/**
 * Monday-anchored week bookkeeping — the ONE place that decides whether a week
 * is "complete" (safe for week-over-week reporting) or "in progress" (only ever
 * shown in the day-grain live tracker).
 *
 * Why this exists: a partial current week compared against a full prior week
 * makes every cumulative metric (leads/sales/premium) look like it's crashing
 * on a Tuesday. Per COACHING-PLAYBOOK, the Monday deck presents the week that
 * ENDED the previous Saturday — i.e. the current calendar week is in progress
 * and the headline WoW numbers come from the last COMPLETED week. Live intraday
 * reads use week-to-date comparisons instead (see live.ts).
 *
 * All boundaries are computed in Pacific time (the team's operating clock, per
 * the UTC-8 rule) so "today" flips at midnight PT, not UTC.
 */

const PACIFIC_TZ = "America/Los_Angeles";

/** Today's date in Pacific time as an ISO YYYY-MM-DD string. */
export function pacificToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Shift an ISO date string by N days (parsed at UTC noon to dodge DST edges). */
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday (ISO date) of the week containing the given date. */
export function weekStartOf(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sun … 6 = Sat
  const sinceMonday = (dow + 6) % 7; // Mon→0, Tue→1 … Sun→6
  return addDaysISO(iso, -sinceMonday);
}

/** The Monday of the current (in-progress) Pacific week. */
export function currentWeekStart(now: Date = new Date()): string {
  return weekStartOf(pacificToday(now));
}

/**
 * A week is "in progress" if it is the current calendar week (or somehow later,
 * e.g. a warehouse row dated ahead). Everything strictly before is complete.
 */
export function isWeekInProgress(weekStart: string, now: Date = new Date()): boolean {
  return weekStart.slice(0, 10) >= currentWeekStart(now);
}

/** A week is complete once we've moved past it — safe for WoW reporting. */
export function isWeekComplete(weekStart: string, now: Date = new Date()): boolean {
  return !isWeekInProgress(weekStart, now);
}

/**
 * Pick the reporting week (latest COMPLETED week) from a set of week rows.
 * Returns null if none have completed yet. Rows may be in any order.
 */
export function latestCompleteWeekStart(
  weekStarts: string[],
  now: Date = new Date()
): string | null {
  const complete = weekStarts
    .map((w) => w.slice(0, 10))
    .filter((w) => isWeekComplete(w, now))
    .sort();
  return complete.length ? complete[complete.length - 1] : null;
}
