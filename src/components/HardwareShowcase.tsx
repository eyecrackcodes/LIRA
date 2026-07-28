"use client";

import { BRAND_FULL } from "@/lib/brand";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import AgentAvatar from "./AgentAvatar";
import { tierColor } from "@/lib/ratings";
import { Sparkline } from "./ui";
import { BADGE_META, type BadgeKey } from "@/lib/badges";

/**
 * "This Week's Hardware" with a playable trailer: each scene opens on the
 * agent's headshot, then bleeds into their metrics. The top three
 * achievements get medal treatment and play #3 → #2 → #1, ending on a podium.
 */

export interface TrailerAttr {
  key: string;
  rating: number | null;
  rawText: string;
}

export interface TrailerScene {
  badge: BadgeKey;
  agent: string;
  detail: string;
  weekLabel: string;
  rank: number | null; // 1–3 for medalists, null for the rest
  ovr: number | null;
  stats: { label: string; value: string }[];
  attrs: TrailerAttr[];
  formSales: number[];
  cardHref: string;
}

const MEDAL: Record<number, { label: string; color: string }> = {
  1: { label: "GOLD", color: "var(--medal-gold)" },
  2: { label: "SILVER", color: "var(--medal-silver)" },
  3: { label: "BRONZE", color: "var(--medal-bronze)" },
};

const INTRO_MS = 1900;
const SCENE_MS = 6800;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function useCountUp(target: number | null, run: boolean, ms = 900): number | null {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run || target == null) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target, ms]);
  return target == null ? null : v;
}

function RankStamp({ rank, badge }: { rank: number | null; badge: BadgeKey }) {
  const medal = rank != null ? MEDAL[rank] : null;
  return (
    <div className="tr-slam flex items-center gap-3">
      {medal ? (
        <>
          <span
            className="display text-6xl font-bold leading-none"
            style={{ color: medal.color }}
          >
            #{rank}
          </span>
          <span
            className="display border px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.3em]"
            style={{ color: medal.color, borderColor: medal.color }}
          >
            {medal.label}
          </span>
        </>
      ) : (
        <span className="display text-3xl text-gold">{BADGE_META[badge].icon}</span>
      )}
    </div>
  );
}

