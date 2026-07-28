import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getViewer, canViewAgentFilm } from "@/lib/auth";
import { getActiveAgents, getFilmMeta, getCallTranscript, getCallTranscriptsByUuids } from "@/lib/queries";
import type { CallTranscriptFullRow, CallTranscriptRow } from "@/lib/types";
import {
  buildFilmDays,
  pickBestHotCall,
  pickLatestColdCall,
  parseTranscript,
  openingExchange,
  talkTimeShare,
  fmtDuration,
  speakerColor,
} from "@/lib/film";
import { agentSlug, fmtTimePT, fmtScore, fmtWeek } from "@/lib/format";
import { detectObjections, compareObjections, OBJECTION_CATEGORIES } from "@/lib/objections";
import TranscriptReader from "@/components/TranscriptReader";
import ObjectionCompare, { ObjectionMomentCard } from "@/components/ObjectionCompare";
import SessionPicker, { type SessionOption } from "@/components/SessionPicker";
import CallPlayer from "@/components/CallPlayer";
import BackToTop from "@/components/BackToTop";
import { Panel, SectionTitle } from "@/components/ui";

export const dynamic = "force-dynamic"; // viewer-scoped access

export default async function SessionViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ hot?: string; cold?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const agents = await getActiveAgents();
  const agentRow = agents.find((a) => agentSlug(a.agent) === slug);
  if (!agentRow) notFound();
  const agent = agentRow.agent;
  // Client PII — manager, or the agent's own session only.
  if (!canViewAgentFilm(await getViewer(), agent)) redirect("/");

  const rows = await getFilmMeta({ agent });
  const days = buildFilmDays(rows);
  const defaultHot = pickBestHotCall(days);
  const defaultCold = pickLatestColdCall(days);

  const optionLabel = (c: { call_date: string; started_at: string; overall_score: number | null }) =>
    `${fmtWeek(c.call_date)} · ${fmtTimePT(c.started_at)} · score ${fmtScore(c.overall_score)}`;

  const hotOptions: SessionOption[] = days
    .filter((d) => d.trigger === "hot")
    .flatMap((d) => d.calls)
    .map((c) => ({ uuid: c.conversation_uuid, label: optionLabel(c) }));
  const coldOptions: SessionOption[] = days
    .filter((d) => d.trigger === "cold")
    .flatMap((d) => d.calls)
    .map((c) => ({ uuid: c.conversation_uuid, label: optionLabel(c) }));

  const backLink = (
    <Link href={`/film/${slug}`} className="text-xs uppercase tracking-wider text-mute hover:text-gold">
      ← {agent}&apos;s Film Library
    </Link>
  );

  if ((!sp.hot && !defaultHot) || (!sp.cold && !defaultCold)) {
    return (
      <div className="space-y-6">
        {backLink}
        <Panel>
          <p className="text-sm text-mute">
            A session needs at least one 🔥 hot-day call and one 🧊 cold-day call for {agent}.
            Captured so far: {hotOptions.length} hot, {coldOptions.length} cold.
          </p>
        </Panel>
      </div>
    );
  }

  // Default picks are objection-aware: among the default day's calls, open the
  // one with the most flagged client-pushback moments (tie → higher score).
  // The objection comparison is this page's centerpiece — score-only defaults
  // regularly landed on two clean calls and rendered it empty.
  async function resolveSide(
    explicitUuid: string | undefined,
    dflt: CallTranscriptRow | null
  ): Promise<CallTranscriptFullRow | null> {
    if (explicitUuid) return getCallTranscript(explicitUuid);
    if (!dflt) return null;
    const day = days.find((d) =>
      d.calls.some((c) => c.conversation_uuid === dflt.conversation_uuid)
    );
    if (!day || day.calls.length === 1) return getCallTranscript(dflt.conversation_uuid);

    const fulls = await getCallTranscriptsByUuids(day.calls.map((c) => c.conversation_uuid));
    let best: CallTranscriptFullRow | null = null;
    let bestObjections = -1;
    let bestScore = -Infinity;
    for (const f of fulls) {
      const total = detectObjections(parseTranscript(f.transcript, agent)).total;
      const score = f.overall_score ?? -1;
      if (total > bestObjections || (total === bestObjections && score > bestScore)) {
        best = f;
        bestObjections = total;
        bestScore = score;
      }
    }
    return best ?? getCallTranscript(dflt.conversation_uuid);
  }

  const [hotFull, coldFull] = await Promise.all([
    resolveSide(sp.hot, defaultHot),
    resolveSide(sp.cold, defaultCold),
  ]);
  if (!hotFull || !coldFull) notFound();
  // The hot/cold UUIDs come from the URL — never let them cross agents.
  if (hotFull.agent !== agent || coldFull.agent !== agent) notFound();

  const hotUuid = hotFull.conversation_uuid;
  const coldUuid = coldFull.conversation_uuid;

  const hotTurns = parseTranscript(hotFull.transcript, agent);
  const coldTurns = parseTranscript(coldFull.transcript, agent);
  const hotObjections = detectObjections(hotTurns);
  const coldObjections = detectObjections(coldTurns);
  const objectionRows = compareObjections(hotObjections, coldObjections);

  const sides = [
    { full: hotFull, turns: hotTurns, objections: hotObjections, isHot: true, title: "Best day" },
    { full: coldFull, turns: coldTurns, objections: coldObjections, isHot: false, title: "Slump day" },
  ];

  return (
    <div className="space-y-6">
      {backLink}

      <Panel>
        <SectionTitle sub="own-best comparison — never agent-vs-agent">Session View</SectionTitle>
        <p className="mb-3 text-sm text-mute">
          &quot;This is you at your best — three weeks ago.&quot; A call from {agent}&apos;s own
          best day next to a call from a slump day. Where did they deviate from what was working
          FOR THEM?
        </p>
        <SessionPicker
          slug={slug}
          hotOptions={hotOptions}
          coldOptions={coldOptions}
          hotValue={hotUuid}
          coldValue={coldUuid}
        />
      </Panel>

      <Panel>
        <SectionTitle sub="candidate moments · client pushback paired with the agent's reply">
          Objection Handling — Best vs Slump
        </SectionTitle>
        <p className="mb-3 text-sm text-mute">
          The moments where the client pushed back, lined up by type. Compare how {agent} handled
          the same objection on the day they closed vs. the slump day — a category that shows up
          only on the slump side, or a &quot;no reply&quot; where the best day has &quot;handled,&quot;
          is where to point the coaching. These are auto-flagged candidates from the transcript
          text, not a graded score — read the moment before you judge it.
        </p>
        <ObjectionCompare rows={objectionRows} hot={hotObjections} cold={coldObjections} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {sides.map(({ full, turns, objections, isHot, title }) => {
          const shares = talkTimeShare(turns);
          const opening = openingExchange(turns);
          const openingMarkers: Record<number, { label: string; color: string }> = {};
          for (const m of objections.moments) {
            if (m.turnIndex < opening.length)
              openingMarkers[m.turnIndex] = {
                label: OBJECTION_CATEGORIES[m.category].label,
                color: OBJECTION_CATEGORIES[m.category].color,
              };
          }
          return (
            <Panel key={full.conversation_uuid}>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-lg">{isHot ? "🔥" : "🧊"}</span>
                <span className="display font-semibold uppercase tracking-wide text-ink">
                  {title}
                </span>
              </div>
              <div className="num mb-3 text-xs text-mute">
                {fmtWeek(full.call_date)} · {fmtTimePT(full.started_at)} ·{" "}
                {fmtDuration(full.duration_sec)} · score {fmtScore(full.overall_score)}
              </div>

              <div className="mb-4">
                <CallPlayer uuid={full.conversation_uuid} compact />
              </div>

              <div className="mb-4">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-faint">
                  Talk-time share (est. by word count — no per-line timestamps exist)
                </div>
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-navy">
                  {shares.map((s) => (
                    <div
                      key={s.speaker}
                      style={{ width: `${s.pct}%`, backgroundColor: speakerColor(s.speaker) }}
                      title={`${s.speaker}: ${s.pct.toFixed(0)}%`}
                    />
                  ))}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-mute">
                  {shares.map((s) => (
                    <span key={s.speaker}>
                      <span style={{ color: speakerColor(s.speaker) }}>{s.speaker}</span>{" "}
                      {s.pct.toFixed(0)}%
                    </span>
                  ))}
                </div>
              </div>

              <div className="mb-4">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-faint">
                    Objection moments
                  </span>
                  <span className="num text-[10px] text-faint">
                    {objections.total > 0
                      ? `${objections.respondedCount}/${objections.total} handled`
                      : "none flagged"}
                  </span>
                </div>
                {objections.moments.length === 0 ? (
                  <p className="text-xs italic text-faint">
                    No client pushback auto-flagged on this call.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {objections.moments.map((m, i) => (
                      <ObjectionMomentCard key={i} m={m} showCategory />
                    ))}
                  </div>
                )}
              </div>

              <div className="mb-4">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-faint">
                  Opening exchange (approx., first {opening.length} turns — no timestamped
                  60-sec cut exists)
                </div>
                <TranscriptReader turns={opening} dense objections={openingMarkers} />
              </div>

              <Link
                href={`/film/${slug}/call/${full.conversation_uuid}`}
                className="text-xs uppercase tracking-wider text-gold hover:underline"
              >
                Read full call →
              </Link>
            </Panel>
          );
        })}
      </div>

      <BackToTop />
    </div>
  );
}
