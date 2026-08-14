import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, canViewAgentFilm } from "@/lib/auth";
import { getActiveAgents, getFilmMeta } from "@/lib/queries";
import { buildFilmDays } from "@/lib/film";
import { agentSlug, fmtWeek } from "@/lib/format";
import AgentAvatar from "@/components/AgentAvatar";
import { HeaderTip, Panel } from "@/components/ui";

export const dynamic = "force-dynamic"; // viewer-scoped access

export default async function FilmRoomPage() {
  const viewer = await getViewer();
  // The roster-wide index is open to the whole team: agents need it to reach
  // each other's libraries at all, so gating it would have made "everyone can
  // see everyone's calls" reachable only by guessing URLs. It does expose every
  // agent's hot/cold day pattern to their peers — accepted along with it.
  if (!canViewAgentFilm(viewer)) redirect("/");

  const [agents, meta] = await Promise.all([getActiveAgents(), getFilmMeta()]);

  const rowsByAgent = new Map<string, typeof meta>();
  for (const r of meta) {
    if (!rowsByAgent.has(r.agent)) rowsByAgent.set(r.agent, []);
    rowsByAgent.get(r.agent)!.push(r);
  }

  const summaries = agents.map((a) => {
    const rows = rowsByAgent.get(a.agent) ?? [];
    const days = buildFilmDays(rows);
    const hotDays = days.filter((d) => d.trigger === "hot").length;
    const coldDays = days.filter((d) => d.trigger === "cold").length;
    return {
      agent: a.agent,
      calls: rows.length,
      hotDays,
      coldDays,
      latest: days[0]?.call_date ?? null, // buildFilmDays sorts newest-first
    };
  });

  const withFilm = summaries.filter((s) => s.calls > 0).sort((a, b) => (b.latest! < a.latest! ? -1 : 1));
  const withoutFilm = summaries.filter((s) => s.calls === 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
          🎬 Film Room
        </h1>
        <p className="text-sm text-mute">
          Full transcripts, captured only on outlier days —{" "}
          <HeaderTip
            label="🔥 hot / 🧊 cold"
            tip="Flagged by the nightly capture against the agent's OWN baseline: hot = an outlier good day (big sales/premium, or converting with above-median call length); cold = zero conversions with an off-median call-length profile. Every serious athlete watches film — best day next to slump day."
          />
          . Open to the whole team — every teammate can watch every agent&apos;s film.
          Transcripts and recordings carry real client names and health/bank details, so treat
          them as customer records: study them, don&apos;t share them outside this room.
        </p>
      </header>

      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {withFilm.map((s) => (
            <Link
              key={s.agent}
              href={`/film/${agentSlug(s.agent)}`}
              className="card-in group rounded-md border border-edge bg-panel p-4 transition-colors hover:border-gold-dim"
            >
              <div className="flex items-center gap-3">
                <AgentAvatar agent={s.agent} size={48} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink group-hover:text-gold">
                    {s.agent}
                  </div>
                  <div className="text-xs text-mute">
                    latest capture {s.latest ? fmtWeek(s.latest) : "—"}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-4 text-sm">
                <span className="num text-ink">
                  🔥 <span className="font-semibold">{s.hotDays}</span>
                </span>
                <span className="num text-ink">
                  🧊 <span className="font-semibold">{s.coldDays}</span>
                </span>
                <span className="num text-faint">{s.calls} calls captured</span>
              </div>
            </Link>
          ))}
        </div>

        {withoutFilm.length > 0 && (
          <div className="mt-5 border-t border-edge pt-4">
            <div className="mb-2 text-xs uppercase tracking-wider text-faint">
              No outlier days captured yet
            </div>
            <div className="flex flex-wrap gap-2">
              {withoutFilm.map((s) => (
                <span
                  key={s.agent}
                  className="rounded-full border border-edge px-3 py-1 text-xs text-mute"
                >
                  {s.agent}
                </span>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
