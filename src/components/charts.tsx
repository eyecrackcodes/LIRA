"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ScatterChart,
  Scatter,
  ZAxis,
  AreaChart,
  Area,
  Cell,
  ReferenceLine,
} from "recharts";

import { C } from "@/lib/theme-colors";

const tooltipStyle = {
  backgroundColor: C.panel2,
  border: `1px solid ${C.edge2}`,
  borderRadius: 4,
  fontSize: 12,
  color: C.ink,
};

const axis = { fill: C.mute, fontSize: 11 } as const;

export function TeamTrendChart({
  data,
}: {
  data: {
    week: string;
    premium: number;
    close: number | null;
    leads: number;
    provisional?: boolean;
  }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.edge} vertical={false} />
        <XAxis dataKey="week" tick={axis} tickLine={false} axisLine={{ stroke: C.edge }} />
        <YAxis
          yAxisId="premium"
          tick={axis}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${Math.round(v / 1000)}K`}
        />
        <YAxis
          yAxisId="close"
          orientation="right"
          tick={axis}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}%`}
          domain={[0, "auto"]}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name, item) => {
            const p = (item?.payload as { provisional?: boolean } | undefined)?.provisional;
            const tag = p ? " (in progress)" : "";
            return name === "Premium"
              ? [`$${Math.round(Number(value)).toLocaleString()}${tag}`, name]
              : name === "Close rate"
                ? [`${Number(value).toFixed(1)}%${tag}`, name]
                : [`${Number(value).toLocaleString()}${tag}`, name];
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: C.mute }} />
        {/* The in-progress week renders hollow/faded so a partial bar never
            reads as a real cliff next to finished weeks. */}
        <Bar yAxisId="premium" dataKey="premium" name="Premium" radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.provisional ? "transparent" : C.navy}
              stroke={d.provisional ? C.gold : undefined}
              strokeWidth={d.provisional ? 1 : 0}
              strokeDasharray={d.provisional ? "3 2" : undefined}
            />
          ))}
        </Bar>
        <Line
          yAxisId="close"
          dataKey="close"
          name="Close rate"
          stroke={C.gold}
          strokeWidth={2}
          dot={{ r: 2.5, fill: C.gold }}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * Week-to-date day-by-day bars: this week's daily premium (solid) against the
 * same weekday last week (faint). Powers the "This Week (Live)" tracker — an
 * honest intraday read where each day is compared like-for-like.
 */
