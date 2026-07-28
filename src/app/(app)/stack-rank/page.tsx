import Link from "next/link";
import { buildStackRank, renderStackRankEmail } from "@/lib/stackrank";
import { getViewer, isManager } from "@/lib/auth";
import { getPnlStackRank } from "@/lib/queries";
import { FORM_EXPLAINER } from "@/lib/ratings";
import { BADGE_META } from "@/lib/badges";
import { agentSlug, fmtInt, fmtMinAsHrs, fmtMoney, fmtPct, fmtWeek } from "@/lib/format";
import AgentAvatar from "@/components/AgentAvatar";
import { HeaderTip, Panel, SectionTitle } from "@/components/ui";

export const revalidate = 900;

const pnlColor = (v: number | null) =>
  v == null ? "var(--color-faint)" : v >= 0 ? "var(--color-up)" : "var(--color-down)";

export default async function StackRankPage() {
  const manager = isManager(await getViewer());
  // P&L is pay-adjacent — don't even fetch it for agents.
  const [stack, pnl] = await Promise.all([
    buildStackRank(),
    manager ? getPnlStackRank(21) : Promise.resolve([]),
  ]);
  const emailHtml = manager ? renderStackRankEmail(stack) : null;
  const weekLabel = stack.weekStart ? fmtWeek(stack.weekStart) : "—";

  const pnlWeek = pnl.length ? pnl[pnl.length - 1].week_start : null;
  const pnlRows = pnl
    .filter((p) => p.week_start === pnlWeek)
    .sort((a, b) => (b.act_net_after_cb ?? -Infinity) - (a.act_net_after_cb ?? -Infinity));
  const pnlTotals = pnlRows.reduce(
    (t, p) => ({
      leads: t.leads + (p.billable_leads ?? 0),
      leadCost: t.leadCost + (p.lead_cost ?? 0),
      expNet: t.expNet + (p.exp_net_pnl ?? 0),
      actNet: t.actNet + (p.act_net_pnl ?? 0),
      cb: t.cb + (p.chargebacks ?? 0),
      netAfterCb: t.netAfterCb + (p.act_net_after_cb ?? 0),
    }),
    { leads: 0, leadCost: 0, expNet: 0, actNet: 0, cb: 0, netAfterCb: 0 }
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
          Weekly Stack Rank
        </h1>
        <p className="text-sm text-mute">
          Ranked by OVR, week of {weekLabel}. True HP and EFF come from the official efficiency
          scorecard. No pay data on this board.
        </p>
      </header>

      <Panel>
        <SectionTitle
          sub={
            <>
              week of {weekLabel} ·{" "}
              <HeaderTip label="rated on recent form" tip={FORM_EXPLAINER} align="right" />
            </>
          }
        >
          The Board
        </SectionTitle>
        <div className="overflow-x-auto">
          <table className="num w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                <th className="py-2 pr-3">
                  <HeaderTip
                    label="#"
                    tip="Stack-rank position, ordered by OVR. Agents without enough production data yet are unranked (—)."
                  />
                </th>
                <th className="py-2 pr-3">Agent</th>
                <th className="py-2 pr-3 text-center">
                  <HeaderTip
                    label="OVR"
                    tip={`Overall rating (40–99): closing, placement, production, hustle, discipline, and consistency blended into one number. ${FORM_EXPLAINER}`}
                  />
                </th>
                <th className="py-2 pr-3 text-center">
                  <HeaderTip
                    label="EFF"
                    tip="The official efficiency score from the nightly scorecard — the number behind bonuses. The tag underneath (e.g. Silver) is the official tier."
                  />
                </th>
                <th className="py-2 pr-3 text-right">
                  <HeaderTip
                    label="Premium (wk)"
                    tip="Submitted premium this week, from the CRM."
                    align="right"
                  />
                </th>
                <th className="py-2 pr-3 text-right">
                  <HeaderTip label="Sales" tip="Policies sold this week." align="right" />
                </th>
                <th className="py-2 pr-3 text-right">
                  <HeaderTip
                    label="Close (leads)"
                    tip="Sales ÷ leads this week. The number in parentheses is the lead count behind the rate — small samples swing hard."
                    align="right"
                  />
                </th>
                <th className="py-2 pr-3 text-right">
                  <HeaderTip
                    label="True HP"
                    tip="Horsepower: hourly premium × place rate, from the official scorecard. Output speed discounted by placement quality. '—' means not scored yet."
                    align="right"
                  />
                </th>
                <th className="py-2 pr-3 text-right">
                  <HeaderTip
                    label="Hustle"
                    tip="Average RPA (revenue-producing activity) hours per active day over the last 8 weeks."
                    align="right"
                  />
                </th>
                <th className="py-2 pr-3 text-right">
                  <HeaderTip
                    label="Place rate"
                    tip="Placed ÷ submissions, counting only cohorts that are ≥70% matured (n = submissions). 'Baking' means no cohort has resolved enough to judge yet."
                    align="right"
                  />
                </th>
                <th className="py-2">
                  <HeaderTip
                    label="Hardware"
                    tip="This week's auto-awarded badges — hover a badge for the stat that earned it."
                    align="right"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {stack.rows.map((r) => (
                <tr key={r.agent} className="border-b border-edge/50">
                  <td className="py-2 pr-3 text-mute">{r.rank ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <Link
                      href={`/roster/${agentSlug(r.agent)}`}
                      className="flex items-center gap-2 whitespace-nowrap text-ink hover:text-gold"
                    >
                      <AgentAvatar agent={r.agent} size={28} />
                      {r.agent}
                    </Link>
                  </td>
                  <td className="py-2 pr-3 text-center">
                    <span className="display font-bold" style={{ color: r.tier.color }}>
                      {r.ovr ?? "—"}
                    </span>
                    <div
                      className="display text-[9px] uppercase tracking-widest"
                      style={{ color: r.tier.color }}
                    >
                      {r.tier.label}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-center">
                    {r.effScore != null ? (
                      <>
                        <span className="display font-bold text-ink">{r.effScore}</span>
                        {r.effTier && (
                          <div className="display text-[9px] uppercase tracking-widest text-mute">
                            {r.effTier}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">{fmtMoney(r.weekPremium)}</td>
                  <td className="py-2 pr-3 text-right">{fmtInt(r.weekSales)}</td>
                  <td className="py-2 pr-3 text-right">
                    {r.weekClose != null ? (
                      <>
                        {fmtPct(r.weekClose)}{" "}
                        <span className="text-faint">({fmtInt(r.weekLeads)})</span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold text-gold">
                    {r.trueHp != null ? `$${Math.round(r.trueHp)}/hr` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right text-mute">
                    {r.rpaMinPerDay != null ? `${fmtMinAsHrs(r.rpaMinPerDay)}/day` : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {r.placeRate != null ? (
                      <>
                        {fmtPct(r.placeRate, 0)}{" "}
                        <span className="text-faint">(n={fmtInt(r.placeN)})</span>
                      </>
                    ) : (
                      <span className="text-faint">baking</span>
                    )}
                  </td>
                  <td className="py-2 text-gold">
                    {r.badges.length
                      ? r.badges.map((b) => (
                          <span key={b.key} className="mr-2 whitespace-nowrap" title={b.detail}>
                            {BADGE_META[b.key].icon} {BADGE_META[b.key].name}
                          </span>
                        ))
                      : <span className="text-faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          OVR grades your last 8 weeks against the team — a body-of-work number, not a this-week
          number. EFF is the official efficiency score behind bonuses (nightly scorecard). True
          HP = hourly premium × place rate — output speed discounted by placement quality. Place
          rate counts only cohorts that are mostly resolved, and every rate carries its
          denominator.
        </p>
      </Panel>

      {pnlRows.length > 0 && (
        <Panel>
          <SectionTitle
            sub={`week of ${pnlWeek ? fmtWeek(pnlWeek) : "—"} · manager view — never in the agent email`}
          >
            P&amp;L Stack Rank
          </SectionTitle>
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                  <th className="py-2 pr-4">Agent</th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip label="Leads" tip="Billable leads this week." align="right" />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Lead cost"
                      tip="What this week's leads cost the company."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Expected net"
                      tip="This week's sales potential: expected company revenue minus lead cost and expected agent cost (agent cost = max of draw and commission — never both)."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Actual net"
                      tip="Cash P&L from policies inforcing now — sold 2–3 months ago. Diverges from Expected by design; the two converge as months mature."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Chargebacks"
                      tip="Commission clawed back this week on lapsed/cancelled policies."
                      align="right"
                    />
                  </th>
                  <th className="py-2 text-right">
                    <HeaderTip
                      label="Net after CB"
                      tip="Actual net minus chargebacks — the real cash line for the week."
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
                  <td className="py-2 pr-4 text-right">{fmtInt(pnlTotals.leads)}</td>
                  <td className="py-2 pr-4 text-right">{fmtMoney(pnlTotals.leadCost)}</td>
                  <td className="py-2 pr-4 text-right" style={{ color: pnlColor(pnlTotals.expNet) }}>
                    {fmtMoney(pnlTotals.expNet)}
                  </td>
                  <td className="py-2 pr-4 text-right" style={{ color: pnlColor(pnlTotals.actNet) }}>
                    {fmtMoney(pnlTotals.actNet)}
                  </td>
                  <td className="py-2 pr-4 text-right text-down">
                    {pnlTotals.cb ? `−${fmtMoney(pnlTotals.cb)}` : "—"}
                  </td>
                  <td
                    className="py-2 text-right font-semibold"
                    style={{ color: pnlColor(pnlTotals.netAfterCb) }}
                  >
                    {fmtMoney(pnlTotals.netAfterCb)}
                  </td>
                </tr>
                {pnlRows.map((p) => (
                  <tr key={p.agent} className="border-b border-edge/50">
                    <td className="py-2 pr-4 text-ink">{p.agent}</td>
                    <td className="py-2 pr-4 text-right">{fmtInt(p.billable_leads)}</td>
                    <td className="py-2 pr-4 text-right">{fmtMoney(p.lead_cost)}</td>
                    <td className="py-2 pr-4 text-right" style={{ color: pnlColor(p.exp_net_pnl) }}>
                      {fmtMoney(p.exp_net_pnl)}
                    </td>
                    <td className="py-2 pr-4 text-right" style={{ color: pnlColor(p.act_net_pnl) }}>
                      {fmtMoney(p.act_net_pnl)}
                    </td>
                    <td className="py-2 pr-4 text-right text-down">
                      {p.chargebacks ? `−${fmtMoney(p.chargebacks)}` : "—"}
                    </td>
                    <td
                      className="py-2 text-right font-semibold"
                      style={{ color: pnlColor(p.act_net_after_cb) }}
                    >
                      {fmtMoney(p.act_net_after_cb)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-faint">
            Expected = this week&apos;s sales potential; Actual = cash from policies inforcing now
            (sold 2–3 months ago) — they diverge by design and converge on matured months. New
            agents look bad on Actual purely from inforce lag; judge them on Expected. Agent cost
            = max(draw, commission).
          </p>
        </Panel>
      )}

      {emailHtml && (
        <Panel>
          <SectionTitle sub="exactly what lands in the inbox — email-safe HTML, inline styles">
            Email Draft Preview
          </SectionTitle>
          <p className="mb-3 text-xs text-mute">
            Draft only — nothing sends automatically yet.{" "}
            <a
              href="/api/weekly-email"
              target="_blank"
              className="text-gold underline underline-offset-2 hover:text-gold-hi"
            >
              Open raw HTML
            </a>{" "}
            to copy into a mailer or wire into automation later.
          </p>
          <iframe
            srcDoc={emailHtml}
            title="Weekly stack-rank email preview"
            className="h-[720px] w-full rounded-md border border-edge bg-[#0a0e17]"
          />
        </Panel>
      )}
    </div>
  );
}
