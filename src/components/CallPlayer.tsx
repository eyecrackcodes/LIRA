"use client";

import { useState } from "react";

/**
 * Play button for a captured call. The playback URL is a short-lived
 * presigned MP4 link, so it's fetched on demand from /api/film/media/[uuid] —
 * which also enforces manager-any / agent-own-calls-only access. If a long
 * listen outlives the link and seeking dies, re-opening the page gets a
 * fresh one.
 */
export default function CallPlayer({ uuid, compact = false }: { uuid: string; compact?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/film/media/${uuid}`);
      const data = (await res.json()) as { src?: string; error?: string };
      if (!res.ok || !data.src) throw new Error(data.error ?? "Playback failed.");
      setSrc(data.src);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Playback failed.");
    } finally {
      setLoading(false);
    }
  }

  if (src) {
    return (
      <audio
        src={src}
        controls
        autoPlay
        preload="metadata"
        className={`w-full ${compact ? "h-9" : "h-11"}`}
      >
        Your browser can&apos;t play this recording.
      </audio>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="display inline-flex items-center gap-2 rounded-sm border border-gold-dim bg-navy px-3 py-1.5 text-xs uppercase tracking-wider text-gold transition-colors hover:bg-gold/10 disabled:opacity-60"
      >
        <span aria-hidden>▶</span>
        {loading ? "Loading…" : "Listen to this call"}
      </button>
      {error && <span className="text-xs text-down">{error}</span>}
    </div>
  );
}
