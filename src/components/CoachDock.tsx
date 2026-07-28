"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  DOCK_SUGGESTIONS,
  renderCoachText,
  useCoachChat,
} from "./useCoachChat";

/**
 * The floating Coach — a draggable bubble that expands into a chat panel and
 * follows the viewer across every page.
 *
 * It's mounted once in the (app) layout, which the App Router keeps mounted
 * across navigation, so the conversation survives moving between pages. The
 * position survives a full reload via localStorage.
 *
 * Drag notes:
 *  - Pointer Events (not mouse/touch) so it works with mouse, touch, and pen
 *    from one code path, and setPointerCapture keeps the drag alive even when
 *    the cursor outruns the element.
 *  - A 4px movement threshold separates "click to open" from "drag" on the
 *    collapsed bubble, so a slightly shaky click still opens the panel.
 *  - Position is clamped into the viewport on drag, on open/collapse (the panel
 *    is much bigger than the bubble), and on resize — so the dock can never end
 *    up somewhere you can't grab it again.
 */

const BUBBLE = 56; // px, collapsed hit target
const PANEL_W = 380;
const PANEL_H = 520;
const MARGIN = 16; // keep this much clear of the viewport edge
const DRAG_THRESHOLD = 4;
const POS_KEY = "coach-dock-pos";

interface Pos {
  x: number;
  y: number;
}

