import Link from "next/link";
import type { ColdStreak, ColdPattern } from "@/lib/coldstreak";
import { agentSlug } from "@/lib/format";
import { Panel, SectionTitle } from "@/components/ui";

/**
 * Roster-wide cold-streak alert (FILM-ROOM-PROMPT.md §4). Manager-only — the
 * parent gates this. Rushed vs over-talked render distinctly on purpose: they
 * are opposite coaching conversations. Each row deep-links into Session View
 * (best day vs slump day) — that's where the coaching happens; the library is
 * one click back from there if needed.
 */

const PATTERN: Record<
  ColdPattern,
  { icon: string; label: string; color: string; blurb: string }
> = {
  rushed: {
    icon: "⏩",
    label: "rushed",
    color: "var(--color-warn)",
    blurb: "Calls ran shorter than their own median — likely rushing past discovery/objections.",
  },
  "over-talked": {
    icon: "⏱",
    label: "over-talked",
    color: "var(--color-blue)",
    blurb: "Calls ran longer than their median but still didn't convert — long calls that don't close.",
  },
};

function pctLabel(p: number | null): string | null {
  if (p == null) return null;
  return `${Math.round(p * 100)}th pct`;
}

export default function ColdStreakAlert({ streaks }: { streaks: ColdStreak[] }) {
  return (
    <Panel>
      <SectionTitle sub="latest worked day is a 2+ day cold streak · duration-based · manager-only">
        Cold-Streak Watch
      </SectionTitle>

      {streaks.length === 0 ? (
        <p className="text-sm text-mute">
          All clear — no agents in a cold streak right now.
        </p>
      ) : (
        <ul className="space-y-2">
          {streaks.map((s) => {
            const p = PATTERN[s.pattern];
            const pct = pctLabel(s.durationPercentile);
            return (
              <li
                key={s.agent}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
              >
                <span aria-hidden className="text-base">
                  🧊
                </span>
                <Link
                  href={`/film/${agentSlug(s.agent)}/session`}
                  className="font-semibold text-ink hover:text-gold"
                >
                  {s.agent}
                </Link>
                <span className="num text-mute">
                  {s.days} day{s.days === 1 ? "" : "s"} cold
                </span>
                <span
                  className="display rounded-sm border px-1.5 py-0.5 text-[11px] uppercase tracking-wider"
                  style={{ color: p.color, borderColor: p.color }}
                  title={p.blurb}
                >
                  {p.icon} {p.label}
                </span>
                {pct && <span className="text-xs text-faint">{pct}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        A cold day = zero conversions with an off-median call-length profile; only two-plus in a
        row count here (one bad day is noise). &ldquo;Rushed&rdquo; means calls ran short (skipping
        discovery); &ldquo;over-talked&rdquo; means long calls that still don&apos;t close — opposite
        fixes. Click a name to open their session tape: best day next to slump day.
      </p>
    </Panel>
  );
}
