import { NextRequest } from "next/server";
import { getViewer, canViewAgentFilm } from "@/lib/auth";
import { getFilmCallOwner } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Exchanges a conversation UUID for a playback URL via Attention's
 * "Generate Conversation Media Download URL" endpoint — a presigned,
 * short-lived MP4 URL (their playback CDN) that a plain <audio> element can
 * stream. Fetched fresh per listen; the ATTENTION_API_KEY never leaves the
 * server. Access: any rostered teammate may play any call (Film Room is open to
 * the whole team); signed-in users who aren't on the roster get nothing.
 * (Do NOT use attributes.videoUID — that Cloudflare Stream token only
 * resolves inside Attention's own player, not on public embed hosts.)
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  const { uuid } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) {
    return Response.json({ error: "Bad call id." }, { status: 400 });
  }

  const viewer = await getViewer();
  if (!viewer || viewer.role === "none") {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  // Still resolved, but as an EXISTENCE check now (404 on an unknown uuid) —
  // playback is no longer scoped to the call's owner.
  const owner = await getFilmCallOwner(uuid);
  if (!owner) return Response.json({ error: "Unknown call." }, { status: 404 });
  if (!canViewAgentFilm(viewer)) {
    return Response.json({ error: "Not authorized to play recordings." }, { status: 403 });
  }

  // Demo mode has no real recordings (and must never reach a real vendor API).
  if (process.env.DEMO_MODE === "1") {
    return Response.json(
      { error: "Recording playback is disabled in demo mode." },
      { status: 503 }
    );
  }

  const key = process.env.ATTENTION_API_KEY;
  if (!key) {
    return Response.json(
      { error: "Playback isn't configured (missing ATTENTION_API_KEY)." },
      { status: 503 }
    );
  }

  const res = await fetch(
    `https://api.attention.tech/v2/conversations/${uuid}/media/download`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );
  if (res.status === 404 || res.status === 403) {
    return Response.json({ error: "No recording available for this call." }, { status: 404 });
  }
  if (!res.ok) {
    return Response.json({ error: `Recording service error (${res.status}).` }, { status: 502 });
  }
  const { url } = (await res.json()) as { url?: string };
  if (!url) {
    return Response.json({ error: "No recording available for this call." }, { status: 404 });
  }

  return Response.json({ src: url });
}
