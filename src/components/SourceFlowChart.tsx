"use client";

import { useId, useState } from "react";

/**
 * Sankey: lead source → outcome, for one settled week.
 *
 * Hand-rolled SVG rather than a charting lib's Sankey because the layout is
 * trivial (one source column, two outcome nodes) while the parts that matter —
 * direct labels on every node, theme-token fills, conserved geometry — are
 * exactly what a generic Sankey makes hardest.
 *
 * The reading: node height = leads. The ribbon leaving toward "Sold" is that
 * source's sales. A source whose block is tall but whose sold ribbon is a
 * thread is dragging team close rate, and it's visible without reading a
 * single number.
 *
 * Direct labels are NOT optional decoration here: three light-mode series
 * colors sit just under 3:1 on white, which the palette rules permit only
 * where values are also readable as text. Removing the labels would make this
 * chart non-compliant.
 */

export interface FlowDatum {
  key: string;
  leads: number;
  sales: number;
  unsold: number;
  closePct: number | null;
  color: string;
  isOther: boolean;
  folded: string[];
}

const H = 360;
const PAD = 14;
const NODE_W = 13;
const GAP = 3; // surface gap between stacked nodes (spacer rule)
const LABEL_L = 190; // room for "Internal/Organic  1,234 leads · 12.3%"
const LABEL_R = 128;
const VB_W = 1000;

const fmt = (n: number) => n.toLocaleString("en-US");

