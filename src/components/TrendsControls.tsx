"use client";

import { useRouter } from "next/navigation";
import { agentSlug } from "@/lib/format";

export default function TrendsControls({
  agents,
  currentSlug,
  weeksN,
  rangeOptions,
  locked,
}: {
  agents: { agent: string; status: string }[];
  currentSlug: string;
  weeksN: number;
  rangeOptions: readonly { weeks: number; label: string }[];
  locked: boolean;
}) {
  const router = useRouter();

  function navigate(nextSlug: string, nextWeeks: number) {
    router.push(`/trends?agent=${nextSlug}&weeks=${nextWeeks}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-faint">
        Agent
        <select
          value={currentSlug}
          disabled={locked}
          onChange={(e) => navigate(e.target.value, weeksN)}
          className="display rounded-sm border border-edge bg-navy px-3 py-1.5 text-sm text-ink outline-none focus:border-gold-dim disabled:cursor-not-allowed disabled:opacity-70"
        >
          {agents.map((a) => (
            <option key={a.agent} value={agentSlug(a.agent)}>
              {a.agent}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-faint">
        Date range
        <select
          value={weeksN}
          onChange={(e) => navigate(currentSlug, Number(e.target.value))}
          className="display rounded-sm border border-edge bg-navy px-3 py-1.5 text-sm text-ink outline-none focus:border-gold-dim"
        >
          {rangeOptions.map((r) => (
            <option key={r.weeks} value={r.weeks}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
