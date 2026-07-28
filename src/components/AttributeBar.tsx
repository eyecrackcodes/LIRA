import { ATTR_META, tierColor, type Attribute } from "@/lib/ratings";
import { TrendArrow } from "./ui";

/** One Madden attribute row: `CLS 87 · 24.2% (n=212) ▲` + eased bar fill. */
export default function AttributeBar({ attr }: { attr: Attribute }) {
  const meta = ATTR_META[attr.key];
  const r = attr.rating;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <div className="flex items-baseline gap-2">
          <span className="display w-10 font-bold uppercase tracking-wider text-mute">
            {attr.key}
          </span>
          <span className="num display text-lg font-bold" style={{ color: r != null ? tierColor(r) : "var(--color-faint)" }}>
            {r ?? "—"}
          </span>
          <span className="num text-xs text-mute">
            {attr.raw != null ? meta.describe(attr.raw) : "no data"}
          </span>
          {attr.sample > 0 && (
            <span className="num text-[11px] text-faint">n={attr.sample}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="hidden text-faint sm:inline">{meta.name}</span>
          <TrendArrow trend={attr.trend} />
        </div>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-navy">
        {r != null && (
          <div
            className="attr-fill h-full rounded-full"
            style={{ width: `${r}%`, backgroundColor: tierColor(r) }}
          />
        )}
      </div>
    </div>
  );
}
