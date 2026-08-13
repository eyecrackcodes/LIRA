import { redirect } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { getActiveAgents, getCloseEffort, getLeadSources } from "@/lib/queries";
import { fmtInt, fmtMoney, fmtMonth, fmtPct, fmtWeek } from "@/lib/format";
import { HeaderTip, Panel, SectionTitle } from "@/components/ui";
import { EffortScatter, SourceMixChart, type EffortPoint } from "@/components/charts";
import SourceFlowChart from "@/components/SourceFlowChart";
import { buildLeadFlow, foldSourceGroups, MAX_SOURCES } from "@/lib/leadflow";

export const revalidate = 900;

export default async function CloseDiagnosticsPage() {
  if (!(await requireManager())) redirect("/"); // lead costs/CPL — manager-only
  const [effort, monthSources, weekSources, activeAgents] = await Promise.all([
    getCloseEffort({ sinceDays: 56 }),
    getLeadSources("month", 210),
    getLeadSources("week", 14),
    getActiveAgents(),
  ]);
  const activeSet = new Set(activeAgents.map((a) => a.agent));

  // Warehouse anchors are clean Mondays since the 2026-07-11 hardening; this
  // latest-anchor filter is purely defensive (contract: costs nothing).
  const latestWeekAnchor = weekSources.reduce(
    (max, s) => (s.period_start > max ? s.period_start : max),
    ""
  );
  const currentWeekRows = weekSources.filter((s) => s.period_start === latestWeekAnchor);

  const points: EffortPoint[] = effort
    .filter((e) => activeSet.has(e.agent))
    .filter((e) => (e.leads ?? 0) > 0 && e.leads_per_day != null && e.close_rate_pct != null)
    .map((e) => ({
      agent: e.agent,
      week: fmtWeek(e.week_start),
      leadsPerDay: e.leads_per_day!,
      close: e.close_rate_pct!,
      talkPerDial: e.talk_min_per_dial,
      leads: e.leads ?? 0,
    }));

  // Lead mix by source_group: monthly backfill buckets + the current week's
  // partial bucket. Each bucket aggregates within a single grain; the chart
  // shows share-of-period so the partial week is comparable.
  const allSourceRows = [...monthSources, ...currentWeekRows];

  // The lead-source taxonomy was enriched to 90+ sources across a dozen groups.
  // Rendering a band per group would push well past the ~7 classes a reader can
  // tell apart (and past the categorical palette), so the tail folds into
  // "Other" — one gray band — instead of inventing indistinguishable hues.
  // Selection is by total leads across the whole window, so a band doesn't
  // appear and vanish between buckets.
  const leadsByGroup = new Map<string, number>();
  for (const s of allSourceRows) {
    const g = s.source_group ?? "Other";
    leadsByGroup.set(g, (leadsByGroup.get(g) ?? 0) + (s.leads ?? 0));
  }
  const { keep: keptGroups, colorOf: GROUP_COLORS, folded } = foldSourceGroups(leadsByGroup);
  const keptSet = new Set(keptGroups);
  const groupOf = (g: string) => (keptSet.has(g) ? g : "Other");
  const groups = [...keptGroups, ...(folded.length ? ["Other"] : [])];

  const bucketOf = (row: (typeof allSourceRows)[number]) =>
    row.grain === "month" ? fmtMonth(row.period_start) : `wk ${fmtWeek(latestWeekAnchor)}`;
  const bucketKeys: string[] = [];
  const byBucket = new Map<string, Record<string, number>>();
  for (const s of allSourceRows) {
    const b = bucketOf(s);
    if (!byBucket.has(b)) {
      byBucket.set(b, {});
      bucketKeys.push(b);
    }
    const g = groupOf(s.source_group ?? "Other");
    byBucket.get(b)![g] = (byBucket.get(b)![g] ?? 0) + (s.leads ?? 0);
  }
  // Zero-fill every series in every bucket. A stacked area breaks wherever a
  // key is absent rather than 0, so a group that didn't appear in one bucket
  // tore a hole through the band — which looked like "we bought no leads that
  // week" instead of "this source had none".
  const mixData = bucketKeys.map((b) => {
    const row: Record<string, string | number> = { week: b };
    for (const g of groups) row[g] = byBucket.get(b)?.[g] ?? 0;
    return row;
  });

  // Lead flow for the latest SETTLED week. Deliberately not the current week:
  // leads land before they close, so a partial week draws every sale ribbon
  // too thin and would read as a conversion collapse.
  const flow = buildLeadFlow(weekSources);

  const ctvShare = (b: string) => {
    const c = byBucket.get(b);
    if (!c) return null;
    const total = Object.values(c).reduce((a, v) => a + v, 0);
    return total ? (100 * (c["CTV"] ?? 0)) / total : null;
  };
  const latestShare = bucketKeys.length ? ctvShare(bucketKeys[bucketKeys.length - 1]) : null;
  const priorShare = bucketKeys.length >= 2 ? ctvShare(bucketKeys[bucketKeys.length - 2]) : null;

  // latest-week effort table
  const latestWeek = effort.length ? effort[effort.length - 1].week_start : null;
  const latestRows = effort
    .filter((e) => e.week_start === latestWeek && activeSet.has(e.agent))
    .sort((a, b) => (b.close_rate_pct ?? -1) - (a.close_rate_pct ?? -1));

  // RPA hrs/day = weekly RPA ÷ active days (never averaged from per-agent rates)
  const rpaPerDay = (rpaMin: number | null, days: number | null) =>
    rpaMin != null && days ? rpaMin / 60 / days : null;

  const teamTotals = latestRows.reduce(
    (t, e) => ({
      leads: t.leads + (e.leads ?? 0),
      sales: t.sales + (e.sales ?? 0),
      dials: t.dials + (e.dials ?? 0),
      talkMin: t.talkMin + (e.crm_talk_min ?? 0),
      rpaMin: t.rpaMin + (e.rpa_min ?? 0),
      activeDays: t.activeDays + (e.active_days ?? 0),
    }),
    { leads: 0, sales: 0, dials: 0, talkMin: 0, rpaMin: 0, activeDays: 0 }
  );
  const team = {
    close: teamTotals.leads ? (100 * teamTotals.sales) / teamTotals.leads : null,
    leadsPerDay: teamTotals.activeDays ? teamTotals.leads / teamTotals.activeDays : null,
    talkPerDial: teamTotals.dials ? teamTotals.talkMin / teamTotals.dials : null,
    rpaHrsPerDay: rpaPerDay(teamTotals.rpaMin, teamTotals.activeDays),
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
          Close-Rate Diagnostics
        </h1>
        <p className="text-sm text-mute">
          Why did close move? Volume-per-day vs conversion, talk quality, and lead-source mix.
        </p>
      </header>

      <Panel>
        <SectionTitle sub="last 8 weeks · one dot per agent-week · bubble size = talk min/dial">
          Leads/Day vs Close Rate
        </SectionTitle>
        <EffortScatter data={points} />
        <p className="mt-2 text-[11px] text-faint">
          The flood signature: dots drift right (more leads/day), shrink (less talk per dial), and
          fall (close drops). June 2026 CTV week looked exactly like this.
        </p>
      </Panel>

      {flow.periodStart && (
        <Panel>
          <SectionTitle
            sub={
              <HeaderTip
                label={`week of ${fmtWeek(flow.periodStart)} · ${fmtInt(flow.totals.leads)} leads → ${fmtInt(flow.totals.sales)} sales · ${fmtPct(flow.totals.closePct)}`}
                tip="The latest SETTLED week — the in-progress week is excluded on purpose, because leads arrive before they close and a partial week would draw every sale ribbon too thin. Block height is leads; the ribbon into Sold is that source's sales. Rates are total sales ÷ total leads per source, never an average of agent rates."
                align="right"
              />
            }
          >
            Lead Flow — Source to Outcome
          </SectionTitle>
          <SourceFlowChart
            data={flow.sources}
            totalLeads={flow.totals.leads}
            totalSales={flow.totals.sales}
          />

          {/* Table view: the numbers behind the ribbons. Also what makes the
              light-mode palette compliant — three of its series colors sit just
              under 3:1 on white, which is permitted only where the values are
              legible as text too. */}
          <div className="mt-4 overflow-x-auto">
            <table className="num w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4 text-right">Leads</th>
                  <th className="py-2 pr-4 text-right">Share</th>
                  <th className="py-2 pr-4 text-right">Sales</th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Close"
                      tip="Sales ÷ leads for this source this week. Compare against the team row: a source below it is diluting close rate, one above is carrying it."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">Spend</th>
                  <th className="py-2 text-right">
                    <HeaderTip
                      label="Cost/sale"
                      tip="Lead spend ÷ sales. Blank where the source carries no cost-per-lead in dim_lead_source — those leads bill as $0, so a missing CPL makes a source look free rather than cheap."
                      align="right"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-edge bg-navy/40">
                  <td className="display py-2 pr-4 font-bold uppercase tracking-wider text-gold">
                    Team
                  </td>
                  <td className="py-2 pr-4 text-right">{fmtInt(flow.totals.leads)}</td>
                  <td className="py-2 pr-4 text-right text-faint">100%</td>
                  <td className="py-2 pr-4 text-right">{fmtInt(flow.totals.sales)}</td>
                  <td className="py-2 pr-4 text-right">{fmtPct(flow.totals.closePct)}</td>
                  <td className="py-2 pr-4 text-right">{fmtMoney(flow.totals.cost)}</td>
                  <td className="py-2 text-right">
                    {flow.totals.costPerSale != null ? fmtMoney(flow.totals.costPerSale) : "—"}
                  </td>
                </tr>
                {flow.sources.map((s) => (
                  <tr key={s.key} className="border-b border-edge/50">
                    <td className="py-2 pr-4 text-ink">
                      <span
                        aria-hidden
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-xs align-middle"
                        style={{ background: s.color }}
                      />
                      {s.key}
                      {/* Named in one template literal: split across JSX lines
                          the pluralizing "s" gets its own text node and renders
                          as "source s". The warehouse's own "Other" group is
                          dropped from the list — naming Other inside Other is
                          noise, and the count still covers it. */}
                      {s.isOther &&
                        (() => {
                          const named = s.folded.filter((f) => f !== "Other");
                          if (named.length === 0) return null;
                          return (
                            <span className="ml-2 text-[11px] text-faint">
                              {`incl. ${named.join(", ")}`}
                            </span>
                          );
                        })()}
                    </td>
                    <td className="py-2 pr-4 text-right">{fmtInt(s.leads)}</td>
                    <td className="py-2 pr-4 text-right text-faint">
                      {fmtPct((100 * s.leads) / flow.totals.leads, 0)}
                    </td>
                    <td className="py-2 pr-4 text-right">{fmtInt(s.sales)}</td>
                    <td
                      className={`py-2 pr-4 text-right ${
                        s.closePct != null &&
                        flow.totals.closePct != null &&
                        s.closePct < flow.totals.closePct
                          ? "text-down"
                          : ""
                      }`}
                    >
                      {fmtPct(s.closePct)}
                    </td>
                    <td className="py-2 pr-4 text-right">{fmtMoney(s.cost)}</td>
                    <td className="py-2 text-right">
                      {s.leadsWithoutCost > 0 ? (
                        <span
                          className="text-warn"
                          title={`${fmtInt(s.leadsWithoutCost)} of this source's leads have no cost_per_lead, so spend is understated.`}
                        >
                          partial
                        </span>
                      ) : s.costPerSale != null ? (
                        fmtMoney(s.costPerSale)
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-faint">
            Read the mismatch, not the size: a tall block with a thin Sold ribbon is buying
            volume that isn&apos;t converting. Sources are folded to the top {MAX_SOURCES} by
            leads because past ~7 colors adjacent bands stop being distinguishable — the rest
            are listed inside the Other row.
            {flow.totals.leadsWithoutCost > 0 && (
              <>
                {" "}
                {fmtInt(flow.totals.leadsWithoutCost)} lead
                {flow.totals.leadsWithoutCost === 1 ? "" : "s"} this week carry no cost-per-lead
                in <code>dim_lead_source</code>, so Spend and Cost/sale are understated for the
                rows marked <span className="text-warn">partial</span>.
              </>
            )}
          </p>
        </Panel>
      )}

      <Panel>
        <SectionTitle
          sub={
            latestShare != null
              ? `CTV share this week ${latestShare.toFixed(0)}%${priorShare != null ? ` · prior month ${priorShare.toFixed(0)}%` : ""}`
              : undefined
          }
        >
          Lead-Source Mix (share of leads)
        </SectionTitle>
        <SourceMixChart data={mixData} groups={groups} colors={GROUP_COLORS} />
        <p className="mt-2 text-[11px] text-faint">
          Monthly buckets from the backfill, plus the current (partial) week — grains are never
          summed together. A fast-rising CTV band is the early flood warning. Bands are the top{" "}
          {MAX_SOURCES} groups by leads over the whole window; smaller groups are pooled into
          Other so the same source keeps the same color in every bucket.
        </p>
      </Panel>

      <Panel>
        <SectionTitle sub={latestWeek ? `week of ${fmtWeek(latestWeek)}` : undefined}>
          Effort Board — Latest Week
        </SectionTitle>
        <div className="overflow-x-auto">
          <table className="num w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                <th className="py-2 pr-4">Agent</th>
                <th className="py-2 pr-4 text-right">
                  <HeaderTip
                    label="Close"
                    tip="Sales ÷ leads this week (sales/leads shown in parentheses). The team row aggregates totals first — never an average of agent rates."
                    align="right"
                  />
                </th>
                <th className="py-2 pr-4 text-right">
                  <HeaderTip label="Leads" tip="Billable leads received this week." align="right" />
                </th>
                <th className="py-2 pr-4 text-right">
                  <HeaderTip
                    label="Leads/day"
                    tip="Leads ÷ active days. A sudden jump is the flood signature — expect close to dip with it."
                    align="right"
                  />
                </th>
                <th className="py-2 pr-4 text-right">
                  <HeaderTip label="Dials" tip="Total CRM dials this week." align="right" />
                </th>
                <th className="py-2 pr-4 text-right">
                  <HeaderTip
                    label="Talk/dial"
                    tip="CRM talk minutes per dial — conversation depth. Falls during a lead flood as calls get spread thin."
                    align="right"
                  />
                </th>
                <th className="py-2 pr-4 text-right">
                  <HeaderTip
                    label="RPA hrs/day"
                    tip="Weekly RPA (revenue-producing activity) hours ÷ active days. RPA model: 1 CRM dial = 1 minute plus a dial-quality adjustment."
                    align="right"
                  />
                </th>
                <th className="py-2 text-right">
                  <HeaderTip
                    label="Active days"
                    tip="Days this week with any RPA activity logged."
                    align="right"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-edge bg-navy/40">
                <td className="display py-2 pr-4 font-bold uppercase tracking-wider text-gold">
                  Team
                </td>
                <td className="py-2 pr-4 text-right">
                  {fmtPct(team.close)}{" "}
                  <span className="text-faint">
                    ({fmtInt(teamTotals.sales)}/{fmtInt(teamTotals.leads)})
                  </span>
                </td>
                <td className="py-2 pr-4 text-right">{fmtInt(teamTotals.leads)}</td>
                <td className="py-2 pr-4 text-right">{team.leadsPerDay?.toFixed(1) ?? "—"}</td>
                <td className="py-2 pr-4 text-right">{fmtInt(teamTotals.dials)}</td>
                <td className="py-2 pr-4 text-right">{team.talkPerDial?.toFixed(2) ?? "—"}</td>
                <td className="py-2 pr-4 text-right">{team.rpaHrsPerDay?.toFixed(1) ?? "—"}</td>
                <td className="py-2 text-right">{fmtInt(teamTotals.activeDays)}</td>
              </tr>
              {latestRows.map((e) => (
                <tr key={e.agent} className="border-b border-edge/50">
                  <td className="py-2 pr-4 text-ink">{e.agent}</td>
                  <td className="py-2 pr-4 text-right">
                    {fmtPct(e.close_rate_pct)}{" "}
                    <span className="text-faint">
                      ({fmtInt(e.sales)}/{fmtInt(e.leads)})
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right">{fmtInt(e.leads)}</td>
                  <td className="py-2 pr-4 text-right">{e.leads_per_day?.toFixed(1) ?? "—"}</td>
                  <td className="py-2 pr-4 text-right">{fmtInt(e.dials)}</td>
                  <td className="py-2 pr-4 text-right">{e.talk_min_per_dial?.toFixed(2) ?? "—"}</td>
                  <td className="py-2 pr-4 text-right">
                    {rpaPerDay(e.rpa_min, e.active_days)?.toFixed(1) ?? "—"}
                  </td>
                  <td className="py-2 text-right">{fmtInt(e.active_days)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-faint">
          RPA hrs/day = weekly RPA ÷ active days; the team row aggregates totals first (never an
          average of agent rates). Board is for coaching, not shaming — low close with low
          leads/day and high talk/dial is a different conversation than low close on a flood week.
        </p>
      </Panel>
    </div>
  );
}
