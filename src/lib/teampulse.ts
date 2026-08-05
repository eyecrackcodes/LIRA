import "server-only";
import type { WeeklyTeamRow, WeeklyAgentRow } from "./types";
import { isWeekInProgress } from "./weeks";
import type { SalesStarts } from "./queries";
import { salesTenure } from "./queries";

/**
 * Team Pulse rollups: a selectable trailing window, calendar-month trends, and
 * roster movement.
 *
 * THE RULE THAT MATTERS: every rate here is aggregate-then-rate — Σsales ÷
 * Σleads across the period, never the mean of the weekly percentages. Averaging
 * rates weights a 30-lead week the same as a 300-lead week and produces numbers
 * that disagree with `v_weekly_team`, Looker, and the Monday deck.
 *
 * In-progress weeks are excluded from every rollup: a partial week drags a
 * period total down and would read as a decline. The live tracker at the top of
 * the page is where the current week belongs.
 */

export const TEAM_WINDOWS = [
  { weeks: 4, label: "Last 4 weeks" },
  { weeks: 6, label: "Last 6 weeks" },
  { weeks: 8, label: "Last 8 weeks" },
  { weeks: 12, label: "Last 12 weeks" },
  { weeks: 26, label: "Last 26 weeks" },
] as const;

export type TeamWindowWeeks = (typeof TEAM_WINDOWS)[number]["weeks"];
export const DEFAULT_TEAM_WINDOW: TeamWindowWeeks = 6;

export function coerceTeamWindow(n: unknown): TeamWindowWeeks {
  const v = Number(n);
  const hit = TEAM_WINDOWS.find((w) => w.weeks === v);
  return hit ? hit.weeks : DEFAULT_TEAM_WINDOW;
}

const sum = (xs: (number | null | undefined)[]) =>
  xs.reduce<number>((a, b) => a + (b ?? 0), 0);
const rate = (num: number, den: number) => (den > 0 ? (100 * num) / den : null);
const pctChange = (now: number, prev: number) =>
  prev > 0 ? (100 * (now - prev)) / prev : null;

export interface PeriodTotals {
  label: string;
  weeks: number;
  leads: number;
  sales: number;
  premium: number;
  sdp: number;
  closeRatePct: number | null;
  premiumPerSale: number | null;
  premiumPerAgent: number | null;
  /** Mean active agents across the period — headcount, not a rate. */
  avgActiveAgents: number | null;
  sdpSharePct: number | null;
}

function totals(rows: WeeklyTeamRow[], label: string): PeriodTotals {
  const leads = sum(rows.map((r) => r.leads));
  const sales = sum(rows.map((r) => r.sales));
  const premium = sum(rows.map((r) => r.premium));
  const sdp = sum(rows.map((r) => r.sdp));
  const agentWeeks = rows.filter((r) => (r.active_agents ?? 0) > 0);
  const avgActiveAgents = agentWeeks.length
    ? sum(agentWeeks.map((r) => r.active_agents)) / agentWeeks.length
    : null;
  return {
    label,
    weeks: rows.length,
    leads,
    sales,
    premium,
    sdp,
    closeRatePct: rate(sales, leads),
    premiumPerSale: sales > 0 ? premium / sales : null,
    premiumPerAgent: avgActiveAgents ? premium / avgActiveAgents : null,
    avgActiveAgents,
    sdpSharePct: rate(sdp, premium),
  };
}

export interface WindowComparison {
  current: PeriodTotals;
  prior: PeriodTotals | null;
  delta: {
    leadsPct: number | null;
    salesPct: number | null;
    premiumPct: number | null;
    closeRatePts: number | null;
    premiumPerSalePct: number | null;
    premiumPerAgentPct: number | null;
  };
}

/**
 * The last `n` complete weeks vs the `n` complete weeks before them — a
 * like-for-like comparison, which a single WoW delta can't give you (one hot
 * week reads as a trend). `prior` is null until enough history exists; showing
 * a delta against a short prior period would overstate the swing.
 */
