import { OBJECTION_CATEGORIES } from "@/lib/objections";
import type {
  ObjectionCompareRow,
  ObjectionMoment,
  ObjectionProfile,
} from "@/lib/objections";

/**
 * Game Day objection comparison — category-aligned, hot (best day) vs cold
 * (slump day). Lets a coach see at a glance whether an objection showed up on
 * one day and not the other, and how the agent handled it each time. Candidate
 * moments only (see detectObjections) — read for content, not as a score.
 */

export function ObjectionMomentCard({
  m,
  showCategory = false,
}: {
  m: ObjectionMoment;
  showCategory?: boolean;
}) {
  return (
    <div className="rounded-sm border border-edge2 bg-navy px-2.5 py-2">
      {showCategory && (
        <div className="mb-1">
          <span
            className="rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              color: OBJECTION_CATEGORIES[m.category].color,
              borderColor: OBJECTION_CATEGORIES[m.category].color,
            }}
          >
            {m.label}
          </span>
        </div>
      )}
      <p className="text-[13px] italic leading-snug text-down">
        “{m.clientText.length > 220 ? m.clientText.slice(0, 220) + "…" : m.clientText}”
      </p>
      {m.agentResponse ? (
        <p className="mt-1.5 text-[13px] leading-snug text-ink">
          <span className="text-[10px] uppercase tracking-wider text-faint">reply · </span>
          {m.agentResponse.length > 240
            ? m.agentResponse.slice(0, 240) + "…"
            : m.agentResponse}
        </p>
      ) : null}
      <div className="mt-1.5">
        {m.agentResponse === "" ? (
          <span className="rounded-full border border-down/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-down">
            no reply — possible drop
          </span>
        ) : m.responded ? (
          <span className="rounded-full border border-up/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-up">
            handled
          </span>
        ) : (
          <span className="rounded-full border border-edge px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-mute">
            brief reply
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Compact category vector — counts per side + "only on" flags, no full moment
 * text (the moment cards live on each day's tape below, so we don't repeat
 * them here). This is the at-a-glance "did objections differ?" view.
 */
export default function ObjectionCompare({
  rows,
  hot,
  cold,
}: {
  rows: ObjectionCompareRow[];
  hot: ObjectionProfile;
  cold: ObjectionProfile;
}) {
  const respRate = (p: ObjectionProfile) =>
    p.total > 0 ? `${p.respondedCount}/${p.total} handled` : "—";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-sm border border-edge2 bg-navy px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-faint">🔥 Best day</div>
          <div className="num text-lg font-bold text-ink">
            {hot.total} <span className="text-xs font-normal text-mute">objections</span>
          </div>
          <div className="num text-[11px] text-mute">{respRate(hot)}</div>
        </div>
        <div className="rounded-sm border border-edge2 bg-navy px-3 py-2">
          <div className="text-[10px] uppercase tracking-wider text-faint">🧊 Slump day</div>
          <div className="num text-lg font-bold text-ink">
            {cold.total} <span className="text-xs font-normal text-mute">objections</span>
          </div>
          <div className="num text-[11px] text-mute">{respRate(cold)}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-mute">
          No client objections auto-flagged in either call. Detection is conservative — it only
          flags clear resistance language in client turns (needs to think, won&apos;t share
          info, wants to consult a spouse, can&apos;t afford it), not answers to script
          questions. Read the tapes below if you expected pushback here.
        </p>
      ) : (
        <div className="divide-y divide-edge2 overflow-hidden rounded-md border border-edge">
          {rows.map((row) => {
            const onlyOneSide = (row.hot.length === 0) !== (row.cold.length === 0);
            return (
              <div
                key={row.category}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-panel/40 px-3 py-2"
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: row.color }}
                  aria-hidden
                />
                <span className="display text-xs font-bold uppercase tracking-wider text-ink">
                  {row.label}
                </span>
                <span className="num ml-auto text-[11px] text-mute">
                  🔥 {row.hot.length} · 🧊 {row.cold.length}
                </span>
                {onlyOneSide && (
                  <span className="rounded-full border border-gold/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gold">
                    {row.hot.length === 0 ? "only on slump day" : "only on best day"}
                  </span>
                )}
                <span className="w-full text-[11px] text-faint">{row.blurb}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
