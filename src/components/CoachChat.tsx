"use client";

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/** Coach is told to write plain text, but render **bold** properly if it slips. */
function renderContent(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-gold">
        {part}
      </strong>
    ) : (
      part
    )
  );
}

const MANAGER_SUGGESTIONS = [
  "Pull up Marcus Webb's book — policies, chargebacks, and last two weeks day by day.",
  "Which of Priya Raman's cohorts are still baking?",
  "Why is Rosa ranked #1 when her True HP is lower than everyone else's?",
  "What's the difference between OVR and EFF?",
];

const AGENT_SUGGESTIONS = [
  "Break down my last two weeks day by day — where did I leak?",
  "Which of my policies charged back this year, and is there a pattern?",
  "What am I on track to get paid this month?",
  "Which lead source is working best for me lately?",
];

export default function CoachChat({
  configured,
  role = "manager",
}: {
  configured: boolean;
  role?: "manager" | "agent";
}) {
  const suggestions = role === "agent" ? AGENT_SUGGESTIONS : MANAGER_SUGGESTIONS;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok || !data.reply) {
        setError(data.error ?? "Something went wrong — try again.");
        setMessages(messages); // roll back the optimistic user message
        setInput(q);
      } else {
        setMessages([...next, { role: "assistant", content: data.reply }]);
      }
    } catch {
      setError("Couldn't reach Coach — check your connection and try again.");
      setMessages(messages);
      setInput(q);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
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
              {m.role === "assistant" ? renderContent(m.content) : m.content}
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
