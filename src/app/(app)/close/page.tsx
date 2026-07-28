import { redirect } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { getActiveAgents, getCloseEffort, getLeadSources } from "@/lib/queries";
import { fmtInt, fmtMonth, fmtPct, fmtWeek } from "@/lib/format";
import { HeaderTip, Panel, SectionTitle } from "@/components/ui";
import { EffortScatter, SourceMixChart, type EffortPoint } from "@/components/charts";

export const revalidate = 900;

// Theme-token references (not literal hex) so the source-mix legend swatches
// stay visible across dark/light and shift to color-blind-safe hues too.
const GROUP_COLORS: Record<string, string> = {
  CTV: "var(--color-down)",
  Roku: "var(--color-warn)",
  "Paid Social": "var(--color-blue)",
  Direct: "var(--color-purple)",
  "Internal/Organic": "var(--color-up)",
  Other: "var(--color-faint)",
};

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
  const groups = [...new Set(allSourceRows.map((s) => s.source_group ?? "Other"))].sort(
    (a, b) => (GROUP_COLORS[a] ? 0 : 1) - (GROUP_COLORS[b] ? 0 : 1) || a.localeCompare(b)
  );
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
    const g = s.source_group ?? "Other";
    byBucket.get(b)![g] = (byBucket.get(b)![g] ?? 0) + (s.leads ?? 0);
  }
  const mixData = bucketKeys.map((b) => ({ week: b, ...byBucket.get(b)! }));

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
          summed together. A fast-rising CTV band is the early flood warning.
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
