import { BRAND_FULL } from "./brand";
import "server-only";
import { buildStackRank } from "./stackrank";
import {
  getTeamWeeks,
  getPlacementCohorts,
  getLeadSources,
  getDailyAgent,
  getDailyActivity,
  getActiveAgents,
} from "./queries";
import { buildTeamLiveWeek } from "./live";
import { fetchAll, getWarehouse } from "./supabase";
import { createAuthClient, type Viewer } from "./auth";
import { fmtInt, fmtMoney, fmtPct, fmtWeek, fmtMonth, agentSlug } from "./format";
import { BADGE_META } from "./badges";
import { computeUwMix } from "./underwriting";
import type { CommissionLedgerRow, CommSummaryRow, DimAgentRow } from "./types";

/**
 * "Coach" — the in-app chat bot. Everyone gets the agent-safe board context
 * (ratings, weekly production, badges — same numbers as the weekly email).
 * A signed-in AGENT additionally gets their OWN book: commission-ledger line
 * items, pay periods, placement cohorts, and lead-source mix. That personal
 * block is:
 *   - scoped by the viewer's identity (never another agent's pay), and
 *   - fetched through the viewer's OWN Supabase session (anon key + their JWT),
 *     so the pay-table RLS policies (supabase/rls-commissions.sql) enforce
 *     own-row access at the database — a bug here cannot leak someone else's
 *     book. Client PII never appears (the ledger carries none; transcripts are
 *     never loaded).
 *
 * Provider is picked from env: ANTHROPIC_API_KEY or OPENAI_API_KEY
 * (Anthropic wins when both are set). Optional COACH_MODEL overrides the
 * default model for whichever provider is active.
 */

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function coachConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

/** Monthly draw threshold — payable = max(0, net − draw). Matches comm team. */
import { MONTHLY_DRAW, DRAW_LABEL } from "./config";

/** Most line items the book block will carry; older months stay as totals. */
const MAX_LEDGER_LINES = 200;

/** Trailing window for the day-by-day itemization (~2 workweeks + buffer). */
const DAILY_WINDOW_DAYS = 16;

