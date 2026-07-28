import type { ReactNode } from "react";
import { getTeamWeeks, getAgentDayTriggers } from "@/lib/queries";
import { buildTeamLiveWeek } from "@/lib/live";
import { buildColdStreaks } from "@/lib/coldstreak";
import { getViewer, isManager } from "@/lib/auth";
import { isWeekInProgress, latestCompleteWeekStart } from "@/lib/weeks";
import { fmtInt, fmtMoney, fmtPct, fmtPts, fmtWeek } from "@/lib/format";
import { Panel, SectionTitle, Delta } from "@/components/ui";
import { TeamTrendChart, LeadsSalesChart } from "@/components/charts";
import LiveWeekPanel from "@/components/LiveWeekPanel";
import ColdStreakAlert from "@/components/ColdStreakAlert";

export const revalidate = 900;

/**
 * Box-score cell for the "Last Completed Week" strip. Intentionally flatter than
 * StatTile (no per-cell border/card, smaller number) so this settled-week
 * reference reads as secondary to the "This Week (Live)" hero panel above it.
 */
function ScoreCell({
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
    <div>
      <div className="display text-[11px] font-semibold uppercase tracking-widest text-faint">
        {label}
      </div>
      <div className="num display mt-1 text-2xl font-bold text-ink/90">{value}</div>
      {(delta || sample) && (
        <div className="mt-1 flex items-baseline gap-2 text-[11px]">
          {delta}
          {sample && <span className="text-faint">{sample}</span>}
        </div>
      )}
    </div>
  );
}

/** Callouts describe the last COMPLETED week (`completeWeeks`, ascending). */
function buildCallouts(completeWeeks: Awaited<ReturnType<typeof getTeamWeeks>>): string[] {
  const w = completeWeeks[completeWeeks.length - 1];
  const prev = completeWeeks[completeWeeks.length - 2];
  if (!w) return [];
  const out: string[] = [];

  const closeD = w.wow_close_rate_pts ?? 0;
  const leadsD = w.wow_leads ?? 0;
  const leadsPct = prev?.leads ? (100 * leadsD) / prev.leads : 0;

  if (closeD <= -2 && leadsPct >= 10) {
    out.push(
      `Close ${fmtPts(closeD)} while leads ${leadsD > 0 ? "+" : ""}${fmtInt(leadsD)} (${leadsPct.toFixed(0)}%) — lead flood? Check talk-per-dial on Close Diagnostics.`
    );
  } else if (closeD <= -2) {
    out.push(`Close rate ${fmtPts(closeD)} WoW — worth a look at effort stats before Monday.`);
  } else if (closeD >= 2) {
    out.push(`Close rate ${fmtPts(closeD)} WoW — momentum week; call it out at All-Hands.`);
  }

  if (prev?.premium && w.premium != null) {
    const pPct = (100 * (w.premium - prev.premium)) / prev.premium;
    if (Math.abs(pPct) >= 20)
      out.push(
        `Premium ${pPct > 0 ? "up" : "down"} ${Math.abs(pPct).toFixed(0)}% WoW (${fmtMoney(w.premium)} vs ${fmtMoney(prev.premium)}).`
      );
  }

  if (prev && w.active_agents !== prev.active_agents) {
    out.push(
      `Active agents ${w.active_agents} (was ${prev.active_agents}) — per-agent averages will shift.`
    );
  }

  if (out.length === 0) out.push("No unusual moves this week — steady as she goes.");
  return out;
}

export default async function TeamPulsePage() {
  // Cold-streak watch is roster-wide, film-derived data — manager-only.
  const manager = isManager(await getViewer());
  const [weeks, live, triggers] = await Promise.all([
    getTeamWeeks(14),
    buildTeamLiveWeek(),
    manager ? getAgentDayTriggers() : Promise.resolve([]),
  ]);
  const coldStreaks = manager ? buildColdStreaks(triggers) : [];

  // Headline the last COMPLETED week (matches the Monday deck); the in-progress
  // week is shown only in the live tracker + as a faded trend bar.
  const completeWeeks = weeks.filter((w) => !isWeekInProgress(w.week_start));
  const reportingWeek = latestCompleteWeekStart(weeks.map((w) => w.week_start));
  const latest = completeWeeks[completeWeeks.length - 1];
  const callouts = buildCallouts(completeWeeks);

  const trendData = weeks.map((w) => ({
    week: fmtWeek(w.week_start),
    premium: w.premium ?? 0,
    close: w.close_rate_pct,
    leads: w.leads ?? 0,
    provisional: isWeekInProgress(w.week_start),
  }));
  const lsData = weeks.map((w) => ({
    week: fmtWeek(w.week_start),
    leads: w.leads ?? 0,
    sales: w.sales ?? 0,
  }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
          Team Pulse
        </h1>
        <p className="text-sm text-mute">
          This week&apos;s live pace up top, then last week&apos;s final box score.
        </p>
      </header>

      {manager && <ColdStreakAlert streaks={coldStreaks} />}

      <LiveWeekPanel live={live} scope="team" />

      <Panel className="border-edge/60 bg-panel/70">
        <SectionTitle
          sub={
            <>
              week of {reportingWeek ? fmtWeek(reportingWeek) : "—"} ·{" "}
              {latest?.active_agents ?? "—"} agents · deltas vs prior week
            </>
          }
        >
          Last Completed Week
        </SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          <ScoreCell
            label="Leads"
            value={fmtInt(latest?.leads)}
            delta={<Delta value={latest?.wow_leads} format={(v) => fmtInt(v)} />}
          />
          <ScoreCell
            label="Sales"
            value={fmtInt(latest?.sales)}
            delta={<Delta value={latest?.wow_sales} format={(v) => fmtInt(v)} />}
          />
          <ScoreCell
            label="Close rate"
            value={fmtPct(latest?.close_rate_pct)}
            delta={<Delta value={latest?.wow_close_rate_pts} format={(v) => `${v.toFixed(1)} pts`} />}
            sample={`${fmtInt(latest?.sales)}/${fmtInt(latest?.leads)} leads`}
          />
          <ScoreCell
            label="Premium"
            value={fmtMoney(latest?.premium)}
            delta={<Delta value={latest?.wow_premium} format={(v) => fmtMoney(v)} />}
          />
          <ScoreCell
            label="Premium / sale"
            value={fmtMoney(latest?.premium_per_sale)}
            sample={`${fmtInt(latest?.sales)} sales`}
          />
          <ScoreCell
            label="Premium / agent"
            value={fmtMoney(latest?.premium_per_agent)}
            sample={`${latest?.active_agents ?? "—"} agents`}
          />
        </div>
      </Panel>

      <Panel>
        <SectionTitle sub="auto-generated from v_weekly_team WoW columns">
          Monday Callouts
        </SectionTitle>
        <ul className="space-y-2">
          {callouts.map((c, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink">
              <span className="mt-0.5 text-gold">▍</span>
              {c}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <SectionTitle sub="12 weeks · bars = premium ($), line = close rate (%) · faded bar = current week in progress">
          Premium & Close Trend
        </SectionTitle>
        <TeamTrendChart data={trendData} />
      </Panel>

      <Panel>
        <SectionTitle sub="12 weeks · team totals">Leads vs Sales</SectionTitle>
        <LeadsSalesChart data={lsData} />
      </Panel>
    </div>
  );
}
