import Link from "next/link";
import { getViewer, isManager } from "@/lib/auth";
import { getActiveAgents, getAgentUwLedger, getTeamUwLedger, getUwMixWeekAgent } from "@/lib/queries";
import type { UwLedgerRow, UwMixWeekRow } from "@/lib/queries";
import { computeUwMix, computeUwByMonth, pivotUwWeekMix } from "@/lib/underwriting";
import {
  buildAgentTrends,
  coerceTrendWeeks,
  TREND_RANGES,
  MIN_LEADS_SAMPLE,
  MIN_SCRIPT_SAMPLE,
} from "@/lib/trends";
import { PLC_MIN_MATURITY_PCT } from "@/lib/ratings";
import { agentSlug, fmtInt, fmtPct, fmtMonth, fmtMoney, fmtWeek } from "@/lib/format";
import { Panel, SectionTitle, StatTile, Delta, HeaderTip } from "@/components/ui";
import { TrendChart, CohortPlaceRateChart, UwMixChart } from "@/components/charts";
import { C } from "@/lib/theme-colors";
import TrendsControls from "@/components/TrendsControls";
import AgentAvatar from "@/components/AgentAvatar";

export const dynamic = "force-dynamic";

const money0 = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
const hrs1 = (v: number) => `${v.toFixed(1)} hrs`;
const grade = (v: number) => v.toFixed(2);
const pctFraction = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; weeks?: string }>;
}) {
  const [viewer, agents] = await Promise.all([getViewer(), getActiveAgents()]);
  const { agent: agentParam, weeks: weeksParam } = await searchParams;
  const weeksN = coerceTrendWeeks(Number(weeksParam));

  const isAgentViewer = viewer?.role === "agent" && !!viewer.agent;
  const dropdownAgents = isAgentViewer ? agents.filter((a) => a.agent === viewer!.agent) : agents;

  if (!dropdownAgents.length) {
    return <div className="text-sm text-mute">No active agents on the roster yet.</div>;
  }

  const requestedSlug = agentParam ?? agentSlug(dropdownAgents[0].agent);
  const resolved =
    dropdownAgents.find((a) => agentSlug(a.agent) === requestedSlug) ?? dropdownAgents[0];

  // Net effective rate / UW-mix are commission-derived (P&L). Per the role model
  // (auth.ts) the agent-safe app carries NO commissions/P&L — and Trends is a
  // shared surface, so keeping this manager-only prevents pay verbiage or
  // team-aggregate economics from ever reaching an agent's peer group. Agents get
  // their own pay economics privately through the RLS'd Coach book instead.
  const managerView = isManager(viewer);
  const [t, uwLedger, teamUwLedger, uwMixWeek] = await Promise.all([
    buildAgentTrends(resolved.agent, weeksN),
    managerView ? getAgentUwLedger(resolved.agent) : Promise.resolve<UwLedgerRow[]>([]),
    managerView ? getTeamUwLedger() : Promise.resolve<UwLedgerRow[]>([]),
    managerView ? getUwMixWeekAgent(resolved.agent) : Promise.resolve<UwMixWeekRow[]>([]),
  ]);
  const uwMix = computeUwMix(uwLedger);

  // Month-over-month UW trend (statement month — the finest grain the ledger
  // carries; see computeUwByMonth). Team line is blended over the ACTIVE roster
  // only, aggregated here so no individual pay ever reaches the client.
  const activeSet = new Set(agents.map((a) => a.agent));
  const agentByMonth = new Map(computeUwByMonth(uwLedger).map((p) => [p.month, p]));
  const teamMonthly = computeUwByMonth(teamUwLedger.filter((r) => r.agent && activeSet.has(r.agent)));
  const teamByMonth = new Map(teamMonthly.map((p) => [p.month, p]));
  const uwMonths = teamMonthly.map((p) => p.month).slice(-12);
  const netEffData = uwMonths.map((m) => ({
    week: fmtMonth(m),
    agent: agentByMonth.get(m)?.netEffRatePct ?? null,
    team: teamByMonth.get(m)?.netEffRatePct ?? null,
  }));
  // Underwriting mix is now TRUE weekly — bucketed on day-grain inforce_date via
  // v_uw_mix_week_agent (net effective rate stays monthly on the paycheck-exact
  // ledger). Windowed to the same range selector as the other weekly charts.
  const mixData = pivotUwWeekMix(uwMixWeek)
    .slice(-weeksN)
    .map((p) => ({
      week: fmtWeek(p.week_start),
      Level: p.Level,
      Term: p.Term,
      Graded: p.Graded,
      GI: p.GI,
      Other: p.Other,
    }));

  const rangeLabel = TREND_RANGES.find((r) => r.weeks === weeksN)!.label.toLowerCase();

  const chartData = t.weeks.map((w) => ({
    week: w.weekLabel,
    closeRate: w.closeRate,
    teamCloseRate: w.teamCloseRate,
    premium: w.premium,
    teamPremiumPerAgent: w.teamPremiumPerAgent,
    premiumPerSale: w.premiumPerSale,
    teamPremiumPerSale: w.teamPremiumPerSale,
    leadsPerDay: w.leadsPerDay,
    teamLeadsPerDay: w.teamLeadsPerDay,
    rpaHrsPerDay: w.rpaHrsPerDay,
    teamRpaHrsPerDay: w.teamRpaHrsPerDay,
    scriptAdherence: w.scriptAdherence,
    teamScriptAdherence: w.teamScriptAdherence,
    hp: w.hp,
  }));

  const smallLeadSample = t.current.leads < MIN_LEADS_SAMPLE;
  const smallScriptSample = t.current.scriptCalls < MIN_SCRIPT_SAMPLE;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
            Performance Trends
          </h1>
          <p className="text-sm text-mute">
            1:1 prep — {rangeLabel}, compared against the same-length period before it.{" "}
            <span className="text-faint">Dashed lines are the active-team benchmark.</span>
          </p>
        </div>
        <TrendsControls
          agents={dropdownAgents}
          currentSlug={agentSlug(resolved.agent)}
          weeksN={weeksN}
          rangeOptions={TREND_RANGES}
          locked={isAgentViewer}
        />
      </header>

      <Panel>
        <div className="flex flex-wrap items-center gap-4">
          <AgentAvatar agent={resolved.agent} size={56} />
          <div>
            <div className="display flex items-center gap-2 text-xl font-bold text-ink">
              <Link href={`/roster/${agentSlug(resolved.agent)}`} className="hover:text-gold">
                {resolved.agent}
              </Link>
              {resolved.status === "departed" && (
                <span className="display rounded-sm border border-edge px-2 py-0.5 text-[10px] uppercase tracking-widest text-faint">
                  Departed
                </span>
              )}
            </div>
            <div className="text-xs text-faint">
              {t.tenureMo != null ? `${t.tenureMo} mo tenure` : "tenure —"}
              {t.tenureMo != null && t.tenureMo < 3 && (
                <span className="ml-2 text-mute">
                  — new hire: judge on effort/script leading indicators, not trailing $$$.
                </span>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatTile
          label="Premium"
          value={money0(t.current.premium)}
          delta={<Delta value={t.current.premiumDeltaPct} format={(v) => `${v.toFixed(1)}%`} />}
          sample={`${t.current.weeksWithData}wk`}
        />
        <StatTile
          label="Sales"
          value={fmtInt(t.current.sales)}
          delta={<Delta value={t.current.salesDeltaPct} format={(v) => `${v.toFixed(1)}%`} />}
        />
        <StatTile
          label="Close rate"
          value={
            <>
              {fmtPct(t.current.closeRate)}
              {smallLeadSample && <span className="ml-1 text-xs text-warn">small n</span>}
            </>
          }
          delta={<Delta value={t.current.closeRateDeltaPts} format={(v) => `${v.toFixed(1)} pts`} />}
          sample={`${fmtInt(t.current.leads)} leads`}
        />
        <StatTile
          label="Avg $/sale"
          value={t.current.premiumPerSale != null ? money0(t.current.premiumPerSale) : "—"}
          delta={<Delta value={t.current.premiumPerSaleDeltaPct} format={(v) => `${v.toFixed(1)}%`} />}
        />
        <StatTile
          label="Leads/day"
          value={t.current.leadsPerDay != null ? t.current.leadsPerDay.toFixed(1) : "—"}
          delta={<Delta value={t.current.leadsPerDayDeltaPct} format={(v) => `${v.toFixed(1)}%`} />}
        />
        <StatTile
          label="RPA hrs/day"
          value={t.current.rpaHrsPerDay != null ? hrs1(t.current.rpaHrsPerDay) : "—"}
          delta={<Delta value={t.current.rpaHrsPerDayDeltaPct} format={(v) => `${v.toFixed(1)}%`} />}
        />
        <StatTile
          label="Script adherence"
          value={
            <>
              {t.current.scriptAdherence != null ? grade(t.current.scriptAdherence) : "—"}
              {smallScriptSample && <span className="ml-1 text-xs text-warn">small n</span>}
            </>
          }
          delta={<Delta value={t.current.scriptAdherenceDeltaPts} format={(v) => `${v.toFixed(2)} pts`} />}
          sample={`${fmtInt(t.current.scriptCalls)} graded calls`}
        />
      </div>

      {t.efficiency && (
        <Panel>
          <SectionTitle
            sub={
              <HeaderTip
                label={t.efficiency.month ? `as of ${fmtMonth(t.efficiency.month)}` : "current snapshot"}
                tip="From the nightly efficiency scorecard — a single current snapshot, not a weekly history, and never windowed to the date range above."
                align="right"
              />
            }
          >
            Efficiency Snapshot
          </SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <div className="display text-xs uppercase tracking-widest text-faint">Tier</div>
              <div className="display text-lg font-bold text-gold">{t.efficiency.tier ?? "—"}</div>
            </div>
            <div>
              <div className="display text-xs uppercase tracking-widest text-faint">
                <HeaderTip
                  label="Validifi rate"
                  tip="Bank verifications ÷ sales. Floor 0.80 — below that predicts placement/chargeback trouble in 30–60 days."
                />
              </div>
              <div className="num display text-lg font-bold text-ink">
                {pctFraction(t.efficiency.validifiRatePct)}
              </div>
            </div>
            <div>
              <div className="display text-xs uppercase tracking-widest text-faint">
                <HeaderTip
                  label="Baked place rate"
                  tip={`Placed ÷ submitted, counting only cohorts ≥${PLC_MIN_MATURITY_PCT}% matured — the trusted number.`}
                />
              </div>
              <div className="num display text-lg font-bold text-ink">
                {pctFraction(t.efficiency.bakedPlaceRatePct)}
              </div>
            </div>
            <div>
              <div className="display text-xs uppercase tracking-widest text-faint">
                <HeaderTip label="True HP" tip="Hourly premium × place rate — output speed discounted by placement quality." />
              </div>
              <div className="num display text-lg font-bold text-gold">
                {t.efficiency.trueHp != null ? `$${Math.round(t.efficiency.trueHp)}/hr` : "—"}
              </div>
            </div>
          </div>
        </Panel>
      )}

      {managerView && (uwMonths.length > 0 || mixData.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {uwMonths.length > 0 && (
            <Panel>
              <SectionTitle sub="blended net commission ÷ premium, by statement month · dashed = active-team average">
                Net Effective Rate by Month
              </SectionTitle>
              <TrendChart
                data={netEffData}
                format="pct1"
                series={[
                  { key: "agent", name: resolved.agent, color: C.gold },
                  { key: "team", name: "Team avg", color: C.blue, dashed: true },
                ]}
              />
              <p className="mt-2 text-[11px] text-faint">
                Driven by the 30% vs 15% mix (graded and guaranteed-issue products pay 15%; most
                else pays 30%), net of chargebacks. Statement month — commission_ledger is the
                paycheck-exact source of truth, so this stays monthly by design.
              </p>
            </Panel>
          )}

          {mixData.length > 0 && (
            <Panel>
              <SectionTitle sub="policy share by UW class, by placement (inforce) week">
                Underwriting Mix by Week
              </SectionTitle>
              <UwMixChart data={mixData} />
              <p className="mt-2 text-[11px] text-faint">
                True weekly cut — policies bucketed on day-grain inforce date (Agent Policy
                Detail). Level &amp; Term pay 30%; Graded &amp; GI are the 15% classes, so more
                Level/Term lifts the net effective rate. Low-volume weeks swing hard (a 2-policy
                week reads 50/50), and the newest week or two can still shift as AMS settles.
              </p>
            </Panel>
          )}
        </div>
      )}

      {managerView && uwMix.totalPolicies > 0 && (
        <Panel>
          <SectionTitle sub="entire book · net effective = net commission ÷ commissionable premium (after chargebacks)">
            Underwriting Mix &amp; Net Effective Rate
          </SectionTitle>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span className="num display text-4xl font-bold text-gold">
              {fmtPct(uwMix.blendedNetEffRatePct, 1)}
            </span>
            <span className="num text-sm text-mute">
              blended net effective rate · {fmtMoney(uwMix.totalNet)} net on{" "}
              {fmtMoney(uwMix.totalCommPremium)} premium · {fmtInt(uwMix.totalPolicies)} policies
            </span>
            <span className="num text-sm text-mute">
              <HeaderTip
                label={`gross ${fmtPct(uwMix.blendedGrossEffRatePct, 1)}`}
                tip="Gross commission ÷ commissionable premium, before chargebacks. The gap to net effective is chargeback drag."
              />
            </span>
            {uwMix.unclassifiedPct > 0 && (
              <span className="num text-sm text-warn">
                {fmtInt(uwMix.unclassifiedPolicies)} unclassified ({fmtPct(uwMix.unclassifiedPct, 1)})
              </span>
            )}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="num w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                  <th className="py-2 pr-4">UW type</th>
                  <th className="py-2 pr-4 text-right">Policies</th>
                  <th className="py-2 pr-4 text-right">% book</th>
                  <th className="py-2 pr-4 text-right">Premium</th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Net eff."
                      tip="Net commission (after chargebacks) ÷ commissionable premium — what you keep on each premium dollar for this class."
                      align="right"
                    />
                  </th>
                  <th className="py-2 text-right">
                    <HeaderTip
                      label="CB drag"
                      tip="Chargebacks as a share of gross commission for this class. More negative = more clawback."
                      align="right"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {uwMix.buckets.map((b) => (
                  <tr key={b.label} className="border-b border-edge/50">
                    <td className={`py-2 pr-4 ${b.unclassified ? "text-warn" : "text-ink"}`}>
                      {b.label}
                    </td>
                    <td className="py-2 pr-4 text-right">{fmtInt(b.policies)}</td>
                    <td className="py-2 pr-4 text-right text-mute">{fmtPct(b.pctPolicies, 1)}</td>
                    <td className="py-2 pr-4 text-right">{fmtMoney(b.commPremium)}</td>
                    <td className="py-2 pr-4 text-right font-semibold text-ink">
                      {fmtPct(b.netEffRatePct, 1)}
                    </td>
                    <td className={`py-2 text-right ${(b.chargebackDragPct ?? 0) < 0 ? "text-down" : "text-faint"}`}>
                      {b.chargebackDragPct != null ? fmtPct(b.chargebackDragPct, 1) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-faint">
            Skewing toward Level (vs GI/Graded) lifts your net effective rate and cuts chargeback
            drag. Whole-book figure — not windowed to the date range above.
          </p>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle sub="sales ÷ leads, full-cycle CRM">Close Rate by Week</SectionTitle>
          <TrendChart
            data={chartData}
            format="pct1"
            series={[
              { key: "closeRate", name: resolved.agent, color: C.gold },
              { key: "teamCloseRate", name: "Team", color: C.blue, dashed: true },
            ]}
          />
        </Panel>

        <Panel>
          <SectionTitle sub="submitted premium">Premium by Week</SectionTitle>
          <TrendChart
            data={chartData}
            format="money0"
            series={[
              { key: "premium", name: resolved.agent, color: C.gold },
              { key: "teamPremiumPerAgent", name: "Team avg/agent", color: C.blue, dashed: true },
            ]}
          />
        </Panel>

        <Panel>
          <SectionTitle sub="premium ÷ sales">Avg $ per Sale by Week</SectionTitle>
          <TrendChart
            data={chartData}
            format="money0"
            series={[
              { key: "premiumPerSale", name: resolved.agent, color: C.gold },
              { key: "teamPremiumPerSale", name: "Team", color: C.blue, dashed: true },
            ]}
          />
        </Panel>

        <Panel>
          <SectionTitle sub="leads ÷ active days">Avg Daily Leads by Week</SectionTitle>
          <TrendChart
            data={chartData}
            format="num1"
            series={[
              { key: "leadsPerDay", name: resolved.agent, color: C.gold },
              { key: "teamLeadsPerDay", name: "Team", color: C.blue, dashed: true },
            ]}
          />
        </Panel>

        <Panel>
          <SectionTitle sub="revenue-producing activity ÷ active days">RPA Hrs/Day by Week</SectionTitle>
          <TrendChart
            data={chartData}
            format="hrs1"
            series={[
              { key: "rpaHrsPerDay", name: resolved.agent, color: C.gold },
              { key: "teamRpaHrsPerDay", name: "Team", color: C.blue, dashed: true },
            ]}
          />
        </Panel>

        <Panel>
          <SectionTitle sub="Attention AI call grading, 1–5 scale (call-weighted)">
            Script Adherence by Week
          </SectionTitle>
          <TrendChart
            data={chartData}
            format="grade"
            series={[
              { key: "scriptAdherence", name: resolved.agent, color: C.gold },
              { key: "teamScriptAdherence", name: "Team", color: C.blue, dashed: true },
            ]}
          />
          <p className="mt-2 text-[11px] text-faint">
            Sparse for some agents due to an upstream grading-coverage gap — near-empty weeks are
            a vendor issue, not agent behavior.
          </p>
        </Panel>

        <Panel>
          <SectionTitle sub="premium per hour worked">HP by Week</SectionTitle>
          <TrendChart
            data={chartData}
            format="moneyCents"
            series={[{ key: "hp", name: resolved.agent, color: C.gold }]}
          />
          <p className="mt-2 text-[11px] text-faint">
            Raw HP — the rate-tilted True HP (HP × place rate) is in the Efficiency Snapshot
            above and on the Stack Rank board.
          </p>
        </Panel>

        <Panel>
          <SectionTitle sub={`by submission month, not by week · matured ≥${PLC_MIN_MATURITY_PCT}%`}>
            Placement by Cohort
          </SectionTitle>
          {t.cohorts.length ? (
            <CohortPlaceRateChart data={t.cohorts} maturedThresholdPct={PLC_MIN_MATURITY_PCT} />
          ) : (
            <div className="flex h-[220px] items-center justify-center text-sm text-faint">
              No submission cohorts yet.
            </div>
          )}
          <p className="mt-2 text-[11px] text-faint">
            Faded bars are cohorts too young to trust. A later lapse is a chargeback, not an
            un-placement.
          </p>
        </Panel>
      </div>
    </div>
  );
}
