/**
 * Underwriting mix + net effective rate, aggregated from commission-ledger rows.
 *
 * Two consumers share this so the number the Coach quotes ties to the P&L panel:
 *   - the Commission Center panel (server component, whole-team book), and
 *   - the Ask Coach agent book (per-agent).
 *
 * NET EFFECTIVE RATE = net commission ÷ commissionable premium (net is already
 * after chargebacks), i.e. how many cents of every premium dollar the shop keeps
 * once clawbacks settle. Gross effective rate uses gross commission instead, so
 * (gross − net) / gross is the chargeback drag on that UW class.
 *
 * "Unclassified" = a null/blank uw_type OR the literal "Unknown" bucket — those
 * are the rows worth mapping at the source. "Other" (term, etc.) is a real class,
 * not a gap, so it is NOT counted as unclassified.
 */

/** Numeric-ish pay columns come back as strings over PostgREST — coerce. */
function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface LedgerLike {
  uw_type: string | null;
  commissionable_premium: number | string | null;
  commission: number | string | null;
  chargeback: number | string | null;
  net: number | string | null;
}

export interface UwBucket {
  /** Display label — the raw uw_type, or "(unset)" for null/blank. */
  label: string;
  /** True when the row can't be classified (null/blank/"Unknown"). */
  unclassified: boolean;
  policies: number;
  pctPolicies: number;
  commPremium: number;
  grossComm: number;
  /** Signed, ≤ 0. */
  chargebacks: number;
  net: number;
  grossEffRatePct: number | null;
  netEffRatePct: number | null;
  /** Chargeback as a share of gross commission (≤ 0). */
  chargebackDragPct: number | null;
}

export interface UwMix {
  buckets: UwBucket[];
  totalPolicies: number;
  totalCommPremium: number;
  totalGrossComm: number;
  totalChargebacks: number;
  totalNet: number;
  blendedGrossEffRatePct: number | null;
  blendedNetEffRatePct: number | null;
  unclassifiedPolicies: number;
  unclassifiedPct: number;
}

/**
 * Month-over-month UW mix + net effective rate, keyed by statement month.
 *
 * WHY MONTHLY (not weekly): the only source carrying uw_type + the 30%/15%
 * commission split is commission_ledger, whose finest grain is statement_month
 * (production month). weekly_data's ams_level/graded/gi columns are unpopulated
 * upstream, and the ledger has no per-policy placement date to bucket into
 * weeks, so a weekly cut would be fabricated precision — statement month is the
 * true grain (and matches the app's submission-month placement convention).
 */
export interface UwMonthPoint {
  month: string; // YYYY-MM
  policies: number;
  commPremium: number;
  grossComm: number;
  net: number;
  netEffRatePct: number | null;
  grossEffRatePct: number | null;
  levelPct: number | null;
  termPct: number | null;
  gradedPct: number | null;
  giPct: number | null;
  otherPct: number | null;
}

type MonthlyLedgerRow = LedgerLike & { statement_month: string | null };

type UwClass = "level" | "term" | "graded" | "gi" | "other";
function classOf(uw: string | null): UwClass {
  switch ((uw ?? "").trim().toLowerCase()) {
    case "level":
      return "level";
    case "term":
      return "term";
    case "graded":
      return "graded";
    case "gi":
      return "gi";
    default:
      return "other"; // Modified, Unknown, and null fold in here
  }
}

export function computeUwByMonth(rows: MonthlyLedgerRow[]): UwMonthPoint[] {
  interface Acc {
    policies: number;
    commPremium: number;
    grossComm: number;
    net: number;
    level: number;
    term: number;
    graded: number;
    gi: number;
    other: number;
  }
  const byMonth = new Map<string, Acc>();

  for (const r of rows) {
    const m = r.statement_month;
    if (!m) continue; // stray null-month rows are out of pay math
    const a =
      byMonth.get(m) ??
      { policies: 0, commPremium: 0, grossComm: 0, net: 0, level: 0, term: 0, graded: 0, gi: 0, other: 0 };
    a.policies += 1;
    a.commPremium += toNum(r.commissionable_premium);
    a.grossComm += toNum(r.commission);
    a.net += toNum(r.net);
    a[classOf(r.uw_type)] += 1;
    byMonth.set(m, a);
  }

  return [...byMonth.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([month, a]) => ({
      month,
      policies: a.policies,
      commPremium: a.commPremium,
      grossComm: a.grossComm,
      net: a.net,
      netEffRatePct: rate(a.net, a.commPremium),
      grossEffRatePct: rate(a.grossComm, a.commPremium),
      levelPct: rate(a.level, a.policies),
      termPct: rate(a.term, a.policies),
      gradedPct: rate(a.graded, a.policies),
      giPct: rate(a.gi, a.policies),
      otherPct: rate(a.other, a.policies),
    }));
}

