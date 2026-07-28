import "server-only";
import { cache } from "react";
import { getWarehouse } from "./supabase";

/**
 * App-side roster overrides — the manager "hang up the jersey" list.
 *
 * WHY THIS EXISTS: dim_agent is an upstream warehouse mirror, full-refreshed nightly
 * (DATA-CONTRACT § dim_agent). Writing status='departed' straight into it would
 * be silently destroyed on the next 11 PM sync (.cursorrules: never write the
 * warehouse mirrors). So departures the team makes here are kept in an app-OWNED
 * table (app_roster_override — not part of the upstream sync set) and layered over
 * dim_agent at read time. They stick regardless of what the sheet says and take
 * effect immediately (no waiting for the nightly rebuild).
 *
 * The table is written only by manager server actions (see roster/actions.ts),
 * which gate with requireManager(); the anon Data API can't see it (RLS on, no
 * anon policy). An optional DEPARTED_AGENTS env var (comma-separated exact
 * dim_agent names) is merged in for quick ops changes without a deploy. If the
 * table read ever fails we degrade to env-only rather than crash the roster.
 */

export interface RosterOverride {
  /** ISO date the jersey was hung up (for a "Departed · Jul 15" tag). */
  departedOn: string | null;
  note?: string | null;
}

interface OverrideRow {
  agent: string;
  departed_on: string | null;
  note: string | null;
}

function envDeparted(): string[] {
  return (process.env.DEPARTED_AGENTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The full departed-override set (app table ∪ env), agent → override.
 * Cached per request so the roster/badges/placement reads share one round trip.
 */
export const loadDepartedOverrides = cache(
  async (): Promise<Map<string, RosterOverride>> => {
    const m = new Map<string, RosterOverride>();
    try {
      const { data, error } = await getWarehouse()
        .from("app_roster_override")
        .select("agent, departed_on, note")
        .eq("status", "departed");
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as OverrideRow[]) {
        m.set(r.agent, { departedOn: r.departed_on, note: r.note });
      }
    } catch (e) {
      // Never let a departures-lookup failure take down the whole roster.
      console.error("roster overrides:", e);
    }
    for (const agent of envDeparted()) {
      if (!m.has(agent)) m.set(agent, { departedOn: null });
    }
    return m;
  }
);

/** Has this agent's jersey been hung up app-side? */
export async function isDepartedOverride(agent: string): Promise<boolean> {
  return (await loadDepartedOverrides()).has(agent);
}

/** Departed-override agent names, for filtering data that carries its own
 *  agent_status (badges, cohorts) instead of going through getActiveAgents. */
export async function departedAgentSet(): Promise<Set<string>> {
  return new Set((await loadDepartedOverrides()).keys());
}

export interface DepartedRecord {
  agent: string;
  departedOn: string | null;
  note: string | null;
}

/** Table-backed departures only (the ones the manager UI can reinstate) —
 *  env-managed entries are intentionally excluded from the button list. */
export async function listTableDepartures(): Promise<DepartedRecord[]> {
  try {
    const { data, error } = await getWarehouse()
      .from("app_roster_override")
      .select("agent, departed_on, note")
      .eq("status", "departed")
      .order("agent");
    if (error) throw new Error(error.message);
    return ((data ?? []) as OverrideRow[]).map((r) => ({
      agent: r.agent,
      departedOn: r.departed_on,
      note: r.note,
    }));
  } catch (e) {
    console.error("list departures:", e);
    return [];
  }
}
