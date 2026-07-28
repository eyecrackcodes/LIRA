"use client";

import { useCallback, useState } from "react";

export interface CoachMsg {
  role: "user" | "assistant";
  content: string;
}

/**
 * The Coach conversation, shared by the full-page chat and the floating dock so
 * the two can't drift apart on the API contract or the failure handling.
 *
 * `send` resolves to false when the turn failed AND the optimistic user message
 * has been rolled back — the caller should put the text back in its input so
 * nothing the user typed is lost.
 */
export function useCoachChat() {
  const [messages, setMessages] = useState<CoachMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const q = text.trim();
      if (!q || busy) return false;

      // Snapshot for rollback, and capture the exact array we post.
      let prev: CoachMsg[] = [];
      let next: CoachMsg[] = [];
      setMessages((cur) => {
        prev = cur;
        next = [...cur, { role: "user", content: q }];
        return next;
      });
      setError(null);
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
          setMessages(prev);
          return false;
        }
        setMessages([...next, { role: "assistant", content: data.reply }]);
        return true;
      } catch {
        setError("Couldn't reach Coach — check your connection and try again.");
        setMessages(prev);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy]
  );

  const reset = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, busy, error, send, reset };
}

/** Coach is told to write plain text, but render **bold** properly if it slips. */
export function renderCoachText(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold text-gold">
        {part}
      </strong>
    ) : (
      part
    )
  );
}

export const MANAGER_SUGGESTIONS = [
  "Pull up Marcus Webb's book — policies, chargebacks, and last two weeks day by day.",
  "Which of Priya Raman's cohorts are still baking?",
  "Why is Rosa ranked #1 when her True HP is lower than everyone else's?",
  "What's the difference between OVR and EFF?",
];

export const AGENT_SUGGESTIONS = [
  "Break down my last two weeks day by day — where did I leak?",
  "Which of my policies charged back this year, and is there a pattern?",
  "What am I on track to get paid this month?",
  "Which lead source is working best for me lately?",
];

/** Short prompts for the floating dock, where space is tight. */
export const DOCK_SUGGESTIONS: Record<"manager" | "agent", string[]> = {
  manager: [
    "What changed this week?",
    "Who needs coaching most, and why?",
    "Explain OVR vs EFF.",
  ],
  agent: [
    "How am I doing this week?",
    "Where am I leaking?",
    "What's my place rate telling me?",
  ],
};
