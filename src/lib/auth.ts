import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { cache } from "react";
import { getActiveAgents } from "./queries";

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
}

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

/** Who is looking at this request? Cached per render pass. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
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

export function isManager(viewer: Viewer | null): boolean {
  return viewer?.role === "manager";
}

/** Page-level gate for pay/PII pages. Returns the viewer or null (render a denial). */
export async function requireManager(): Promise<Viewer | null> {
  const viewer = await getViewer();
  return isManager(viewer) ? viewer : null;
}

/**
 * Film Room privacy rule: a manager sees every agent's calls; an agent only
 * ever sees their OWN (transcripts/recordings carry client names + details).
 */
export function canViewAgentFilm(viewer: Viewer | null, agent: string): boolean {
  if (isManager(viewer)) return true;
  return viewer?.role === "agent" && viewer.agent === agent;
}
