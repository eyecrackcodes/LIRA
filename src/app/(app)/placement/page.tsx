import {
  getActiveAgents,
  getAgentWeeks,
  getDailyActivity,
  getPlacementCohorts,
  getPlacementCohortTeam,
  getClientPlacementAgent,
  getClientPlacementTeam,
} from "@/lib/queries";
import {
  buildRatings,
  tierColor,
  tierOf,
  NORM_WINDOW_WEEKS,
  PLC_MIN_MATURITY_PCT,
} from "@/lib/ratings";
import { fmtInt, fmtMonth, fmtPct } from "@/lib/format";
import { departedAgentSet } from "@/lib/roster";
import { HeaderTip, Panel, SectionTitle, Delta, TrendArrow } from "@/components/ui";

export const revalidate = 900;

/** Cell shade: hue from place rate (red→gold→green), alpha from maturity. */
function cellStyle(rate: number | null, maturity: number | null) {
  if (rate == null) return {};
  const alpha = Math.max(0.15, Math.min(1, (maturity ?? 0) / 100)) * 0.55;
  const color =
    rate >= 55 ? `rgba(61, 220, 142, ${alpha})` :
    rate >= 40 ? `rgba(233, 182, 75, ${alpha})` :
    `rgba(255, 107, 94, ${alpha})`;
  return { backgroundColor: color };
}