export function buildTeamWindow(
  allWeeks: WeeklyTeamRow[],
  n: number
): WindowComparison {
  const complete = allWeeks
    .filter((w) => !isWeekInProgress(w.week_start))
    .sort((a, b) => (a.week_start < b.week_start ? -1 : 1));

  const cur = complete.slice(-n);
  const priorRows = complete.slice(-2 * n, -n);
  const current = totals(cur, `last ${cur.length} wk`);
  const prior = priorRows.length === n ? totals(priorRows, `prior ${n} wk`) : null;

  return {
    current,
    prior,
    delta: {
      leadsPct: prior ? pctChange(current.leads, prior.leads) : null,
      salesPct: prior ? pctChange(current.sales, prior.sales) : null,
      premiumPct: prior ? pctChange(current.premium, prior.premium) : null,
      closeRatePts:
        prior && current.closeRatePct != null && prior.closeRatePct != null
          ? current.closeRatePct - prior.closeRatePct
          : null,
      premiumPerSalePct:
        prior && current.premiumPerSale != null && prior.premiumPerSale != null
          ? pctChange(current.premiumPerSale, prior.premiumPerSale)
          : null,
      premiumPerAgentPct:
        prior && current.premiumPerAgent != null && prior.premiumPerAgent != null
          ? pctChange(current.premiumPerAgent, prior.premiumPerAgent)
          : null,
    },
  };
}

export interface MonthPoint {
  month: string; // YYYY-MM
  weeks: number;
  leads: number;
  sales: number;
  premium: number;
  closeRatePct: number | null;
  premiumPerSale: number | null;
  avgActiveAgents: number | null;
  /** Month-over-month, vs the immediately preceding month in this series. */
  momPremiumPct: number | null;
  momSalesPct: number | null;
  momCloseRatePts: number | null;
  /** A month still accumulating weeks — don't read its total as final. */
  partial: boolean;
}

/** How many Mondays a calendar month contains — i.e. how many weekly rows a
 *  COMPLETE month must have, given weeks are Monday-anchored. */
