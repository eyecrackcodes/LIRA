import type { WeeklyAgentRow, DailyActivityRow } from "./types";
import { currentWeekStart } from "./weeks";

/**
 * Weekly auto-awarded badges (from v_weekly_agent + daily_activity).
 * Leaderboards are for coaching, not shaming — badges only celebrate tops.
 */
export type BadgeKey = "POTW" | "IRON_MAN" | "SNIPER" | "GRINDER" | "HOT_STREAK";

export const BADGE_META: Record<BadgeKey, { name: string; icon: string; blurb: string }> = {
  POTW: { name: "Player of the Week", icon: "★", blurb: "Top week-over-week premium gain" },
  IRON_MAN: { name: "Iron Man", icon: "⛨", blurb: "Most active days on the phones" },
  SNIPER: { name: "Sniper", icon: "◎", blurb: "Best close rate (min 20 leads)" },
  GRINDER: { name: "Grinder", icon: "⚒", blurb: "Most RPA hours logged" },
  HOT_STREAK: { name: "Hot Streak", icon: "🔥", blurb: "3+ straight weeks of sales gains" },
};

export const SNIPER_MIN_LEADS = 20;

export interface BadgeAward {
  week_start: string;
  badge: BadgeKey;
  agent: string;
  detail: string;
}

export function awardBadges(
  weeks: WeeklyAgentRow[], // all agents, ascending
  days: DailyActivityRow[],
  weeksBack = 12,
  /** Agents whose jersey is hung up app-side (lib/roster) — excluded from
   *  hardware even while dim_agent still reads 'active'. */
  departed: ReadonlySet<string> = new Set()
): BadgeAward[] {
  // Badges are only awarded for COMPLETED weeks — the in-progress week's WoW
  // columns compare a partial week against a full one, which would hand out a
  // bogus Player-of-the-Week on a Tuesday.
  const inProgress = currentWeekStart();
  const activeRows = weeks.filter(
    (w) =>
      w.agent_status === "active" &&
      !departed.has(w.agent) &&
      w.week_start.slice(0, 10) < inProgress
  );
  const weekStarts = [...new Set(activeRows.map((w) => w.week_start))].sort().slice(-weeksBack);
  const awards: BadgeAward[] = [];

  // active-day + RPA totals per agent-week from daily_activity
  const dailyByAgentWeek = new Map<string, { activeDays: number; rpa: number }>();
  for (const d of days) {
    if ((d.rpa_min ?? 0) <= 0) continue;
    const k = `${d.week ?? d.activity_date.slice(0, 10)}|${d.agent}`;
    const cur = dailyByAgentWeek.get(k) ?? { activeDays: 0, rpa: 0 };
    cur.activeDays += 1;
    cur.rpa += d.rpa_min ?? 0;
    dailyByAgentWeek.set(k, cur);
  }

  const salesHistory = new Map<string, WeeklyAgentRow[]>();
  for (const w of activeRows) {
    if (!salesHistory.has(w.agent)) salesHistory.set(w.agent, []);
    salesHistory.get(w.agent)!.push(w);
  }

  for (const ws of weekStarts) {
    const rows = activeRows.filter((w) => w.week_start === ws);
    if (!rows.length) continue;

    const potw = rows
      .filter((r) => (r.wow_premium ?? -Infinity) > 0)
      .sort((a, b) => (b.wow_premium ?? 0) - (a.wow_premium ?? 0))[0];
    if (potw)
      awards.push({
        week_start: ws,
        badge: "POTW",
        agent: potw.agent,
        detail: `+$${Math.round(potw.wow_premium ?? 0).toLocaleString("en-US")} WoW`,
      });

    const sniper = rows
      .filter((r) => (r.leads ?? 0) >= SNIPER_MIN_LEADS && r.close_rate_pct != null)
      .sort((a, b) => (b.close_rate_pct ?? 0) - (a.close_rate_pct ?? 0))[0];
    if (sniper)
      awards.push({
        week_start: ws,
        badge: "SNIPER",
        agent: sniper.agent,
        detail: `${sniper.close_rate_pct?.toFixed(1)}% on ${sniper.leads} leads`,
      });

    let iron: { agent: string; activeDays: number; rpa: number } | null = null;
    let grinder: { agent: string; rpa: number } | null = null;
    for (const r of rows) {
      const d = dailyByAgentWeek.get(`${ws}|${r.agent}`);
      if (!d) continue;
      if (!iron || d.activeDays > iron.activeDays || (d.activeDays === iron.activeDays && d.rpa > iron.rpa))
        iron = { agent: r.agent, ...d };
      if (!grinder || d.rpa > grinder.rpa) grinder = { agent: r.agent, rpa: d.rpa };
    }
    if (iron)
      awards.push({
        week_start: ws,
        badge: "IRON_MAN",
        agent: iron.agent,
        detail: `${iron.activeDays} active days`,
      });
    if (grinder)
      awards.push({
        week_start: ws,
        badge: "GRINDER",
        agent: grinder.agent,
        detail: `${(grinder.rpa / 60).toFixed(1)} RPA hrs`,
      });

    for (const [agent, hist] of salesHistory) {
      const upto = hist.filter((h) => h.week_start <= ws);
      let streak = 0;
      for (let i = upto.length - 1; i >= 0; i--) {
        if ((upto[i].wow_sales ?? 0) > 0) streak++;
        else break;
      }
      if (streak >= 3 && upto[upto.length - 1]?.week_start === ws)
        awards.push({
          week_start: ws,
          badge: "HOT_STREAK",
          agent,
          detail: `${streak} straight weeks up`,
        });
    }
  }
  return awards;
}
