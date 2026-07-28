import "server-only";
import {
  getAgentWeeks,
  getTeamWeeks,
  getDailyActivity,
  getPlacementCohorts,
  getAgentEfficiency,
  getActiveAgents,
} from "./queries";
import type { WeeklyAgentRow, DailyActivityRow } from "./types";
import { fmtWeek, fmtMonth } from "./format";
import { currentWeekStart } from "./weeks";

/**
 * Data assembly for the Performance Trends (1:1 prep) page. Mirrors the
 * COACHING-PLAYBOOK conventions: Monday-anchored weeks, the 8-week coaching
 * lens as the default, aggregate-then-rate (never average per-agent rates),
 * and submission-month cohorts (not weeks) for placement.
 *
 * Deliberately excludes anything pay-adjacent from agent_efficiency
 * (adj_net_pnl, bonus_5th, on_probation) — this page is safe for agents to
 * view their own trends, or for a manager to pull up anyone's.
 */

export const TREND_RANGES = [
  { weeks: 4, label: "Last 4 weeks" },
  { weeks: 8, label: "Last 8 weeks (coaching window)" },
  { weeks: 12, label: "Last 12 weeks" },
  { weeks: 26, label: "Last 6 months" },
] as const;
export type TrendRangeWeeks = (typeof TREND_RANGES)[number]["weeks"];
export const DEFAULT_TREND_WEEKS: TrendRangeWeeks = 8;

export function coerceTrendWeeks(n: number | undefined): TrendRangeWeeks {
  const match = TREND_RANGES.find((r) => r.weeks === n);
  return match ? match.weeks : DEFAULT_TREND_WEEKS;
}

export const MIN_LEADS_SAMPLE = 20;
export const MIN_SCRIPT_SAMPLE = 3;

export interface WeekPoint {
  week: string;
  weekLabel: string;
  premium: number | null;
  sales: number | null;
  leads: number | null;
  closeRate: number | null;
  premiumPerSale: number | null;
  hp: number | null;
  leadsPerDay: number | null;
  rpaHrsPerDay: number | null;
  scriptAdherence: number | null;
  teamCloseRate: number | null;
  teamPremiumPerAgent: number | null;
  teamPremiumPerSale: number | null;
  teamLeadsPerDay: number | null;
  teamRpaHrsPerDay: number | null;
  teamScriptAdherence: number | null;
}

export interface WindowSummary {
  weeksWithData: number;
  premium: number;
  premiumDeltaPct: number | null;
  sales: number;
  salesDeltaPct: number | null;
  leads: number;
  closeRate: number | null;
  closeRateDeltaPts: number | null;
  premiumPerSale: number | null;
  premiumPerSaleDeltaPct: number | null;
  leadsPerDay: number | null;
  leadsPerDayDeltaPct: number | null;
  rpaHrsPerDay: number | null;
  rpaHrsPerDayDeltaPct: number | null;
  scriptAdherence: number | null;
  scriptCalls: number;
  scriptAdherenceDeltaPts: number | null;
}

export interface EfficiencySnapshot {
  tier: string | null;
  validifiRatePct: number | null;
  bakedPlaceRatePct: number | null;
  trueHp: number | null;
  month: string | null;
}

export interface CohortPoint {
  monthLabel: string;
  placeRatePct: number | null;
  submissions: number;
  maturityPct: number | null;
}

export interface AgentTrends {
  agent: string;
  status: "active" | "departed";
  tenureMo: number | null;
  weeksN: TrendRangeWeeks;
  weeks: WeekPoint[];
  current: WindowSummary;
  cohorts: CohortPoint[];
  efficiency: EfficiencySnapshot | null;
}

const sum = (xs: (number | null | undefined)[]) => xs.reduce((a: number, b) => a + (b ?? 0), 0);

function pctDelta(cur: number, prior: number): number | null {
  if (!Number.isFinite(prior) || prior === 0) return null;
  return (100 * (cur - prior)) / prior;
}

interface DayAgg {
  leads: number;
  activeDays: number;
  rpaMin: number;
  scriptWeighted: number;
  scriptCalls: number;
}

