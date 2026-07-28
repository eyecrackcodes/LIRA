"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/auth";
import { getWarehouse } from "@/lib/supabase";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Every surface whose roster is derived from getActiveAgents / overrides. */
function revalidateRoster() {
  for (const p of ["/", "/roster", "/stack-rank", "/trends", "/placement", "/close", "/mailer", "/coach"]) {
    revalidatePath(p);
  }
}

/**
 * "Hang up the jersey" — record an agent as departed in the app-owned override
 * table (survives the nightly dim_agent rebuild). Manager-only.
 */
export async function retireAgent(input: {
  agent: string;
  departedOn?: string;
  note?: string;
}): Promise<ActionResult> {
  const viewer = await requireManager();
  if (!viewer) return { ok: false, error: "Managers only." };

  const agent = input.agent?.trim();
  if (!agent) return { ok: false, error: "Pick an agent to retire." };
  const departed_on = input.departedOn?.trim() || null;
  const note = input.note?.trim() || null;

  const { error } = await getWarehouse()
    .from("app_roster_override")
    .upsert(
      {
        agent,
        status: "departed",
        departed_on,
        note,
        set_by: viewer.email,
        set_at: new Date().toISOString(),
      },
      { onConflict: "agent" }
    );
  if (error) return { ok: false, error: error.message };

  revalidateRoster();
  return { ok: true };
}

/** Un-retire an agent — remove the override so dim_agent's status rules again. */
export async function reinstateAgent(agent: string): Promise<ActionResult> {
  const viewer = await requireManager();
  if (!viewer) return { ok: false, error: "Managers only." };
  const name = agent?.trim();
  if (!name) return { ok: false, error: "No agent specified." };

  const { error } = await getWarehouse()
    .from("app_roster_override")
    .delete()
    .eq("agent", name);
  if (error) return { ok: false, error: error.message };

  revalidateRoster();
  return { ok: true };
}
