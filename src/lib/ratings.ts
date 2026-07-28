import type { WeeklyAgentRow, PlacementCohortRow, DailyActivityRow } from "./types";
import { currentWeekStart } from "./weeks";

/**
 * Madden-style rating engine.
 * Raw stats come from the trailing RATING_WINDOW_WEEKS; each is percentile-
 * normalized against the active team's trailing NORM_WINDOW_WEEKS distribution
 * and mapped into the 40–99 band (nobody rates like a 12). Ratings are for
 * feel — the raw stat is always displayed next to them.
 */
export const RATING_WINDOW_WEEKS = 8;
export const NORM_WINDOW_WEEKS = 12;
export const RATING_FLOOR = 40;
export const RATING_CEIL = 99;

/** The one plain-English explanation of the rating windows — reuse everywhere. */
export const FORM_EXPLAINER =
  "Ratings grade your last 8 weeks of work on a curve against the whole team's last 12 weeks. " +
  "One hot or cold week moves your rating a little — never all of it. That's why a rating can " +
  "disagree with this week's numbers.";

/** OVR blend — THE tunable constant (weights renormalize if an attr is missing). */
export const OVR_WEIGHTS: Record<AttrKey, number> = {
  CLS: 0.25,
  PLC: 0.25,
  VOL: 0.2,
  HUS: 0.15,
  GRD: 0.1,
  CNS: 0.05,
};

/** Cohorts below this maturity don't count toward PLC (rate not baked yet). */
export const PLC_MIN_MATURITY_PCT = 70;

/** Monthly submitted-premium goal per agent (goals run $40–60K/mo). */
export const DEFAULT_MONTHLY_GOAL = 50_000;

export type AttrKey = "CLS" | "PLC" | "VOL" | "HUS" | "GRD" | "CNS";

/** Franchise tiers — one place for every rating→tier/color mapping. */
export interface Tier {
  label: string;
  color: string;
}

export function tierOf(rating: number | null): Tier {
  if (rating == null) return { label: "No data", color: "var(--tier-none)" };
  if (rating >= 90) return { label: "Elite", color: "var(--tier-elite)" };
  if (rating >= 80) return { label: "Star", color: "var(--tier-star)" };
  if (rating >= 70) return { label: "Starter", color: "var(--tier-starter)" };
  if (rating >= 60) return { label: "Rotation", color: "var(--tier-rotation)" };
  return { label: "Development", color: "var(--tier-dev)" };
}

export const tierColor = (rating: number | null): string => tierOf(rating).color;

export const ATTR_META: Record<
  AttrKey,
  { name: string; unit: string; describe: (raw: number) => string }
> = {
  CLS: { name: "Closing", unit: "%", describe: (r) => `${r.toFixed(1)}%` },
  PLC: { name: "Placement", unit: "%", describe: (r) => `${r.toFixed(1)}%` },
  VOL: {
    name: "Production",
    unit: "$/wk",
    describe: (r) => `$${Math.round(r).toLocaleString("en-US")}/wk`,
  },
  HUS: { name: "Hustle", unit: "RPA hrs/day", describe: (r) => `${(r / 60).toFixed(1)} hrs/day` },
  GRD: { name: "Discipline", unit: "/5", describe: (r) => `${r.toFixed(2)}/5` },
  CNS: { name: "Consistency", unit: "CV", describe: (r) => `${(r * 100).toFixed(0)}% swing` },
};

export interface Attribute {
  key: AttrKey;
  rating: number | null; // 40–99, null when no data
  raw: number | null;
  sample: number; // denominator behind the raw stat (leads, submissions, days…)
  trend: -1 | 0 | 1;
}

export interface AgentRating {
  agent: string;
  ovr: number | null;
  attrs: Record<AttrKey, Attribute>;
  formSales: number[]; // last 8 weeks of sales (oldest → newest)
  formPremium: number[];
  status: string;
  tenureMo: number | null;
  latestWeek: WeeklyAgentRow | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);

function stddev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

