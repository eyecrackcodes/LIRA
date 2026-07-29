"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getRealViewer, VIEW_AS_COOKIE } from "@/lib/auth";
import { getActiveAgents } from "@/lib/queries";
import { departedAgentSet } from "@/lib/roster";
import { agentSlug } from "@/lib/format";

interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * "View as" — a manager previews the app as a specific agent.
 *
 * Guarded on the REAL identity (getRealViewer), not the effective one:
 * getViewer() reports role "agent" while a preview is active, and gating on
 * that would (a) let nobody start a second preview without exiting and (b) be
 * meaningless anyway, since the effective role is derived from this cookie.
 */
export async function startViewAs(slug: string): Promise<ActionResult> {
  const real = await getRealViewer();
  if (real?.role !== "manager") return { ok: false, error: "Managers only." };

  const wanted = slug?.trim();
  if (!wanted) return { ok: false, error: "Pick an agent." };

  const [agents, departed] = await Promise.all([getActiveAgents(), departedAgentSet()]);
  const target = agents.find(
    (a) => agentSlug(a.agent) === wanted && !departed.has(a.agent)
  );
  if (!target) return { ok: false, error: "That agent isn't on the active roster." };

  (await cookies()).set(VIEW_AS_COOKIE, wanted, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    // Session cookie on purpose: closing the browser ends the preview.
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Exit the preview. Unguarded on purpose: the cookie only ever has an effect
 * for managers, so clearing it can only restore someone to their real self.
 */
export async function stopViewAs(): Promise<ActionResult> {
  (await cookies()).set(VIEW_AS_COOKIE, "", { maxAge: 0, path: "/" });
  revalidatePath("/", "layout");
  return { ok: true };
}
