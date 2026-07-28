import { hoursSince } from "@/lib/format";
import type { Freshness } from "@/lib/queries";

export const STALE_HOURS = 36;

export function FreshnessStamp({ freshness }: { freshness: Freshness }) {
  const at = freshness.maxSyncedAt;
  const hrs = hoursSince(at);
  const stale = hrs != null && hrs > STALE_HOURS;
  const label = at
    ? new Date(at).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "unknown";
  return (
    <div
      className={`num flex items-center gap-2 text-xs ${stale ? "text-warn" : "text-mute"}`}
      title="max(synced_at) across warehouse mirrors — pipeline syncs nightly ~11 PM"
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${stale ? "bg-warn" : "bg-up"}`}
      />
      Synced {label}
      {hrs != null && <span className="text-faint">({hrs.toFixed(0)}h ago)</span>}
    </div>
  );
}

export function StaleBanner({ freshness }: { freshness: Freshness }) {
  const hrs = hoursSince(freshness.maxSyncedAt);
  if (hrs == null || hrs <= STALE_HOURS) return null;
  return (
    <div className="border-b border-warn/40 bg-warn/10 px-4 py-2 text-sm text-warn">
      Warehouse data is {hrs.toFixed(0)} hours old (nightly sync may have missed — is the
      pipeline machine awake?). Numbers below may be stale.
    </div>
  );
}
