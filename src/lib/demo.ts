import "server-only";
import { MONTHLY_DRAW } from "./config";

/**
 * DEMO MODE — a self-contained fake warehouse for screencasts/demos.
 *
 * Set DEMO_MODE=1 and the app never touches Supabase: getWarehouse() returns a
 * mock PostgREST client (demo-client.ts) backed by the tables generated here.
 * Nothing in this module runs unless the flag is on, so production is unaffected.
 *
 * Rules this generator follows so the demo can't teach the wrong thing:
 *  - Every name is fictional (roster AND the client names inside transcripts).
 *    No real agent, no real client, no real pay figure appears anywhere.
 *  - Numbers are internally CONSISTENT: team rows are aggregate-then-rate over
 *    the agent rows (never averaged rates), close_rate = sales/leads, cohort
 *    maturity rises with cohort age. The integrity rules in DATA-CONTRACT.md
 *    hold in the fake data too, so on-screen numbers reconcile if a viewer
 *    checks them.
 *  - Deterministic: one fixed seed, so the same figures appear on every reload
 *    and across retakes of a recording. Only the date window moves.
 */

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}

/* ── deterministic PRNG (mulberry32) ─────────────────────────────────────── */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── date helpers (real "today" so freshness reads green) ────────────────── */
const iso = (d: Date) => d.toISOString().slice(0, 10);
function mondayOf(d: Date): Date {
  const x = new Date(d);
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
/** Same calendar day at an explicit wall-clock time — addDays() carries the
 *  current time-of-day, which would otherwise push "last night's" capture into
 *  the future and make freshness read negative. */
function atClock(d: Date, h: number, m = 0): Date {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/* ── the fictional roster ────────────────────────────────────────────────── */
interface Archetype {
  agent: string;
  /** baseline weekly leads */
  leads: number;
  /** close rate as a fraction */
  close: number;
  /** avg premium per sale */
  ticket: number;
  /** RPA minutes per active day */
  rpa: number;
  /** script adherence 1–5 */
  script: number;
  /** week-to-week volatility (0 = metronome, 1 = wild) */
  swing: number;
  /** cohort place rate as a fraction */
  place: number;
  tenureMo: number;
}

const ACTIVE: Archetype[] = [
  { agent: "Marcus Webb",      leads: 38, close: 0.27, ticket: 1320, rpa: 352, script: 4.3, swing: 0.18, place: 0.71, tenureMo: 26 },
  { agent: "Priya Raman",      leads: 35, close: 0.26, ticket: 1290, rpa: 340, script: 4.1, swing: 0.20, place: 0.69, tenureMo: 19 },
  { agent: "Danielle Fox",     leads: 36, close: 0.24, ticket: 1240, rpa: 322, script: 3.9, swing: 0.24, place: 0.67, tenureMo: 22 },
  { agent: "Tobias Klein",     leads: 34, close: 0.23, ticket: 1205, rpa: 318, script: 3.8, swing: 0.26, place: 0.65, tenureMo: 15 },
  { agent: "Rosa Delgado",     leads: 33, close: 0.22, ticket: 1180, rpa: 305, script: 3.7, swing: 0.28, place: 0.64, tenureMo: 31 },
  { agent: "Jamal Carter",     leads: 32, close: 0.22, ticket: 1150, rpa: 298, script: 3.6, swing: 0.30, place: 0.62, tenureMo: 11 },
  { agent: "Wesley Nakamura",  leads: 31, close: 0.21, ticket: 1120, rpa: 286, script: 3.5, swing: 0.32, place: 0.61, tenureMo: 17 },
  { agent: "Simone Achebe",    leads: 30, close: 0.20, ticket: 1095, rpa: 274, script: 3.4, swing: 0.34, place: 0.59, tenureMo: 9  },
  { agent: "Declan Moore",     leads: 29, close: 0.19, ticket: 1060, rpa: 262, script: 3.3, swing: 0.36, place: 0.57, tenureMo: 13 },
  { agent: "Bianca Ortiz",     leads: 28, close: 0.18, ticket: 1030, rpa: 250, script: 3.2, swing: 0.38, place: 0.55, tenureMo: 7  },
  { agent: "Omar Haddad",      leads: 27, close: 0.17, ticket: 1005, rpa: 240, script: 3.1, swing: 0.40, place: 0.53, tenureMo: 5  },
  { agent: "Harper Lindqvist", leads: 24, close: 0.16, ticket: 980,  rpa: 228, script: 3.0, swing: 0.44, place: 0.51, tenureMo: 2  },
  // Brand-new hires: thin history on purpose, so "judge on leading indicators"
  // and the small-sample markers have something real to demonstrate.
  { agent: "Nina Vasquez",     leads: 18, close: 0.15, ticket: 950,  rpa: 205, script: 2.9, swing: 0.50, place: 0.48, tenureMo: 0.5 },
  { agent: "Ezra Whitfield",   leads: 14, close: 0.14, ticket: 930,  rpa: 190, script: 2.8, swing: 0.55, place: 0.46, tenureMo: 0.3 },
];

const DEPARTED = ["Cody Brennan", "Talia Rosenberg", "Lena Petrov"];

const emailOf = (agent: string) =>
  `${agent.toLowerCase().replace(/[^a-z ]/g, "").split(" ").join(".")}@demoagency.test`;

/** Weeks of history a brand-new hire has (keeps tenure and data consistent). */
const weeksOfHistory = (a: Archetype, total: number) =>
  a.tenureMo >= 6 ? total : Math.max(2, Math.round(a.tenureMo * 4.33));

/* ── the generated warehouse ─────────────────────────────────────────────── */
type Row = Record<string, unknown>;

export interface DemoDb {
  [table: string]: Row[];
}

let cache: DemoDb | null = null;

export function demoDb(): DemoDb {
  if (cache) return cache;
  const r = rng(20260728);
  const jitter = (base: number, swing: number) =>
    Math.max(0, base * (1 + (r() - 0.5) * 2 * swing));

  const today = new Date();
  const thisMonday = mondayOf(today);
  const WEEKS = 26;
  const weekStarts = Array.from({ length: WEEKS }, (_, i) =>
    iso(addDays(thisMonday, -7 * (WEEKS - 1 - i)))
  );
  const syncedAt = new Date(today.getTime() - 8 * 3600_000).toISOString();

  /* dim_agent */
  const dim_agent: Row[] = [
    ...ACTIVE.map((a) => ({
      agent: a.agent, agent_email: emailOf(a.agent), status: "active", synced_at: syncedAt,
    })),
    ...DEPARTED.map((n) => ({
      agent: n, agent_email: emailOf(n), status: "departed", synced_at: syncedAt,
    })),
  ];

  /* ── agent-week facts (the spine everything else derives from) ────────── */
  interface AW { week_start: string; agent: string; leads: number; sales: number; premium: number; sdp: number; rpa: number; script: number; dials: number; talk: number; activeDays: number; }
  const aw: AW[] = [];
  for (const a of ACTIVE) {
    const start = WEEKS - weeksOfHistory(a, WEEKS);
    // A gentle arc so trend arrows and WoW deltas have something to say.
    for (let i = start; i < WEEKS; i++) {
      const arc = 1 + 0.12 * Math.sin((i / WEEKS) * Math.PI * 1.6 + a.leads);
      const leads = Math.max(4, Math.round(jitter(a.leads * arc, a.swing * 0.5)));
      const close = Math.min(0.55, Math.max(0.04, jitter(a.close * arc, a.swing)));
      const sales = Math.max(0, Math.round(leads * close));
      const premium = Math.round(sales * jitter(a.ticket, 0.12));
      const activeDays = 4 + (r() < 0.72 ? 1 : 0);
      aw.push({
        week_start: weekStarts[i], agent: a.agent, leads, sales, premium,
        sdp: Math.round(premium * (0.42 + r() * 0.22)),
        rpa: Math.round(jitter(a.rpa, 0.14)) * activeDays,
        script: round2(Math.min(5, Math.max(1, jitter(a.script, 0.10)))),
        dials: Math.round(jitter(a.rpa * 0.62, 0.18)) * activeDays,
        talk: Math.round(jitter(a.rpa * 0.42, 0.2)) * activeDays,
        activeDays,
      });
    }
  }
  const awByAgent = new Map<string, AW[]>();
  for (const w of aw) {
    if (!awByAgent.has(w.agent)) awByAgent.set(w.agent, []);
    awByAgent.get(w.agent)!.push(w);
  }

  const pct = (num: number, den: number) => (den > 0 ? round2((100 * num) / den) : null);

  /* v_weekly_agent — with per-agent-timeline WoW */
  const v_weekly_agent: Row[] = [];
  for (const [agent, rows] of awByAgent) {
    const arch = ACTIVE.find((x) => x.agent === agent)!;
    rows.forEach((w, i) => {
      const prev = i > 0 ? rows[i - 1] : null;
      const closeNow = pct(w.sales, w.leads);
      const closePrev = prev ? pct(prev.sales, prev.leads) : null;
      const subs = Math.round(w.sales * (0.94 + r() * 0.12));
      const placed = Math.round(subs * arch.place);
      v_weekly_agent.push({
        week_start: w.week_start, agent, agent_email: emailOf(agent), agent_status: "active",
        leads: w.leads, sales: w.sales, premium: w.premium, sdp: w.sdp,
        hp: w.rpa > 0 ? round2(w.premium / (w.rpa / 60)) : null,
        attendance_pct: round2(Math.min(100, 84 + r() * 16)),
        tenure_mo: round2(arch.tenureMo + (i - rows.length + 1) * 0.23),
        outage_days: r() < 0.08 ? 1 : 0,
        ams_submissions: subs, ams_placed: placed, ams_pending: Math.max(0, subs - placed - Math.round(subs * 0.1)),
        close_rate_pct: closeNow,
        premium_per_sale: w.sales > 0 ? round2(w.premium / w.sales) : null,
        ams_place_rate_pct: pct(placed, subs),
        wow_sales: prev ? w.sales - prev.sales : null,
        wow_leads: prev ? w.leads - prev.leads : null,
        wow_premium: prev ? w.premium - prev.premium : null,
        wow_close_rate_pts:
          closeNow != null && closePrev != null ? round2(closeNow - closePrev) : null,
      });
    });
  }

  /* v_weekly_team — aggregate-then-rate (NEVER averaged agent rates) */
  const v_weekly_team: Row[] = weekStarts.map((ws) => {
    const rows = aw.filter((w) => w.week_start === ws);
    const sum = (f: (w: AW) => number) => rows.reduce((s, w) => s + f(w), 0);
    const leads = sum((w) => w.leads), sales = sum((w) => w.sales), premium = sum((w) => w.premium);
    return {
      week_start: ws, leads, sales, premium, sdp: sum((w) => w.sdp),
      active_agents: rows.length,
      ams_submissions: Math.round(sales * 0.98), ams_placed: Math.round(sales * 0.64),
      close_rate_pct: pct(sales, leads),
      premium_per_sale: sales > 0 ? round2(premium / sales) : null,
      premium_per_agent: rows.length ? round2(premium / rows.length) : null,
      wow_sales: null, wow_leads: null, wow_premium: null, wow_close_rate_pts: null,
    };
  });
  for (let i = 1; i < v_weekly_team.length; i++) {
    const c = v_weekly_team[i] as Record<string, number | null>;
    const p = v_weekly_team[i - 1] as Record<string, number | null>;
    c.wow_sales = (c.sales as number) - (p.sales as number);
    c.wow_leads = (c.leads as number) - (p.leads as number);
    c.wow_premium = (c.premium as number) - (p.premium as number);
    c.wow_close_rate_pts =
      c.close_rate_pct != null && p.close_rate_pct != null
        ? round2((c.close_rate_pct as number) - (p.close_rate_pct as number))
        : null;
  }

  /* v_weekly_close_effort */
  const v_weekly_close_effort: Row[] = aw.map((w) => ({
    week_start: w.week_start, agent: w.agent, leads: w.leads, sales: w.sales, premium: w.premium,
    close_rate_pct: pct(w.sales, w.leads),
    dials: w.dials, crm_talk_min: w.talk, rpa_min: w.rpa, active_days: w.activeDays,
    script_adherence: w.script,
    talk_min_per_dial: w.dials > 0 ? round2(w.talk / w.dials) : null,
    leads_per_day: w.activeDays > 0 ? round2(w.leads / w.activeDays) : null,
  }));

  /* daily_activity + v_daily_agent/_team (last 84 days) */
  const daily_activity: Row[] = [];
  const dailyAgentAcc: Row[] = [];
  for (let d = 83; d >= 0; d--) {
    const date = addDays(today, -d);
    const dow = date.getDay();
    const dateS = iso(date);
    const wk = iso(mondayOf(date));
    for (const a of ACTIVE) {
      if (!aw.some((w) => w.agent === a.agent && w.week_start === wk)) continue;
      const weekend = dow === 0 || dow === 6;
      const present = !weekend && r() > 0.06;
      const rpaMin = present ? Math.round(jitter(a.rpa, 0.2)) : 0;
      const dials = present ? Math.round(jitter(a.rpa * 0.62, 0.22)) : 0;
      const leads = present ? Math.max(0, Math.round(jitter(a.leads / 5, 0.3))) : 0;
      const sales = present && r() < a.close * 1.9 ? (r() < 0.16 ? 2 : 1) : 0;
      const premium = sales * Math.round(jitter(a.ticket, 0.13));
      // Script grading is genuinely sparse for some agents upstream — mirror
      // that so the "n graded calls" caveat has something to show.
      const graded = present && r() > (a.tenureMo < 3 ? 0.55 : 0.22);
      daily_activity.push({
        activity_date: dateS, week: wk, agent: a.agent,
        billable_leads: leads, total_dials: dials,
        crm_talk_min: Math.round(rpaMin * 0.42), rpa_min: rpaMin,
        rpa_hrs: round2(rpaMin / 60), idle_hrs: round2(present ? r() * 1.6 : 0),
        present: present ? "Y" : "N",
        script_adherence: graded ? round2(Math.min(5, Math.max(1, jitter(a.script, 0.12)))) : null,
        script_calls: graded ? 2 + Math.round(r() * 7) : null,
        hp: rpaMin > 0 ? round2(premium / (rpaMin / 60)) : null,
        synced_at: syncedAt,
      });
      dailyAgentAcc.push({
        activity_date: dateS, week_start: wk, agent: a.agent, agent_email: emailOf(a.agent),
        agent_status: "active", leads, sales, premium,
        sdp: Math.round(premium * 0.5), close_rate_pct: pct(sales, leads),
        premium_per_sale: sales > 0 ? round2(premium / sales) : null,
        dod_sales: null, dod_leads: null, dod_premium: null,
      });
    }
  }
  const dayKeys = [...new Set(dailyAgentAcc.map((x) => x.activity_date as string))].sort();
  const v_daily_team: Row[] = dayKeys.map((d) => {
    const rows = dailyAgentAcc.filter((x) => x.activity_date === d);
    const sum = (k: string) => rows.reduce((s, x) => s + ((x[k] as number) ?? 0), 0);
    const leads = sum("leads"), sales = sum("sales"), premium = sum("premium");
    return {
      activity_date: d, week_start: rows[0]?.week_start ?? d,
      leads, sales, premium, sdp: sum("sdp"),
      close_rate_pct: pct(sales, leads),
      premium_per_sale: sales > 0 ? round2(premium / sales) : null,
      dod_sales: null, dod_leads: null, dod_premium: null,
    };
  });

  /* placement cohorts — maturity rises with cohort age */
  const monthStarts: string[] = [];
  for (let m = 11; m >= 0; m--) {
    const d = new Date(today.getFullYear(), today.getMonth() - m, 1);
    monthStarts.push(iso(d));
  }
  const v_placement_cohort: Row[] = [];
  for (const a of ACTIVE) {
    for (const [i, cm] of monthStarts.entries()) {
      const ageMonths = monthStarts.length - 1 - i;
      if (a.tenureMo < ageMonths) continue; // no cohorts before they started
      const subs = Math.max(1, Math.round(jitter(a.leads * a.close * 4.2, 0.22)));
      // 0 months old ≈ 65% resolved, ≥3 months ≈ fully baked.
      const maturity = Math.min(1, 0.62 + ageMonths * 0.14);
      const resolved = Math.round(subs * maturity);
      const placed = Math.round(resolved * a.place);
      const declined = resolved - placed;
      v_placement_cohort.push({
        agent: a.agent, agent_status: "active", cohort_month: cm,
        submissions: subs, placed, declined, pending: subs - resolved,
        place_rate_pct: pct(placed, subs),
        resolved_rate_pct: pct(placed, placed + declined),
        maturity_pct: pct(resolved, subs),
      });
    }
  }
  const v_placement_cohort_team: Row[] = monthStarts.map((cm, i) => {
    const rows = v_placement_cohort.filter((c) => c.cohort_month === cm);
    const sum = (k: string) => rows.reduce((s, c) => s + ((c[k] as number) ?? 0), 0);
    const subs = sum("submissions"), placed = sum("placed"), declined = sum("declined");
    return {
      cohort_month: cm, submissions: subs, placed, declined, pending: sum("pending"),
      place_rate_pct: pct(placed, subs),
      resolved_rate_pct: pct(placed, placed + declined),
      mom_place_rate_pts: null as number | null,
      _i: i,
    };
  });
  for (let i = 1; i < v_placement_cohort_team.length; i++) {
    const c = v_placement_cohort_team[i] as Record<string, number | null>;
    const p = v_placement_cohort_team[i - 1] as Record<string, number | null>;
    c.mom_place_rate_pts =
      c.place_rate_pct != null && p.place_rate_pct != null
        ? round2((c.place_rate_pct as number) - (p.place_rate_pct as number))
        : null;
  }

  /* client-level capped placement (per household) */
  const v_client_placement_agent: Row[] = ACTIVE.map((a) => {
    const policies = v_placement_cohort
      .filter((c) => c.agent === a.agent)
      .reduce((s, c) => s + ((c.submissions as number) ?? 0), 0);
    const multi = Math.round(policies * 0.08);
    const clients = policies - multi;
    const pending = Math.round(clients * 0.03);
    const resolved = clients - pending;
    // Capping lifts the rate a few points vs per-policy — the real signal.
    const capped = Math.min(0.95, a.place + 0.045 + r() * 0.02);
    const cappedPlaced = Math.round(resolved * capped);
    return {
      agent: a.agent, agent_status: "active", clients, multi_policy_clients: multi,
      ever_inforce_policies: Math.round(policies * a.place),
      total_policies: policies, clients_capped_placed: cappedPlaced,
      capped_place_rate_pct: pct(cappedPlaced, clients),
      uncapped_place_rate_pct: pct(Math.round(policies * a.place), policies),
      pending_clients: pending, resolved_clients: resolved,
      maturity_pct: pct(resolved, clients),
      capped_place_rate_resolved_pct: pct(cappedPlaced, resolved),
    };
  });
  const cpSum = (k: string) => v_client_placement_agent.reduce((s, c) => s + ((c[k] as number) ?? 0), 0);
  const v_client_placement_team: Row[] = [{
    clients: cpSum("clients"), multi_policy_clients: cpSum("multi_policy_clients"),
    ever_inforce_policies: cpSum("ever_inforce_policies"), total_policies: cpSum("total_policies"),
    clients_capped_placed: cpSum("clients_capped_placed"),
    capped_place_rate_pct: pct(cpSum("clients_capped_placed"), cpSum("clients")),
    uncapped_place_rate_pct: pct(cpSum("ever_inforce_policies"), cpSum("total_policies")),
    pending_clients: cpSum("pending_clients"), resolved_clients: cpSum("resolved_clients"),
    maturity_pct: pct(cpSum("resolved_clients"), cpSum("clients")),
    capped_place_rate_resolved_pct: pct(cpSum("clients_capped_placed"), cpSum("resolved_clients")),
  }];

  /* commission_ledger + comm_summary (fictional pay) */
  const CARRIERS = [
    ["Northwind Mutual", "Legacy Whole Life", "Level"],
    ["Cascade Life", "Simplified WL", "Level"],
    ["Ironwood Assurance", "Graded Benefit", "Graded"],
    ["Ironwood Assurance", "Guaranteed Issue", "GI"],
    ["Meridian Senior", "Term Made Simple", "Term"],
  ];
  const commission_ledger: Row[] = [];
  let pn = 41000;
  const stmtMonths = monthStarts.slice(-7).map((m) => m.slice(0, 7));
  for (const sm of stmtMonths) {
    for (const a of ACTIVE) {
      const n = Math.round(jitter(a.leads * a.close * 3.6, 0.2));
      for (let i = 0; i < n; i++) {
        const [carrier, product, uw] = CARRIERS[Math.floor(r() * CARRIERS.length)];
        const prem = Math.round(jitter(a.ticket, 0.3));
        const isGI = uw === "GI";
        const rate = isGI ? 0.15 : 0.3;
        const gross = isGI ? Math.min(200, round2(prem * rate)) : round2(prem * rate);
        const chargedBack = r() < 0.075;
        const cb = chargedBack ? -gross : 0;
        pn += 1 + Math.floor(r() * 3);
        commission_ledger.push({
          policy_number: `DM-${pn}`, policy_key: String(pn), agent: a.agent,
          agent_email: emailOf(a.agent), carrier, product, uw_type: uw,
          commissionable_premium: prem, rate: `${(rate * 100).toFixed(1)}%`,
          commission: gross, statement_month: sm,
          pay_date: `${sm}-20`, status: chargedBack ? "Charged Back" : "Paid",
          chargeback: cb, chargeback_month: chargedBack ? sm : null,
          chargeback_date: chargedBack ? `${sm}-27` : null,
          net: round2(gross + cb), origin: "CAPTURE", synced_at: syncedAt,
        });
      }
    }
  }
  const comm_summary: Row[] = [];
  for (const sm of stmtMonths) {
    for (const a of ACTIVE) {
      const rows = commission_ledger.filter((x) => x.agent === a.agent && x.statement_month === sm);
      const gross = round2(rows.reduce((s, x) => s + ((x.commission as number) ?? 0), 0));
      const cbs = round2(rows.reduce((s, x) => s + ((x.chargeback as number) ?? 0), 0));
      const net = round2(gross + cbs);
      const inforce = round2(rows.reduce((s, x) => s + ((x.commissionable_premium as number) ?? 0), 0));
      const isCurrent = sm === stmtMonths[stmtMonths.length - 1];
      comm_summary.push({
        agent: a.agent, agent_email: emailOf(a.agent), pay_date: `${sm}-20`,
        pay_date_label: `${sm}-20`, period_type: isCurrent ? "Current Period" : "",
        inforce_premium: inforce, gross_commissions: gross, chargebacks: cbs,
        net_this_period: net, commission_payable: Math.max(0, round2(net - MONTHLY_DRAW)),
        pay_status: isCurrent ? "Accruing" : "Paid",
        effective_rate: inforce > 0 ? round2(gross / inforce) : null,
        policies: rows.length,
        placed: rows.filter((x) => x.status === "Paid").length,
        charged_back: rows.filter((x) => x.status === "Charged Back").length,
        net_after_draw: round2(net - MONTHLY_DRAW), synced_at: syncedAt,
      });
    }
  }

  /* v_uw_mix_week_agent — derived from the ledger's uw_type mix */
  const v_uw_mix_week_agent: Row[] = [];
  for (const a of ACTIVE) {
    for (const ws of weekStarts.slice(-13)) {
      const mix = [["Level", 0.55], ["Graded", 0.2], ["GI", 0.15], ["Term", 0.1]] as const;
      const totalPolicies = Math.max(1, Math.round(jitter(a.leads * a.close, 0.3)));
      for (const [uw, share] of mix) {
        const policies = Math.round(totalPolicies * share);
        if (policies <= 0) continue;
        v_uw_mix_week_agent.push({
          week_start: ws, agent: a.agent, agent_status: "active", uw_type: uw,
          policies, premium: Math.round(policies * jitter(a.ticket, 0.1)),
          total_policies: totalPolicies,
        });
      }
    }
  }

  /* pnl_stack_rank + agent_efficiency */
  const pnl_stack_rank: Row[] = aw.slice(-ACTIVE.length * 13).map((w) => {
    const a = ACTIVE.find((x) => x.agent === w.agent)!;
    const leadCost = Math.round(w.leads * 46);
    const expRev = Math.round(w.premium * 1.4 * a.place);
    const agentCost = Math.max(1000, Math.round(w.premium * 0.3));
    return {
      week_start: w.week_start, agent: w.agent, billable_leads: w.leads, lead_cost: leadCost,
      sales_crm: w.sales, avg_premium: w.sales > 0 ? round2(w.premium / w.sales) : null,
      place_rate_pct: round2(a.place * 100),
      exp_company_rev: expRev, exp_agent_cost: agentCost,
      exp_net_pnl: expRev - agentCost - leadCost,
      act_company_rev: Math.round(expRev * 0.82), act_agent_cost: agentCost,
      act_net_pnl: Math.round(expRev * 0.82) - agentCost - leadCost,
      chargebacks: r() < 0.2 ? -Math.round(jitter(600, 0.6)) : 0,
      act_net_after_cb: Math.round(expRev * 0.8) - agentCost - leadCost,
      synced_at: syncedAt,
    };
  });
  const TIERS = ["Platinum", "Gold", "Silver", "Bronze", "-"];
  const agent_efficiency: Row[] = ACTIVE.map((a, i) => {
    const hp = round2(a.ticket * a.close * 5.2);
    const scored = a.tenureMo >= 2;
    return {
      rank: i + 1, agent: a.agent,
      efficiency_score: scored ? round2(58 + (ACTIVE.length - i) * 2.6 + r() * 3) : 0,
      tier: scored ? TIERS[Math.min(4, Math.floor(i / 3))] : "-",
      place_gated: a.place >= 0.55 ? "Y" : "N",
      adj_net_pnl: Math.round(jitter(9000, 0.5)),
      cleared_draw: a.close > 0.19 ? "Y" : "N",
      bonus_5th: i < 5 ? 1000 : 0,
      place_rate: round2(a.place), raw_place_rate: round2(a.place - 0.02),
      baked_place_rate: round2(a.place),
      true_hp: scored ? round2(hp * a.place) : 0,
      rpa_utilization: round2(Math.min(1, a.rpa / 400)),
      present_days: 18 + Math.round(r() * 4),
      validifi_rate: round2(Math.min(1.15, 0.72 + r() * 0.4)),
      coverage_pct: round2(Math.min(100, 70 + r() * 30)),
      month: monthStarts[monthStarts.length - 1].slice(0, 7),
      tenure_days: Math.round(a.tenureMo * 30.4), on_probation: a.tenureMo < 1 ? "Y" : "N",
      synced_at: syncedAt,
    };
  });

  /* lead sources (CTV-flood story intact, fictional vendors) */
  const SOURCES = [
    ["StreamReach CTV", "CTV", true, 50], ["StreamReach Web", "CTV", true, 21],
    ["Beacon Media", "Paid Social", false, 70], ["Beacon Web", "Paid Social", false, 18],
    ["Harborline Direct", "Direct", false, 68], ["Organic / Referral", "Internal/Organic", false, 0],
  ] as const;
  const v_lead_source_enriched: Row[] = [];
  for (const grain of ["week", "month"] as const) {
    const periods = grain === "week" ? weekStarts.slice(-1) : monthStarts.slice(-5);
    for (const p of periods) {
      for (const a of ACTIVE) {
        for (const [source, group, isCtv, cpl] of SOURCES) {
          const leads = Math.max(0, Math.round(jitter(a.leads * (isCtv ? 0.34 : 0.15), 0.4)));
          if (!leads) continue;
          const accepted = Math.round(leads * (0.86 + r() * 0.12));
          const salesIcd = Math.round(accepted * a.close * 0.55);
          v_lead_source_enriched.push({
            period_start: p, grain, agent: a.agent, source, source_group: group,
            is_ctv: isCtv, dim_cost_per_lead: cpl, billed_on_total: false,
            leads, accepted, sales_icd: salesIcd, lead_cost: accepted * cpl,
            icd_close_pct: pct(salesIcd, accepted),
          });
        }
      }
    }
  }

  /* mailer */
  const mailer_scan_snapshot: Row[] = [];
  let scans = 8200, uniq = 6100, sends = 41000;
  for (let d = 120; d >= 0; d--) {
    const date = addDays(today, -d);
    scans += Math.round(jitter(58, 0.5)); uniq += Math.round(jitter(41, 0.5));
    sends += Math.round(jitter(320, 0.4));
    mailer_scan_snapshot.push({
      snap_date: iso(date), total_scans: scans, unique_scans: uniq, total_sends: sends,
      taken_at: new Date(date.getTime() + 18 * 3600_000).toISOString(),
    });
  }

  /* Film Room — fictional transcripts, no real client data anywhere */
  const CLIENTS = ["Harold P.", "Wanda J.", "Clarence B.", "Ruth M.", "Vernon S.", "Etta L.", "Roy D.", "Mabel T."];
  const call_transcripts: Row[] = [];
  const v_agent_day_trigger: Row[] = [];
  let uu = 0;
  // Date-driven, not agent-driven: the capture job runs every weeknight and
  // flags whoever had an outlier day. That keeps the Data Health capture panel
  // honest-and-green (recent last-capture, only Fri→Mon gaps, which classify as
  // self-healed) while still producing the uneven per-agent coverage that makes
  // the Film Room story real — some agents have lots of film, some have little.
  const filmAgents = ACTIVE.slice(0, 10);
  for (let d = 27; d >= 1; d--) {
    const date = addDays(today, -d);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue; // no weekend captures
    const triggered = 1 + Math.floor(r() * 2);
    for (let t = 0; t < triggered; t++) {
      // Weighted pick: earlier agents in the list trigger more often, so
      // coverage is lopsided the way it is in the real warehouse.
      const idx = Math.min(filmAgents.length - 1, Math.floor(Math.abs(r() - r()) * filmAgents.length * 1.4));
      const a = filmAgents[idx];
      const hot = r() < 0.55;
      const daySales = hot ? 3 + Math.round(r() * 2) : 0;
      const calls = 2 + Math.floor(r() * 2);
      for (let c = 0; c < calls; c++) {
        uu += 1;
        const client = CLIENTS[Math.floor(r() * CLIENTS.length)];
        const dur = hot ? 900 + Math.round(r() * 900) : 240 + Math.round(r() * 300);
        call_transcripts.push({
          conversation_uuid: `demo-${String(uu).padStart(4, "0")}-0000-0000-000000000000`,
          agent: a.agent, call_date: iso(date),
          started_at: atClock(date, 9 + c * 2, 15).toISOString(),
          title: `${a.agent} · ${client} — final expense`,
          trigger: hot ? "hot" : "cold",
          day_sales: daySales, day_premium: daySales * Math.round(a.ticket),
          day_dials: Math.round(jitter(a.rpa * 0.6, 0.2)),
          overall_score: round2(hot ? 3.9 + r() * 1.0 : 2.2 + r() * 1.0),
          duration_sec: dur,
          // The nightly job runs ~11 PM on the call day itself.
          captured_at: atClock(date, 23, 10).toISOString(),
          transcript: demoTranscript(a.agent, client, hot),
        });
      }
      v_agent_day_trigger.push({
        agent: a.agent, call_date: iso(date),
        avg_duration_sec: hot ? 1200 : 380, call_count: calls,
        sales: daySales, premium: daySales * Math.round(a.ticket),
        duration_percentile: round2(hot ? 0.82 + r() * 0.15 : r() * 0.2),
        cold_candidate: !hot, is_hot: hot, is_cold_streak: !hot,
      });
    }
  }

  cache = {
    dim_agent,
    v_weekly_agent,
    v_weekly_team,
    v_weekly_close_effort,
    daily_activity,
    v_daily_agent: dailyAgentAcc,
    v_daily_team,
    v_placement_cohort,
    v_placement_cohort_team,
    v_client_placement_agent,
    v_client_placement_team,
    commission_ledger,
    comm_summary,
    v_uw_mix_week_agent,
    pnl_stack_rank,
    agent_efficiency,
    v_lead_source_enriched,
    mailer_scan_snapshot,
    call_transcripts,
    v_agent_day_trigger,
    // A clean bill of health reads better on camera than invented problems.
    v_data_quality: [],
    app_roster_override: [],
    // weekly_data/placement_cohort are only probed for freshness stamps.
    weekly_data: [{ synced_at: syncedAt }],
    placement_cohort: [{ synced_at: syncedAt }],
    lead_source_week: [{ captured_at: syncedAt }],
  };
  return cache;
}

/** A short, obviously-fictional call. Hot = discovery + close; cold = rushed. */
function demoTranscript(agent: string, client: string, hot: boolean): string {
  const open = `${agent}:\nHi, is this ${client}? This is ${agent} calling on a recorded line from the benefits center about the final expense information you requested. How are you today?\n\nClient:\nOh yes, I did send that card in.\n\n`;
  if (hot) {
    return (
      open +
      `${agent}:\nWonderful. Before I quote anything, help me understand what you're hoping this covers.\n\nClient:\nI buried my sister last year and it cost the family almost nine thousand dollars. I don't want my kids going through that.\n\n${agent}:\nI'm really sorry you went through that. That's exactly what this is for, and we'll make sure your family never sees that bill. Let me ask a few health questions so I can find the right carrier for you.\n\nClient:\nI take blood pressure medication, that's about it.\n\n${agent}:\nPerfect, that keeps you in the best tier. For ten thousand in coverage that's going to run about forty-one dollars a month, locked in for life, and it never goes up. Does that fit comfortably in the budget?\n\nClient:\nThat's less than I expected, honestly.\n\n${agent}:\nGreat. Let's get the draft date set to match your Social Security deposit so it's never a surprise — is the third of the month better, or the seventeenth?\n\nClient:\nThe third works.\n\n${agent}:\nDone. I'll get the bank information verified while we're on the line so nothing holds up your approval.\n\n[DEMO DATA — fictional call, fictional client. Not a real transcript.]`
    );
  }
  return (
    open +
    `${agent}:\nGreat, so I've got a plan here starting around fifty dollars a month for ten thousand in coverage. Does that sound like something you'd want to move forward with?\n\nClient:\nWell, hold on. I don't know anything about it yet.\n\n${agent}:\nSure, it's whole life, it never expires, rates never go up. So we'd just need your bank information to lock it in today.\n\nClient:\nI'd need to talk to my daughter first before I give anybody my account number.\n\n${agent}:\nI understand. When would be a good time to call back?\n\nClient:\nMaybe next week sometime.\n\n${agent}:\nOkay, I'll try you then. Have a good one.\n\n[DEMO DATA — fictional call, fictional client. Not a real transcript. Note the missing discovery: no "why", no health questions, no draft date, and price came before value.]`
  );
}