/** Percentile of v within pool (ties get half credit), mapped to 40–99. */
function toRating(v: number, pool: number[], invert = false): number {
  const others = pool.filter((p) => Number.isFinite(p));
  if (others.length === 0) return Math.round((RATING_FLOOR + RATING_CEIL) / 2);
  let below = 0;
  let ties = 0;
  for (const p of others) {
    if (invert ? p > v : p < v) below++;
    else if (p === v) ties++;
  }
  const pct = (below + ties / 2) / others.length;
  return Math.round(RATING_FLOOR + pct * (RATING_CEIL - RATING_FLOOR));
}

/** trend from comparing recent half of a weekly series vs the prior half */
function halvesTrend(series: number[], invert = false, epsilon = 1e-9): -1 | 0 | 1 {
  if (series.length < 4) return 0;
  const mid = Math.floor(series.length / 2);
  const a = mean(series.slice(0, mid));
  const b = mean(series.slice(mid));
  if (a == null || b == null) return 0;
  const d = (b - a) * (invert ? -1 : 1);
  const threshold = Math.abs(a) * 0.05 + epsilon;
  return d > threshold ? 1 : d < -threshold ? -1 : 0;
}

interface MetricValue {
  raw: number | null;
  sample: number;
  series: number[]; // weekly series used for trend
  invert?: boolean;
}

function computeMetrics(
  agent: string,
  weeks: WeeklyAgentRow[], // this agent's rows, ascending, trailing window
  cohorts: PlacementCohortRow[], // this agent's cohorts
  days: DailyActivityRow[] // this agent's daily rows, trailing window
): Record<AttrKey, MetricValue> {
  const leads = sum(weeks.map((w) => w.leads ?? 0));
  const sales = sum(weeks.map((w) => w.sales ?? 0));
  const closeSeries = weeks
    .filter((w) => (w.leads ?? 0) > 0)
    .map((w) => (100 * (w.sales ?? 0)) / (w.leads ?? 1));

  const matured = cohorts.filter(
    (c) => (c.maturity_pct ?? 0) >= PLC_MIN_MATURITY_PCT && (c.submissions ?? 0) > 0
  );
  const subs = sum(matured.map((c) => c.submissions ?? 0));
  const placed = sum(matured.map((c) => c.placed ?? 0));
  const placeSeries = matured.map((c) => c.place_rate_pct ?? 0);

  const activeDays = days.filter((d) => (d.rpa_min ?? 0) > 0);
  const rpaByWeek = new Map<string, number[]>();
  for (const d of activeDays) {
    const k = d.week ?? d.activity_date.slice(0, 10);
    if (!rpaByWeek.has(k)) rpaByWeek.set(k, []);
    rpaByWeek.get(k)!.push(d.rpa_min ?? 0);
  }
  const rpaWeekAvgs = [...rpaByWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => mean(v)!);

  const scriptDays = days.filter((d) => d.script_adherence != null);
  const scriptSeries = scriptDays.map((d) => d.script_adherence!);

  const premiumSeries = weeks.map((w) => w.premium ?? 0);
  const salesSeries = weeks.map((w) => w.sales ?? 0);
  const salesMean = mean(salesSeries);
  const salesSd = stddev(salesSeries);
  const cv = salesMean && salesMean > 0 && salesSd != null ? salesSd / salesMean : null;

  return {
    CLS: {
      raw: leads > 0 ? (100 * sales) / leads : null,
      sample: leads,
      series: closeSeries,
    },
    PLC: {
      raw: subs > 0 ? (100 * placed) / subs : null,
      sample: subs,
      series: placeSeries,
    },
    VOL: {
      raw: weeks.length ? sum(premiumSeries) / weeks.length : null,
      sample: weeks.length,
      series: premiumSeries,
    },
    HUS: {
      raw: activeDays.length ? sum(activeDays.map((d) => d.rpa_min ?? 0)) / activeDays.length : null,
      sample: activeDays.length,
      series: rpaWeekAvgs,
    },
    GRD: {
      raw: mean(scriptSeries),
      sample: scriptDays.length,
      series: scriptSeries,
    },
    CNS: {
      raw: cv,
      sample: salesSeries.length,
      series: salesSeries.length >= 4 ? salesSeries : [],
      invert: true, // lower volatility = better
    },
  };
}

function isoWeeksAgo(weeks: number): string {
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7);
  return d.toISOString().slice(0, 10);
}

