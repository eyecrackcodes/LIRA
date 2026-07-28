import type { AgentDayTriggerRow } from "./types";

/**
 * Roster-wide "who is in a cold streak right now" derived from
 * v_agent_day_trigger (FILM-ROOM-PROMPT.md §4). A cold streak = the agent's
 * LATEST worked day is is_cold_streak (two-plus consecutive cold-candidate
 * days). We never surface a single cold_candidate day — one bad day is noise.
 *
 * Pattern tells the coach which failure mode it is, from the latest day's
 * duration percentile: ≤ 0.5 = "rushed" (under their own median call length —
 * skipping discovery/objections), > 0.5 = "over-talked" (long calls that still
 * don't convert). Opposite coaching conversations, so they must read distinctly.
 */

export type ColdPattern = "rushed" | "over-talked";

export interface ColdStreak {
  agent: string;
  days: number; // consecutive cold-candidate worked days ending on the latest
  pattern: ColdPattern;
  durationPercentile: number | null;
  lastDate: string;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildColdStreaks(rows: AgentDayTriggerRow[]): ColdStreak[] {
  const byAgent = new Map<string, AgentDayTriggerRow[]>();
  for (const r of rows) {
    if (!byAgent.has(r.agent)) byAgent.set(r.agent, []);
    byAgent.get(r.agent)!.push(r);
  }

  const streaks: ColdStreak[] = [];
  for (const [agent, agentRows] of byAgent) {
    const sorted = agentRows
      .slice()
      .sort((a, b) => a.call_date.localeCompare(b.call_date));
    const latest = sorted[sorted.length - 1];
    // Only flag when the MOST RECENT worked day is itself a cold streak.
    if (!latest?.is_cold_streak) continue;

    // Walk back over consecutive worked days that were cold candidates.
    let days = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].cold_candidate) days++;
      else break;
    }

    const pct = toNum(latest.duration_percentile);
    // Default to "over-talked" only if we somehow lack a percentile; ≤ 0.5 is
    // rushed per the spec.
    const pattern: ColdPattern = pct != null && pct <= 0.5 ? "rushed" : "over-talked";

    streaks.push({
      agent,
      days,
      pattern,
      durationPercentile: pct,
      lastDate: latest.call_date.slice(0, 10),
    });
  }

  // Longest streaks first, then alphabetical for stable ordering.
  return streaks.sort((a, b) => b.days - a.days || a.agent.localeCompare(b.agent));
}