export function DailyWeekChart({
  data,
}: {
  data: {
    label: string;
    thisPremium: number | null;
    priorPremium: number | null;
  }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.edge} vertical={false} />
        <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: C.edge }} />
        <YAxis
          tick={axis}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${Math.round(v / 1000)}K`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [
            value == null ? "—" : `$${Math.round(Number(value)).toLocaleString()}`,
            name,
          ]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: C.mute }} />
        <Bar dataKey="priorPremium" name="Last week" fill={C.edge2} radius={[2, 2, 0, 0]} />
        <Bar dataKey="thisPremium" name="This week" fill={C.gold} radius={[2, 2, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function LeadsSalesChart({
  data,
}: {
  data: { week: string; leads: number; sales: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.edge} vertical={false} />
        <XAxis dataKey="week" tick={axis} tickLine={false} axisLine={{ stroke: C.edge }} />
        <YAxis tick={axis} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12, color: C.mute }} />
        <Bar dataKey="leads" name="Leads" fill={C.blue} radius={[2, 2, 0, 0]} />
        <Bar dataKey="sales" name="Sales" fill={C.gold} radius={[2, 2, 0, 0]} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export interface EffortPoint {
  agent: string;
  week: string;
  leadsPerDay: number;
  close: number;
  talkPerDial: number | null;
  leads: number;
}

export function EffortScatter({ data }: { data: EffortPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
        <CartesianGrid stroke={C.edge} />
        <XAxis
          type="number"
          dataKey="leadsPerDay"
          name="Leads/day"
          tick={axis}
          tickLine={false}
          axisLine={{ stroke: C.edge }}
          label={{ value: "Leads per day", position: "insideBottom", offset: -4, fill: C.mute, fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="close"
          name="Close %"
          tick={axis}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}%`}
        />
        <ZAxis type="number" dataKey="talkPerDial" range={[30, 260]} name="Talk min/dial" />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ stroke: C.faint, strokeDasharray: "3 3" }}
          formatter={(value, name) =>
            name === "Close %"
              ? [`${Number(value).toFixed(1)}%`, name]
              : [Number(value ?? 0).toFixed(2), name]
          }
          labelFormatter={() => ""}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as EffortPoint | undefined;
            if (!p) return null;
            return (
              <div style={tooltipStyle} className="p-2">
                <div style={{ color: C.gold, fontWeight: 600 }}>{p.agent}</div>
                <div>wk {p.week}</div>
                <div>close {p.close.toFixed(1)}% · {p.leads} leads</div>
                <div>{p.leadsPerDay.toFixed(1)} leads/day · {p.talkPerDial?.toFixed(2) ?? "—"} talk min/dial</div>
              </div>
            );
          }}
        />
        <Scatter data={data} fill={C.gold} fillOpacity={0.75} stroke={C.goldHi} strokeOpacity={0.4} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export function SourceMixChart({
  data,
  groups,
  colors,
}: {
  data: Record<string, string | number>[];
  groups: string[];
  colors: Record<string, string>;
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} stackOffset="expand" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.edge} vertical={false} />
        <XAxis dataKey="week" tick={axis} tickLine={false} axisLine={{ stroke: C.edge }} />
        <YAxis
          tick={axis}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [`${Number(value).toLocaleString()} leads`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: C.mute }} />
        {groups.map((g) => (
          <Area
            key={g}
            dataKey={g}
            stackId="mix"
            name={g}
            fill={colors[g] ?? C.faint}
            stroke={colors[g] ?? C.faint}
            fillOpacity={0.85}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Underwriting-mix composition by month — a 100%-stacked area of the UW classes
 * (Level / Graded / GI / Other) so you can see the mix shift over time. Values
 * are per-class policy shares (already summing to ~100); stackOffset expand
 * re-normalizes to a clean 0–100% band.
 */
const UW_MIX_GROUPS = ["Level", "Term", "Graded", "GI", "Other"] as const;
const UW_MIX_COLORS: Record<string, string> = {
  Level: C.gold,
  Term: C.teal,
  Graded: C.blue,
  GI: C.down,
  Other: C.faint,
};

export function UwMixChart({
  data,
}: {
  data: Record<string, string | number>[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} stackOffset="expand" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.edge} vertical={false} />
        <XAxis dataKey="week" tick={axis} tickLine={false} axisLine={{ stroke: C.edge }} />
        <YAxis
          tick={axis}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: C.mute }} />
        {UW_MIX_GROUPS.map((g) => (
          <Area
            key={g}
            dataKey={g}
            stackId="uwmix"
            name={g}
            fill={UW_MIX_COLORS[g]}
            stroke={UW_MIX_COLORS[g]}
            fillOpacity={0.85}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MailerChart({
  data,
}: {
  data: { day: string; scans: number; sends: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.edge} vertical={false} />
        <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={{ stroke: C.edge }} />
        <YAxis yAxisId="scans" tick={axis} tickLine={false} axisLine={false} />
        <YAxis yAxisId="sends" orientation="right" tick={axis} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12, color: C.mute }} />
        <Bar yAxisId="sends" dataKey="sends" name="Cards sent" fill={C.navy} radius={[2, 2, 0, 0]} />
        <Line
          yAxisId="scans"
          dataKey="scans"
          name="QR scans"
          stroke={C.gold}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export interface TrendSeriesDef {
  key: string;
  name: string;
  color: string;
  dashed?: boolean;
  /** Stroke weight override — e.g. a thin context series beneath an emphasis line. */
  strokeWidth?: number;
  /** Force dots on/off. Defaults on for solid series, off for dashed. Turn them
   *  off past ~45 points, where a dot per day becomes noise rather than data. */
  dots?: boolean;
}

/** Named formats only — functions can't cross the server/client boundary. */
export type TrendFormat =
  | "money0"
  | "moneyCents"
  | "pct1"
  | "hrs1"
  | "grade"
  | "num1"
  | "ratiox";

const TREND_FORMATTERS: Record<TrendFormat, (v: number) => string> = {
  money0: (v) => `$${Math.round(v).toLocaleString("en-US")}`,
  moneyCents: (v) => `$${v.toFixed(2)}`,
  pct1: (v) => `${v.toFixed(1)}%`,
  hrs1: (v) => `${v.toFixed(1)} hrs`,
  grade: (v) => v.toFixed(2),
  num1: (v) => v.toFixed(1),
  /** A return multiple — "3.29×". Never render a ROAS-style ratio as a percent. */
  ratiox: (v) => `${v.toFixed(2)}×`,
};

/**
 * One generic weekly line chart used across the Performance Trends page —
 * pass 1 series for an agent-only view, or 2 (agent + dashed team-average)
 * for a coaching comparison. `data` rows carry a `week` label plus one field
 * per series key; missing weeks are bridged with connectNulls.
 */
export function TrendChart({
  data,
  series,
  format = "num1",
  height = 220,
  xKey = "week",
  connectNulls = true,
}: {
  data: Record<string, string | number | null>[];
  series: TrendSeriesDef[];
  format?: TrendFormat;
  height?: number;
  /** X-axis field. Defaults to "week" for the weekly Trends callers. */
  xKey?: string;
  /**
   * Bridge a null by drawing straight through it. TRUE for weekly series where
   * a missing week is noise; pass FALSE when a null means "not reported" and
   * interpolating would invent a number the source never published.
   */
  connectNulls?: boolean;
}) {
  const fmt = TREND_FORMATTERS[format];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.edge} vertical={false} />
        <XAxis dataKey={xKey} tick={axis} tickLine={false} axisLine={{ stroke: C.edge }} />
        <YAxis
          tick={axis}
          tickLine={false}
          axisLine={false}
          domain={["auto", "auto"]}
          tickFormatter={(v: number) => fmt(v)}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => [value == null ? "—" : fmt(Number(value)), name]}
        />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: C.mute }} />}
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={s.strokeWidth ?? (s.dashed ? 1.5 : 2.5)}
            strokeDasharray={s.dashed ? "5 4" : undefined}
            dot={(s.dots ?? !s.dashed) ? { r: 3, fill: s.color } : false}
            connectNulls={connectNulls}
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export interface CohortPoint {
  monthLabel: string;
  placeRatePct: number | null;
  submissions: number;
  maturityPct: number | null;
}

/**
 * Place rate by SUBMISSION-month cohort (not by week — cohorts take 30–90
 * days to resolve, per COACHING-PLAYBOOK). Immature cohorts (below the
 * matured threshold) render faded so a slow-baking month doesn't read as a
 * slump.
 */
export function CohortPlaceRateChart({
  data,
  maturedThresholdPct,
}: {
  data: CohortPoint[];
  maturedThresholdPct: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.edge} vertical={false} />
        <XAxis dataKey="monthLabel" tick={axis} tickLine={false} axisLine={{ stroke: C.edge }} />
        <YAxis
          tick={axis}
          tickLine={false}
          axisLine={false}
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: C.edge, fillOpacity: 0.3 }}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as CohortPoint | undefined;
            if (!p) return null;
            const matured = (p.maturityPct ?? 0) >= maturedThresholdPct;
            return (
              <div style={tooltipStyle} className="p-2">
                <div style={{ color: C.gold, fontWeight: 600 }}>{p.monthLabel}</div>
                <div>
                  {p.placeRatePct != null ? `${p.placeRatePct.toFixed(1)}%` : "—"} placed · n=
                  {p.submissions}
                </div>
                <div style={{ color: C.faint, fontSize: 11 }}>
                  {(p.maturityPct ?? 0).toFixed(0)}% matured
                  {matured ? "" : " — too early to judge"}
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="placeRatePct" radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={C.gold}
              fillOpacity={(d.maturityPct ?? 0) >= maturedThresholdPct ? 0.9 : 0.25}
            />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Net-after-draw waterfall: invisible base bar + colored delta bar per step. */
export function WaterfallChart({
  data,
}: {
  data: { name: string; base: number; delta: number; kind: "pos" | "neg" | "total" }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={C.edge} vertical={false} />
        <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={{ stroke: C.edge }} />
        <YAxis
          tick={axis}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${Math.round(v / 1000)}K`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) =>
            name === "delta"
              ? [`$${Math.round(Number(value)).toLocaleString()}`, "amount"]
              : []
          }
        />
        <ReferenceLine y={0} stroke={C.faint} />
        <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="delta" stackId="wf" radius={[2, 2, 0, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.kind === "total" ? C.gold : d.kind === "pos" ? C.up : C.down}
              fillOpacity={d.kind === "total" ? 1 : 0.8}
            />
          ))}
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
