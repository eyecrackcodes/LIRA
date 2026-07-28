import { redirect } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { getDataQuality, getFreshness, getFilmCaptureHealth } from "@/lib/queries";
import { hoursSince } from "@/lib/format";
import { Panel, SectionTitle } from "@/components/ui";
import { STALE_HOURS } from "@/components/FreshnessStamp";

export const revalidate = 900;

/** The nightly job self-heals via --backscan=3 (today + 2 prior days). A gap
 *  this size or smaller between capture-run dates is invisible in practice —
 *  the next run catches it up. Longer gaps may have missed data for good. */
const FILM_SELF_HEAL_DAYS = 3;
/** No new captures in this long is unusual even for a quiet team — flag it. */
const FILM_STALE_DAYS = 4;

export default async function HealthPage() {
  if (!(await requireManager())) redirect("/"); // admin page — manager-only
  const [dq, freshness, filmHealth] = await Promise.all([
    getDataQuality(),
    getFreshness(),
    getFilmCaptureHealth(),
  ]);
  const filmHrs = hoursSince(filmHealth.lastCapturedAt);
  const filmDays = filmHrs == null ? null : filmHrs / 24;
  const filmStale = filmDays == null || filmDays > FILM_STALE_DAYS;
  const realGaps = filmHealth.gaps.filter((g) => g.days > FILM_SELF_HEAL_DAYS);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
          Data Health
        </h1>
        <p className="text-sm text-mute">
          Green wall = trust. Pipeline runs nightly ~11 PM on a desktop that must be awake.
        </p>
      </header>

      <Panel>
        <SectionTitle sub={`stale threshold ${STALE_HOURS}h`}>Table Freshness</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {freshness.perTable.map((t) => {
            const hrs = hoursSince(t.at);
            const stale = hrs == null || hrs > STALE_HOURS;
            return (
              <div
                key={t.table}
                className={`rounded-sm border px-3 py-2 ${
                  stale ? "border-warn/50 bg-warn/10" : "border-up/30 bg-up/5"
                }`}
              >
                <div className="num text-sm text-ink">{t.table}</div>
                <div className={`num text-xs ${stale ? "text-warn" : "text-up"}`}>
                  {t.at
                    ? `${new Date(t.at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })} · ${hrs!.toFixed(0)}h ago`
                    : "no rows"}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <SectionTitle
          sub={`trigger-based ingestion (hot/cold outlier days only) — a quiet team can go days with 0 new rows by design; self-heals gaps ≤${FILM_SELF_HEAL_DAYS}d via the nightly --backscan`}
        >
          Film Room Capture Health
        </SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2">
          <div
            className={`rounded-sm border px-3 py-2 ${
              filmStale ? "border-warn/50 bg-warn/10" : "border-up/30 bg-up/5"
            }`}
          >
            <div className="num text-sm text-ink">Last capture</div>
            <div className={`num text-xs ${filmStale ? "text-warn" : "text-up"}`}>
              {filmHealth.lastCapturedAt
                ? `${new Date(filmHealth.lastCapturedAt).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })} · ${filmDays!.toFixed(1)}d ago`
                : "no rows yet"}
            </div>
          </div>
          <div
            className={`rounded-sm border px-3 py-2 ${
              realGaps.length ? "border-warn/50 bg-warn/10" : "border-up/30 bg-up/5"
            }`}
          >
            <div className="num text-sm text-ink">
              Run gaps (last {filmHealth.lookbackDays}d)
            </div>
            <div className={`num text-xs ${realGaps.length ? "text-warn" : "text-up"}`}>
              {realGaps.length > 0
                ? `${realGaps.length} beyond the ${FILM_SELF_HEAL_DAYS}-day self-heal window`
                : filmHealth.gaps.length > 0
                  ? `${filmHealth.gaps.length} self-healed, none unresolved`
                  : "none"}
            </div>
          </div>
        </div>
        {filmHealth.gaps.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="num w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                  <th className="py-2 pr-4">Gap</th>
                  <th className="py-2 pr-4 text-right">Days</th>
                  <th className="py-2 text-left">Read</th>
                </tr>
              </thead>
              <tbody>
                {filmHealth.gaps.map((g) => {
                  const real = g.days > FILM_SELF_HEAL_DAYS;
                  return (
                    <tr key={g.from} className="border-b border-edge/50">
                      <td className="py-2 pr-4 text-ink">
                        {g.from} → {g.to}
                      </td>
                      <td className={`py-2 pr-4 text-right ${real ? "text-warn" : "text-mute"}`}>
                        {g.days}
                      </td>
                      <td className={`py-2 text-left ${real ? "text-warn" : "text-faint"}`}>
                        {real
                          ? "beyond backscan reach — may have permanently missed a day"
                          : "self-healed by the next run's backscan"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-faint">
          The capture job runs on a cloud cron, not the local pipeline machine — this table is
          the only visibility into whether it actually ran each night. A gap here means no agent
          had a qualifying hot/cold day AND the job may not have run; gaps ≤{FILM_SELF_HEAL_DAYS}d
          are invisible in the data itself (backscan covers them), so treat those as low-signal.
        </p>
      </Panel>

      <Panel>
        <SectionTitle sub="v_data_quality — non-empty means action needed">
          Quality Issues
        </SectionTitle>
        {dq.length === 0 ? (
          <div className="flex items-center gap-2 rounded-sm border border-up/30 bg-up/5 px-4 py-3 text-sm text-up">
            <span className="inline-block h-2 w-2 rounded-full bg-up" />
            No open issues — aliases resolve, sources are priced, ledger rows are RLS-able.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                  <th className="py-2 pr-4">Issue</th>
                  <th className="py-2 pr-4">Subject</th>
                  <th className="py-2 pr-4">Detail</th>
                  <th className="py-2">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {dq.map((r, i) => (
                  <tr key={i} className="border-b border-edge/50">
                    <td className="py-2 pr-4 text-warn">{r.issue}</td>
                    <td className="py-2 pr-4 text-ink">{r.subject ?? "—"}</td>
                    <td className="py-2 pr-4 text-mute">{r.detail ?? "—"}</td>
                    <td className="py-2 text-faint">{r.evidence ?? "—"}</td>
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
