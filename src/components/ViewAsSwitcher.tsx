"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startViewAs } from "@/app/(app)/view-as/actions";

/**
 * Sidebar control for managers: pick an agent and the whole app re-renders as
 * that agent sees it (server-enforced — see getViewer in lib/auth.ts). The
 * layout only renders this for the manager view, so it disappears while a
 * preview is active; the ViewAsBanner carries the exit.
 */
export default function ViewAsSwitcher({
  agents,
}: {
  agents: { name: string; slug: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (agents.length === 0) return null;

  return (
    <div className="mt-4 border-t border-edge pt-4">
      <label
        htmlFor="view-as-agent"
        className="display block text-[10px] font-bold uppercase tracking-widest text-faint"
      >
        View as agent
      </label>
      <select
        id="view-as-agent"
        data-view-as
        defaultValue=""
        disabled={pending}
        onChange={(e) => {
          const slug = e.target.value;
          if (!slug) return;
          setError(null);
          start(async () => {
            const res = await startViewAs(slug);
            if (!res.ok) {
              setError(res.error ?? "Couldn't switch view.");
              e.target.value = "";
            } else {
              router.refresh();
            }
          });
        }}
        className="mt-1.5 w-full rounded-sm border border-edge bg-navy px-2 py-1.5 text-xs text-mute focus:border-gold-dim focus:outline-none disabled:opacity-60"
      >
        <option value="">{pending ? "Switching…" : "Pick an agent…"}</option>
        {agents.map((a) => (
          <option key={a.slug} value={a.slug}>
            {a.name}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-[11px] text-down">{error}</p>}
      <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
        See the app exactly as they do — own commission, own film, agent nav.
      </p>
    </div>
  );
}
