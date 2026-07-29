import { BRAND } from "@/lib/brand";
import CoachDock from "@/components/CoachDock";
import { coachConfigured } from "@/lib/coach";
import Nav from "@/components/Nav";
import ThemeToggle from "@/components/ThemeToggle";
import { FreshnessStamp, StaleBanner } from "@/components/FreshnessStamp";
import ViewAsBanner from "@/components/ViewAsBanner";
import ViewAsSwitcher from "@/components/ViewAsSwitcher";
import { getActiveAgents, getFreshness } from "@/lib/queries";
import { getViewer, isManager } from "@/lib/auth";
import { departedAgentSet } from "@/lib/roster";
import { agentSlug } from "@/lib/format";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic"; // viewer-dependent; queries are cached upstream

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login"); // proxy already guards; belt and suspenders

  if (viewer.role === "none") {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center gap-6 px-4">
        <div className="w-full max-w-md rounded-md border border-edge bg-panel p-8 text-center">
          <h1 className="display mb-2 text-xl font-bold uppercase tracking-widest text-ink">
            No locker assigned
          </h1>
          <p className="mb-6 text-sm leading-relaxed text-mute">
            <span className="text-ink">{viewer.email}</span> is signed in but isn&apos;t on the
            active roster or the management list. If that&apos;s wrong, ask your manager to add
            your email.
          </p>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="display rounded-sm border border-edge px-4 py-2 text-sm uppercase tracking-wider text-mute transition-colors hover:border-gold-dim hover:text-gold"
            >
              Sign out
            </button>
          </form>
        </div>
        <div className="w-full max-w-md">
          <ThemeToggle compact />
        </div>
      </div>
    );
  }

  const freshness = await getFreshness();

  // Managers get the "View as agent" switcher. While a preview is active the
  // effective role is "agent", so this list is empty and the switcher hides —
  // the banner carries the exit instead.
  let switchable: { name: string; slug: string }[] = [];
  if (isManager(viewer)) {
    const [agents, departed] = await Promise.all([getActiveAgents(), departedAgentSet()]);
    switchable = agents
      .filter((a) => !departed.has(a.agent))
      .map((a) => ({ name: a.agent, slug: agentSlug(a.agent) }));
  }

  return (
    <>
      {process.env.DEMO_MODE === "1" && (
        <div className="border-b border-gold-dim bg-navy px-4 py-1.5 text-center text-[11px] uppercase tracking-widest text-gold">
          Demo data · fictional agents, clients &amp; figures · nothing here is real
        </div>
      )}
      {viewer.viewingAs && <ViewAsBanner agent={viewer.agent!} />}
      <StaleBanner freshness={freshness} />
      <div className="mx-auto flex max-w-[1440px] flex-col lg:flex-row">
        <aside className="shrink-0 border-b border-edge px-4 py-4 lg:min-h-screen lg:w-56 lg:border-b-0 lg:border-r lg:py-6">
          <div className="mb-1 flex items-center gap-2">
            <span className="display text-xl font-bold uppercase tracking-widest text-gold">
              {BRAND.mark}
            </span>
            <span className="display text-xl font-semibold uppercase tracking-widest text-ink">
              {BRAND.name}
            </span>
          </div>
          <div className="mb-4 text-[11px] uppercase tracking-wider text-faint">
            {BRAND.tagline}
          </div>
          <Nav
            role={viewer.role}
            myCardHref={viewer.agent ? `/roster/${agentSlug(viewer.agent)}` : null}
          />
          <div className="mt-4 border-t border-edge pt-4">
            <ThemeToggle />
          </div>
          {switchable.length > 0 && <ViewAsSwitcher agents={switchable} />}
          <div className="mt-6 hidden border-t border-edge pt-4 lg:block">
            <FreshnessStamp freshness={freshness} />
            <div className="mt-2 text-[11px] leading-relaxed text-faint">
              Nightly warehouse batch — not live.
            </div>
            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-faint">
              <span className="truncate" title={viewer.email}>
                {viewer.agent ?? viewer.email}
              </span>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="whitespace-nowrap uppercase tracking-wider text-mute hover:text-gold"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
          <div className="mb-4 lg:hidden">
            <FreshnessStamp freshness={freshness} />
          </div>
          {children}
        </main>
      </div>
      {/* Mounted in the layout (not per page) so the App Router keeps it alive
          across navigation — the conversation follows the viewer around. Keyed
          by identity so switching into/out of a "View as" preview starts a
          fresh conversation instead of leaking the manager's transcript into
          the agent view. */}
      <CoachDock
        key={viewer.agent ?? viewer.email}
        configured={coachConfigured()}
        role={viewer.role === "agent" ? "agent" : "manager"}
      />
    </>
  );
}
