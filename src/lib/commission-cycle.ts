import "server-only";
import type { CommissionLedgerRow } from "./types";

/**
 * Statement-month lifecycle: has this month's production actually been captured
 * yet, and how much of what's sitting on it is really last cycle's drift?
 *
 * WHY THIS EXISTS: a statement month starts accumulating rows LONG before its
 * own production is captured. When a settlement runs, policies that didn't tie
 * out (timing mismatches, chargebacks that landed on the commission team's
 * photo a cycle later than ours) get deferred FORWARD onto the next statement
 * month as origin=RECON. So the moment July settles, August is suddenly holding
 * real dollars — with zero August production behind them.
 *
 * Read naively, that looks like early-month production and invites a pace
 * reading. It isn't one. In Aug 2026 all 105 rows were RECON, all stamped the
 * same day July's capture ran, and the "leaders" were simply the agents whose
 * July settlement drift happened to land in their favor.
 *
 * Hence the rule enforced here: ONLY origin=CAPTURE counts as this month's
 * production. Everything else is reported separately, under its own label.
 *
 * Note capture is a single bulk load about a month after month-end (July 2026:
 * 1,436 rows on 2026-08-05), not a trickle across the month. So there is no
 * honest "X% of the month elapsed" proration to compute — a statement month is
 * either captured or it isn't, which is why this returns a STAGE, not a ratio.
 */

export const CAPTURE_ORIGIN = "CAPTURE";

export type CycleStage =
  /** Capture has run — production dollars are real and complete enough to judge. */
  | "captured"
  /** In the capture era but capture hasn't run yet. No production signal exists. */
  | "awaiting-capture"
  /** Predates capture (backfilled/seeded months). Closed; no pace read available. */
  | "legacy";

export interface CommissionCycle {
  month: string;
  stage: CycleStage;
  /** Organic production — origin=CAPTURE only. */
  captureRows: number;
  captureNet: number;
  captureNetByAgent: Map<string, number>;
  /** Carried in from an earlier cycle's settlement — everything not CAPTURE. */
  deferredRows: number;
  deferredNet: number;
  deferredOrigins: string[];
  deferredNetByAgent: Map<string, number>;
  /** Most recent month that DID capture, and when that run landed. */
  lastCapturedMonth: string | null;
  lastCaptureRunOn: string | null;
}

/** Earliest statement month with any CAPTURE row — the start of the capture era.
 *  Months before it were seeded and must not be labelled "awaiting capture". */
export function captureEraStart(all: CommissionLedgerRow[]): string | null {
  let earliest: string | null = null;
  for (const r of all) {
    if (r.origin !== CAPTURE_ORIGIN || !r.statement_month) continue;
    if (!earliest || r.statement_month < earliest) earliest = r.statement_month;
  }
  return earliest;
}

export function buildCommissionCycle(
  all: CommissionLedgerRow[],
  month: string
): CommissionCycle {
  const rows = all.filter((r) => r.statement_month === month);
  const capture = rows.filter((r) => r.origin === CAPTURE_ORIGIN);
  const deferred = rows.filter((r) => r.origin !== CAPTURE_ORIGIN);

  const sumBy = (rs: CommissionLedgerRow[]) => {
    const m = new Map<string, number>();
    for (const r of rs) m.set(r.agent, (m.get(r.agent) ?? 0) + (r.net ?? 0));
    return m;
  };
  const net = (rs: CommissionLedgerRow[]) =>
    rs.reduce((s, r) => s + (r.net ?? 0), 0);

  const era = captureEraStart(all);
  const stage: CycleStage =
    capture.length > 0
      ? "captured"
      : era != null && month >= era
        ? "awaiting-capture"
        : "legacy";

  // When did the most recent capture actually run? Concrete evidence beats a
  // hardcoded schedule, and it tells the reader what "about a month" means here.
  let lastCapturedMonth: string | null = null;
  for (const r of all) {
    if (r.origin !== CAPTURE_ORIGIN || !r.statement_month) continue;
    if (!lastCapturedMonth || r.statement_month > lastCapturedMonth) {
      lastCapturedMonth = r.statement_month;
    }
  }
  let lastCaptureRunOn: string | null = null;
  if (lastCapturedMonth) {
    for (const r of all) {
      if (r.origin !== CAPTURE_ORIGIN || r.statement_month !== lastCapturedMonth) continue;
      const seen = r.first_seen ? String(r.first_seen).slice(0, 10) : null;
      if (seen && (!lastCaptureRunOn || seen < lastCaptureRunOn)) lastCaptureRunOn = seen;
    }
  }

  return {
    month,
    stage,
    captureRows: capture.length,
    captureNet: net(capture),
    captureNetByAgent: sumBy(capture),
    deferredRows: deferred.length,
    deferredNet: net(deferred),
    deferredOrigins: [...new Set(deferred.map((r) => r.origin ?? "—"))].sort(),
    deferredNetByAgent: sumBy(deferred),
    lastCapturedMonth,
    lastCaptureRunOn,
  };
}

/** Agents whose ORGANIC net cleared the draw. Deliberately ignores deferred
 *  dollars: clearing draw on last cycle's drift is not a production result. */
export function agentsAboveDraw(cycle: CommissionCycle, draw: number): number {
  let n = 0;
  for (const v of cycle.captureNetByAgent.values()) if (v > draw) n++;
  return n;
}
