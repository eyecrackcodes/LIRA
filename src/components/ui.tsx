import type { ReactNode } from "react";

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`card-in rounded-md border border-edge bg-panel p-4 ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  children,
  sub,
}: {
  children: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="display text-sm font-bold uppercase tracking-widest text-gold">
        {children}
      </h2>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

export function Delta({
  value,
  format,
  invert = false,
}: {
  value: number | null | undefined;
  format: (v: number) => string;
  invert?: boolean;
}) {
  if (value == null) return <span className="text-faint">—</span>;
  const good = invert ? value < 0 : value > 0;
  const cls = value === 0 ? "text-mute" : good ? "text-up" : "text-down";
  const arrow = value === 0 ? "→" : value > 0 ? "▲" : "▼";
  return (
    <span className={`num ${cls}`}>
      {arrow} {format(Math.abs(value))}
    </span>
  );
}

export function StatTile({
  label,
  value,
  delta,
  sample,
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  sample?: ReactNode;
}) {
  return (
    <div className="card-in rounded-md border border-edge bg-panel p-4">
      <div className="display text-xs font-semibold uppercase tracking-widest text-mute">
        {label}
      </div>
      <div className="num display mt-1 text-3xl font-bold text-ink">{value}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-xs">
        <span>{delta}</span>
        {sample && <span className="text-faint">{sample}</span>}
      </div>
    </div>
  );
}

/**
 * Column-header tooltip — hover (or keyboard-focus) the dotted label to see
 * the definition. Pure CSS, so it works in server components. Tooltips open
 * downward because the tables live in overflow-x-auto containers that would
 * clip anything above the header row.
 */
export function HeaderTip({
  label,
  tip,
  align = "left",
}: {
  label: ReactNode;
  tip: string;
  align?: "left" | "right";
}) {
  return (
    <span
      tabIndex={0}
      className="group relative inline-block cursor-help underline decoration-faint/60 decoration-dotted underline-offset-4 outline-none focus-visible:decoration-gold"
    >
      {label}
      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute top-full z-30 mt-1.5 w-56 rounded-sm border border-edge bg-navy p-2 text-left text-[11px] font-normal normal-case leading-relaxed tracking-normal text-ink opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        {tip}
      </span>
    </span>
  );
}

export function TrendArrow({ trend }: { trend: -1 | 0 | 1 }) {
  if (trend === 0) return <span className="text-faint">→</span>;
  return trend === 1 ? (
    <span className="text-up">▲</span>
  ) : (
    <span className="text-down">▼</span>
  );
}

/** Tiny inline SVG sparkline — server-renderable, no chart lib needed. */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = "var(--color-gold)",
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (values.length < 2)
    return <span className="text-xs text-faint">not enough weeks</span>;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 4) + 2;
      const y = height - 3 - ((v - min) / span) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.5" />
      {values.map((v, i) => {
        if (i !== values.length - 1) return null;
        const x = (i / (values.length - 1)) * (width - 4) + 2;
        const y = height - 3 - ((v - min) / span) * (height - 6);
        return <circle key={i} cx={x} cy={y} r="2.2" fill={stroke} />;
      })}
    </svg>
  );
}
