"use client";

import { useRouter } from "next/navigation";

export interface SessionOption {
  uuid: string;
  label: string;
}

export default function SessionPicker({
  slug,
  hotOptions,
  coldOptions,
  hotValue,
  coldValue,
}: {
  slug: string;
  hotOptions: SessionOption[];
  coldOptions: SessionOption[];
  hotValue: string;
  coldValue: string;
}) {
  const router = useRouter();

  function navigate(nextHot: string, nextCold: string) {
    router.push(`/film/${slug}/session?hot=${nextHot}&cold=${nextCold}`);
  }

  return (
    <div className="flex flex-wrap gap-4">
      <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-faint">
        🔥 Best-day call
        <select
          value={hotValue}
          onChange={(e) => navigate(e.target.value, coldValue)}
          className="display rounded-sm border border-edge bg-navy px-3 py-1.5 text-sm text-ink outline-none focus:border-gold-dim"
        >
          {hotOptions.map((o) => (
            <option key={o.uuid} value={o.uuid}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-faint">
        🧊 Slump-day call
        <select
          value={coldValue}
          onChange={(e) => navigate(hotValue, e.target.value)}
          className="display rounded-sm border border-edge bg-navy px-3 py-1.5 text-sm text-ink outline-none focus:border-gold-dim"
        >
          {coldOptions.map((o) => (
            <option key={o.uuid} value={o.uuid}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