function mondaysInMonth(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  let n = 0;
  while (d.getUTCMonth() === m - 1) {
    if (d.getUTCDay() === 1) n++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return n;
}

/**
 * Calendar-month rollup of complete weeks, bucketed by the week's MONDAY.
 *
 * Month edges are therefore fuzzy: a week straddling the 1st lands wholly in
 * the month its Monday falls in, so these totals will not tie exactly to a
 * calendar-month report out of ICD/AMS. That's expected and documented in
 * DATA-CONTRACT — weekly and all-time are the exact grains.
 *
 * `partial` = this month is missing weeks, measured as "fewer rows than the
 * month has Mondays". That catches BOTH ends of the series, which is the whole
 * point: the current month is still accumulating, and the FIRST month is
 * usually truncated because the warehouse history starts mid-month. Flagging
 * only the current month (the obvious implementation) leaves a 2-week opening
 * month acting as a full baseline, and the month after it then reports a
 * spectacular fake gain. So a MoM delta is also suppressed whenever the prior
 * month is partial — same rule as the trailing window's `prior`: no comparison
 * against an incomplete base.
 */
export function buildMonthlyTeam(allWeeks: WeeklyTeamRow[]): MonthPoint[] {
  const complete = allWeeks.filter((w) => !isWeekInProgress(w.week_start));
  const byMonth = new Map<string, WeeklyTeamRow[]>();
  for (const w of complete) {
    const key = w.week_start.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(w);
  }

  const months = [...byMonth.keys()].sort();
  const stats = months.map((m) => {
    const t = totals(byMonth.get(m)!, m);
    return { month: m, t, partial: t.weeks < mondaysInMonth(m) };
  });

  return stats.map((cur, i) => {
    const { month: m, t, partial } = cur;
    const prev = stats[i - 1];
    // Only compare against a month that actually finished.
    const p = prev && !prev.partial ? prev.t : null;
    return {
      month: m,
      weeks: t.weeks,
      leads: t.leads,
      sales: t.sales,
      premium: t.premium,
      closeRatePct: t.closeRatePct,
      premiumPerSale: t.premiumPerSale,
      avgActiveAgents: t.avgActiveAgents,
      momPremiumPct: p ? pctChange(t.premium, p.premium) : null,
      momSalesPct: p ? pctChange(t.sales, p.sales) : null,
      momCloseRatePts:
        p && t.closeRatePct != null && p.closeRatePct != null
          ? t.closeRatePct - p.closeRatePct
          : null,
      partial,
    };
  });
}

export interface RosterInsights {
  activeNow: number;
  departedTotal: number;
  /** Started selling inside the window (first production week observed). */
  startedInWindow: { agent: string; startedOn: string }[];
  /** Departures recorded with a date inside the window. */
  departedInWindow: { agent: string; departedOn: string | null }[];
  /** Headcount at the start vs end of the window, from v_weekly_team. */
  headcountFirst: number | null;
  headcountLast: number | null;
  /** Active agents with zero sales across the whole window — a coaching list. */
  zeroSaleAgents: string[];
  /** Share of window premium written by the top 3 agents. */
  top3SharePct: number | null;
}

export function buildRosterInsights(opts: {
  teamWeeks: WeeklyTeamRow[];
  agentWeeks: WeeklyAgentRow[];
  activeAgents: string[];
  departed: Set<string>;
  departures: { agent: string; departedOn: string | null }[];
  salesStarts: SalesStarts;
  windowWeeks: number;
}): RosterInsights {
  const {
    teamWeeks,
    agentWeeks,
    activeAgents,
    departed,
    departures,
    salesStarts,
    windowWeeks,
  } = opts;

  const complete = teamWeeks
    .filter((w) => !isWeekInProgress(w.week_start))
    .sort((a, b) => (a.week_start < b.week_start ? -1 : 1))
    .slice(-windowWeeks);
  const from = complete[0]?.week_start ?? null;
  const to = complete[complete.length - 1]?.week_start ?? null;

  const inWindow = (d: string | null) => !!d && !!from && !!to && d >= from && d <= to;

  const startedInWindow = activeAgents
    .map((a) => {
      const { startedOn, observed } = salesTenure(salesStarts, a);
      return observed && inWindow(startedOn)
        ? { agent: a, startedOn: startedOn! }
        : null;
    })
    .filter((x): x is { agent: string; startedOn: string } => x !== null)
    .sort((a, b) => (a.startedOn < b.startedOn ? -1 : 1));

  // Per-agent window production, for the zero-sale list and concentration.
  const premiumByAgent = new Map<string, number>();
  const salesByAgent = new Map<string, number>();
  for (const w of agentWeeks) {
    if (!from || !to || w.week_start < from || w.week_start > to) continue;
    if (departed.has(w.agent)) continue;
    premiumByAgent.set(w.agent, (premiumByAgent.get(w.agent) ?? 0) + (w.premium ?? 0));
    salesByAgent.set(w.agent, (salesByAgent.get(w.agent) ?? 0) + (w.sales ?? 0));
  }

  const zeroSaleAgents = activeAgents
    .filter((a) => (salesByAgent.get(a) ?? 0) === 0 && premiumByAgent.has(a))
    .sort();

  const premiums = [...premiumByAgent.values()].sort((a, b) => b - a);
  const totalPremium = premiums.reduce((a, b) => a + b, 0);
  const top3 = premiums.slice(0, 3).reduce((a, b) => a + b, 0);

  return {
    activeNow: activeAgents.length,
    departedTotal: departed.size,
    startedInWindow,
    departedInWindow: departures
      .filter((d) => inWindow(d.departedOn))
      .sort((a, b) => ((a.departedOn ?? "") < (b.departedOn ?? "") ? -1 : 1)),
    headcountFirst: complete[0]?.active_agents ?? null,
    headcountLast: complete[complete.length - 1]?.active_agents ?? null,
    zeroSaleAgents,
    top3SharePct: totalPremium > 0 ? (100 * top3) / totalPremium : null,
  };
}
