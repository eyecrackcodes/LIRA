import type { ReactNode } from "react";
import {
  getTeamWeeks,
  getAgentDayTriggers,
  getAgentWeeks,
  getActiveAgents,
  getAgentSalesStart,
} from "@/lib/queries";
import { buildTeamLiveWeek } from "@/lib/live";
import { buildColdStreaks } from "@/lib/coldstreak";
import { getViewer, isManager } from "@/lib/auth";
import { departedAgentSet, listTableDepartures } from "@/lib/roster";
import {
  buildMonthlyTeam,
  buildRosterInsights,
  buildTeamWindow,
  coerceTeamWindow,
  TEAM_WINDOWS,
} from "@/lib/teampulse";
import { isWeekInProgress, latestCompleteWeekStart } from "@/lib/weeks";
import { fmtInt, fmtMoney, fmtPct, fmtPts, fmtWeek, fmtMonth } from "@/lib/format";
import { Panel, SectionTitle, Delta, HeaderTip } from "@/components/ui";
import { TeamTrendChart, LeadsSalesChart } from "@/components/charts";
import LiveWeekPanel from "@/components/LiveWeekPanel";
import ColdStreakAlert from "@/components/ColdStreakAlert";
import TeamPulseControls from "@/components/TeamPulseControls";

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

