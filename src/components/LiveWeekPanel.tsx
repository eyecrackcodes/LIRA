import type { LiveWeek } from "@/lib/live";
import { fmtInt, fmtMoney, fmtPct, fmtWeek } from "@/lib/format";
import { Panel, SectionTitle, StatTile, Delta, HeaderTip } from "@/components/ui";
import { DailyWeekChart } from "@/components/charts";

const pctFmt = (v: number) => `${Math.abs(v).toFixed(0)}%`;

/**
 * "This Week (Live)" — the honest intraday tracker. Every number is
 * week-to-date and compared against the SAME weekdays of last week, so a
 * partial week never reads as a collapse. Used for both the team (Team Pulse)
 * and a single agent (their card).
 */
export default function LiveWeekPanel({
  live,
  scope,
}: {
  live: LiveWeek;
  scope: "team" | "agent";
}) {
  const noun = scope === "team" ? "the team" : "this agent";
  const closePts =
    live.closeRatePct != null && live.priorCloseRatePct != null
      ? live.closeRatePct - live.priorCloseRatePct
      : null;

  return (
    <Panel>
      <SectionTitle
        sub={
          <>
            week of {fmtWeek(live.weekStart)}
            {live.throughLabel ? ` · through ${live.throughLabel}` : ""} ·{" "}
            <HeaderTip
              label="vs same point last week"
              tip="Every figure is week-to-date (Monday through the latest synced day) and compared against the SAME weekdays of last week — never against last week's finished total. Day counts are small, so treat this as a live pulse, not a trend."
              align="right"
            />
          </>
        }
      >
        This Week (Live)
      </SectionTitle>

      {!live.hasData ? (
        <p className="text-sm text-mute">
          No activity recorded for {noun} yet this week — check back after tonight&apos;s sync.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              label="Premium (WTD)"
              value={fmtMoney(live.premium.wtd)}
              delta={<Delta value={live.premium.deltaPct} format={pctFmt} />}
              sample={
                live.premium.projected != null ? `~${fmtMoney(live.premium.projected)} pace` : undefined
              }
            />
            <StatTile
              label="Sales (WTD)"
              value={fmtInt(live.sales.wtd)}
              delta={<Delta value={live.sales.deltaPct} format={pctFmt} />}
              sample={
                live.sales.projected != null
                  ? `~${fmtInt(Math.round(live.sales.projected))} pace`
                  : undefined
              }
            />
            <StatTile
              label="Close rate (WTD)"
              value={fmtPct(live.closeRatePct)}
              delta={
                closePts != null ? (
                  <Delta value={closePts} format={(v) => `${Math.abs(v).toFixed(1)} pts`} />
                ) : undefined
              }
              sample={`${fmtInt(live.sales.wtd)}/${fmtInt(live.leads.wtd)} leads`}
            />
            <StatTile
              label="Leads (WTD)"
              value={fmtInt(live.leads.wtd)}
              delta={<Delta value={live.leads.deltaPct} format={pctFmt} />}
            />
          </div>

          <div className="mt-4">
            <DailyWeekChart data={live.byDay} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Solid = this week&apos;s daily submitted premium; faint = the same weekday last week.
            &ldquo;Pace&rdquo; projects the full week from last week&apos;s day-shape — a hint, not
            a forecast. Small daily samples swing hard.
          </p>
        </>
      )}
    </Panel>
  );
}