export default function CoachDock({
  configured,
  role = "manager",
}: {
  configured: boolean;
  role?: "manager" | "agent";
}) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [input, setInput] = useState("");

  const { messages, busy, error, send } = useCoachChat();
  const rootRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragState = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  const size = useCallback(
    () => (open ? { w: PANEL_W, h: PANEL_H } : { w: BUBBLE, h: BUBBLE }),
    [open]
  );

  const clamp = useCallback((p: Pos, w: number, h: number): Pos => {
    const maxX = Math.max(MARGIN, window.innerWidth - w - MARGIN);
    const maxY = Math.max(MARGIN, window.innerHeight - h - MARGIN);
    return {
      x: Math.min(Math.max(p.x, MARGIN), maxX),
      y: Math.min(Math.max(p.y, MARGIN), maxY),
    };
  }, []);

  // Restore position (or default to bottom-right) after hydration. Reading
  // localStorage during render would desync SSR and client markup.
  useEffect(() => {
    const fallback: Pos = {
      x: window.innerWidth - BUBBLE - 24,
      y: window.innerHeight - BUBBLE - 24,
    };
    let start = fallback;
    try {
      const raw = window.localStorage.getItem(POS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Pos>;
        if (typeof saved?.x === "number" && typeof saved?.y === "number") {
          start = { x: saved.x, y: saved.y };
        }
      }
    } catch {
      // Corrupt or blocked storage is not worth failing over — use the default.
    }
    setPos(clamp(start, BUBBLE, BUBBLE));
    setMounted(true);
  }, [clamp]);

  // Expanding makes the footprint much larger; pull it back on screen.
  useLayoutEffect(() => {
    if (!mounted) return;
    const { w, h } = size();
    setPos((p) => clamp(p, w, h));
  }, [open, mounted, size, clamp]);

  useEffect(() => {
    if (!mounted) return;
    const onResize = () => {
      const { w, h } = size();
      setPos((p) => clamp(p, w, h));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mounted, size, clamp]);

  const persist = useCallback((p: Pos) => {
    try {
      window.localStorage.setItem(POS_KEY, JSON.stringify(p));
    } catch {
      // Private mode / storage disabled — position just won't survive reload.
    }
  }, []);

  /* ── drag ──────────────────────────────────────────────────────────────── */

  function onPointerDown(e: React.PointerEvent) {
    // Never start a drag from a control inside the panel.
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragState.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    const st = dragState.current;
    if (!st) return;
    const next = { x: e.clientX - st.dx, y: e.clientY - st.dy };
    if (
      !st.moved &&
      (Math.abs(next.x - pos.x) > DRAG_THRESHOLD || Math.abs(next.y - pos.y) > DRAG_THRESHOLD)
    ) {
      st.moved = true;
    }
    const { w, h } = size();
    setPos(clamp(next, w, h));
  }

  function onPointerUp(e: React.PointerEvent) {
    const st = dragState.current;
    dragState.current = null;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Capture may already be gone; harmless.
    }
    if (!st) return;
    if (st.moved) persist(pos);
    // A press that never moved on the collapsed bubble is a click → open.
    else if (!open) setOpen(true);
  }

  /* ── chat ──────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit(text: string) {
    const q = text.trim();
    if (!q) return;
    setInput("");
    const ok = await send(q);
    if (!ok) setInput(q); // put it back so nothing typed is lost
    inputRef.current?.focus();
  }

  // The /coach page IS the chat — a second one floating over it is just noise.
  if (!mounted || pathname?.startsWith("/coach")) return null;

  const dragCursor = dragging ? "cursor-grabbing" : "cursor-grab";

  return (
    <div
      ref={rootRef}
      style={{ left: pos.x, top: pos.y, touchAction: "none" }}
      className="fixed z-50"
    >
      {!open ? (
        <button
          type="button"
          aria-label="Open Coach"
          aria-expanded={false}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          title="Ask Coach — drag to move"
          style={{ width: BUBBLE, height: BUBBLE }}
          className={`group flex items-center justify-center rounded-full border border-gold-dim bg-navy shadow-lg transition-colors motion-reduce:transition-none hover:bg-gold-dim/20 ${dragCursor}`}
        >
          <span className="display text-lg font-bold uppercase tracking-wider text-gold">
            AC
          </span>
          {busy && (
            <span
              className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full bg-gold motion-reduce:animate-none"
              aria-hidden
            />
          )}
        </button>
      ) : (
        <div
          role="dialog"
          aria-label="Coach"
          style={{ width: PANEL_W, height: PANEL_H }}
          className="flex flex-col overflow-hidden rounded-md border border-edge bg-panel shadow-2xl"
        >
          {/* Header doubles as the drag handle. */}
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className={`flex shrink-0 items-center justify-between gap-2 border-b border-edge bg-navy px-3 py-2 ${dragCursor}`}
          >
            <div className="flex items-center gap-2">
              <span className="display text-sm font-bold uppercase tracking-widest text-gold">
                Coach
              </span>
              <span className="select-none text-[10px] text-faint">drag to move</span>
            </div>
            <div className="flex items-center gap-1" data-no-drag>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Collapse Coach"
                className="rounded-sm px-2 py-1 text-xs text-mute transition-colors motion-reduce:transition-none hover:text-gold"
              >
                —
              </button>
            </div>
          </div>

          {!configured ? (
            <div className="flex-1 overflow-y-auto p-3 text-xs leading-relaxed text-warn">
              Coach isn&apos;t wired to a model yet. Add{" "}
              <code className="num">ANTHROPIC_API_KEY</code> (or{" "}
              <code className="num">OPENAI_API_KEY</code>) to{" "}
              <code className="num">.env.local</code> and restart. Running the demo? Use{" "}
              <code className="num">npm run demo:live</code>.
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-2 overflow-y-auto p-3" data-no-drag>
                {messages.length === 0 && (
                  <div className="space-y-2">
                    <p className="text-xs leading-relaxed text-mute">
                      Ask about anything on screen — ratings, rankings, place rate, pay.
                    </p>
                    {DOCK_SUGGESTIONS[role].map((s) => (
                      <button
                        key={s}
                        onClick={() => submit(s)}
                        className="block w-full rounded-sm border border-edge bg-navy px-2 py-1.5 text-left text-xs text-mute transition-colors motion-reduce:transition-none hover:border-gold-dim hover:text-gold"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
                  >
                    <div
                      className={`max-w-[88%] whitespace-pre-wrap rounded-md border px-2.5 py-1.5 text-xs leading-relaxed ${
                        m.role === "user"
                          ? "border-gold-dim/60 bg-navy text-ink"
                          : "border-edge bg-field text-ink"
                      }`}
                    >
                      {m.role === "assistant"
                        ? renderCoachText(m.content)
                        : m.content}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="text-xs text-mute">
                    <span className="display text-[10px] font-bold uppercase tracking-widest text-gold">
                      Coach
                    </span>{" "}
                    is checking the tape…
                  </div>
                )}
                {error && <div className="text-xs text-down">{error}</div>}
                <div ref={endRef} />
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(input);
                }}
                className="flex shrink-0 items-end gap-2 border-t border-edge p-2"
                data-no-drag
              >
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit(input);
                    }
                  }}
                  rows={2}
                  placeholder="Ask Coach…"
                  className="min-h-[38px] flex-1 resize-none rounded-sm border border-edge bg-navy px-2 py-1.5 text-xs text-ink placeholder:text-faint focus:border-gold-dim focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  className="display rounded-sm border border-gold-dim bg-navy px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-gold transition-colors motion-reduce:transition-none hover:bg-gold-dim/20 disabled:cursor-not-allowed disabled:border-edge disabled:text-faint"
                >
                  Send
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