export default function SourceFlowChart({
  data,
  totalLeads,
  totalSales,
}: {
  data: FlowDatum[];
  totalLeads: number;
  totalSales: number;
}) {
  const gid = useId().replace(/:/g, "");
  const [hot, setHot] = useState<string | null>(null);

  if (!data.length || totalLeads <= 0) {
    return (
      <p className="py-8 text-center text-sm text-faint">
        No settled lead-source week to chart yet.
      </p>
    );
  }

  const x0 = LABEL_L;
  const x1 = VB_W - LABEL_R - NODE_W;
  const innerH = H - PAD * 2;

  // One scale for both columns — this is what makes flow conservation visible
  // instead of merely claimed.
  const srcGaps = (data.length - 1) * GAP;
  const scale = (innerH - srcGaps) / totalLeads;

  // Left column
  let y = PAD;
  const nodes = data.map((d) => {
    const h = d.leads * scale;
    const n = { d, y, h };
    y += h + GAP;
    return n;
  });

  // Right column: Sold on top, No sale beneath, same scale so the two columns
  // are literally the same quantity of ink.
  const soldH = totalSales * scale;
  const unsoldH = (totalLeads - totalSales) * scale;
  const soldY = PAD;
  const unsoldY = PAD + soldH + GAP;

  // Ribbons stack within each node in the same order on both ends, so bands
  // never cross unnecessarily.
  let soldCursor = soldY;
  let unsoldCursor = unsoldY;
  const ribbons: {
    id: string;
    d: FlowDatum;
    path: string;
    sold: boolean;
    value: number;
  }[] = [];

  const band = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    thick: number
  ) => {
    const c = ax + (bx - ax) / 2;
    return [
      `M ${ax},${ay}`,
      `C ${c},${ay} ${c},${by} ${bx},${by}`,
      `L ${bx},${by + thick}`,
      `C ${c},${by + thick} ${c},${ay + thick} ${ax},${ay + thick}`,
      "Z",
    ].join(" ");
  };

  for (const n of nodes) {
    let cursor = n.y;
    const sH = n.d.sales * scale;
    const uH = n.d.unsold * scale;
    if (n.d.sales > 0) {
      ribbons.push({
        id: `${n.d.key}-sold`,
        d: n.d,
        sold: true,
        value: n.d.sales,
        path: band(x0 + NODE_W, cursor, x1, soldCursor, sH),
      });
      cursor += sH;
      soldCursor += sH;
    }
    if (n.d.unsold > 0) {
      ribbons.push({
        id: `${n.d.key}-unsold`,
        d: n.d,
        sold: false,
        value: n.d.unsold,
        path: band(x0 + NODE_W, cursor, x1, unsoldCursor, uH),
      });
      unsoldCursor += uH;
    }
  }

  // Label de-collision. A node's height is its lead count, so the small
  // sources end up only a few pixels tall and their two-line labels pile into
  // an unreadable stack. Node rects stay exactly where the data puts them —
  // only the LABELS are spread to a minimum pitch, with a leader line drawn
  // whenever a label had to leave its node. Growing the nodes instead would
  // have been the easy fix and a dishonest one: it makes small sources look
  // bigger than they are.
  const LABEL_PITCH = 34;
  const labelY = nodes.map((n) => n.y + n.h / 2);
  for (let i = 1; i < labelY.length; i++) {
    if (labelY[i] - labelY[i - 1] < LABEL_PITCH) labelY[i] = labelY[i - 1] + LABEL_PITCH;
  }
  const floor = H - PAD - 6;
  if (labelY.length && labelY[labelY.length - 1] > floor) {
    labelY[labelY.length - 1] = floor;
    for (let i = labelY.length - 2; i >= 0; i--) {
      if (labelY[i + 1] - labelY[i] < LABEL_PITCH) labelY[i] = labelY[i + 1] - LABEL_PITCH;
    }
  }

  const dim = (key: string) => hot !== null && hot !== key;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${VB_W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`Lead flow by source. ${fmt(totalLeads)} leads produced ${fmt(totalSales)} sales.`}
        style={{ overflow: "visible" }}
      >
        <title>Lead source to outcome</title>

        {/* Ribbons first so nodes sit on top of their own edges. */}
        <g>
          {ribbons.map((r) => (
            <path
              key={r.id}
              d={r.path}
              fill={r.d.color}
              fillOpacity={r.sold ? 0.62 : 0.16}
              stroke="none"
              style={{
                transition: "fill-opacity 120ms",
                fillOpacity: dim(r.d.key) ? (r.sold ? 0.16 : 0.05) : undefined,
              }}
              onMouseEnter={() => setHot(r.d.key)}
              onMouseLeave={() => setHot(null)}
            >
              <desc>
                {r.d.key} → {r.sold ? "Sold" : "No sale"}: {fmt(r.value)}
              </desc>
            </path>
          ))}
        </g>

        {/* Source nodes + direct labels */}
        {nodes.map((n, i) => {
          const ly = labelY[i];
          const nodeMid = n.y + n.h / 2;
          const displaced = Math.abs(ly - nodeMid) > 1.5;
          return (
            <g
              key={n.d.key}
              onMouseEnter={() => setHot(n.d.key)}
              onMouseLeave={() => setHot(null)}
              style={{ cursor: "default" }}
            >
              <rect
                x={x0}
                y={n.y}
                width={NODE_W}
                height={Math.max(1, n.h)}
                rx={2}
                fill={n.d.color}
                fillOpacity={dim(n.d.key) ? 0.35 : 1}
              />
              {displaced && (
                <polyline
                  points={`${x0 - 3},${nodeMid} ${x0 - 8},${nodeMid} ${x0 - 8},${ly - 6} ${x0 - 12},${ly - 6}`}
                  fill="none"
                  stroke="var(--color-edge2)"
                  strokeWidth={1}
                />
              )}
              <text
                x={x0 - 16}
                y={ly - 6}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={13}
                fill="var(--color-ink)"
              >
                {n.d.key}
              </text>
              <text
                x={x0 - 16}
                y={ly + 9}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={11}
                fill="var(--color-faint)"
              >
                {fmt(n.d.leads)} leads
                {n.d.closePct != null ? ` · ${n.d.closePct.toFixed(1)}%` : ""}
              </text>
            </g>
          );
        })}

        {/* Outcome nodes */}
        <g>
          <rect
            x={x1}
            y={soldY}
            width={NODE_W}
            height={Math.max(1, soldH)}
            rx={2}
            fill="var(--color-up)"
          />
          <text
            x={x1 + NODE_W + 10}
            y={soldY + soldH / 2}
            dominantBaseline="central"
            fontSize={13}
            fill="var(--color-ink)"
          >
            Sold
          </text>
          <text
            x={x1 + NODE_W + 10}
            y={soldY + soldH / 2 + 15}
            dominantBaseline="central"
            fontSize={11}
            fill="var(--color-faint)"
          >
            {fmt(totalSales)}
          </text>

          <rect
            x={x1}
            y={unsoldY}
            width={NODE_W}
            height={Math.max(1, unsoldH)}
            rx={2}
            fill="var(--color-edge2)"
          />
          <text
            x={x1 + NODE_W + 10}
            y={unsoldY + unsoldH / 2}
            dominantBaseline="central"
            fontSize={13}
            fill="var(--color-ink)"
          >
            No sale
          </text>
          <text
            x={x1 + NODE_W + 10}
            y={unsoldY + unsoldH / 2 + 15}
            dominantBaseline="central"
            fontSize={11}
            fill="var(--color-faint)"
          >
            {fmt(totalLeads - totalSales)}
          </text>
        </g>
        <desc id={`${gid}-desc`}>
          Left column: lead sources sized by lead count. Right column: sold vs
          not sold. Ribbon thickness is the number of leads taking that path.
        </desc>
      </svg>
    </div>
  );
}