export default async function PlacementPage() {
  const [agents, weeks, days, cohorts, team, clientAgents, clientTeam] = await Promise.all([
    getActiveAgents(),
    getAgentWeeks({ sinceDays: NORM_WINDOW_WEEKS * 7 + 7 }),
    getDailyActivity({ sinceDays: NORM_WINDOW_WEEKS * 7 + 7 }),
    getPlacementCohorts(),
    getPlacementCohortTeam(),
    getClientPlacementAgent(),
    getClientPlacementTeam(),
  ]);

  // PLC ratings come from the same engine as the roster, so the tier chip here
  // matches the agent card exactly (raw = matured-cohort place rate).
  const ratings = buildRatings(weeks, cohorts, days, agents.map((a) => a.agent));
  const plcByAgent = new Map(ratings.map((r) => [r.agent, r.attrs.PLC]));

  const departed = await departedAgentSet();
  const active = cohorts.filter(
    (c) => c.agent_status === "active" && !departed.has(c.agent)
  );

  // Client-level capped placement — active roster only, best resolved rate first.
  const clientRows = clientAgents
    .filter((c) => c.agent_status === "active" && !departed.has(c.agent))
    .sort(
      (a, b) =>
        (b.capped_place_rate_resolved_pct ?? -1) - (a.capped_place_rate_resolved_pct ?? -1)
    );
  const months = [...new Set(active.map((c) => c.cohort_month))].sort().slice(-9);
  const visible = active.filter((c) => months.includes(c.cohort_month));
  const cell = new Map(visible.map((c) => [`${c.agent}|${c.cohort_month}`, c]));
  const teamVisible = team.filter((t) => months.includes(t.cohort_month));
  const teamCell = new Map(teamVisible.map((t) => [t.cohort_month, t]));

  // Capped client rate per agent, for the heatmap's comparison column. Keyed
  // off the same rows as the panel above so the two can never disagree.
  const cappedByAgent = new Map(clientRows.map((c) => [c.agent, c]));

  // Open pipeline per agent — pendings across every cohort, not just visible ones.
  const pendingByAgent = new Map<string, number>();
  for (const c of active) {
    pendingByAgent.set(c.agent, (pendingByAgent.get(c.agent) ?? 0) + (c.pending ?? 0));
  }

  // Stack the rows by PLC rating (baked place rate percentile), not the alphabet.
  const agentList = [...new Set(visible.map((c) => c.agent))].sort((a, b) => {
    const ra = plcByAgent.get(a)?.rating ?? -1;
    const rb = plcByAgent.get(b)?.rating ?? -1;
    if (rb !== ra) return rb - ra;
    return a.localeCompare(b);
  });

  const latestTeam = teamVisible[teamVisible.length - 1];
  const teamMaturity = latestTeam?.submissions
    ? (100 * ((latestTeam.placed ?? 0) + (latestTeam.declined ?? 0))) / latestTeam.submissions
    : null;
  const latestImmature = (teamMaturity ?? 0) < 70;
  const teamPending = latestTeam?.pending ?? null;

  // ── Company place rate (actualized) ──────────────────────────────────────
  // Aggregate-then-rate over TEAM cohorts (never averaged agent rates).
  // Headline = last 6 MATURED cohort months; young cohorts are excluded by
  // actual maturity (≥70% resolved, same rule as PLC) rather than by age —
  // cohorts bake faster than a calendar cutoff assumes (June 2026 was 90%
  // resolved within ~6 weeks). The 60-day age roll-off is shown alongside
  // as a reference definition.
  const withMaturity = team.map((t) => ({
    ...t,
    maturity: t.submissions
      ? (100 * ((t.placed ?? 0) + (t.declined ?? 0))) / t.submissions
      : 0,
  }));
  const agg = (rows: typeof withMaturity) => {
    const subs = rows.reduce((s, r) => s + (r.submissions ?? 0), 0);
    const placed = rows.reduce((s, r) => s + (r.placed ?? 0), 0);
    return { subs, placed, rate: subs > 0 ? (100 * placed) / subs : null };
  };
  const matured = withMaturity.filter((t) => t.maturity >= PLC_MIN_MATURITY_PCT);
  const last6 = matured.slice(-6);
  const company6 = agg(last6);
  const companyAll = agg(matured);
  const cutoff60 = new Date();
  cutoff60.setDate(cutoff60.getDate() - 60);
  const company60 = agg(
    withMaturity.filter((t) => new Date(t.cohort_month) <= cutoff60)
  );
  const last6Label = last6.length
    ? `${fmtMonth(last6[0].cohort_month)} – ${fmtMonth(last6[last6.length - 1].cohort_month)}`
    : "—";
  // Resolved rate = placed ÷ decided business (pendings excluded by
  // construction), so baking months can be included — same window as the
  // headline plus anything newer. Pendings resolving can only move it via
  // new declines; it never climbs just because the pipeline empties.
  const resolvedRows = last6.length
    ? withMaturity.filter((t) => t.cohort_month >= last6[0].cohort_month)
    : [];
  const resolvedPlaced = resolvedRows.reduce((s, r) => s + (r.placed ?? 0), 0);
  const resolvedDecided = resolvedRows.reduce(
    (s, r) => s + (r.placed ?? 0) + (r.declined ?? 0),
    0
  );
  const companyResolved = resolvedDecided > 0 ? (100 * resolvedPlaced) / resolvedDecided : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
          Placement Quality
        </h1>
        <p className="text-sm text-mute">
          Place rate by submission-month cohort. Cell shading fades with low maturity — a pale cell
          means the cohort isn&apos;t baked yet, not that the agent slumped.
        </p>
      </header>

      <Panel>
        <SectionTitle sub={`matured submission cohorts only (≥${PLC_MIN_MATURITY_PCT}% resolved) · aggregate placed ÷ submitted, never averaged agent rates`}>
          Company Place Rate
        </SectionTitle>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="num display text-5xl font-bold text-gold">
            {fmtPct(company6.rate)}
          </span>
          <span className="num text-sm text-mute">
            {fmtInt(company6.placed)}/{fmtInt(company6.subs)} placed · {last6Label}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-edge pt-3 text-sm">
          <span className="num text-mute">
            <HeaderTip
              label={`All-time (matured): ${fmtPct(companyAll.rate)}`}
              tip={`Every submission cohort ≥${PLC_MIN_MATURITY_PCT}% resolved since Jan 2025 — ${fmtInt(companyAll.placed)}/${fmtInt(companyAll.subs)} placed. Includes the smaller 2025-era team.`}
            />
          </span>
          <span className="num text-mute">
            <HeaderTip
              label={`60-day roll-off: ${fmtPct(company60.rate)}`}
              tip={`Reference definition — cohorts that started ≥60 days ago (${fmtInt(company60.placed)}/${fmtInt(company60.subs)} placed). Age is a proxy for maturity; the headline uses actual maturity instead, which keeps nearly-settled recent months.`}
            />
          </span>
          <span className="num text-mute">
            <HeaderTip
              label={`Resolved rate: ${fmtPct(companyResolved)}`}
              tip={`Placed ÷ (placed + declined) = ${fmtInt(resolvedPlaced)}/${fmtInt(resolvedDecided)} since ${last6.length ? fmtMonth(last6[0].cohort_month) : "—"}, incl. the baking month. Placed = the policy has EVER been inforce (a later lapse is a chargeback, not an un-place); declines count AGAINST this rate. Pendings are excluded until they get a final answer — that's the only difference from the headline, which treats a pending as a miss-so-far.`}
            />
          </span>
        </div>
        <p className="mt-2 text-[11px] text-faint">
          The headline is the trailing six matured cohort months — young cohorts are excluded by
          how resolved they actually are, not by age, so a fast-baking month counts as soon as
          it&apos;s trustworthy. The current month lives in the snapshot below until it matures.
        </p>
      </Panel>

      {clientTeam && (
        <Panel>
          <SectionTitle sub="client-level · a client is placed if ANY of their policies has ever been inforce, capped at 100% per household — not the per-policy cohort rate above">
            Client Place Rate (Capped)
          </SectionTitle>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span className="num display text-5xl font-bold text-gold">
              {fmtPct(clientTeam.capped_place_rate_resolved_pct)}
            </span>
            <span className="num text-sm text-mute">
              Capped Place Rate (Resolved) · n={fmtInt(clientTeam.resolved_clients)} ·{" "}
              {fmtPct(clientTeam.maturity_pct, 1)} mature
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-edge pt-3 text-sm">
            <span className="num text-mute">
              <HeaderTip
                label={`Capped Place Rate: ${fmtPct(clientTeam.capped_place_rate_pct)}`}
                tip={`All ${fmtInt(clientTeam.clients)} clients in the denominator — the ${fmtInt(clientTeam.pending_clients)} still-pending clients count as miss-so-far. The Resolved headline drops those pendings from the denominator (same treatment as the cohort resolved rate), so it reads slightly higher and settles as the book bakes.`}
              />
            </span>
            <span className="num text-mute">
              <HeaderTip
                label={`${fmtInt(clientTeam.multi_policy_clients)} multi-policy households`}
                tip={`Clients with more than one policy. Capping at 100% per client stops a multi-policy household from counting as several placements — this is a household-level rate, not a policy-level one.`}
              />
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="num w-full border-separate border-spacing-0.5 text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-panel py-2 pr-3 text-left uppercase tracking-wider text-faint">
                    Agent
                  </th>
                  <th className="px-2 py-2 text-right uppercase tracking-wider text-faint">
                    Clients
                  </th>
                  <th className="px-2 py-2 text-right uppercase tracking-wider text-faint">
                    <HeaderTip
                      label="Capped"
                      align="right"
                      tip="Capped place rate with pending clients counted as miss-so-far (all clients in the denominator)."
                    />
                  </th>
                  <th className="px-2 py-2 text-right uppercase tracking-wider text-faint">
                    <HeaderTip
                      label="Capped (Resolved)"
                      align="right"
                      tip="Capped place rate with pending clients excluded from the denominator — the settled read."
                    />
                  </th>
                  <th className="px-2 py-2 text-right uppercase tracking-wider text-faint">
                    <HeaderTip
                      label="Maturity"
                      align="right"
                      tip="% of the client's book that's resolved (placed or declined). Lower maturity = a less settled rate, same caveat as immature cohorts. n = resolved clients."
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="display sticky left-0 bg-panel py-2 pr-3 font-bold uppercase tracking-wider text-gold">
                    Team
                  </td>
                  <td className="px-2 py-2 text-right text-mute">{fmtInt(clientTeam.clients)}</td>
                  <td className="px-2 py-2 text-right text-mute">
                    {fmtPct(clientTeam.capped_place_rate_pct)}
                  </td>
                  <td className="px-2 py-2 text-right font-semibold text-ink">
                    {fmtPct(clientTeam.capped_place_rate_resolved_pct)}
                  </td>
                  <td className="px-2 py-2 text-right text-mute">
                    {fmtPct(clientTeam.maturity_pct, 1)}{" "}
                    <span className="text-faint">n={fmtInt(clientTeam.resolved_clients)}</span>
                  </td>
                </tr>
                {clientRows.map((c) => {
                  const lowMaturity = (c.maturity_pct ?? 100) < 95;
                  return (
                    <tr key={c.agent}>
                      <td className="sticky left-0 whitespace-nowrap bg-panel py-2 pr-3 text-ink">
                        {c.agent}
                      </td>
                      <td className="px-2 py-2 text-right text-mute">{fmtInt(c.clients)}</td>
                      <td className="px-2 py-2 text-right text-mute">
                        {fmtPct(c.capped_place_rate_pct)}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold text-ink">
                        {fmtPct(c.capped_place_rate_resolved_pct)}
                      </td>
                      <td
                        className={`px-2 py-2 text-right ${lowMaturity ? "text-warn" : "text-mute"}`}
                        title={`${fmtInt(c.resolved_clients)} of ${fmtInt(c.clients)} clients resolved · ${fmtInt(c.pending_clients)} pending`}
                      >
                        {fmtPct(c.maturity_pct, 1)}{" "}
                        <span className="text-faint">n={fmtInt(c.resolved_clients)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-faint">
            Client-level view: each household counts once, placed if any of their policies has ever
            been inforce (a later lapse is a chargeback, not an un-place). Read the Resolved column
            with Maturity — a low-maturity agent cut is less settled and will move as pendings
            resolve, just like an immature cohort.
          </p>
        </Panel>
      )}

      {latestTeam && (
        <Panel>
          <SectionTitle sub={`cohort ${fmtMonth(latestTeam.cohort_month)} — the month still baking`}>
            Latest Cohort Snapshot
          </SectionTitle>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span className="num display text-4xl font-bold text-ink">
              {fmtPct(latestTeam.place_rate_pct)}
            </span>
            <span className="num text-sm text-mute">
              {fmtInt(latestTeam.placed)}/{fmtInt(latestTeam.submissions)} placed
            </span>
            <span className="text-sm">
              <Delta value={latestTeam.mom_place_rate_pts} format={(v) => `${v.toFixed(1)} pts MoM`} />
            </span>
            <span className="num text-sm text-mute">
              resolved {fmtPct(latestTeam.resolved_rate_pct)}
            </span>
            <span className={`num text-sm ${latestImmature ? "text-warn" : "text-mute"}`}>
              maturity {fmtPct(teamMaturity, 0)}
            </span>
            {teamPending != null && (
              <span className="num text-sm text-mute">{fmtInt(teamPending)} pending</span>
            )}
          </div>
          {latestImmature && (
            <p className="mt-2 text-xs text-warn">
              This cohort is still baking — the rate (and the MoM drop) will climb as pendings
              resolve. Don&apos;t read it as a slump yet.
            </p>
          )}
        </Panel>
      )}

      <Panel>
        <SectionTitle sub="rows stacked by PLC · baked rate counts only cohorts ≥70% matured">
          Agent × Cohort-Month Heatmap
        </SectionTitle>
        <div className="overflow-x-auto">
          <table className="num w-full border-separate border-spacing-0.5 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 bg-panel py-2 pr-3 text-left text-xs uppercase tracking-wider text-faint">
                  Agent
                </th>
                <th className="px-2 py-2 text-center uppercase tracking-wider text-faint">
                  <HeaderTip
                    label="PLC"
                    tip="The roster card's placement rating: baked place rate, percentile-ranked 40–99 against the active team. Rows are stacked by this."
                  />
                </th>
                <th className="px-2 py-2 text-center uppercase tracking-wider text-faint">
                  <HeaderTip
                    label="Baked rate"
                    tip="PER POLICY: placed ÷ submissions counting only cohorts ≥70% matured (n = submissions) — the raw stat behind PLC, and the figure the cohort cells to the right add up to. 'Baking' = nothing matured enough to judge yet."
                  />
                </th>
                <th className="px-2 py-2 text-center uppercase tracking-wider text-faint">
                  <HeaderTip
                    label="Client (capped)"
                    tip="PER HOUSEHOLD, lifetime: a client counts once and is placed if ANY of their policies has ever been inforce (capped at 100% — a 3-policy household can't count as 3 placements). Pending clients excluded from the denominator; n = resolved clients. A different unit from Baked rate, so the two do NOT reconcile — the gap is the signal: wide means multi-policy households where at least one policy stuck."
                  />
                </th>
                <th className="px-2 py-2 text-center uppercase tracking-wider text-faint">
                  <HeaderTip
                    label="Pending"
                    tip="Open submissions across all cohorts — the pipeline that will move the rate as it resolves."
                  />
                </th>
                {months.map((m) => (
                  <th key={m} className="px-2 py-2 text-center uppercase tracking-wider text-faint">
                    {fmtMonth(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="display sticky left-0 bg-panel py-2 pr-3 font-bold uppercase tracking-wider text-gold">
                  Team
                </td>
                <td className="px-2 py-2 text-center text-faint">—</td>
                <td className="px-2 py-2 text-center text-faint">—</td>
                <td className="px-2 py-2 text-center text-mute">
                  {clientTeam ? (
                    <>
                      <div className="font-semibold">
                        {fmtPct(clientTeam.capped_place_rate_resolved_pct, 0)}
                      </div>
                      <div className="text-[10px] text-faint">
                        n={fmtInt(clientTeam.resolved_clients)}
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-2 text-center text-mute">{fmtInt(teamPending)}</td>
                {months.map((m) => {
                  const t = teamCell.get(m);
                  return (
                    <td key={m} className="rounded-sm px-2 py-2 text-center text-ink" style={cellStyle(t?.place_rate_pct ?? null, 100)}>
                      {t ? (
                        <>
                          <div className="font-semibold">{fmtPct(t.place_rate_pct, 0)}</div>
                          <div className="text-[10px] text-mute">
                            {fmtInt(t.placed)}/{fmtInt(t.submissions)}
                          </div>
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
              {agentList.map((a) => {
                const plc = plcByAgent.get(a);
                const pending = pendingByAgent.get(a) ?? 0;
                return (
                  <tr key={a}>
                    <td className="sticky left-0 whitespace-nowrap bg-panel py-2 pr-3 text-ink">
                      {a}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {plc?.rating != null ? (
                        <span
                          className="display inline-flex items-center gap-1 font-bold"
                          style={{ color: tierColor(plc.rating) }}
                          title={`${tierOf(plc.rating).label} — percentile vs active team`}
                        >
                          {plc.rating}
                          <TrendArrow trend={plc.trend} />
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {plc?.raw != null ? (
                        <>
                          <div className="font-semibold text-ink">{fmtPct(plc.raw, 0)}</div>
                          <div className="text-[10px] text-mute">n={fmtInt(plc.sample)}</div>
                        </>
                      ) : (
                        <span className="text-faint" title="No cohort ≥70% matured yet">
                          baking
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {(() => {
                        const cap = cappedByAgent.get(a);
                        const capRate = cap?.capped_place_rate_resolved_pct ?? null;
                        if (capRate == null) return <span className="text-faint">—</span>;
                        const gap = plc?.raw != null ? capRate - plc.raw : null;
                        return (
                          <span
                            title={
                              `${a} — household rate ${fmtPct(capRate)} on ${fmtInt(cap!.resolved_clients)} resolved clients ` +
                              `(${fmtInt(cap!.multi_policy_clients)} multi-policy). ` +
                              (gap != null
                                ? `${gap >= 0 ? "+" : ""}${gap.toFixed(1)} pts vs the per-policy baked rate — different unit, not a discrepancy.`
                                : "")
                            }
                          >
                            <span className="font-semibold text-ink">{fmtPct(capRate, 0)}</span>
                            <span className="block text-[10px] text-mute">
                              n={fmtInt(cap!.resolved_clients)}
                            </span>
                          </span>
                        );
                      })()}
                    </td>
                    <td className={`px-2 py-2 text-center ${pending > 0 ? "text-ink" : "text-faint"}`}>
                      {fmtInt(pending)}
                    </td>
                    {months.map((m) => {
                      const c = cell.get(`${a}|${m}`);
                      if (!c || !(c.submissions ?? 0))
                        return (
                          <td key={m} className="px-2 py-2 text-center text-faint">
                            —
                          </td>
                        );
                      const immature = (c.maturity_pct ?? 0) < PLC_MIN_MATURITY_PCT;
                      return (
                        <td
                          key={m}
                          className="rounded-sm px-2 py-2 text-center text-ink"
                          style={cellStyle(c.place_rate_pct, c.maturity_pct)}
                          title={`${a} · ${fmtMonth(m)} — ${fmtPct(c.place_rate_pct)} (${c.placed}/${c.submissions}), maturity ${fmtPct(c.maturity_pct, 0)}, ${fmtInt(c.pending)} pending`}
                        >
                          <div className="font-semibold">
                            {fmtPct(c.place_rate_pct, 0)}
                            {immature && <span className="text-warn">*</span>}
                          </div>
                          <div className="text-[10px] text-mute">
                            {fmtInt(c.placed)}/{fmtInt(c.submissions)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-faint">
          * cohort under {PLC_MIN_MATURITY_PCT}% matured — the rate will move as pendings resolve.
          A 3/11 month reads as 27% and means almost nothing; always read the count under the rate.
          PLC is the roster-card placement rating (percentile vs the active team); Baked rate is
          the raw stat behind it and reconciles with the cohort cells in the row. Client (capped)
          is a different unit — per household, lifetime, each client counted once — so it will
          not tie to the cells; hover it for the gap vs Baked rate, which widens for agents
          writing multi-policy households. Pending = open submissions across all cohorts.
        </p>
      </Panel>
    </div>
  );
}
