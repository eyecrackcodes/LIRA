import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getViewer, canViewAgentFilm } from "@/lib/auth";
import { getCallTranscript } from "@/lib/queries";
import { fmtDuration, parseTranscript } from "@/lib/film";
import { detectObjections, OBJECTION_CATEGORIES } from "@/lib/objections";
import { detectScriptSections } from "@/lib/script";
import { agentSlug, fmtInt, fmtMoney, fmtScore, fmtTimePT, fmtWeek } from "@/lib/format";
import TranscriptReader from "@/components/TranscriptReader";
import CallPlayer from "@/components/CallPlayer";
import BackToTop from "@/components/BackToTop";
import { Panel } from "@/components/ui";

export const dynamic = "force-dynamic"; // viewer-scoped access

export default async function CallReaderPage({
  params,
}: {
  params: Promise<{ slug: string; uuid: string }>;
}) {
  const { slug, uuid } = await params;

  const row = await getCallTranscript(uuid);
  if (!row || agentSlug(row.agent) !== slug) notFound();
  // Client PII in transcript/recording — manager, or the agent's own call only.
  if (!canViewAgentFilm(await getViewer(), row.agent)) redirect("/");

  const turns = parseTranscript(row.transcript, row.agent);
  const isHot = row.trigger === "hot";

  const objections = detectObjections(turns);
  const objectionMarkers: Record<number, { label: string; color: string }> = {};
  for (const m of objections.moments) {
    objectionMarkers[m.turnIndex] = {
      label: OBJECTION_CATEGORIES[m.category].label,
      color: OBJECTION_CATEGORIES[m.category].color,
    };
  }

  const scriptSections = detectScriptSections(turns);
  const sectionMarkers: Record<number, { label: string; color: string }> = {};
  for (const s of scriptSections) {
    // If two stages resolve to the same turn, the earlier script stage keeps
    // the inline heading (list is ordered turnIndex→script order).
    if (sectionMarkers[s.turnIndex]) continue;
    sectionMarkers[s.turnIndex] = { label: s.label, color: s.color };
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/film/${slug}`}
        className="text-xs uppercase tracking-wider text-mute hover:text-gold"
      >
        ← {row.agent}&apos;s Film Library
      </Link>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">{isHot ? "🔥" : "🧊"}</span>
              <h1 className="display text-xl font-bold uppercase tracking-wide text-ink">
                {row.agent} · {fmtWeek(row.call_date)}
              </h1>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                  isHot ? "border-up/50 text-up" : "border-down/50 text-down"
                }`}
              >
                {row.trigger}
              </span>
            </div>
            <div className="num mt-1 text-sm text-mute">
              {fmtTimePT(row.started_at)} · {fmtDuration(row.duration_sec)} · score{" "}
              {fmtScore(row.overall_score)}
            </div>
          </div>
          <div className="num text-right text-sm text-mute">
            day: {fmtInt(row.day_sales)} sales · {fmtMoney(row.day_premium)} ·{" "}
            {fmtInt(row.day_dials)} dials
          </div>
        </div>
        <div className="mt-3">
          <CallPlayer uuid={row.conversation_uuid} />
        </div>
        <p className="mt-3 rounded-sm border border-edge2 bg-navy px-3 py-2 text-[11px] leading-relaxed text-faint">
          Turns are resolved to <span className="text-gold">Agent</span> /{" "}
          <span className="text-blue">Client</span> from the call&apos;s role tags and who runs
          the script — the transcription tool misspells names (the same agent appears under
          several spellings) and per Attention&apos;s diarization bug an opening line can be a
          transfer-fronter rather than the agent, so treat opening-line attribution as a best
          guess, not gospel. The raw transcribed label is shown beside each turn.
        </p>
      </Panel>

      {scriptSections.length > 0 && (
        <Panel>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display text-sm font-bold uppercase tracking-widest text-gold">
              Jump to Script Section
            </h2>
            <span className="num text-xs text-mute">
              {scriptSections.length} of 6 stages found
            </span>
          </div>
          <p className="mb-2 text-xs text-faint">
            Where each part of the script starts in this call — jump straight to the opening,
            the quote, or the close. A missing stage means the call didn&apos;t clearly reach it.
          </p>
          <div className="flex flex-wrap gap-2">
            {scriptSections.map((s) => (
              <a
                key={s.section}
                href={`#section-${s.turnIndex}`}
                className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider hover:opacity-80"
                style={{ color: s.color, borderColor: s.color }}
              >
                {s.label}
              </a>
            ))}
          </div>
        </Panel>
      )}

      {objections.total > 0 && (
        <Panel>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="display text-sm font-bold uppercase tracking-widest text-gold">
              Objection Moments
            </h2>
            <span className="num text-xs text-mute">
              {objections.total} flagged · {objections.respondedCount} handled
            </span>
          </div>
          <p className="mb-2 text-xs text-faint">
            Auto-flagged client pushback (candidates, not a score) — jump to a moment in the
            transcript below.
          </p>
          <div className="flex flex-wrap gap-2">
            {objections.moments.map((m, i) => (
              <a
                key={i}
                href={`#moment-${m.turnIndex}`}
                className="rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider hover:opacity-80"
                style={{
                  color: OBJECTION_CATEGORIES[m.category].color,
                  borderColor: OBJECTION_CATEGORIES[m.category].color,
                }}
              >
                {OBJECTION_CATEGORIES[m.category].label}
                {m.agentResponse === "" ? " · no reply" : ""}
              </a>
            ))}
          </div>
        </Panel>
      )}

      <Panel>
        <TranscriptReader
          turns={turns}
          objections={objectionMarkers}
          sections={sectionMarkers}
        />
      </Panel>

      <BackToTop />
    </div>
  );
}
