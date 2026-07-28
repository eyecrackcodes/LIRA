"use client";

import { useEffect, useRef, useState } from "react";
import { agentInitials, agentSlug } from "@/lib/format";

/**
 * Circular headshot from /agents/<slug>.png with an initials fallback —
 * new hires have no photo yet; never break on a missing slug.
 * The naturalWidth check covers 404s that happen before React hydrates
 * (onError alone misses those).
 */
const EXTENSIONS = ["png", "jpg"];

export default function AgentAvatar({
  agent,
  size = 48,
}: {
  agent: string;
  size?: number;
}) {
  const [extIdx, setExtIdx] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const slug = agentSlug(agent);
  const failed = extIdx >= EXTENSIONS.length;

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth === 0) setExtIdx((i) => i + 1);
  }, [extIdx]);

  if (failed) {
    return (
      <div
        className="display flex items-center justify-center rounded-full border border-edge2 bg-navy font-bold text-gold"
        style={{ width: size, height: size, fontSize: size * 0.34 }}
        aria-label={agent}
      >
        {agentInitials(agent)}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={`/agents/${slug}.${EXTENSIONS[extIdx]}`}
      alt=""
      aria-label={agent}
      width={size}
      height={size}
      className="rounded-full border border-edge2 bg-navy object-cover"
      style={{ width: size, height: size }}
      onError={() => setExtIdx((i) => i + 1)}
    />
  );
}