function Scene({
  scene,
  phase,
  reduced,
}: {
  scene: TrailerScene;
  phase: "intro" | "stats";
  reduced: boolean;
}) {
  const showStats = phase === "stats" || reduced;
  const ovr = useCountUp(scene.ovr, showStats && !reduced);
  const ovrShown = reduced ? scene.ovr : ovr;
  const meta = BADGE_META[scene.badge];
  const accent = scene.rank != null ? MEDAL[scene.rank].color : "var(--color-gold)";

  return (
    <div className="flex h-full flex-col justify-center px-6 py-10 sm:px-12">
      <RankStamp rank={scene.rank} badge={scene.badge} />

      <div
        className={`mt-6 flex flex-col gap-8 sm:flex-row sm:items-center ${
          showStats ? "" : "sm:justify-center"
        }`}
      >
        {/* Headshot — full-frame in the intro, slides aside as stats bleed in */}
        <div
          className="flex shrink-0 flex-col items-center gap-4 transition-all duration-700 ease-out"
          style={{ transform: showStats && !reduced ? "scale(0.72)" : "scale(1)" }}
        >
          <div className="tr-headshot tr-ring rounded-full">
            <AgentAvatar agent={scene.agent} size={190} />
          </div>
          <div className="text-center">
            <div className="display text-4xl font-bold uppercase tracking-widest text-ink">
              {scene.agent}
            </div>
            <div
              className="display mt-1 text-sm font-semibold uppercase tracking-[0.25em]"
              style={{ color: accent }}
            >
              {meta.icon} {meta.name}
            </div>
            <div className="num mt-1 text-xs text-mute">
              {scene.detail} · wk {scene.weekLabel}
            </div>
          </div>
        </div>

        {/* Metrics — cascade in during the stats phase */}
        {showStats && (
          <div className="min-w-0 flex-1">
            <div className="tr-rise flex items-baseline gap-3" style={{ animationDelay: "80ms" }}>
              <span className="num display text-7xl font-bold leading-none text-gold">
                {ovrShown ?? "—"}
              </span>
              <span className="display text-xs uppercase tracking-widest text-faint">
                Overall
              </span>
              <span className="ml-auto">
                <Sparkline values={scene.formSales} width={130} height={30} />
              </span>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3">
              {scene.stats.map((s, i) => (
                <div
                  key={s.label}
                  className="tr-rise"
                  style={{ animationDelay: `${220 + i * 140}ms` }}
                >
                  <div className="display text-[11px] uppercase tracking-widest text-faint">
                    {s.label}
                  </div>
                  <div className="num display text-2xl font-bold text-ink">{s.value}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-2">
              {scene.attrs.map((a, i) => (
                <div
                  key={a.key}
                  className="tr-rise flex items-center gap-2"
                  style={{ animationDelay: `${700 + i * 110}ms` }}
                >
                  <span className="display w-9 text-xs font-bold uppercase tracking-wider text-mute">
                    {a.key}
                  </span>
                  <span
                    className="num display w-8 text-sm font-bold"
                    style={{ color: a.rating != null ? tierColor(a.rating) : "var(--color-faint)" }}
                  >
                    {a.rating ?? "—"}
                  </span>
                  <div className="h-1 flex-1 rounded-full bg-navy">
                    {a.rating != null && (
                      <div
                        className="attr-fill h-full rounded-full"
                        style={{
                          width: `${a.rating}%`,
                          backgroundColor: tierColor(a.rating),
                          animationDelay: `${750 + i * 110}ms`,
                        }}
                      />
                    )}
                  </div>
                  <span className="num w-24 text-right text-[11px] text-faint">{a.rawText}</span>
                </div>
              ))}
            </div>

            <Link
              href={scene.cardHref}
              className="tr-rise mt-6 inline-block text-xs uppercase tracking-wider text-mute hover:text-gold"
              style={{ animationDelay: "1300ms" }}
              onClick={(e) => e.stopPropagation()}
            >
              Full player card →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Podium({ scenes }: { scenes: TrailerScene[] }) {
  const byRank = (r: number) => scenes.find((s) => s.rank === r);
  const order = [byRank(2), byRank(1), byRank(3)].filter(Boolean) as TrailerScene[];
  const heights: Record<number, number> = { 1: 120, 2: 84, 3: 60 };
  const sizes: Record<number, number> = { 1: 120, 2: 92, 3: 84 };

  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10">
      <div className="tr-slam display text-2xl font-bold uppercase tracking-[0.35em] text-gold">
        This Week&apos;s Podium
      </div>
      <div className="mt-10 flex items-end gap-4 sm:gap-8">
        {order.map((s, i) => {
          const medal = MEDAL[s.rank!];
          return (
            <div
              key={s.rank}
              className="tr-podium-up flex flex-col items-center"
              style={{ animationDelay: `${300 + i * 220}ms` }}
            >
              <AgentAvatar agent={s.agent} size={sizes[s.rank!]} />
              <div className="display mt-2 text-center text-sm font-bold uppercase tracking-wider text-ink">
                {s.agent}
              </div>
              <div className="text-center text-[11px]" style={{ color: medal.color }}>
                {BADGE_META[s.badge].icon} {BADGE_META[s.badge].name}
              </div>
              <div
                className="mt-3 flex w-24 items-start justify-center rounded-t-sm border border-b-0 sm:w-32"
                style={{
                  height: heights[s.rank!],
                  borderColor: medal.color,
                  backgroundColor: `color-mix(in srgb, ${medal.color} 12%, transparent)`,
                }}
              >
                <span
                  className="display mt-2 text-3xl font-bold"
                  style={{ color: medal.color }}
                >
                  {s.rank}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-8 text-xs uppercase tracking-wider text-faint">
        click to replay · esc to close
      </div>
    </div>
  );
}

export default function HardwareShowcase({
  scenes,
  weekLabel,
}: {
  scenes: TrailerScene[];
  weekLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<"intro" | "stats" | "podium">("intro");
  useEffect(() => setMounted(true), []);
  const reduced = useReducedMotion();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const hasPodium = scenes.some((s) => s.rank != null);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const startScene = useCallback(
    (i: number) => {
      clearTimers();
      setIdx(i);
      setPhase("intro");
      if (reduced) return; // no auto-advance without motion
      timers.current.push(setTimeout(() => setPhase("stats"), INTRO_MS));
      timers.current.push(
        setTimeout(() => {
          if (i + 1 < scenes.length) startScene(i + 1);
          else if (hasPodium) setPhase("podium");
        }, SCENE_MS)
      );
    },
    [reduced, scenes.length, hasPodium]
  );

  const play = (startAt = 0) => {
    setOpen(true);
    startScene(startAt);
  };

  const close = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, []);

  const advance = () => {
    if (phase === "intro" && !reduced) {
      clearTimers();
      setPhase("stats");
      timers.current.push(
        setTimeout(() => {
          if (idx + 1 < scenes.length) startScene(idx + 1);
          else if (hasPodium) setPhase("podium");
        }, SCENE_MS - INTRO_MS)
      );
    } else if (idx + 1 < scenes.length) {
      startScene(idx + 1);
    } else if (phase !== "podium" && hasPodium) {
      clearTimers();
      setPhase("podium");
    } else {
      startScene(0);
    }
  };

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight" || e.key === " ") advance();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idx, phase]);

  useEffect(() => clearTimers, []);

  const scene = scenes[idx];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => play(0)}
          className="display flex items-center gap-2 rounded-sm border border-gold bg-gold/10 px-3 py-1.5 text-sm font-semibold uppercase tracking-wider text-gold transition-colors hover:bg-gold/20"
        >
          <span aria-hidden>▶</span> Play weekly trailer
        </button>
        {scenes.map((s, i) => (
          <button
            key={i}
            onClick={() => play(i)}
            className="badge-unlock flex items-center gap-2 rounded-sm border border-gold-dim/50 bg-navy px-3 py-1.5 text-sm transition-colors hover:border-gold"
            style={{ "--d": `${i * 130}ms` } as React.CSSProperties}
            title={`${BADGE_META[s.badge].blurb} — click to play`}
          >
            {s.rank != null && (
              <span
                className="display text-xs font-bold"
                style={{ color: MEDAL[s.rank].color }}
              >
                #{s.rank}
              </span>
            )}
            <span className="badge-icon text-gold">{BADGE_META[s.badge].icon}</span>
            <span className="display font-semibold uppercase tracking-wider text-gold">
              {BADGE_META[s.badge].name}
            </span>
            <span className="text-ink">{s.agent}</span>
            <span className="num text-xs text-mute">{s.detail}</span>
          </button>
        ))}
      </div>

      {open && scene && mounted &&
        createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Weekly trailer, week of ${weekLabel}`}
          // Cinematic mode is always dark, independent of the app-wide light/
          // dark toggle — forcing data-theme here keeps every text-ink /
          // text-mute / text-gold descendant legible against the near-black
          // backdrop. The color-blind palette still applies (inherited).
          data-theme="dark"
          className="tr-fade fixed inset-0 z-50 overflow-y-auto bg-[#04060b]/95 backdrop-blur-sm"
          onClick={advance}
        >
          <div className="absolute left-4 top-4 flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-faint sm:left-8 sm:top-6">
            <span className="display text-gold">{BRAND_FULL}</span> week of {weekLabel}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              close();
            }}
            aria-label="Close trailer"
            className="absolute right-4 top-4 z-10 rounded-sm border border-edge px-2.5 py-1 text-sm text-mute hover:border-gold hover:text-gold sm:right-8 sm:top-6"
          >
            ✕
          </button>

          <div className="mx-auto h-full max-w-4xl" key={`${idx}-${phase === "podium"}`}>
            {phase === "podium" ? (
              <Podium scenes={scenes} />
            ) : (
              <Scene scene={scene} phase={phase === "stats" ? "stats" : "intro"} reduced={reduced} />
            )}
          </div>

          <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2">
            {scenes.map((_, i) => (
              <span
                key={i}
                className="h-1.5 w-6 rounded-full transition-colors"
                style={{
                  backgroundColor:
                    phase !== "podium" && i === idx ? "var(--color-gold)" : "var(--color-edge2)",
                }}
              />
            ))}
            {hasPodium && (
              <span
                className="h-1.5 w-6 rounded-full transition-colors"
                style={{
                  backgroundColor:
                    phase === "podium" ? "var(--color-gold)" : "var(--color-edge2)",
                }}
              />
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
