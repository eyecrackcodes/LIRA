const money0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const money2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const fmtMoney = (v: number | null | undefined) =>
  v == null ? "—" : money0.format(v);

export const fmtMoneyCents = (v: number | null | undefined) =>
  v == null ? "—" : money2.format(v);

export const fmtInt = (v: number | null | undefined) =>
  v == null ? "—" : int.format(v);

export const fmtPct = (v: number | null | undefined, digits = 1) =>
  v == null ? "—" : `${v.toFixed(digits)}%`;

export const fmtPts = (v: number | null | undefined, digits = 1) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)} pts`;

/** Minutes → hours for humans: "1,461 min" reads as "24.4 hrs". */
export const fmtMinAsHrs = (min: number | null | undefined, digits = 1) =>
  min == null ? "—" : `${(min / 60).toFixed(digits)} hrs`;

export const fmtSigned = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${int.format(Math.round(v))}`;

export const fmtSignedMoney = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${money0.format(Math.abs(v))}`;

/** "2026-07-06" -> "Jul 6" (parsed as plain date, no TZ shift) */
export function fmtWeek(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-07" or "2026-07-01" -> "Jul '26" */
export function fmtMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function agentSlug(agent: string): string {
  return agent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function agentInitials(agent: string): string {
  return agent
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

/** Call timestamp -> Pacific-time clock, e.g. "7:11 AM PT". */
export function fmtTimePT(iso: string): string {
  return `${new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Los_Angeles",
  })} PT`;
}

/** Call/day score, 1-5 scale -> "3.7/5". */
export function fmtScore(v: number | null | undefined): string {
  return v == null ? "—" : `${v.toFixed(1)}/5`;
}
