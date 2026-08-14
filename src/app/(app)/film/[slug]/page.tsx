import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getViewer, canViewAgentFilm } from "@/lib/auth";
import { getActiveAgents, getFilmMeta } from "@/lib/queries";
import { bestCallOf, buildFilmDays, fmtDuration, pickBestHotCall, pickLatestColdCall } from "@/lib/film";
import { agentSlug, fmtInt, fmtMoney, fmtScore, fmtTimePT, fmtWeek } from "@/lib/format";
import AgentAvatar from "@/components/AgentAvatar";
import { HeaderTip, Panel, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic"; // viewer-scoped access

export default async function AgentFilmLibraryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const viewer = await getViewer();

  const agents = await getActiveAgents();
  const agentRow = agents.find((a) => agentSlug(a.agent) === slug);
  if (!agentRow) notFound();
  const agent = agentRow.agent;
  // Open to the whole roster; still closed to anyone without an account.
  if (!canViewAgentFilm(viewer)) redirect("/");

  const rows = await getFilmMeta({ agent });
  const days = buildFilmDays(rows);
  const bestHot = pickBestHotCall(days);
  const latestCold = pickLatestColdCall(days);

  return (
    <div className="space-y-6">
      <Link href="/film" className="text-xs uppercase tracking-wider text-mute hover:text-gold">
        ← Film Room
      </Link>

      <Panel className="!p-6">
        <div className="flex flex-wrap items-center gap-4">
          <AgentAvatar agent={agent} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="display text-2xl font-bold uppercase tracking-wide text-ink">
              {agent}
            </h1>
            <div className="text-sm text-mute">
              {days.length} captured day{days.length === 1 ? "" : "s"} · {rows.length} calls ·{" "}
              🔥 {days.filter((d) => d.trigger === "hot").length} · 🧊{" "}
              {days.filter((d) => d.trigger === "cold").length}
            </div>
          </div>
          {bestHot && latestCold && (
            <Link
              href={`/film/${slug}/session`}
              className="display rounded-sm border border-gold-dim bg-navy px-4 py-2 text-sm uppercase tracking-wider text-gold transition-colors hover:bg-gold/10"
            >
              Session View →
            </Link>
          )}
        </div>
      </Panel>

      {days.length === 0 ? (
        <Panel>
          <p className="text-sm text-mute">
            No outlier days captured for {agent} yet — film library fills in nightly on the
            agent&apos;s own hot (big-sales) or cold (zero-sales) days.
          </p>
        </Panel>
      ) : (
        <Panel>
          <SectionTitle sub="newest first · ★ = the day's strongest call — start there">
            Film Library
          </SectionTitle>
          <div className="space-y-3">
            {days.map((day, dayIdx) => {
              const isHot = day.trigger === "hot";
              const startHere = bestCallOf(day);
              return (
                // Native disclosure keeps this server-rendered: recent days
                // open, the long tail collapsed so 20+ days don't wall the page.
                <details
                  key={day.call_date}
                  open={dayIdx < 3}
                  className="group rounded-sm border border-edge/60"
                >
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-3 [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-faint transition-transform group-open:rotate-90">
                        ▶
                      </span>
                      <span className="text-lg">{isHot ? "🔥" : "🧊"}</span>
                      <span className="display font-semibold text-ink">{fmtWeek(day.call_date)}</span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                          isHot ? "border-up/50 text-up" : "border-down/50 text-down"
                        }`}
                      >
                        {day.trigger}
                      </span>
                      <span className="text-xs text-faint">
                        {day.calls.length} call{day.calls.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="num text-xs text-mute">
                        <HeaderTip
                          label={`${fmtInt(day.day_sales)} sales · ${fmtMoney(day.day_premium)} · ${fmtInt(day.day_dials)} dials`}
                          tip="Day-level context from daily_activity/AMS — same for every call captured that day."
                          align="right"
                        />
                      </div>
                      {!isHot && bestHot && (
                        <Link
                          href={`/film/${slug}/session?hot=${bestHot.conversation_uuid}&cold=${startHere.conversation_uuid}`}
                          className="text-xs uppercase tracking-wider text-mute hover:text-gold"
                        >
                          Compare vs best day →
                        </Link>
                      )}
                    </div>
                  </summary>
                  <div className="divide-y divide-edge/40 border-t border-edge/40 px-3 pb-1">
                    {day.calls.map((c) => {
                      const isStart = c.conversation_uuid === startHere.conversation_uuid;
                      return (
                        <div
                          key={c.conversation_uuid}
                          className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm"
                        >
                          <div className="num min-w-0 flex-1 truncate text-mute">
                            {fmtTimePT(c.started_at)} · {fmtDuration(c.duration_sec)} · score{" "}
                            {fmtScore(c.overall_score)}
                            {isStart && day.calls.length > 1 && (
                              <span className="ml-2 rounded-sm border border-gold-dim px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gold">
                                ★ start here
                              </span>
                            )}
                          </div>
                          <Link
                            href={`/film/${slug}/call/${c.conversation_uuid}`}
                            className="text-xs uppercase tracking-wider text-gold hover:underline"
                          >
                            Read
                          </Link>
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
