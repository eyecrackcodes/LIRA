"use client";

import { useMemo, useState } from "react";
import type { ThanksioOrder } from "@/lib/thanksio";
import { fmtInt, fmtMoneyCents, fmtPct, fmtWeek } from "@/lib/format";
import { Panel, SectionTitle, StatTile } from "@/components/ui";
import { MailerChart } from "@/components/charts";

const RANGES = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "all", label: "All time", days: null },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

/** ISO timestamp -> Pacific calendar date "YYYY-MM-DD" (en-CA yields ISO order). */
function pacificDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

const selectCls =
  "display rounded-sm border border-edge bg-navy px-3 py-1.5 text-sm text-ink outline-none focus:border-gold-dim";

export default function MailerExplorer({ orders }: { orders: ThanksioOrder[] }) {
  const [range, setRange] = useState<RangeKey>("all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [design, setDesign] = useState("all");

  // Each creative is an image template named after its agent (resolved to the
  // dim_agent name server-side). Unnamed creatives fall back to stable
  // "Design N" labels numbered by first appearance across ALL orders.
  const designs = useMemo(
    () => uniqueInOrder(orders.map((o) => o.frontImage ?? "none")),
    [orders]
  );
  const nameByImage = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) {
      if (o.templateName) m.set(o.frontImage ?? "none", o.templateName);
    }
    return m;
  }, [orders]);
  const designLabel = (img: string | null) => {
    const key = img ?? "none";
    const named = nameByImage.get(key);
    if (named) return named;
    const idx = designs.indexOf(key);
    return idx >= 0 ? `Design ${idx + 1}` : "Design ?";
  };

  const types = useMemo(() => uniqueInOrder(orders.map((o) => o.displayType)), [orders]);
  const statuses = useMemo(() => uniqueInOrder(orders.map((o) => o.status)), [orders]);

  const filtered = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    const cutoff = days != null ? Date.now() - days * 86_400_000 : null;
    return orders.filter((o) => {
      if (cutoff != null && new Date(o.createdAt).getTime() < cutoff) return false;
      if (type !== "all" && o.displayType !== type) return false;
      if (status !== "all" && o.status !== status) return false;
      if (design !== "all" && (o.frontImage ?? "none") !== design) return false;
      return true;
    });
  }, [orders, range, type, status, design]);

  const agg = useMemo(() => {
    let cards = 0;
    let scans = 0;
    let spendCents = 0;
    const funnel = {
      Delivered: 0,
      "Processed for delivery": 0,
      "In local area": 0,
      "In transit": 0,
      Printed: 0,
      Processing: 0,
      "Re-routed": 0,
      "Returned to sender": 0,
      Failed: 0,
    };
    let tracked = 0; // cards on orders where the track call succeeded

    const dailyMap = new Map<string, { sends: number; scans: number }>();
    const byDesign = new Map<
      string,
      { image: string | null; orders: number; cards: number; scans: number; spendCents: number }
    >();

    for (const o of filtered) {
      cards += o.cards;
      scans += o.scans;
      spendCents += o.costCents;

      if (o.delivery) {
        tracked += o.cards;
        funnel.Delivered += o.delivery.delivered;
        funnel["Processed for delivery"] += o.delivery.processedForDelivery;
        funnel["In local area"] += o.delivery.inLocalArea;
        funnel["In transit"] += o.delivery.inTransit;
        funnel.Printed += o.delivery.printed;
        funnel.Processing += o.delivery.processing;
        funnel["Re-routed"] += o.delivery.reRouted;
        funnel["Returned to sender"] += o.delivery.returnedToSender;
        funnel.Failed += o.delivery.failed;
      }

      const day = pacificDate(o.createdAt);
      const bucket = dailyMap.get(day) ?? { sends: 0, scans: 0 };
      bucket.sends += o.cards;
      bucket.scans += o.scans;
      dailyMap.set(day, bucket);

      const dKey = o.frontImage ?? "none";
      const d = byDesign.get(dKey) ?? {
        image: o.frontImage,
        orders: 0,
        cards: 0,
        scans: 0,
        spendCents: 0,
      };
      d.orders += 1;
      d.cards += o.cards;
      d.scans += o.scans;
      d.spendCents += o.costCents;
      byDesign.set(dKey, d);
    }

    const daily = [...dailyMap.entries()]
      .map(([date, v]) => ({ day: fmtWeek(date), date, sends: v.sends, scans: v.scans }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const creatives = [...byDesign.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.cards - a.cards);

    return { cards, scans, spendCents, funnel, tracked, daily, creatives };
  }, [filtered]);

  const { cards, scans, spendCents, funnel, tracked, daily, creatives } = agg;
  const deliveredRate = tracked > 0 ? (100 * funnel.Delivered) / tracked : null;
  const funnelRows = Object.entries(funnel).filter(([, v]) => v > 0);
  const funnelMax = Math.max(...funnelRows.map(([, v]) => v), 1);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-faint">
          Date range
          <select value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className={selectCls}>
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-faint">
          Mail type
          <select value={type} onChange={(e) => setType(e.target.value)} className={selectCls}>
            <option value="all">All types</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-faint">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-faint">
          Agent
          <select value={design} onChange={(e) => setDesign(e.target.value)} className={selectCls}>
            <option value="all">All agents</option>
            {[...designs]
              .sort((a, b) =>
                designLabel(a === "none" ? null : a).localeCompare(designLabel(b === "none" ? null : b))
              )
              .map((d) => (
                <option key={d} value={d}>
                  {designLabel(d === "none" ? null : d)}
                </option>
              ))}
          </select>
        </label>
        <span className="text-xs text-faint">
          {fmtInt(filtered.length)} of {fmtInt(orders.length)} orders match
        </span>
      </div>

      {/* Headline tiles (all reflect the active filters) */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Cards out" value={fmtInt(cards)} sample={`${fmtInt(filtered.length)} orders`} />
        <StatTile
          label="Spend"
          value={fmtMoneyCents(spendCents / 100)}
          sample={cards > 0 ? `${fmtMoneyCents(spendCents / 100 / cards)} per card` : undefined}
        />
        <StatTile
          label="Scans per 100 cards"
          value={cards > 0 ? ((100 * scans) / cards).toFixed(1) : "—"}
          sample={`${fmtInt(scans)} scans`}
        />
        <StatTile
          label="Delivered"
          value={fmtInt(funnel.Delivered)}
          sample={deliveredRate != null ? `${fmtPct(deliveredRate)} of tracked cards` : "no tracking data"}
        />
      </div>

      {/* Trend */}
      <Panel>
        <SectionTitle sub="cards mailed & QR scans, by day sent (Pacific) · respects filters">
          Scans & Sends by Day
        </SectionTitle>
        {daily.length < 1 ? (
          <p className="text-sm text-mute">No orders match the current filters.</p>
        ) : (
          <MailerChart data={daily} />
        )}
      </Panel>

      {/* Delivery funnel */}
      <Panel>
        <SectionTitle sub="per-card USPS pipeline from thanks.io tracking · respects filters">
          Delivery Funnel
        </SectionTitle>
        {funnelRows.length === 0 ? (
          <p className="text-sm text-mute">No tracking data for the current filters.</p>
        ) : (
          <div className="space-y-2">
            {funnelRows.map(([label, count]) => (
              <div key={label} className="flex items-center gap-3">
                <span className="w-44 shrink-0 text-xs uppercase tracking-wider text-mute">{label}</span>
                <div className="h-4 flex-1 overflow-hidden rounded-sm bg-navy">
                  <div
                    className="h-full rounded-sm"
                    style={{
                      width: `${Math.max(2, (100 * count) / funnelMax)}%`,
                      backgroundColor:
                        label === "Failed" || label === "Returned to sender"
                          ? "var(--color-down)"
                          : "var(--color-gold)",
                    }}
                  />
                </div>
                <span className="num w-20 shrink-0 text-right text-sm text-ink">
                  {fmtInt(count)}
                  {tracked > 0 && (
                    <span className="ml-1 text-xs text-faint">({((100 * count) / tracked).toFixed(0)}%)</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Per-agent creative performance */}
      <Panel>
        <SectionTitle sub="each card design is an agent's image template · respects filters">
          Agent Performance
        </SectionTitle>
        {creatives.length === 0 ? (
          <p className="text-sm text-mute">No orders match the current filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-mute">
                  <th className="py-2 pr-3">Agent / design</th>
                  <th className="py-2 pr-3 text-right">Orders</th>
                  <th className="py-2 pr-3 text-right">Cards</th>
                  <th className="py-2 pr-3 text-right">Spend</th>
                  <th className="py-2 pr-3 text-right">Cost / card</th>
                  <th className="py-2 pr-3 text-right">Scans</th>
                  <th className="py-2 text-right">Scans / 100</th>
                </tr>
              </thead>
              <tbody>
                {creatives.map((c) => (
                  <tr key={c.key} className="border-b border-edge/50">
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        {c.image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={c.image}
                            alt=""
                            className="h-9 w-14 rounded-sm border border-edge object-cover"
                            loading="lazy"
                          />
                        )}
                        <span className="text-ink">{designLabel(c.image)}</span>
                      </span>
                    </td>
                    <td className="num py-2 pr-3 text-right">{fmtInt(c.orders)}</td>
                    <td className="num py-2 pr-3 text-right">{fmtInt(c.cards)}</td>
                    <td className="num py-2 pr-3 text-right">{fmtMoneyCents(c.spendCents / 100)}</td>
                    <td className="num py-2 pr-3 text-right">
                      {c.cards > 0 ? fmtMoneyCents(c.spendCents / 100 / c.cards) : "—"}
                    </td>
                    <td className="num py-2 pr-3 text-right">{fmtInt(c.scans)}</td>
                    <td className="num py-2 text-right">
                      {c.cards > 0 ? ((100 * c.scans) / c.cards).toFixed(1) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