const SYSTEM_PROMPT = `You are "Coach" — the assistant inside ${BRAND_FULL} Mode, a Madden-style
stats app for a small remote final-expense life-insurance sales team. Agents ask you why their
numbers look the way they do.

How the ratings work (explain in plain language when asked):
- OVR (40–99) blends six attributes: Closing (CLS, 25%), Placement (PLC, 25%), Production
  (VOL, 20%), Hustle (HUS, 15%), Discipline (GRD, 10%), Consistency (CNS, 5%). Weights
  renormalize when an attribute has no data.
- Each attribute takes the agent's LAST 8 WEEKS of production and grades it on a curve against
  the whole team's last 12 weeks. So OVR is 8 weeks of body-of-work, not one week — one hot or
  cold week moves it a little, never all of it. That's usually the answer to "why is X rated
  higher/lower than me this week".
- True HP (horsepower) = hourly premium × place rate, from the official efficiency scorecard.
  It's a THIS-WEEK output-speed number; OVR is an 8-week body-of-work number. They can easily
  disagree, and that's by design.
- EFF is the official efficiency score behind bonuses (separate from OVR, rate-tilted).
- Place rate only counts submission-month cohorts that are at least 70% resolved ("baked") —
  young cohorts read artificially low, which is why some agents show "baking".
- Close rate = sales ÷ leads. Always mention the lead count; a rate on 15 leads swings hard.

This week vs. last completed week (important — this is the #1 source of confusion):
- The weekly premium/sales/close numbers on the board and in your context are the LAST COMPLETED
  week (Monday-anchored, the week that ended last Saturday) — the same week the Monday meeting
  reviews. They are NOT the current, in-progress week.
- The current week is tracked separately as "This week so far" (week-to-date). It is ALWAYS
  compared to the SAME point last week — e.g. Monday–Tuesday this week vs Monday–Tuesday last
  week — never to last week's finished total. Powered by day-grain daily sales.
- So when an agent panics that they're "way down this week" mid-week, that's almost always the
  partial-week illusion (two days can't beat a full week). Reassure them and use the week-to-date
  comparison in the "This week so far (team)" context line, not the completed-week numbers.

Film Room — hot/cold days and cold streaks (explain the concept; you do NOT have per-agent film):
- Hot/cold days come from call DURATION and conversions, not dial counts (this is an inbound shop,
  so dial volume undercounts effort). A HOT day = you converted AND your calls ran longer than
  your own typical (median) call — "what working sounds like." A COLD day = zero sales with an
  off-median call-length profile. A COLD STREAK = two or more cold days in a row; a single bad day
  is just noise, so never call one day "cold."
- Two cold patterns with OPPOSITE fixes: "Rushed" = calls shorter than your median → you're likely
  skipping discovery/objection-handling, so slow down and let the client talk. "Over-talked" =
  calls longer than your median but still not closing → you're over-explaining and not asking for
  the sale, so tighten the presentation and ask for the close sooner.
- Transcripts are PRIVATE: an agent may review only their OWN calls, in their Film Library (via
  their manager). You don't have transcript text or anyone's per-day film data here — if asked
  "am I in a cold streak" or to review a specific call, explain what the terms mean and point them
  to their Film Library / manager.

AGENT BOOK(S) (a "YOUR BOOK" or "AGENT BOOK" block may be present):
- The block holds one agent's own policies from the commission ledger (carrier, product,
  premium, commission, paid/charged-back), their pay periods, placement cohorts, lead-source
  mix, and a day-by-day breakdown. Discuss whatever books ARE present freely and by the numbers.
- Who gets which book is decided BEFORE you see the context, so trust it: an AGENT only ever gets
  their OWN book (so to an agent, never speculate about another agent's pay — it's not there). A
  MANAGER is authorized to see EVERY agent's data and gets the book of any agent they name.
- Manager, agent not loaded: if a manager asks about an agent whose book ISN'T in the context,
  don't guess pay/policy numbers from the board — ask them to name the agent (spell out the full
  name if a nickname didn't resolve) and it'll load on the next turn. You CAN still give that
  agent's week-level board stats (they're in the stack rank).
- Pay math: commission payable per statement month = max(0, net commission − ${DRAW_LABEL} monthly
  draw). "Net after draw" is the signed version and can be negative; payable cannot. A pay date
  on the 20th covers the PRIOR month's production — always talk in statement months.
- Settled statement months are FROZEN snapshots; the commission team's statement is the source
  of truth for actual pay. If a number looks wrong, the answer is "verify with your manager /
  the commission team", not a recalculation.
- Chargebacks: coach on the pattern (which carrier/product, how soon after placement), never
  shame on dollars. High producers always have more absolute chargeback dollars.
- Underwriting mix & net effective rate: the book block has a UW-mix summary. Net effective
  rate = net commission ÷ commissionable premium (what the shop keeps after chargebacks); gross
  effective uses gross commission, so the gap between them is chargeback drag. Commission by
  class: Level and Term pay 30%, Graded and GI pay 15% — so a mix that skews to Level/Term pays a
  higher net effective rate AND usually takes less chargeback drag. "Improve your net effective
  rate" usually means "write more Level/Term, fewer GI/Graded", plus tighter placement to cut
  clawbacks. Quote the mix percentages and the net-effective number from the block; don't invent
  them. "Unknown" (a genuinely blank product name) is a data gap, not a real UW class — flag it,
  don't coach on it.
- Placement cohorts: judge by SUBMISSION month with maturity. A cohort under ~70% matured has a
  meaningless place rate — say it's still baking. Always mention submissions (sample size).
- Lead mix: per-source AGGREGATES only — individual lead records don't exist in this warehouse,
  so you can't look up a specific lead or phone call. "ICD close" in the lead-mix lines is
  one-call-close, a DIFFERENT stat from the CRM close rate on the board — never compare the two.
- Day-by-day: the "Day-by-day" block itemizes the agent's last ~2 weeks — CRM leads/sales/close/
  premium merged with effort (dials, talk-min, RPA hours, script score, attendance). Use it when
  they ask to break down recent days, spot a pattern (e.g. slow Mondays, a no-sale day with low
  talk time), or compare two days. But day counts are SMALL and noisy: one zero-sale day is not a
  slump, and a single day's close rate on a handful of leads means little. Coach recent days as
  behavior/effort, not verdicts, and roll up to the week when they want a real read. These are
  day-grain rows, not the completed-week board numbers — don't conflate them.

Rules:
- Use ONLY the data in the context block. If asked about something not in it (an individual lead
  record, film transcripts, or an agent book that isn't loaded), say you don't have that here —
  for a manager, ask them to name the agent so it loads; for an agent, point them to their manager.
  Never invent pay or policy numbers that aren't in front of you.
- Be a coach: honest about the numbers, constructive about the path up. Never shame. When an
  agent is below the team on a stat, mention the sample size and one lever they control
  (leads worked, talk time, placement follow-up, consistency).
- Keep answers short — a tight paragraph or two, or a few bullets. Cite the actual numbers.
- Write plain text only: no markdown, no asterisks, no headers. The chat renders raw text.
- Names: reps may go by nicknames or short forms (e.g. "Drew" for "Andrew"). Match generously.`;

