import { NextRequest } from "next/server";
import { askCoach, coachConfigured, type ChatMessage } from "@/lib/coach";
import { getViewer } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Chat endpoint for Coach. Viewer-aware: managers get the board context,
 * agents additionally get their OWN book (policies, pay periods, cohorts,
 * lead mix) — scoped by identity and RLS-enforced in lib/coach. Never
 * client PII, never another agent's pay.
 */
export async function POST(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) {
    return Response.json({ error: "Sign in to talk to Coach." }, { status: 401 });
  }
  if (viewer.role === "none") {
    return Response.json(
      { error: "Your email isn't on the roster or management list yet." },
      { status: 403 }
    );
  }

  if (!coachConfigured()) {
    return Response.json(
      { error: "Coach isn't configured yet — add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env.local." },
      { status: 503 }
    );
  }

  let messages: ChatMessage[];
  try {
    const body = (await req.json()) as { messages?: ChatMessage[] };
    messages = (body.messages ?? []).filter(
      (m): m is ChatMessage =>
        (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
    );
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "Send at least one user message." }, { status: 400 });
  }

  try {
    const reply = await askCoach(messages, viewer);
    return Response.json({ reply });
  } catch (e) {
    console.error("coach:", e);
    return Response.json(
      { error: "Coach hit a snag talking to the model — try again in a moment." },
      { status: 502 }
    );
  }
}
