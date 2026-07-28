import "server-only";
import { getDailyTeam, getDailyAgent } from "./queries";
import { currentWeekStart } from "./weeks";

/**
 * "This week so far" tracker — the honest way to watch the current, in-progress
 * week intraday without the partial-vs-full illusion. Everything is compared
 * WEEK-TO-DATE: Mon–<today> of this week against the SAME weekdays of prior
 * weeks (not against a full week), so a Tuesday reads "+15% vs the same point
 * last week", never "down 80% vs last week's finished total".
 *
 * Source is v_daily_team / v_daily_agent (day-grain). Day counts are small and
 * noisy — this is a live pulse, not trend analysis (use the weekly views for
 * that). Weeks are Monday-anchored to match the rest of the app.
 */

const WEEKDAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday-anchored weekday ordinal (Mon=0 … Sun=6) for an ISO date. */
function weekdayIndex(iso: string): number {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return (d.getUTCDay() + 6) % 7;
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Minimal shape both v_daily_team and v_daily_agent satisfy. */
interface DayRow {
  activity_date: string;
  week_start: string;
  leads: number | null;
  sales: number | null;
  premium: number | null;
}

export interface LiveMetric {
  wtd: number; // this week, Mon → today
  priorWtd: number | null; // same weekdays, last week
  deltaPct: number | null; // wtd vs priorWtd
  avg4Wtd: number | null; // trailing 4 weeks, avg over same weekdays
  projected: number | null; // full-week projection using last week's day-shape
}

export interface LiveWeek {
  weekStart: string;
  hasData: boolean;
  daysElapsed: number;
  throughLabel: string | null; // e.g. "Tue"
  leads: LiveMetric;
  sales: LiveMetric;
  premium: LiveMetric;
  closeRatePct: number | null;
  priorCloseRatePct: number | null;
  byDay: {
    label: string;
    thisPremium: number | null;
    priorPremium: number | null;
    thisSales: number | null;
    priorSales: number | null;
  }[];
}

const sum = (xs: (number | null | undefined)[]) =>
  xs.reduce((a: number, b) => a + (b ?? 0), 0);

function pctDelta(cur: number, prior: number | null): number | null {
  if (prior == null || !Number.isFinite(prior) || prior === 0) return null;
  return (100 * (cur - prior)) / prior;
}

type Field = "leads" | "sales" | "premium";

export function computeLiveWeek(rows: DayRow[], now: Date = new Date()): LiveWeek {
  const weekStart = currentWeekStart(now);
  const byWeek = new Map<string, DayRow[]>();
  for (const r of rows) {
    const wk = r.week_start.slice(0, 10);
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk)!.push(r);
  }

  const thisWeek = (byWeek.get(weekStart) ?? []).slice().sort((a, b) =>
    a.activity_date.localeCompare(b.activity_date)
  );

  const empty: LiveMetric = { wtd: 0, priorWtd: null, deltaPct: null, avg4Wtd: null, projected: null };
  if (thisWeek.length === 0) {
    return {
      weekStart,
      hasData: false,
      daysElapsed: 0,
      throughLabel: null,
      leads: empty,
      sales: { ...empty },
      premium: { ...empty },
      closeRatePct: null,
      priorCloseRatePct: null,
      byDay: [],
    };
  }

  // The weekday positions we've reached this week (handles gaps, e.g. a day
  // with no activity). Baselines only ever sum these same weekdays.
  const reachedOrdinals = new Set(thisWeek.map((r) => weekdayIndex(r.activity_date)));
  const daysElapsed = reachedOrdinals.size;
  const lastOrdinal = Math.max(...[...reachedOrdinals]);
  const throughLabel = WEEKDAY[lastOrdinal];

  const wtdOf = (wkRows: DayRow[], field: Field, ordinals: Set<number>) =>
    sum(wkRows.filter((r) => ordinals.has(weekdayIndex(r.activity_date))).map((r) => r[field]));

  const priorWk = addDaysISO(weekStart, -7);
  const priorRows = byWeek.get(priorWk) ?? [];

  // Trailing 4 complete weeks (prior-1 … prior-4) for a smoother baseline.
  const trailingWeeks: DayRow[][] = [];
  for (let i = 1; i <= 4; i++) {
    const wk = addDaysISO(weekStart, -7 * i);
    const r = byWeek.get(wk);
    if (r && r.length) trailingWeeks.push(r);
  }

  const metric = (field: Field): LiveMetric => {
    const wtd = wtdOf(thisWeek, field, reachedOrdinals);
    const priorWtd = priorRows.length ? wtdOf(priorRows, field, reachedOrdinals) : null;
    const avgs = trailingWeeks.map((wk) => wtdOf(wk, field, reachedOrdinals));
    const avg4Wtd = avgs.length ? sum(avgs) / avgs.length : null;
    // Project the full week from last week's day-shape: scale WTD by
    // (prior full week ÷ prior week-to-date). Falls back to null when we can't.
    const priorFull = priorRows.length ? sum(priorRows.map((r) => r[field])) : 0;
    const projected =
      priorWtd && priorWtd > 0 ? (wtd * priorFull) / priorWtd : null;
    return { wtd, priorWtd, deltaPct: pctDelta(wtd, priorWtd), avg4Wtd, projected };
  };

  const leads = metric("leads");
  const sales = metric("sales");
  const premium = metric("premium");

  const closeRatePct = leads.wtd > 0 ? (100 * sales.wtd) / leads.wtd : null;
  const priorCloseRatePct =
    leads.priorWtd && leads.priorWtd > 0 && sales.priorWtd != null
      ? (100 * sales.priorWtd) / leads.priorWtd
      : null;

  // Per-weekday series for the mini chart (Mon → last reached day).
  const thisByOrd = new Map<number, DayRow>();
  for (const r of thisWeek) thisByOrd.set(weekdayIndex(r.activity_date), r);
  const priorByOrd = new Map<number, DayRow>();
  for (const r of priorRows) priorByOrd.set(weekdayIndex(r.activity_date), r);

  const byDay: LiveWeek["byDay"] = [];
  for (let o = 0; o <= Math.max(lastOrdinal, 4); o++) {
    const t = thisByOrd.get(o) ?? null;
    const p = priorByOrd.get(o) ?? null;
    byDay.push({
      label: WEEKDAY[o],
      thisPremium: o <= lastOrdinal ? t?.premium ?? 0 : null,
      priorPremium: p?.premium ?? null,
      thisSales: o <= lastOrdinal ? t?.sales ?? 0 : null,
      priorSales: p?.sales ?? null,
    });
  }

  return {
    weekStart,
    hasData: true,
    daysElapsed,
    throughLabel,
    leads,
    sales,
    premium,
    closeRatePct,
    priorCloseRatePct,
    byDay,
  };
}

/** Team "this week so far" from v_daily_team. */
export async function buildTeamLiveWeek(now: Date = new Date()): Promise<LiveWeek> {
  const rows = await getDailyTeam(35);
  return computeLiveWeek(rows, now);
}

/** One agent's "this week so far" from v_daily_agent. */
export async function buildAgentLiveWeek(
  agent: string,
  now: Date = new Date()
): Promise<LiveWeek> {
  const rows = await getDailyAgent({ agent, sinceDays: 35 });
  return computeLiveWeek(rows, now);
}