function aggregateDaysByWeek(days: DailyActivityRow[]): Map<string, DayAgg> {
  const m = new Map<string, DayAgg>();
  for (const d of days) {
    const wk = (d.week ?? d.activity_date).slice(0, 10);
    const bucket = m.get(wk) ?? { leads: 0, activeDays: 0, rpaMin: 0, scriptWeighted: 0, scriptCalls: 0 };
    bucket.leads += d.billable_leads ?? 0;
    const isActive = (d.rpa_min ?? 0) > 0;
    if (isActive) {
      bucket.activeDays += 1;
      bucket.rpaMin += d.rpa_min ?? 0;
    }
    if (d.script_adherence != null) {
      const calls = d.script_calls ?? 1;
      bucket.scriptWeighted += d.script_adherence * calls;
      bucket.scriptCalls += calls;
    }
    m.set(wk, bucket);
  }
  return m;
}

export async function buildAgentTrends(agent: string, weeksN: TrendRangeWeeks): Promise<AgentTrends> {
  const sinceDays = weeksN * 2 * 7 + 14;

  const [agentWeeksRaw, teamWeeks, allDays, cohorts, efficiencyRows, activeAgents] = await Promise.all([
    getAgentWeeks({ agent, sinceDays }),
    getTeamWeeks(weeksN * 2 + 4),
    getDailyActivity({ sinceDays }),
    getPlacementCohorts(agent),
    getAgentEfficiency(),
    getActiveAgents(),
  ]);

  const activeSet = new Set(activeAgents.map((a) => a.agent));
  const myDays = allDays.filter((d) => d.agent === agent);
  const teamDays = allDays.filter((d) => activeSet.has(d.agent));

  const myAgg = aggregateDaysByWeek(myDays);
  const teamAgg = aggregateDaysByWeek(teamDays);
  const teamByWeek = new Map(teamWeeks.map((w) => [w.week_start, w]));
  const agentWeeksByKey = new Map(agentWeeksRaw.map((w) => [w.week_start, w]));

  // Completed weeks only — the in-progress week is a partial cumulative total,
  // so including it would understate the current window and drop the last point
  // of every trend line. Intraday lives in the Team Pulse / agent live tracker.
  const inProgress = currentWeekStart();
  const keys = [...new Set([...agentWeeksByKey.keys(), ...myAgg.keys()])]
    .filter((k) => k.slice(0, 10) < inProgress)
    .sort();
  const currentKeys = keys.slice(-weeksN);
  const priorKeys = keys.slice(Math.max(0, keys.length - weeksN * 2), keys.length - weeksN);

  function toPoint(wk: string): WeekPoint {
    const aw = agentWeeksByKey.get(wk);
    const da = myAgg.get(wk);
    const ta = teamAgg.get(wk);
    const tw = teamByWeek.get(wk);
    return {
      week: wk,
      weekLabel: fmtWeek(wk),
      premium: aw?.premium ?? null,
      sales: aw?.sales ?? null,
      leads: aw?.leads ?? null,
      closeRate: aw?.close_rate_pct ?? null,
      premiumPerSale: aw?.premium_per_sale ?? null,
      hp: aw?.hp ?? null,
      leadsPerDay: da && da.activeDays > 0 ? da.leads / da.activeDays : null,
      rpaHrsPerDay: da && da.activeDays > 0 ? da.rpaMin / da.activeDays / 60 : null,
      scriptAdherence: da && da.scriptCalls > 0 ? da.scriptWeighted / da.scriptCalls : null,
      teamCloseRate: tw?.close_rate_pct ?? null,
      teamPremiumPerAgent: tw?.premium_per_agent ?? null,
      teamPremiumPerSale: tw?.premium_per_sale ?? null,
      teamLeadsPerDay: ta && ta.activeDays > 0 ? ta.leads / ta.activeDays : null,
      teamRpaHrsPerDay: ta && ta.activeDays > 0 ? ta.rpaMin / ta.activeDays / 60 : null,
      teamScriptAdherence: ta && ta.scriptCalls > 0 ? ta.scriptWeighted / ta.scriptCalls : null,
    };
  }

  const weekPoints = currentKeys.map(toPoint);

  function summarize(ks: string[]): WindowSummary {
    const rows = ks.map((k) => agentWeeksByKey.get(k)).filter((r): r is WeeklyAgentRow => !!r);
    const daily = ks.map((k) => myAgg.get(k)).filter((r): r is DayAgg => !!r);
    const premium = sum(rows.map((r) => r.premium));
    const sales = sum(rows.map((r) => r.sales));
    const leads = sum(rows.map((r) => r.leads));
    const activeDays = sum(daily.map((d) => d.activeDays));
    const leadsSumDaily = sum(daily.map((d) => d.leads));
    const rpaMinSum = sum(daily.map((d) => d.rpaMin));
    const scriptCalls = sum(daily.map((d) => d.scriptCalls));
    const scriptWeighted = sum(daily.map((d) => d.scriptWeighted));
    return {
      weeksWithData: rows.length,
      premium,
      premiumDeltaPct: null,
      sales,
      salesDeltaPct: null,
      leads,
      closeRate: leads > 0 ? (100 * sales) / leads : null,
      closeRateDeltaPts: null,
      premiumPerSale: sales > 0 ? premium / sales : null,
      premiumPerSaleDeltaPct: null,
      leadsPerDay: activeDays > 0 ? leadsSumDaily / activeDays : null,
      leadsPerDayDeltaPct: null,
      rpaHrsPerDay: activeDays > 0 ? rpaMinSum / activeDays / 60 : null,
      rpaHrsPerDayDeltaPct: null,
      scriptAdherence: scriptCalls > 0 ? scriptWeighted / scriptCalls : null,
      scriptCalls,
      scriptAdherenceDeltaPts: null,
    };
  }

  const current = summarize(currentKeys);
  const prior = summarize(priorKeys);
  current.premiumDeltaPct = pctDelta(current.premium, prior.premium);
  current.salesDeltaPct = pctDelta(current.sales, prior.sales);
  current.closeRateDeltaPts =
    current.closeRate != null && prior.closeRate != null ? current.closeRate - prior.closeRate : null;
  current.premiumPerSaleDeltaPct =
    current.premiumPerSale != null && prior.premiumPerSale != null
      ? pctDelta(current.premiumPerSale, prior.premiumPerSale)
      : null;
  current.leadsPerDayDeltaPct =
    current.leadsPerDay != null && prior.leadsPerDay != null
      ? pctDelta(current.leadsPerDay, prior.leadsPerDay)
      : null;
  current.rpaHrsPerDayDeltaPct =
    current.rpaHrsPerDay != null && prior.rpaHrsPerDay != null
      ? pctDelta(current.rpaHrsPerDay, prior.rpaHrsPerDay)
      : null;
  current.scriptAdherenceDeltaPts =
    current.scriptAdherence != null && prior.scriptAdherence != null
      ? current.scriptAdherence - prior.scriptAdherence
      : null;

  const cohortPoints: CohortPoint[] = cohorts.slice(-12).map((c) => ({
    monthLabel: fmtMonth(c.cohort_month),
    placeRatePct: c.place_rate_pct,
    submissions: c.submissions ?? 0,
    maturityPct: c.maturity_pct,
  }));

  const eff = efficiencyRows.find((r) => r.agent === agent) ?? null;
  const efficiency: EfficiencySnapshot | null = eff
    ? {
        tier: eff.tier && eff.tier !== "-" ? eff.tier : null,
        validifiRatePct: eff.validifi_rate != null ? eff.validifi_rate * 100 : null,
        bakedPlaceRatePct: eff.baked_place_rate != null ? eff.baked_place_rate * 100 : null,
        trueHp: eff.true_hp != null && eff.true_hp > 0 ? eff.true_hp : null,
        month: eff.month,
      }
    : null;

  const latestRow = agentWeeksRaw[agentWeeksRaw.length - 1] ?? null;

  return {
    agent,
    status: latestRow?.agent_status ?? "active",
    tenureMo: latestRow?.tenure_mo ?? null,
    weeksN,
    weeks: weekPoints,
    current,
    cohorts: cohortPoints,
    efficiency,
  };
}
