import { speakerColor, type TranscriptTurn } from "@/lib/film";

/**
 * Server-renderable transcript reader. Each turn is resolved to a ROLE —
 * Agent / Client / Other — rather than trusting the STT-mangled name (which
 * varies within and across calls). The raw transcribed label is shown small
 * beside it for transparency, so a manager can see where the label came from.
 */
export default function TranscriptReader({
  turns,
  dense = false,
  objections,
  sections,
}: {
  turns: TranscriptTurn[];
  dense?: boolean;
  /** turnIndex → objection marker, to flag client-pushback moments inline. */
  objections?: Record<number, { label: string; color: string }>;
  /** turnIndex → script-section marker, renders a jump anchor + heading. */
  sections?: Record<number, { label: string; color: string }>;
}) {
  if (turns.length === 0) {
    return <p className="text-sm text-mute">No transcript text captured for this call.</p>;
  }
  return (
    <div className={dense ? "space-y-2" : "space-y-3"}>
      {turns.map((t, i) => {
        // Only show the raw label when it adds something beyond the role.
        const showRaw =
          t.rawSpeaker &&
          t.rawSpeaker.toLowerCase() !== t.speaker.toLowerCase() &&
          !/^speaker\s*\d+$/i.test(t.rawSpeaker);
        const obj = objections?.[i];
        const sec = sections?.[i];
        return (
          <div key={i}>
            {sec && (
              <div
                id={`section-${i}`}
                className="mb-2 mt-1 flex scroll-mt-24 items-center gap-2 border-t border-edge2 pt-3 first:mt-0 first:border-t-0 first:pt-0"
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: sec.color }}
                  aria-hidden
                />
                <span
                  className="display text-[11px] font-bold uppercase tracking-widest"
                  style={{ color: sec.color }}
                >
                  {sec.label}
                </span>
              </div>
            )}
            <div
              id={obj ? `moment-${i}` : undefined}
              className={`text-sm leading-relaxed ${
                obj ? "-mx-2 scroll-mt-24 rounded-sm border-l-2 bg-navy/40 px-2 py-1" : ""
              }`}
              style={obj ? { borderColor: obj.color } : undefined}
            >
            <span
              className="display mr-1.5 text-xs font-bold uppercase tracking-wider"
              style={{ color: speakerColor(t.speaker) }}
            >
              {t.speaker}
            </span>
            {obj && (
              <span
                className="mr-1.5 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: obj.color, borderColor: obj.color }}
              >
                {obj.label}
              </span>
            )}
            {showRaw && (
              <span className="text-[10px] uppercase tracking-wider text-faint">
                · as transcribed: {t.rawSpeaker}
              </span>
            )}
            <p className="mt-0.5 text-ink">{t.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
