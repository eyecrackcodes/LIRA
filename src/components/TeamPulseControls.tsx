"use client";

import { useRouter } from "next/navigation";

/**
 * Window picker for Team Pulse. Pushes ?weeks=N so the view is shareable and
 * survives a refresh — the server does the rollup, this only navigates.
 */
export default function TeamPulseControls({
  weeksN,
  options,
}: {
  weeksN: number;
  options: readonly { weeks: number; label: string }[];
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-faint">
      Team window
      <select
        value={weeksN}
        onChange={(e) => router.push(`/?weeks=${e.target.value}`)}
        className="display rounded-sm border border-edge bg-navy px-3 py-1.5 text-sm text-ink outline-none focus:border-gold-dim"
      >
        {options.map((o) => (
          <option key={o.weeks} value={o.weeks}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
