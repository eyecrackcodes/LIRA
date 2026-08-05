import "server-only";
import { getWarehouse, fetchAll } from "./supabase";
import { departedAgentSet } from "./roster";
import type {
  WeeklyTeamRow,
  WeeklyAgentRow,
  DailyTeamRow,
  DailyAgentRow,
  AgentDayTriggerRow,
  PlacementCohortRow,
  PlacementCohortTeamRow,
  ClientPlacementAgentRow,
  ClientPlacementTeamRow,
  CloseEffortRow,
  LeadSourceEnrichedRow,
  DailyActivityRow,
  CommissionLedgerRow,
  PnlStackRankRow,
  AgentEfficiencyRow,
  MailerSnapshotRow,
  DimAgentRow,
  DataQualityRow,
  CallTranscriptRow,
  CallTranscriptFullRow,
} from "./types";

/** Some numeric-ish warehouse columns (numeric/decimal) come back as strings
 *  over PostgREST — coerce defensively rather than trust the wire type. */
function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export interface Freshness {
  maxSyncedAt: string | null;
  perTable: { table: string; at: string | null }[];
}

/** max(synced_at/captured_at/taken_at) per table — rendered on every page. */
export async function getFreshness(): Promise<Freshness> {
  const sb = getWarehouse();
  const probe = async (table: string, col: string) => {
    const { data, error } = await sb
      .from(table)
      .select(col)
      .order(col, { ascending: false })
      .limit(1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const row = (data?.[0] ?? null) as unknown as Record<string, string> | null;
    return { table, at: row ? row[col] : null };
  };
  const perTable = await Promise.all([
    probe("weekly_data", "synced_at"),
    probe("daily_activity", "synced_at"),
    probe("commission_ledger", "synced_at"),
    probe("placement_cohort", "synced_at"),
    probe("lead_source_week", "captured_at"),
    probe("mailer_scan_snapshot", "taken_at"),
  ]);
  const mirrors = perTable.filter((t) =>
    ["weekly_data", "daily_activity", "commission_ledger", "placement_cohort"].includes(t.table)
  );
  const maxSyncedAt =
    mirrors.map((t) => t.at).filter(Boolean).sort().pop() ?? null;
  return { maxSyncedAt, perTable };
}

export async function getTeamWeeks(limit = 26): Promise<WeeklyTeamRow[]> {
  const sb = getWarehouse();
  const { data, error } = await sb
    .from("v_weekly_team")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as WeeklyTeamRow[]).reverse();
}

export async function getAgentWeeks(opts?: {
  agent?: string;
  sinceDays?: number;
}): Promise<WeeklyAgentRow[]> {
  const sb = getWarehouse();
  return fetchAll<WeeklyAgentRow>((from, to) => {
    let q = sb
      .from("v_weekly_agent")
      .select("*")
      .order("week_start", { ascending: true })
      .order("agent", { ascending: true })
      .range(from, to);
    if (opts?.agent) q = q.eq("agent", opts.agent);
    if (opts?.sinceDays) q = q.gte("week_start", isoDaysAgo(opts.sinceDays));
    return q;
  });
}

/**
 * Day-grain team totals (v_daily_team) — the ONLY day-grain sales/premium
 * source. Small-N per day; for the "this week so far" live tracker only, never
 * trend analysis (use v_weekly_team for that). Default window covers the
 * current week plus a few prior weeks for the same-point-last-week baseline.
 */
export async function getDailyTeam(sinceDays = 35): Promise<DailyTeamRow[]> {
  const sb = getWarehouse();
  const { data, error } = await sb
    .from("v_daily_team")
    .select("*")
    .gte("activity_date", isoDaysAgo(sinceDays))
    .order("activity_date", { ascending: true });
  if (error) throw new Error(error.message);
  return data as DailyTeamRow[];
}

