import "server-only";
import type { LeadSourceEnrichedRow } from "./types";
import { isWeekInProgress } from "./weeks";

/**
 * Lead-flow model for Close Diagnostics: where leads came from, and which of
 * them turned into a sale.
 *
 * WHY A FLOW AND NOT ANOTHER STACKED BAND: the mix chart answers "what share of
 * leads came from each source". The diagnostic question is sharper — does the
 * mix skew toward sources that DON'T close? A flow puts leads-in and sales-out
 * on one picture, so a source with a fat lead band and a thin sale ribbon is
 * visible instantly. That mismatch is the whole point.
 *
 * INTEGRITY RULES BAKED IN HERE:
 *  - Flow is conserved. leads = sold + unsold for every source, so ribbon
 *    widths sum to node heights and the picture can't lie about totals.
 *  - The IN-PROGRESS week is excluded. Leads arrive before they close (a
 *    Monday lead can sell Thursday), so a partial week systematically
 *    understates conversion and would draw every sale ribbon too thin.
 *  - Rates are aggregate-then-rate: Σsales ÷ Σleads per source, never a mean
 *    of per-agent rates.
 *  - The tail folds into "Other" at MAX_SOURCES. Past ~7 classes adjacent hues
 *    blur, and a generated 8th color is indistinguishable under CVD.
 *  - Cost coverage is reported, not hidden: a source whose dim_lead_source row
 *    has no cost_per_lead contributes $0 spend, which makes it look free. The
 *    model counts those leads so the UI can say so.
 */

/** Categorical slots, assigned in order. Never cycle; never generate a 9th. */
const VIZ_SLOTS = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
] as const;
export const OTHER_COLOR = "var(--viz-other)";
export const MAX_SOURCES = VIZ_SLOTS.length;

/**
 * Fixed identity order. Colors are handed out by a source's position in THIS
 * list, not by how big it was this week — otherwise a quiet week would repaint
 * every band and "CTV is blue" would stop being true.
 */
const GROUP_ORDER = [
  "CTV",
  "Roku",
  "Paid Social",
  "Direct",
  "Web",
  "Internal/Organic",
];

const orderOf = (g: string) => {
  const i = GROUP_ORDER.indexOf(g);
  return i === -1 ? GROUP_ORDER.length : i;
};

/**
 * Fold a full set of source groups down to the palette ceiling and hand each
 * survivor a fixed slot.
 *
 * Shared by every lead-source chart on the page so a source is the SAME color
 * everywhere — the flow and the mix band must agree, or the two panels read as
 * describing different data. Selection is by volume; color is by identity
 * order, so a quiet week reshuffles which sources appear but never repaints the
 * ones that stay.
 */
export function foldSourceGroups(
  leadsByGroup: Map<string, number>,
  max = MAX_SOURCES
): { keep: string[]; colorOf: Record<string, string>; folded: string[] } {
  const ranked = [...leadsByGroup.entries()]
    .filter(([g, n]) => n > 0 && g !== "Other")
    .sort((a, b) => b[1] - a[1]);
  const keep = ranked.slice(0, max).map(([g]) => g);
  const folded = [
    ...ranked.slice(max).map(([g]) => g),
    ...[...leadsByGroup.keys()].filter((g) => g === "Other"),
  ].sort();

  const colorOf: Record<string, string> = { Other: OTHER_COLOR };
  [...keep]
    .sort((a, b) => orderOf(a) - orderOf(b))
    .forEach((g, i) => {
      colorOf[g] = VIZ_SLOTS[i];
    });
  return { keep, colorOf, folded };
}

export interface FlowSource {
  key: string;
  leads: number;
  sales: number;
  unsold: number;
  closePct: number | null;
  cost: number;
  costPerSale: number | null;
  /** Leads whose source carries no cost_per_lead — their spend reads as $0. */
  leadsWithoutCost: number;
  color: string;
  /** True when this row is the folded tail rather than a single source. */
  isOther: boolean;
  /** Names folded in, when isOther. */
  folded: string[];
}

export interface LeadFlow {
  periodStart: string | null;
  sources: FlowSource[];
  totals: {
    leads: number;
    sales: number;
    unsold: number;
    cost: number;
    closePct: number | null;
    costPerSale: number | null;
    leadsWithoutCost: number;
  };
  /** Weeks available to pick from, newest last — for the period selector. */
  availableWeeks: string[];
}