const pctStr = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(0)}%`;

/** Pay-table numerics come back as strings over PostgREST — coerce, don't trust. */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const usd = (v: unknown): string => fmtMoney(toNum(v));

/** "2026-07-20" -> "Mon Jul 20" (plain date, no TZ shift) — for daily lines. */
function fmtDayLabel(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Column subsets actually selected from the pay tables (keeps prompts lean). */
type LedgerLite = Pick<
  CommissionLedgerRow,
  | "policy_number"
  | "agent"
  | "carrier"
  | "product"
  | "uw_type"
  | "commissionable_premium"
  | "commission"
  | "statement_month"
  | "status"
  | "chargeback"
  | "chargeback_month"
  | "net"
>;
type PeriodLite = Pick<
  CommSummaryRow,
  | "agent"
  | "pay_date_label"
  | "period_type"
  | "commission_payable"
  | "net_after_draw"
  | "policies"
  | "placed"
  | "charged_back"
  | "pay_status"
>;

/**
 * One agent's book — ledger line items, pay periods, placement cohorts, lead
 * mix, and a day-by-day breakdown. Two callers:
 *   - mode "own": the AGENT viewing themselves. Pay tables are read through the
 *     viewer's own session (anon key + JWT) so pay-table RLS enforces own-row
 *     access in Postgres. (Dev AUTH_DISABLED has no session → warehouse client;
 *     the explicit agent filter still scopes it.)
 *   - mode "manager": a MANAGER pulling any agent by name. Managers are
 *     authorized for all agent data, so pay tables are read with the server-only
 *     warehouse client (service role), same as every other manager page — the
 *     app's role gating upstream is what authorizes it.
 * The explicit agent filter is always applied. Failures must not take down team
 * questions — the caller catches and degrades.
 */
async function buildAgentBook(agent: string, mode: "own" | "manager"): Promise<string> {
  const rls =
    mode === "own" && process.env.AUTH_DISABLED !== "1"
      ? await createAuthClient()
      : getWarehouse();

  const [ledger, periods, cohorts, monthMix, weekMix, dailySales, dailyEffort] =
    await Promise.all([
    fetchAll<LedgerLite>((from, to) =>
      rls
        .from("commission_ledger")
        .select(
          "policy_number, agent, carrier, product, uw_type, commissionable_premium, commission, statement_month, status, chargeback, chargeback_month, net"
        )
        .eq("agent", agent)
        .order("statement_month", { ascending: true })
        .range(from, to)
    ),
    fetchAll<PeriodLite>((from, to) =>
      rls
        .from("comm_summary")
        .select(
          "agent, pay_date_label, period_type, commission_payable, net_after_draw, policies, placed, charged_back, pay_status"
        )
        .eq("agent", agent)
        .range(from, to)
    ),
    getPlacementCohorts(agent),
    getLeadSources("month", 150, { agent }),
    getLeadSources("week", 8, { agent }),
    getDailyAgent({ agent, sinceDays: DAILY_WINDOW_DAYS }),
    getDailyActivity({ agent, sinceDays: DAILY_WINDOW_DAYS }),
  ]);

  const out: string[] = [
    mode === "own"
      ? `=== YOUR BOOK — ${agent} (this viewer's OWN data; nobody else can see it) ===`
      : `=== AGENT BOOK — ${agent} (manager view; you are authorized to see this) ===`,
  ];

  // --- Ledger: month totals first, then line items (newest months first). ---
  const dated = ledger.filter((r) => r.statement_month); // null months = seed rows, excluded from pay math
  const byMonth = new Map<string, LedgerLite[]>();
  for (const r of dated) {
    const k = r.statement_month!;
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(r);
  }
  const months = [...byMonth.keys()].sort().reverse();

  if (months.length === 0) {
    out.push("No policies in the commission ledger yet.");
  } else {
    const nowMonth = new Date().toISOString().slice(0, 7);
    out.push("Policies by statement month (statement month = production month):");
    for (const m of months) {
      const rows = byMonth.get(m)!;
      const net = rows.reduce((a, r) => a + (toNum(r.net) ?? 0), 0);
      const cb = rows.filter((r) => r.status === "Charged Back");
      const payable = Math.max(0, net - MONTHLY_DRAW);
      const accruing = m >= nowMonth ? " (still accruing — not settled)" : "";
      out.push(
        `- ${fmtMonth(m)}: ${rows.length} policies, net ${fmtMoney(net)}, ` +
          `${cb.length} charged back, payable ${fmtMoney(payable)} (net − ${DRAW_LABEL} draw, floored at 0)${accruing}`
      );
    }

    const items = dated
      .slice()
      .sort((a, b) => (b.statement_month! < a.statement_month! ? -1 : 1))
      .slice(0, MAX_LEDGER_LINES);
    out.push(
      `Line items${dated.length > items.length ? ` (most recent ${items.length} of ${dated.length}; older months are in the totals above)` : ""}:`
    );
    for (const r of items) {
      const cb =
        r.status === "Charged Back"
          ? ` CHARGED BACK ${usd(r.chargeback)}${r.chargeback_month ? ` in ${fmtMonth(r.chargeback_month)}` : ""}`
          : "";
      out.push(
        `- ${fmtMonth(r.statement_month!)} · #${r.policy_number} · ${r.carrier ?? "?"} ${r.product ?? ""}` +
          `${r.uw_type ? ` (${r.uw_type})` : ""} · premium ${usd(r.commissionable_premium)} · ` +
          `commission ${usd(r.commission)} · ${r.status}${cb}`
      );
    }
  }

  // --- Underwriting mix & net effective rate (entire book). ---
  const uwMix = computeUwMix(ledger);
  if (uwMix.totalPolicies > 0) {
    out.push(
      "Underwriting mix & net effective rate (entire book; net effective = net commission ÷ commissionable premium, i.e. what's kept after chargebacks):"
    );
    for (const b of uwMix.buckets) {
      out.push(
        `- ${b.label}: ${fmtInt(b.policies)} policies (${fmtPct(b.pctPolicies, 0)}), ` +
          `net eff ${fmtPct(b.netEffRatePct, 1)} (gross ${fmtPct(b.grossEffRatePct, 1)}, ` +
          `chargeback drag ${fmtPct(b.chargebackDragPct, 1)}), ${fmtMoney(b.commPremium)} premium`
      );
    }
    out.push(
      `Blended: net effective ${fmtPct(uwMix.blendedNetEffRatePct, 1)} ` +
        `(gross ${fmtPct(uwMix.blendedGrossEffRatePct, 1)}) on ${fmtMoney(uwMix.totalCommPremium)} premium. ` +
        `Unclassified (blank/Unknown uw_type): ${fmtInt(uwMix.unclassifiedPolicies)} (${fmtPct(uwMix.unclassifiedPct, 1)}).`
    );
  }

  // --- Pay periods (comm_summary — the commission team's own math). ---
  if (periods.length) {
    out.push(
      "Pay periods (a pay date on the 20th covers the PRIOR month's production; 'Current Period'/'Future' rows are still accruing):"
    );
    for (const p of periods) {
      out.push(
        `- ${p.pay_date_label ?? "?"}${p.period_type ? ` [${p.period_type}]` : ""}: ` +
          `payable ${usd(p.commission_payable)}, net after draw ${usd(p.net_after_draw)}, ` +
          `${fmtInt(toNum(p.policies))} policies (${fmtInt(toNum(p.placed))} placed, ` +
          `${fmtInt(toNum(p.charged_back))} charged back)${p.pay_status ? ` · ${p.pay_status}` : ""}`
      );
    }
  }

  // --- Placement cohorts (submission month, with maturity + sample size). ---
  if (cohorts.length) {
    out.push("Placement cohorts (by SUBMISSION month; under ~70% matured = still baking):");
    for (const c of cohorts) {
      out.push(
        `- ${fmtMonth(c.cohort_month)}: ${fmtInt(c.submissions)} submitted, ${fmtInt(c.placed)} placed, ` +
          `${fmtInt(c.declined)} declined, ${fmtInt(c.pending)} pending → place rate ${fmtPct(c.place_rate_pct)} ` +
          `(${fmtPct(c.maturity_pct, 0)} matured)`
      );
    }
  }

  // --- Lead-source mix (aggregates only; no lead-level records exist). ---
  // Month and week grains are NEVER combined — separate lines by design.
  if (monthMix.length) {
    out.push(
      "Lead mix by month (ICD close = one-call-close, NOT the CRM close rate on the board):"
    );
    const mixMonths = new Map<string, typeof monthMix>();
    for (const r of monthMix) {
      const k = r.period_start.slice(0, 7);
      if (!mixMonths.has(k)) mixMonths.set(k, []);
      mixMonths.get(k)!.push(r);
    }
    for (const [m, rows] of [...mixMonths.entries()].sort()) {
      const parts = rows
        .filter((r) => (r.leads ?? 0) > 0)
        .sort((a, b) => (b.leads ?? 0) - (a.leads ?? 0))
        .map(
          (r) =>
            `${r.source}${r.is_ctv ? " [CTV]" : ""} ${fmtInt(r.leads)} leads` +
            `${r.sales_icd != null ? ` (ICD close ${fmtPct(r.icd_close_pct, 0)})` : ""}`
        );
      if (parts.length) out.push(`- ${fmtMonth(m)}: ${parts.join(" · ")}`);
    }
  }
  if (weekMix.length) {
    const parts = weekMix
      .filter((r) => (r.leads ?? 0) > 0)
      .sort((a, b) => (b.leads ?? 0) - (a.leads ?? 0))
      .map((r) => `${r.source}${r.is_ctv ? " [CTV]" : ""} ${fmtInt(r.leads)} leads`);
    if (parts.length)
      out.push(`This week's leads so far (current week, refreshed nightly): ${parts.join(" · ")}`);
  }

  // --- Day-by-day (the last ~2 workweeks). Sales/premium from v_daily_agent,
  // effort from daily_activity, merged by date. Day counts are SMALL-N and
  // noisy — this is for "itemize my last few days", never trend analysis. ---
  const salesByDay = new Map<string, (typeof dailySales)[number]>();
  for (const r of dailySales) salesByDay.set(r.activity_date.slice(0, 10), r);
  const effortByDay = new Map<string, (typeof dailyEffort)[number]>();
  for (const r of dailyEffort) effortByDay.set(r.activity_date.slice(0, 10), r);

  const allDays = [...new Set([...salesByDay.keys(), ...effortByDay.keys()])].sort().reverse();
  if (allDays.length) {
    out.push(
      "Day-by-day, last ~2 weeks (day-grain is small and noisy — good for itemizing recent days, not for trends; leads/sales/close/premium are CRM, the rest is effort):"
    );
    for (const day of allDays) {
      const s = salesByDay.get(day);
      const e = effortByDay.get(day);
      const prod: string[] = [];
      if (s) {
        prod.push(
          `${fmtInt(s.leads)} leads`,
          `${fmtInt(s.sales)} sales`,
          `close ${fmtPct(s.close_rate_pct, 0)}`,
          `${fmtMoney(s.premium)} premium`
        );
      }
      const eff: string[] = [];
      if (e) {
        if (e.total_dials != null) eff.push(`${fmtInt(e.total_dials)} dials`);
        if (e.crm_talk_min != null) eff.push(`${fmtInt(e.crm_talk_min)} talk-min`);
        if (e.rpa_min != null) eff.push(`${(e.rpa_min / 60).toFixed(1)} RPA hrs`);
        if (e.script_adherence != null)
          eff.push(`script ${e.script_adherence.toFixed(1)}/5 (${fmtInt(e.script_calls)} calls)`);
        if (e.present && e.present.toLowerCase() !== "yes") eff.push(`present: ${e.present}`);
      }
      const segs = [...prod, ...eff];
      out.push(`- ${fmtDayLabel(day)}: ${segs.length ? segs.join(", ") : "no activity recorded"}`);
    }
  }

  return out.join("\n");
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How many agent books a manager can pull into one turn (token budget). */
const MAX_MANAGER_BOOKS = 4;