/** Day-grain per-agent totals (v_daily_agent) — same caveats as getDailyTeam. */
export async function getDailyAgent(opts?: {
  agent?: string;
  sinceDays?: number;
}): Promise<DailyAgentRow[]> {
  const sb = getWarehouse();
  return fetchAll<DailyAgentRow>((from, to) => {
    let q = sb
      .from("v_daily_agent")
      .select("*")
      .gte("activity_date", isoDaysAgo(opts?.sinceDays ?? 35))
      .order("activity_date", { ascending: true })
      .range(from, to);
    if (opts?.agent) q = q.eq("agent", opts.agent);
    return q;
  });
}

/**
 * Film Room duration-based hot/cold triggers (v_agent_day_trigger). Manager-
 * only surface (derived from client-PII film capture). Window covers enough
 * recent worked days to measure a current cold streak. See FILM-ROOM-PROMPT.md.
 */
export async function getAgentDayTriggers(sinceDays = 45): Promise<AgentDayTriggerRow[]> {
  const sb = getWarehouse();
  return fetchAll<AgentDayTriggerRow>((from, to) =>
    sb
      .from("v_agent_day_trigger")
      .select(
        "agent, call_date, avg_duration_sec, call_count, sales, premium, duration_percentile, cold_candidate, is_hot, is_cold_streak"
      )
      .gte("call_date", isoDaysAgo(sinceDays))
      .order("agent", { ascending: true })
      .order("call_date", { ascending: true })
      .range(from, to)
  );
}

export async function getActiveAgents(): Promise<DimAgentRow[]> {
  const sb = getWarehouse();
  const { data, error } = await sb
    .from("dim_agent")
    .select("*")
    .eq("status", "active")
    .order("agent");
  if (error) throw new Error(error.message);
  // Layer app-side departures over the nightly sheet-mirror (see lib/roster):
  // a "hung-up jersey" drops off the active roster immediately and stays off
  // even though dim_agent will keep saying 'active' until the sheet catches up.
  const departed = await departedAgentSet();
  return (data as DimAgentRow[]).filter((a) => !departed.has(a.agent));
}

export async function getPlacementCohorts(agent?: string): Promise<PlacementCohortRow[]> {
  const sb = getWarehouse();
  return fetchAll<PlacementCohortRow>((from, to) => {
    let q = sb
      .from("v_placement_cohort")
      .select("*")
      .order("cohort_month", { ascending: true })
      .range(from, to);
    if (agent) q = q.eq("agent", agent);
    return q;
  });
}

export async function getPlacementCohortTeam(): Promise<PlacementCohortTeamRow[]> {
  const sb = getWarehouse();
  const { data, error } = await sb
    .from("v_placement_cohort_team")
    .select("*")
    .order("cohort_month", { ascending: true });
  if (error) throw new Error(error.message);
  return data as PlacementCohortTeamRow[];
}

export async function getClientPlacementAgent(): Promise<ClientPlacementAgentRow[]> {
  const sb = getWarehouse();
  const { data, error } = await sb
    .from("v_client_placement_agent")
    .select("*")
    .order("agent", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    agent: r.agent as string,
    agent_status: r.agent_status as "active" | "departed",
    clients: toNum(r.clients),
    multi_policy_clients: toNum(r.multi_policy_clients),
    ever_inforce_policies: toNum(r.ever_inforce_policies),
    total_policies: toNum(r.total_policies),
    clients_capped_placed: toNum(r.clients_capped_placed),
    capped_place_rate_pct: toNum(r.capped_place_rate_pct),
    uncapped_place_rate_pct: toNum(r.uncapped_place_rate_pct),
    pending_clients: toNum(r.pending_clients),
    resolved_clients: toNum(r.resolved_clients),
    maturity_pct: toNum(r.maturity_pct),
    capped_place_rate_resolved_pct: toNum(r.capped_place_rate_resolved_pct),
  }));
}

