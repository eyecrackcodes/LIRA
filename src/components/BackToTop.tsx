"use client";

import { useEffect, useState } from "react";

/**
 * Floating "back to top" button for long reads (a full call transcript can run
 * hundreds of turns). Appears once the reader has scrolled past ~1.5 viewports
 * and returns them to the jump-bar at the top. Client-only — it listens to
 * scroll — but degrades gracefully (nothing renders until it mounts).
 */
export default function BackToTop({ threshold = 900 }: { threshold?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-1.5 rounded-full border border-gold/60 bg-navy/90 px-3.5 py-2 text-xs font-bold uppercase tracking-wider text-gold shadow-lg backdrop-blur transition hover:bg-navy hover:shadow-gold/20"
    >
      <span aria-hidden className="text-sm leading-none">↑</span>
      Top
    </button>
  );
}
