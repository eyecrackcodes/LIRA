import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { cache } from "react";
import { getActiveAgents } from "./queries";
import { agentSlug } from "./format";

/**
 * Supabase Auth (Google OAuth + email magic link) with two roles:
 * - manager: emails in MANAGER_EMAILS (comma-separated env) — sees everything,
 *   including commissions and P&L.
 * - agent:   signed-in email matches an active dim_agent.agent_email — sees the
 *   agent-safe app (no commissions, no P&L, no data-health admin).
 * Anyone else authenticated is role "none" and gets a no-access screen.
 *
 * The warehouse queries still run through the server-only client in
 * supabase.ts; auth only decides WHICH server-rendered data a viewer gets.
 */

export type Role = "manager" | "agent" | "none";

export interface Viewer {
  email: string;
  role: Role;
  /** dim_agent.agent name when role === "agent" */
  agent: string | null;
  /**
   * Present when a manager is previewing the app as an agent ("View as").
   * The viewer then LOOKS like that agent to every gate in the app — that's
   * the point — and this field is what lets the layout show the exit banner.
   */
  viewingAs?: { realEmail: string };
}

/**
 * "View as" cookie — holds the slug of the agent a manager is previewing.
 * Deliberately just a slug, not a signed token: the cookie is only ever
 * APPLIED when the real signed-in identity is a manager (see getViewer), so
 * a non-manager planting it changes nothing, and a manager tampering with it
 * can only reach views they already outrank. Impersonation de-escalates,
 * never escalates.
 */
export const VIEW_AS_COOKIE = "view-as-agent";

function managerSet(): Set<string> {
  const fromEnv = (process.env.MANAGER_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(fromEnv);
}

/** Server client bound to the request cookies (session reading + refresh). */
export async function createAuthClient() {
  const cookieStore = await cookies();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY; // anon key — auth only, never data
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_KEY.");
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components can't set cookies; proxy.ts handles the refresh.
        }
      },
    },
  });
}

/**
 * The signed-in identity with NO "View as" applied. This is what the
 * impersonation actions gate on — everything else should use getViewer().
 */
export const getRealViewer = cache(async (): Promise<Viewer | null> => {
  if (process.env.AUTH_DISABLED === "1") {
    // Dev-only: set DEV_VIEWER_AGENT to an exact dim_agent name to browse the
    // app as that agent (for checking agent-scoped views). Never in production.
    const devAgent = process.env.DEV_VIEWER_AGENT?.trim();
    if (devAgent) return { email: "dev@localhost", role: "agent", agent: devAgent };
    return { email: "dev@localhost", role: "manager", agent: null };
  }

  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.toLowerCase();
  if (!email) return null;

  if (managerSet().has(email)) return { email, role: "manager", agent: null };

  const agents = await getActiveAgents();
  const me = agents.find((a) => a.agent_email?.toLowerCase() === email);
  if (me) return { email, role: "agent", agent: me.agent };

  return { email, role: "none", agent: null };
});

/**
 * Who is looking at this request? Cached per render pass.
 *
 * If the real identity is a MANAGER and the "View as" cookie names an active
 * agent, the returned viewer IS that agent (role, name, email) — so film
 * privacy, commission scoping, nav gating, and Coach context all behave
 * exactly as they would for the agent. Non-managers never get the swap, and a
 * stale cookie (agent departed overnight) quietly falls back to the real view.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const real = await getRealViewer();
  if (!real || real.role !== "manager") return real;

  const slug = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  if (!slug) return real;

  const agents = await getActiveAgents();
  const target = agents.find((a) => agentSlug(a.agent) === slug);
  if (!target) return real;

  return {
    email: (target.agent_email ?? real.email).toLowerCase(),
    role: "agent",
    agent: target.agent,
    viewingAs: { realEmail: real.email },
  };
});

export function isManager(viewer: Viewer | null): boolean {
  return viewer?.role === "manager";
}

/** Page-level gate for pay/PII pages. Returns the viewer or null (render a denial). */
export async function requireManager(): Promise<Viewer | null> {
  const viewer = await getViewer();
  return isManager(viewer) ? viewer : null;
}

/**
 * Film Room visibility: every rostered teammate can watch every agent's film.
 *
 * Opened deliberately (2026-08-13, manager's call) so the team can study each
 * other's calls — peer film study is the point of a film room, and the previous
 * own-calls-only rule meant an agent could never hear what a good call sounds
 * like from someone else.
 *
 * What this widens: transcripts and recordings carry client names and
 * health/bank details, so customer PII is now audible to every agent, not just
 * to managers and the agent who took the call. That is the accepted tradeoff,
 * not an oversight.
 *
 * The gate that still matters is the ACCOUNT gate — role "none" (a signed-in
 * Google user who isn't on the roster) gets nothing. `agent` is deliberately
 * not a parameter: taking one would imply a per-agent check that no longer
 * happens.
 */
export function canViewAgentFilm(viewer: Viewer | null): boolean {
  return isManager(viewer) || viewer?.role === "agent";
}