export async function getClientPlacementTeam(): Promise<ClientPlacementTeamRow | null> {
  const sb = getWarehouse();
  const { data, error } = await sb.from("v_client_placement_team").select("*").limit(1);
  if (error) throw new Error(error.message);
  const r = (data?.[0] ?? null) as Record<string, unknown> | null;
  if (!r) return null;
  return {
    clients: toNum(r.clients),
    multi_policy_clients: toNum(r.multi_policy_clients),
    ever_inforce_policies: toNum(r.ever_inforce_policies),
    total_policies: toNum(r.total_policies),
    clients_capped_placed: toNum(r.clients_capped_placed),
    capped_place_rate_pct: toNum(r.capped_place_rate_pct),
    uncapped_place_rate_pct: toNum(r.uncapped_place_rate_pct),
    pending_clients: toNum(r.pending_clients),
    resolved_clients: toNum(r.resolved_clients),
    maturity_pct: toNum(r.maturity_pct),
    capped_place_rate_resolved_pct: toNum(r.capped_place_rate_resolved_pct),
  };
}

export async function getCloseEffort(opts?: {
  agent?: string;
  sinceDays?: number;
}): Promise<CloseEffortRow[]> {
  const sb = getWarehouse();
  return fetchAll<CloseEffortRow>((from, to) => {
    let q = sb
      .from("v_weekly_close_effort")
      .select("*")
      .order("week_start", { ascending: true })
      .range(from, to);
    if (opts?.agent) q = q.eq("agent", opts.agent);
    if (opts?.sinceDays) q = q.gte("week_start", isoDaysAgo(opts.sinceDays));
    return q;
  });
}

/**
 * Grain-filtered fetch — never mix grains in one aggregation (DATA-CONTRACT).
 * 'week' rows exist only for the current week (refreshed nightly);
 * 'month' rows are the historical backfill.
 */
export async function getLeadSources(
  grain: "week" | "month",
  sinceDays = 120,
  opts?: { agent?: string }
): Promise<LeadSourceEnrichedRow[]> {
  const sb = getWarehouse();
  return fetchAll<LeadSourceEnrichedRow>((from, to) => {
    let q = sb
      .from("v_lead_source_enriched")
      .select("*")
      .eq("grain", grain)
      .gte("period_start", isoDaysAgo(sinceDays))
      .order("period_start", { ascending: true })
      .range(from, to);
    if (opts?.agent) q = q.eq("agent", opts.agent);
    return q;
  });
}

export async function getDailyActivity(opts?: {
  agent?: string;
  sinceDays?: number;
}): Promise<DailyActivityRow[]> {
  const sb = getWarehouse();
  return fetchAll<DailyActivityRow>((from, to) => {
    let q = sb
      .from("daily_activity")
      .select(
        "activity_date, week, agent, billable_leads, total_dials, crm_talk_min, rpa_min, rpa_hrs, idle_hrs, present, script_adherence, script_calls, hp, synced_at"
      )
      .gte("activity_date", isoDaysAgo(opts?.sinceDays ?? 84))
      .order("activity_date", { ascending: true })
      .range(from, to);
    if (opts?.agent) q = q.eq("agent", opts.agent);
    return q;
  });
}

/**
 * First week each agent shows up in production data — i.e. tenure SELLING.
 *
 * WHY THIS EXISTS: `weekly_data.tenure_mo` is tenure with the COMPANY, not time
 * on the phones. Agents promoted from another seat (customer service, for
 * example) carry months of company tenure into week one of selling, so keying
 * "is this a new agent?" off tenure_mo tells the manager to judge a two-week
 * rookie on trailing revenue — exactly backwards. Anything that means "time as
 * an agent" should use this instead.
 *
 * Deliberately unwindowed: the whole point is to see a start date that may sit
 * far outside the trailing window the pages load.
 */
export interface SalesStarts {
  /** agent → first week they appear in production data. */
  starts: Map<string, string>;
  /**
   * Earliest week in the whole table. An agent whose first week EQUALS this
   * predates the data — their real start is unknowable from here, so it must
   * not be read as "started recently".
   */
  datasetStart: string | null;
}