const UNSET_LABEL = "(unset)";

function isUnclassified(uw: string | null): boolean {
  if (uw == null) return true;
  const t = uw.trim().toLowerCase();
  return t === "" || t === "unknown";
}

function labelFor(uw: string | null): string {
  return uw == null || uw.trim() === "" ? UNSET_LABEL : uw.trim();
}

const rate = (num: number, den: number): number | null =>
  den > 0 ? (100 * num) / den : null;

export function computeUwMix(rows: LedgerLike[]): UwMix {
  const map = new Map<string, UwBucket>();

  for (const r of rows) {
    const label = labelFor(r.uw_type);
    const b =
      map.get(label) ??
      ({
        label,
        unclassified: isUnclassified(r.uw_type),
        policies: 0,
        pctPolicies: 0,
        commPremium: 0,
        grossComm: 0,
        chargebacks: 0,
        net: 0,
        grossEffRatePct: null,
        netEffRatePct: null,
        chargebackDragPct: null,
      } satisfies UwBucket);
    b.policies += 1;
    b.commPremium += toNum(r.commissionable_premium);
    b.grossComm += toNum(r.commission);
    b.chargebacks += toNum(r.chargeback);
    b.net += toNum(r.net);
    map.set(label, b);
  }

  const totalPolicies = rows.length;
  const buckets = [...map.values()]
    .map((b) => ({
      ...b,
      pctPolicies: totalPolicies ? (100 * b.policies) / totalPolicies : 0,
      grossEffRatePct: rate(b.grossComm, b.commPremium),
      netEffRatePct: rate(b.net, b.commPremium),
      chargebackDragPct: rate(b.chargebacks, b.grossComm),
    }))
    .sort((a, b) => b.policies - a.policies);

  const sum = (pick: (b: UwBucket) => number) => buckets.reduce((s, b) => s + pick(b), 0);
  const totalCommPremium = sum((b) => b.commPremium);
  const totalGrossComm = sum((b) => b.grossComm);
  const totalChargebacks = sum((b) => b.chargebacks);
  const totalNet = sum((b) => b.net);
  const unclassifiedPolicies = buckets
    .filter((b) => b.unclassified)
    .reduce((s, b) => s + b.policies, 0);

  return {
    buckets,
    totalPolicies,
    totalCommPremium,
    totalGrossComm,
    totalChargebacks,
    totalNet,
    blendedGrossEffRatePct: rate(totalGrossComm, totalCommPremium),
    blendedNetEffRatePct: rate(totalNet, totalCommPremium),
    unclassifiedPolicies,
    unclassifiedPct: totalPolicies ? (100 * unclassifiedPolicies) / totalPolicies : 0,
  };
}

/**
 * Pivot week-grain UW-mix rows (one row per week × uw_type, carrying the view's
 * pre-computed pct_of_week) into one row per week with a share per class band.
 * "Unknown"/blank fold into "Other" (grey), matching classOf. Feeds UwMixChart,
 * whose stackOffset="expand" re-normalizes, so any sparse week still fills 100%.
 */
export interface UwWeekMixRow {
  week_start: string;
  uw_type: string | null;
  pct_of_week: number | string | null;
  policies?: number | string | null;
}

export interface UwWeekMixPoint {
  week_start: string;
  Level: number;
  Term: number;
  Graded: number;
  GI: number;
  Other: number;
}

const CLASS_BAND: Record<UwClass, keyof Omit<UwWeekMixPoint, "week_start">> = {
  level: "Level",
  term: "Term",
  graded: "Graded",
  gi: "GI",
  other: "Other",
};

export function pivotUwWeekMix(rows: UwWeekMixRow[]): UwWeekMixPoint[] {
  const byWeek = new Map<string, UwWeekMixPoint>();
  for (const r of rows) {
    const wk = r.week_start;
    if (!wk) continue;
    const p =
      byWeek.get(wk) ??
      ({ week_start: wk, Level: 0, Term: 0, Graded: 0, GI: 0, Other: 0 } satisfies UwWeekMixPoint);
    p[CLASS_BAND[classOf(r.uw_type)]] += toNum(r.pct_of_week);
    byWeek.set(wk, p);
  }
  return [...byWeek.values()].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
}