function emptyFlow(availableWeeks: string[] = []): LeadFlow {
  return {
    periodStart: null,
    sources: [],
    totals: {
      leads: 0,
      sales: 0,
      unsold: 0,
      cost: 0,
      closePct: null,
      costPerSale: null,
      leadsWithoutCost: 0,
    },
    availableWeeks,
  };
}

/**
 * Build the flow for one settled week.
 *
 * `week` picks a specific anchor; omitted, it uses the latest COMPLETE week.
 */
export function buildLeadFlow(rows: LeadSourceEnrichedRow[], week?: string): LeadFlow {
  const weekRows = rows.filter((r) => r.grain === "week" && r.period_start);
  const availableWeeks = [...new Set(weekRows.map((r) => r.period_start))]
    .filter((w) => !isWeekInProgress(w))
    .sort();
  if (availableWeeks.length === 0) return emptyFlow();

  const anchor =
    week && availableWeeks.includes(week)
      ? week
      : availableWeeks[availableWeeks.length - 1];
  const period = weekRows.filter((r) => r.period_start === anchor);
  if (period.length === 0) return emptyFlow(availableWeeks);

  interface Acc {
    leads: number;
    sales: number;
    cost: number;
    leadsWithoutCost: number;
  }
  const byGroup = new Map<string, Acc>();
  for (const r of period) {
    const g = r.source_group ?? "Other";
    const a = byGroup.get(g) ?? { leads: 0, sales: 0, cost: 0, leadsWithoutCost: 0 };
    a.leads += r.leads ?? 0;
    a.sales += r.sales_icd ?? 0;
    a.cost += Number(r.lead_cost ?? 0);
    if (r.dim_cost_per_lead == null) a.leadsWithoutCost += r.leads ?? 0;
    byGroup.set(g, a);
  }

  // Fold the tail by VOLUME, but color by identity order (see GROUP_ORDER).
  const ranked = [...byGroup.entries()]
    .filter(([, a]) => a.leads > 0)
    .sort((x, y) => y[1].leads - x[1].leads);
  const keep = ranked.slice(0, MAX_SOURCES).filter(([g]) => g !== "Other");
  const tail = ranked.filter(([g]) => !keep.some(([k]) => k === g));

  const mk = (
    key: string,
    a: Acc,
    color: string,
    isOther: boolean,
    folded: string[]
  ): FlowSource => ({
    key,
    leads: a.leads,
    sales: a.sales,
    unsold: Math.max(0, a.leads - a.sales),
    closePct: a.leads > 0 ? (100 * a.sales) / a.leads : null,
    cost: a.cost,
    costPerSale: a.sales > 0 ? a.cost / a.sales : null,
    leadsWithoutCost: a.leadsWithoutCost,
    color,
    isOther,
    folded,
  });

  const slotted = [...keep].sort((x, y) => orderOf(x[0]) - orderOf(y[0]));
  const sources: FlowSource[] = slotted.map(([g, a], i) =>
    mk(g, a, VIZ_SLOTS[i], false, [])
  );

  if (tail.length > 0) {
    const agg = tail.reduce<Acc>(
      (t, [, a]) => ({
        leads: t.leads + a.leads,
        sales: t.sales + a.sales,
        cost: t.cost + a.cost,
        leadsWithoutCost: t.leadsWithoutCost + a.leadsWithoutCost,
      }),
      { leads: 0, sales: 0, cost: 0, leadsWithoutCost: 0 }
    );
    sources.push(
      mk(
        "Other",
        agg,
        OTHER_COLOR,
        true,
        tail.map(([g]) => g).sort()
      )
    );
  }

  // Draw order: biggest first reads best; color already fixed above, so
  // sorting here cannot repaint anything.
  sources.sort((a, b) => b.leads - a.leads);

  const t = sources.reduce(
    (acc, s) => ({
      leads: acc.leads + s.leads,
      sales: acc.sales + s.sales,
      unsold: acc.unsold + s.unsold,
      cost: acc.cost + s.cost,
      leadsWithoutCost: acc.leadsWithoutCost + s.leadsWithoutCost,
    }),
    { leads: 0, sales: 0, unsold: 0, cost: 0, leadsWithoutCost: 0 }
  );

  return {
    periodStart: anchor,
    sources,
    totals: {
      ...t,
      closePct: t.leads > 0 ? (100 * t.sales) / t.leads : null,
      costPerSale: t.sales > 0 ? t.cost / t.sales : null,
    },
    availableWeeks,
  };
}