export async function getAgentSalesStart(): Promise<SalesStarts> {
  const sb = getWarehouse();
  const rows = await fetchAll<{ agent: string; week_start: string }>((from, to) =>
    sb
      .from("weekly_data")
      .select("agent, week_start")
      .order("week_start", { ascending: true })
      .range(from, to)
  );
  const starts = new Map<string, string>();
  let datasetStart: string | null = null;
  for (const r of rows) {
    if (!r.agent || !r.week_start) continue;
    if (!datasetStart || r.week_start < datasetStart) datasetStart = r.week_start;
    const prev = starts.get(r.agent);
    if (!prev || r.week_start < prev) starts.set(r.agent, r.week_start);
  }
  return { starts, datasetStart };
}

/** Whole months between an ISO date and now. */
export function monthsSince(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / (1000 * 60 * 60 * 24 * 30.44);
}

/**
 * Time as an AGENT, and whether we can actually trust it.
 *
 * `observed` is the important flag: false means the agent was already selling
 * before this dataset begins, so `months` is a floor (the length of the data),
 * not their tenure. Callers must treat un-observed agents as ESTABLISHED —
 * otherwise every veteran reads as a rookie the moment the history is short.
 */
export function salesTenure(s: SalesStarts, agent: string) {
  const startedOn = s.starts.get(agent) ?? null;
  const observed =
    startedOn != null && s.datasetStart != null && startedOn > s.datasetStart;
  return { startedOn, observed, months: observed ? monthsSince(startedOn) : null };
}

export async function getCommissionLedger(): Promise<CommissionLedgerRow[]> {
  const sb = getWarehouse();
  return fetchAll<CommissionLedgerRow>((from, to) =>
    sb
      .from("commission_ledger")
      .select("*")
      .order("statement_month", { ascending: true })
      .order("agent", { ascending: true })
      .range(from, to)
  );
}

/** Ledger rows trimmed to the columns the UW-mix + net-effective-rate roll-ups
 *  need (whole-book table and the month-over-month trend). */
export type UwLedgerRow = Pick<
  CommissionLedgerRow,
  "agent" | "statement_month" | "uw_type" | "commissionable_premium" | "commission" | "chargeback" | "net"
>;

const UW_LEDGER_COLS =
  "agent, statement_month, uw_type, commissionable_premium, commission, chargeback, net";

/** One agent only — a per-agent (incl. agent-self) view never pulls the team book. */
export async function getAgentUwLedger(agent: string): Promise<UwLedgerRow[]> {
  const sb = getWarehouse();
  return fetchAll<UwLedgerRow>((from, to) =>
    sb.from("commission_ledger").select(UW_LEDGER_COLS).eq("agent", agent).range(from, to)
  );
}

/** Whole-team ledger (trimmed). Server-only; callers aggregate to blended
 *  monthly numbers before anything reaches the client — no individual pay is
 *  ever sent, so this backs the team-average benchmark line safely. */
export async function getTeamUwLedger(): Promise<UwLedgerRow[]> {
  const sb = getWarehouse();
  return fetchAll<UwLedgerRow>((from, to) =>
    sb.from("commission_ledger").select(UW_LEDGER_COLS).range(from, to)
  );
}

/**
 * Week-grain UW mix from v_uw_mix_week_agent — policies bucketed on
 * date_trunc('week', inforce_date), so this is a TRUE weekly placement trend
 * (63 wks of coverage) rather than the statement-month cut the ledger forces.
 *
 * SOURCE CAVEAT: agent_policy_detail is a live, full-nightly rewrite (fresh
 * from AMS each night), NOT a frozen snapshot like commission_ledger — a very
 * recently-placed policy's inforce_date can still settle a few days. Perfect
 * for a count/mix trend; commission_ledger stays the paycheck-exact source of
 * truth for anything that must tie to a statement dollar-for-dollar. The view
 * coalesces null/blank uw_type into "Unknown" (no stray null bucket).
 */
export interface UwMixWeekRow {
  week_start: string;
  agent: string;
  agent_status: string | null;
  uw_type: string | null;
  policies: number;
  premium: number;
  total_policies: number;
  pct_of_week: number;
}

const UW_MIX_WEEK_COLS =
  "week_start, agent, agent_status, uw_type, policies, premium, total_policies, pct_of_week";