/**
 * Which active agents did the manager name? Matches full name, slug, or any
 * name token ≥3 chars as a whole word (so "Dana", "Reyes", "Dana Reyes", and
 * "eric-marrs" all resolve). For managers only — over-matching just adds
 * context they're already authorized to see, so we err toward inclusion.
 */
function resolveNamedAgents(query: string, agents: DimAgentRow[]): string[] {
  const q = ` ${query.toLowerCase()} `;
  const matched: string[] = [];
  for (const a of agents) {
    const name = a.agent.toLowerCase();
    const slug = agentSlug(a.agent);
    const tokens = name.split(/\s+/).filter((t) => t.length >= 3);
    const hit =
      q.includes(name) ||
      q.includes(slug) ||
      tokens.some((t) => new RegExp(`\\b${escapeRegExp(t)}\\b`).test(q));
    if (hit) matched.push(a.agent);
  }
  return matched;
}

/**
 * Board context everyone gets, plus agent book(s):
 *   - an AGENT gets their OWN book;
 *   - a MANAGER gets the book of any agent they named in the conversation
 *     (managers are authorized for all agent data).
 * `userText` is the recent user turns, used to resolve which agent a manager
 * is asking about.
 */
export async function buildCoachContext(viewer: Viewer, userText = ""): Promise<string> {
  const [stack, teamWeeks, live] = await Promise.all([
    buildStackRank(),
    getTeamWeeks(2),
    buildTeamLiveWeek(),
  ]);
  const week = stack.weekStart ? fmtWeek(stack.weekStart) : "—";
  const team = teamWeeks[teamWeeks.length - 1];

  const lines = stack.rows.map((r) => {
    const parts = [
      `#${r.rank ?? "—"} ${r.agent}`,
      `OVR ${r.ovr ?? "no data"}${r.ovr != null ? ` (${r.tier.label})` : ""}`,
      `EFF ${r.effScore ?? "—"}${r.effTier ? ` ${r.effTier}` : ""}`,
      `week: ${fmtMoney(r.weekPremium)} premium, ${fmtInt(r.weekSales)} sales, close ${fmtPct(
        r.weekClose
      )} on ${fmtInt(r.weekLeads)} leads`,
      `True HP ${r.trueHp != null ? `$${Math.round(r.trueHp)}/hr` : "not scored yet"}`,
      `hustle ${r.rpaMinPerDay != null ? `${(r.rpaMinPerDay / 60).toFixed(1)} hrs/day` : "—"}`,
      `place rate ${
        r.placeRate != null ? `${fmtPct(r.placeRate, 0)} (n=${fmtInt(r.placeN)})` : "baking"
      }`,
    ];
    if (r.badges.length) {
      parts.push(
        `badges: ${r.badges.map((b) => `${BADGE_META[b.key].name} (${b.detail})`).join(", ")}`
      );
    }
    return "- " + parts.join(" · ");
  });

  const liveLine =
    live.hasData && live.throughLabel
      ? `This week so far (team, through ${live.throughLabel}, week-to-date vs the SAME weekdays last week): ` +
        `${fmtMoney(live.premium.wtd)} premium (${pctStr(live.premium.deltaPct)}), ` +
        `${fmtInt(live.sales.wtd)} sales (${pctStr(live.sales.deltaPct)}), ` +
        `close ${fmtPct(live.closeRatePct)} on ${fmtInt(live.leads.wtd)} leads` +
        `${live.premium.projected != null ? `; on pace for ~${fmtMoney(live.premium.projected)} by week end` : ""}. ` +
        `Day counts are small — a pace read, not a trend.`
      : "This week so far (team): no activity synced yet this week.";

  // --- Book(s): the agent's own, or the agent(s) a manager named. ---
  let viewerLine: string;
  const bookBlocks: string[] = [];

  if (viewer.role === "agent" && viewer.agent) {
    viewerLine = `You are talking to ${viewer.agent} (an agent — their own book follows the board data; use their numbers in first person).`;
    try {
      bookBlocks.push(await buildAgentBook(viewer.agent, "own"));
    } catch (e) {
      console.error("coach book (own):", e);
      bookBlocks.push(
        "=== YOUR BOOK === (your policy/pay data couldn't be loaded right now — answer board questions normally and suggest trying again in a minute for pay questions)"
      );
    }
  } else {
    // Manager: resolve which agent(s) they asked about and load those books.
    let named: string[] = [];
    try {
      const active = await getActiveAgents();
      named = resolveNamedAgents(userText, active).slice(0, MAX_MANAGER_BOOKS);
    } catch (e) {
      console.error("coach resolve agents:", e);
    }
    viewerLine =
      `You are talking to a manager (${viewer.email}) — authorized to see EVERY agent's ` +
      `individual data. ` +
      (named.length
        ? `Books for the agent(s) they named follow. If they ask about a DIFFERENT agent, that agent's book won't be loaded yet — ask them to name that agent.`
        : `They haven't named a specific agent yet — the board covers the whole team; if they want one agent's policies/pay/day-by-day, they just name the agent.`);
    for (const agent of named) {
      try {
        bookBlocks.push(await buildAgentBook(agent, "manager"));
      } catch (e) {
        console.error(`coach book (manager:${agent}):`, e);
        bookBlocks.push(`=== AGENT BOOK — ${agent} === (couldn't be loaded right now — try again in a moment)`);
      }
    }
  }

  return [
    viewerLine,
    `LAST COMPLETED week of ${week} (this is the finished week the board shows — NOT the current week). Stack rank (ordered by OVR):`,
    ...lines,
    team
      ? `Team, last completed week: ${fmtInt(team.leads)} leads, ${fmtInt(
          team.sales
        )} sales, close ${fmtPct(team.close_rate_pct)}, ${fmtMoney(team.premium)} premium.`
      : "",
    liveLine,
    ...bookBlocks,
    `Data is a nightly batch${stack.syncedAt ? `, last synced ${stack.syncedAt}` : ""} — not live.`,
  ]
    .filter(Boolean)
    .join("\n");
}

const MAX_MESSAGES = 20;
const MAX_CHARS = 4000;

export async function askCoach(messages: ChatMessage[], viewer: Viewer): Promise<string> {
  const trimmed = messages
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  // Recent user turns drive manager agent-name resolution; weight the latest.
  const userText = trimmed
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => m.content)
    .join("  ");
  const context = await buildCoachContext(viewer, userText);
  const system = `${SYSTEM_PROMPT}\n\n=== CONTEXT (current data) ===\n${context}`;

  if (process.env.ANTHROPIC_API_KEY) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.COACH_MODEL ?? "claude-sonnet-5",
        max_tokens: 1000, // room for a full day-by-day itemization
        system,
        messages: trimmed,
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    return data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
  }

  if (process.env.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.COACH_MODEL ?? "gpt-4o-mini",
        max_tokens: 1000, // room for a full day-by-day itemization
        messages: [{ role: "system", content: system }, ...trimmed],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      choices: { message: { content: string | null } }[];
    };
    return data.choices[0]?.message?.content ?? "";
  }

  throw new Error("No LLM provider configured");
}