export default async function TeamPulsePage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>;
}) {
  // Cold-streak watch is roster-wide, film-derived data — manager-only.
  const manager = isManager(await getViewer());
  const weeksN = coerceTeamWindow((await searchParams).weeks);

  // 56 weeks so even the 26-week window has a full 26-week prior period to
  // compare against, and the monthly series has ~13 months of depth.
  const [weeks, live, triggers, agentWeeks, activeAgents, departed, departures, salesStarts] =
    await Promise.all([
      getTeamWeeks(56),
      buildTeamLiveWeek(),
      manager ? getAgentDayTriggers() : Promise.resolve([]),
      manager ? getAgentWeeks({ sinceDays: 26 * 7 + 14 }) : Promise.resolve([]),
      getActiveAgents(),
      departedAgentSet(),
      manager ? listTableDepartures() : Promise.resolve([]),
      getAgentSalesStart(),
    ]);
  const coldStreaks = manager ? buildColdStreaks(triggers) : [];

  const windowCmp = buildTeamWindow(weeks, weeksN);
  const monthly = buildMonthlyTeam(weeks).slice(-8);
  const roster = manager
    ? buildRosterInsights({
        teamWeeks: weeks,
        agentWeeks,
        activeAgents: activeAgents
          .map((a) => a.agent)
          .filter((a) => !departed.has(a)),
        departed,
        departures,
        salesStarts,
        windowWeeks: weeksN,
      })
    : null;

  // Headline the last COMPLETED week (matches the Monday deck); the in-progress
  // week is shown only in the live tracker + as a faded trend bar.
  const completeWeeks = weeks.filter((w) => !isWeekInProgress(w.week_start));
  const reportingWeek = latestCompleteWeekStart(weeks.map((w) => w.week_start));
  const latest = completeWeeks[completeWeeks.length - 1];
  const callouts = buildCallouts(completeWeeks);

  // Reuses TeamTrendChart: `provisional` already renders a hollow/dashed bar,
  // which is exactly the treatment a still-accumulating month needs.
  const monthlyChart = monthly.map((m) => ({
    week: fmtMonth(m.month),
    premium: m.premium,
    close: m.closeRatePct,
    leads: m.leads,
    provisional: m.partial,
  }));

  const windowWeeksRows = weeks.slice(-weeksN);
  const trendData = windowWeeksRows.map((w) => ({
    week: fmtWeek(w.week_start),
    premium: w.premium ?? 0,
    close: w.close_rate_pct,
    leads: w.leads ?? 0,
    provisional: isWeekInProgress(w.week_start),
  }));
  const lsData = windowWeeksRows.map((w) => ({
    week: fmtWeek(w.week_start),
    leads: w.leads ?? 0,
    sales: w.sales ?? 0,
  }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
            Team Pulse
          </h1>
          <p className="text-sm text-mute">
            This week&apos;s live pace up top, then the settled box score, trailing window, and
            month-over-month.
          </p>
        </div>
        <TeamPulseControls weeksN={weeksN} options={TEAM_WINDOWS} />
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
        <SectionTitle
          sub={
            <HeaderTip
              label={`${windowCmp.current.weeks} settled weeks${
                windowCmp.prior
                  ? ` vs the prior ${windowCmp.prior.weeks}`
                  : " · no prior period yet"
              }`}
              tip="Totals are aggregate-then-rate: close rate is the period's total sales divided by its total leads, not the average of the weekly percentages (that would weight a 30-lead week like a 300-lead one). The in-progress week is excluded so a partial week can't read as a decline."
              align="right"
            />
          }
        >
          Trailing {windowCmp.current.weeks} Weeks
        </SectionTitle>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          <ScoreCell
            label="Leads"
            value={fmtInt(windowCmp.current.leads)}
            delta={<Delta value={windowCmp.delta.leadsPct} format={(v) => `${v.toFixed(1)}%`} />}
          />
          <ScoreCell
            label="Sales"
            value={fmtInt(windowCmp.current.sales)}
            delta={<Delta value={windowCmp.delta.salesPct} format={(v) => `${v.toFixed(1)}%`} />}
          />
          <ScoreCell
            label="Close rate"
            value={fmtPct(windowCmp.current.closeRatePct)}
            delta={
              <Delta value={windowCmp.delta.closeRatePts} format={(v) => `${v.toFixed(1)} pts`} />
            }
            sample={`${fmtInt(windowCmp.current.sales)}/${fmtInt(windowCmp.current.leads)} leads`}
          />
          <ScoreCell
            label="Premium"
            value={fmtMoney(windowCmp.current.premium)}
            delta={<Delta value={windowCmp.delta.premiumPct} format={(v) => `${v.toFixed(1)}%`} />}
          />
          <ScoreCell
            label="Premium / sale"
            value={fmtMoney(windowCmp.current.premiumPerSale)}
            delta={
              <Delta
                value={windowCmp.delta.premiumPerSalePct}
                format={(v) => `${v.toFixed(1)}%`}
              />
            }
          />
          <ScoreCell
            label="Premium / agent"
            value={fmtMoney(windowCmp.current.premiumPerAgent)}
            delta={
              <Delta
                value={windowCmp.delta.premiumPerAgentPct}
                format={(v) => `${v.toFixed(1)}%`}
              />
            }
            sample={
              windowCmp.current.avgActiveAgents != null
                ? `${windowCmp.current.avgActiveAgents.toFixed(1)} agents avg`
                : undefined
            }
          />
        </div>
        {!windowCmp.prior && (
          <p className="mt-3 text-[11px] text-faint">
            Deltas appear once there are {windowCmp.current.weeks * 2} settled weeks of history
            — comparing against a shorter prior period would overstate the swing.
          </p>
        )}
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
        <SectionTitle
          sub={
            <HeaderTip
              label="bucketed by the week's Monday · MoM vs prior month"
              tip="Weeks are Monday-anchored, so a week straddling the 1st lands wholly in the month its Monday falls in. These totals will NOT tie exactly to a calendar-month report out of ICD/AMS — that's expected; weekly and all-time are the exact grains. A month with fewer rows than it has Mondays is marked partial — that's the current month, and usually the first one too, since the warehouse history starts mid-month. Partial months get no MoM delta and aren't used as a baseline for the next month, so a short opening month can't manufacture a spike."
              align="right"
            />
          }
        >
          Month over Month
        </SectionTitle>
        <TeamTrendChart data={monthlyChart} />
        <div className="mt-4 overflow-x-auto">
          <table className="num w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                <th className="py-2 pr-4">Month</th>
                <th className="py-2 pr-4 text-right">Leads</th>
                <th className="py-2 pr-4 text-right">Sales</th>
                <th className="py-2 pr-4 text-right">Close</th>
                <th className="py-2 pr-4 text-right">Premium</th>
                <th className="py-2 pr-4 text-right">MoM premium</th>
                <th className="py-2 pr-4 text-right">$/sale</th>
                <th className="py-2 text-right">Agents</th>
              </tr>
            </thead>
            <tbody>
              {[...monthly].reverse().map((m) => (
                <tr key={m.month} className="border-b border-edge/50">
                  <td className="py-2 pr-4 text-ink">
                    {fmtMonth(m.month)}
                    {m.partial && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-warn">
                        partial · {m.weeks} wk
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right">{fmtInt(m.leads)}</td>
                  <td className="py-2 pr-4 text-right">{fmtInt(m.sales)}</td>
                  <td className="py-2 pr-4 text-right">
                    {fmtPct(m.closeRatePct)}
                    <span className="ml-1 text-[11px]">
                      <Delta value={m.momCloseRatePts} format={(v) => `${v.toFixed(1)}`} />
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right">{fmtMoney(m.premium)}</td>
                  <td className="py-2 pr-4 text-right">
                    <Delta value={m.momPremiumPct} format={(v) => `${v.toFixed(1)}%`} />
                  </td>
                  <td className="py-2 pr-4 text-right">{fmtMoney(m.premiumPerSale)}</td>
                  <td className="py-2 text-right text-mute">
                    {m.avgActiveAgents != null ? m.avgActiveAgents.toFixed(1) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <SectionTitle sub={`${weeksN} weeks · bars = premium ($), line = close rate (%) · faded bar = current week in progress`}>
          Premium & Close Trend
        </SectionTitle>
        <TeamTrendChart data={trendData} />
      </Panel>

      <Panel>
        <SectionTitle sub={`${weeksN} weeks · team totals`}>Leads vs Sales</SectionTitle>
        <LeadsSalesChart data={lsData} />
      </Panel>

      {roster && (
        <Panel>
          <SectionTitle sub={`roster movement across the trailing ${weeksN} settled weeks`}>
            Roster &amp; Coverage
          </SectionTitle>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
            <ScoreCell
              label="Active agents"
              value={fmtInt(roster.activeNow)}
              sample={
                roster.headcountFirst != null && roster.headcountLast != null
                  ? `${roster.headcountFirst} → ${roster.headcountLast} on the board`
                  : undefined
              }
            />
            <ScoreCell
              label="Started selling"
              value={fmtInt(roster.startedInWindow.length)}
              sample="in this window"
            />
            <ScoreCell
              label="Departed"
              value={fmtInt(roster.departedInWindow.length)}
              sample={`${fmtInt(roster.departedTotal)} logged in-app`}
            />
            <ScoreCell
              label="Top-3 share"
              value={fmtPct(roster.top3SharePct, 0)}
              sample="of window premium"
            />
            <ScoreCell
              label="Zero-sale agents"
              value={fmtInt(roster.zeroSaleAgents.length)}
              sample="had leads, no sales"
            />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <div className="display text-[10px] font-bold uppercase tracking-widest text-faint">
                New this window
              </div>
              {roster.startedInWindow.length === 0 ? (
                <p className="mt-1 text-xs text-faint">None.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs text-mute">
                  {roster.startedInWindow.map((a) => (
                    <li key={a.agent}>
                      <span className="text-ink">{a.agent}</span> · first week{" "}
                      {fmtWeek(a.startedOn)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="display text-[10px] font-bold uppercase tracking-widest text-faint">
                Departed this window
              </div>
              {roster.departedInWindow.length === 0 ? (
                <p className="mt-1 text-xs text-faint">None.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs text-mute">
                  {roster.departedInWindow.map((d) => (
                    <li key={d.agent}>
                      <span className="text-ink">{d.agent}</span>
                      {d.departedOn ? ` · ${fmtWeek(d.departedOn)}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="display text-[10px] font-bold uppercase tracking-widest text-faint">
                No sales in window
              </div>
              {roster.zeroSaleAgents.length === 0 ? (
                <p className="mt-1 text-xs text-faint">Everyone on the board sold.</p>
              ) : (
                <ul className="mt-1 space-y-1 text-xs text-mute">
                  {roster.zeroSaleAgents.map((a) => (
                    <li key={a} className="text-ink">
                      {a}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <p className="mt-3 text-[11px] text-faint">
            Headcount moves change every per-agent average, so read Premium / agent against the
            agent count beside it. Top-3 share is a concentration read — a high number means
            the period leans on a few people. Zero-sale counts only agents who were issued leads
            in the window, so someone mid-onboarding isn&apos;t flagged as a problem.
          </p>
          <p className="mt-2 text-[11px] text-faint">
            Departures count what&apos;s been marked departed on the Roster page (the app&apos;s own
            override ledger) &mdash; not company HR history, which the warehouse doesn&apos;t carry.
            Anyone who left before the team started using that page won&apos;t appear here.
          </p>
        </Panel>
      )}
    </div>
  );
}