export async function getUwMixWeekAgent(agent: string): Promise<UwMixWeekRow[]> {
  const sb = getWarehouse();
  const rows = await fetchAll<Record<string, unknown>>((from, to) =>
    sb
      .from("v_uw_mix_week_agent")
      .select(UW_MIX_WEEK_COLS)
      .eq("agent", agent)
      .order("week_start", { ascending: true })
      .range(from, to)
  );
  // PostgREST returns numeric/bigint as strings — coerce so the client math is safe.
  return rows.map((r) => ({
    week_start: String(r.week_start ?? ""),
    agent: String(r.agent ?? ""),
    agent_status: (r.agent_status as string | null) ?? null,
    uw_type: (r.uw_type as string | null) ?? null,
    policies: Number(r.policies) || 0,
    premium: Number(r.premium) || 0,
    total_policies: Number(r.total_policies) || 0,
    pct_of_week: Number(r.pct_of_week) || 0,
  }));
}

export async function getPnlStackRank(sinceDays = 90): Promise<PnlStackRankRow[]> {
  const sb = getWarehouse();
  const { data, error } = await sb
    .from("pnl_stack_rank")
    .select("*")
    .gte("week_start", isoDaysAgo(sinceDays))
    .order("week_start", { ascending: true })
    .order("agent", { ascending: true });
  if (error) throw new Error(error.message);
  return data as PnlStackRankRow[];
}

/** Nightly-overwritten snapshot — one row per agent, the official scorecard. */
export async function getAgentEfficiency(): Promise<AgentEfficiencyRow[]> {
  const sb = getWarehouse();
  const { data, error } = await sb
    .from("agent_efficiency")
    .select("*")
    .order("rank", { ascending: true });
  if (error) throw new Error(error.message);
  return data as AgentEfficiencyRow[];
}

export async function getMailerSnapshots(sinceDays = 180): Promise<MailerSnapshotRow[]> {
  const sb = getWarehouse();
  const { data, error } = await sb
    .from("mailer_scan_snapshot")
    .select("*")
    .gte("snap_date", isoDaysAgo(sinceDays))
    .order("snap_date", { ascending: true });
  if (error) throw new Error(error.message);
  return data as MailerSnapshotRow[];
}

export async function getDataQuality(): Promise<DataQualityRow[]> {
  const sb = getWarehouse();
  const { data, error } = await sb.from("v_data_quality").select("*");
  if (error) throw new Error(error.message);
  return data as DataQualityRow[];
}

function toFilmMeta(r: Record<string, unknown>): CallTranscriptRow {
  return {
    conversation_uuid: r.conversation_uuid as string,
    agent: r.agent as string,
    call_date: r.call_date as string,
    started_at: r.started_at as string,
    title: (r.title as string) ?? null,
    trigger: r.trigger as "hot" | "cold",
    day_sales: toNum(r.day_sales),
    day_premium: toNum(r.day_premium),
    day_dials: toNum(r.day_dials),
    overall_score: toNum(r.overall_score),
    duration_sec: toNum(r.duration_sec),
    captured_at: r.captured_at as string,
  };
}

/**
 * Film Room — light rows (no transcript body) for the library/day-timeline
 * views. Contains client names/details — caller MUST gate with
 * requireManager() before rendering (see DATA-CONTRACT § call_transcripts).
 */
export async function getFilmMeta(opts?: {
  agent?: string;
  sinceDays?: number;
}): Promise<CallTranscriptRow[]> {
  const sb = getWarehouse();
  const rows = await fetchAll<Record<string, unknown>>((from, to) => {
    let q = sb
      .from("call_transcripts")
      .select(
        "conversation_uuid, agent, call_date, started_at, title, trigger, day_sales, day_premium, day_dials, overall_score, duration_sec, captured_at"
      )
      .order("call_date", { ascending: false })
      .order("started_at", { ascending: true })
      .range(from, to);
    if (opts?.agent) q = q.eq("agent", opts.agent);
    if (opts?.sinceDays) q = q.gte("call_date", isoDaysAgo(opts.sinceDays));
    return q;
  });
  return rows.map(toFilmMeta);
}

