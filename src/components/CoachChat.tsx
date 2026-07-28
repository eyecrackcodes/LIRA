"use client";

import { useEffect, useRef, useState } from "react";
import {
  AGENT_SUGGESTIONS,
  MANAGER_SUGGESTIONS,
  renderCoachText,
  useCoachChat,
} from "./useCoachChat";

export default function CoachChat({
  configured,
  role = "manager",
}: {
  configured: boolean;
  role?: "manager" | "agent";
}) {
  const suggestions = role === "agent" ? AGENT_SUGGESTIONS : MANAGER_SUGGESTIONS;
  const { messages, busy, error, send: post } = useCoachChat();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q) return;
    setInput("");
    const ok = await post(q);
    if (!ok) setInput(q); // put it back so nothing typed is lost
    inputRef.current?.focus();
  }

  if (!configured) {
    return (
      <div className="rounded-md border border-warn/40 bg-warn/5 p-4 text-sm text-warn">
        Coach isn&apos;t wired to a model yet. Add <code className="num">ANTHROPIC_API_KEY</code>{" "}
        or <code className="num">OPENAI_API_KEY</code> to <code className="num">.env.local</code>{" "}
        and restart — the page and endpoint are ready to go.
      </div>
    );
  }

  return (
    <div className="flex h-[70vh] min-h-[420px] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-mute">
              {role === "agent"
                ? "Ask about anything on the board — or your own book: policies, chargebacks, pay periods, lead mix. Try one of these:"
                : "Ask about anything on the board — ratings, rankings, True HP, place rate, badges. Try one of these:"}
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-sm border border-edge bg-navy px-3 py-1.5 text-left text-xs text-mute transition-colors hover:border-gold-dim hover:text-gold"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-md border px-3 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "border-gold-dim/60 bg-navy text-ink"
                  : "border-edge bg-panel text-ink"
              }`}
            >
              {m.role === "assistant" && (
                <div className="display mb-1 text-[10px] font-bold uppercase tracking-widest text-gold">
                  Coach
                </div>
              )}
              {m.role === "assistant" ? renderCoachText(m.content) : m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-md border border-edge bg-panel px-3 py-2 text-sm text-mute">
              <span className="display text-[10px] font-bold uppercase tracking-widest text-gold">
                Coach
              </span>{" "}
              is checking the tape…
            </div>
          </div>
        )}
        {error && <div className="text-sm text-down">{error}</div>}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex items-end gap-2 border-t border-edge pt-3"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          placeholder="Ask Coach… (Enter to send, Shift+Enter for a new line)"
          className="min-h-[44px] flex-1 resize-y rounded-sm border border-edge bg-navy px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold-dim focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="display rounded-sm border border-gold-dim bg-navy px-4 py-2 text-sm font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold-dim/20 disabled:cursor-not-allowed disabled:border-edge disabled:text-faint"
        >
          Send
        </button>
      </form>
    </div>
  );
}