export function buildRatings(
  allWeeksRaw: WeeklyAgentRow[], // ascending, ≥ trailing 12 weeks, all agents
  allCohorts: PlacementCohortRow[],
  allDaysRaw: DailyActivityRow[],
  activeAgents: string[]
): AgentRating[] {
  // Ratings are a body-of-work measure over COMPLETED weeks only. Including the
  // current in-progress week would drag VOL (a partial week counted as a full
  // one) and put a fake dip at the end of every form sparkline — the exact
  // "everyone's sinking on Tuesday" artifact these ratings must not have.
  const inProgress = currentWeekStart();
  const allWeeks = allWeeksRaw.filter((w) => w.week_start.slice(0, 10) < inProgress);
  const allDays = allDaysRaw.filter((d) => d.activity_date.slice(0, 10) < inProgress);

  const cut8 = isoWeeksAgo(RATING_WINDOW_WEEKS);
  const cut12 = isoWeeksAgo(NORM_WINDOW_WEEKS);

  const byAgent = (agent: string) => ({
    w8: allWeeks.filter((w) => w.agent === agent && w.week_start >= cut8),
    w12: allWeeks.filter((w) => w.agent === agent && w.week_start >= cut12),
    cohorts: allCohorts.filter((c) => c.agent === agent),
    d8: allDays.filter((d) => d.agent === agent && d.activity_date >= cut8),
    d12: allDays.filter((d) => d.agent === agent && d.activity_date >= cut12),
  });

  // Team distribution pools from the trailing-12-week window.
  const pools: Record<AttrKey, number[]> = { CLS: [], PLC: [], VOL: [], HUS: [], GRD: [], CNS: [] };
  const metrics12 = new Map<string, Record<AttrKey, MetricValue>>();
  for (const agent of activeAgents) {
    const a = byAgent(agent);
    const m = computeMetrics(agent, a.w12, a.cohorts, a.d12);
    metrics12.set(agent, m);
    for (const k of Object.keys(pools) as AttrKey[]) {
      if (m[k].raw != null) pools[k].push(m[k].raw!);
    }
  }

  return activeAgents.map((agent) => {
    const a = byAgent(agent);
    const m8 = computeMetrics(agent, a.w8, a.cohorts, a.d8);

    const attrs = {} as Record<AttrKey, Attribute>;
    for (const key of Object.keys(OVR_WEIGHTS) as AttrKey[]) {
      const mv = m8[key];
      attrs[key] = {
        key,
        raw: mv.raw,
        sample: mv.sample,
        rating: mv.raw == null ? null : toRating(mv.raw, pools[key], mv.invert),
        trend: halvesTrend(mv.series, mv.invert),
      };
    }

    let wSum = 0;
    let acc = 0;
    for (const key of Object.keys(OVR_WEIGHTS) as AttrKey[]) {
      const r = attrs[key].rating;
      if (r != null) {
        acc += r * OVR_WEIGHTS[key];
        wSum += OVR_WEIGHTS[key];
      }
    }
    // No OVR without core production data — a rookie with only a script score
    // shouldn't carry a rating that reads like a slump.
    const hasCore = attrs.CLS.raw != null || attrs.VOL.raw != null;
    const ovr = hasCore && wSum > 0 ? Math.round(acc / wSum) : null;

    const latest = a.w12.length ? a.w12[a.w12.length - 1] : null;
    return {
      agent,
      ovr,
      attrs,
      formSales: a.w8.map((w) => w.sales ?? 0),
      formPremium: a.w8.map((w) => w.premium ?? 0),
      status: latest?.agent_status ?? "active",
      tenureMo: latest?.tenure_mo ?? null,
      latestWeek: latest,
    };
  });
}

/** Month-to-date premium pace vs goal (week-grain approximation of the month). */
export function goalPace(agentWeeks: WeeklyAgentRow[], goal = DEFAULT_MONTHLY_GOAL) {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const mtd = sum(
    agentWeeks.filter((w) => w.week_start >= monthStart).map((w) => w.premium ?? 0)
  );
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const elapsed = now.getDate() / daysIn;
  const paceTarget = goal * elapsed;
  return { mtd, goal, paceTarget, onPace: mtd >= paceTarget };
}