export interface FilmCaptureHealth {
  /** max(captured_at) ever — regardless of the lookback window below. */
  lastCapturedAt: string | null;
  /** Distinct calendar dates the capture job inserted ≥1 row, within lookbackDays, ascending. */
  runDates: string[];
  /** Gaps >1 day between consecutive run dates within the window — see health/page.tsx for how these read. */
  gaps: { from: string; to: string; days: number }[];
  lookbackDays: number;
}

/**
 * Film Room capture-job health. Unlike the mirror tables (full nightly
 * refresh -> synced_at always advances), call_transcripts is trigger-based:
 * a quiet night with no agent hot/cold day inserts nothing, so "no new rows"
 * is normal, not evidence of an outage. What IS a useful signal: the nightly
 * job runs `--backscan=3` (self-heals the prior 2 days), so a gap of >3 days
 * between capture-run dates means real data may have been missed beyond that
 * window — not just a quiet team. See health/page.tsx for the read.
 */
export async function getFilmCaptureHealth(lookbackDays = 30): Promise<FilmCaptureHealth> {
  const sb = getWarehouse();
  const { data: latest, error: latestErr } = await sb
    .from("call_transcripts")
    .select("captured_at")
    .order("captured_at", { ascending: false })
    .limit(1);
  if (latestErr) throw new Error(latestErr.message);
  const lastCapturedAt =
    (latest?.[0] as { captured_at: string } | undefined)?.captured_at ?? null;

  const rows = await fetchAll<{ captured_at: string }>((from, to) =>
    sb
      .from("call_transcripts")
      .select("captured_at")
      .gte("captured_at", isoDaysAgo(lookbackDays))
      .order("captured_at", { ascending: true })
      .range(from, to)
  );
  const runDates = [...new Set(rows.map((r) => r.captured_at.slice(0, 10)))].sort();
  const gaps: { from: string; to: string; days: number }[] = [];
  for (let i = 1; i < runDates.length; i++) {
    const days = Math.round(
      (Date.parse(runDates[i]) - Date.parse(runDates[i - 1])) / 86_400_000
    );
    if (days > 1) gaps.push({ from: runDates[i - 1], to: runDates[i], days });
  }
  return { lastCapturedAt, runDates, gaps, lookbackDays };
}

/** Film Room — just the owning agent of one call, for access checks. */
export async function getFilmCallOwner(conversationUuid: string): Promise<string | null> {
  const sb = getWarehouse();
  const { data, error } = await sb
    .from("call_transcripts")
    .select("agent")
    .eq("conversation_uuid", conversationUuid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { agent: string } | null)?.agent ?? null;
}

/**
 * Film Room — one full row including the transcript body (avg ~23K chars,
 * up to ~106K). Fetch on demand only, never in a list. Caller MUST gate with
 * canViewAgentFilm() (manager, or the agent's own call).
 */
export async function getCallTranscript(
  conversationUuid: string
): Promise<CallTranscriptFullRow | null> {
  const sb = getWarehouse();
  const { data, error } = await sb
    .from("call_transcripts")
    .select("*")
    .eq("conversation_uuid", conversationUuid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return { ...toFilmMeta(r), transcript: (r.transcript as string) ?? "" };
}

/**
 * Film Room — full rows (incl. transcripts) for one DAY's worth of calls, so
 * Session View can pick the most objection-rich default. One round trip; only
 * ever called with a single day's call list (≤ ~10 rows), never a whole
 * library. Same access rule as getCallTranscript: gate with canViewAgentFilm().
 */
export async function getCallTranscriptsByUuids(
  conversationUuids: string[]
): Promise<CallTranscriptFullRow[]> {
  if (conversationUuids.length === 0) return [];
  const sb = getWarehouse();
  const { data, error } = await sb
    .from("call_transcripts")
    .select("*")
    .in("conversation_uuid", conversationUuids);
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown>[]).map((r) => ({
    ...toFilmMeta(r),
    transcript: (r.transcript as string) ?? "",
  }));
}
