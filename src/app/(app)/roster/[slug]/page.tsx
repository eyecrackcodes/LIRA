import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getActiveAgents,
  getAgentWeeks,
  getDailyActivity,
  getPlacementCohorts,
} from "@/lib/queries";
import {
  buildRatings,
  goalPace,
  tierColor,
  tierOf,
  FORM_EXPLAINER,
  NORM_WINDOW_WEEKS,
  RATING_WINDOW_WEEKS,
  DEFAULT_MONTHLY_GOAL,
  OVR_WEIGHTS,
  type AttrKey,
} from "@/lib/ratings";
import { awardBadges, BADGE_META } from "@/lib/badges";
import { departedAgentSet } from "@/lib/roster";
import { buildAgentLiveWeek } from "@/lib/live";
import { isWeekInProgress } from "@/lib/weeks";
import {
  agentSlug,
  fmtInt,
  fmtMoney,
  fmtPct,
  fmtWeek,
  fmtMonth,
} from "@/lib/format";
import AgentAvatar from "@/components/AgentAvatar";
import AttributeBar from "@/components/AttributeBar";
import LiveWeekPanel from "@/components/LiveWeekPanel";
import { HeaderTip, Panel, SectionTitle, Sparkline, Delta } from "@/components/ui";

export const revalidate = 900;

const ATTR_ORDER = Object.keys(OVR_WEIGHTS) as AttrKey[];

export default async function AgentCardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [agents, weeks, cohorts, days] = await Promise.all([
    getActiveAgents(),
    getAgentWeeks({ sinceDays: NORM_WINDOW_WEEKS * 7 + 7 }),
    getPlacementCohorts(),
    getDailyActivity({ sinceDays: NORM_WINDOW_WEEKS * 7 + 7 }),
  ]);

  const agentRow = agents.find((a) => agentSlug(a.agent) === slug);
  if (!agentRow) notFound();
  const agent = agentRow.agent;

  const live = await buildAgentLiveWeek(agent);

  const ratings = buildRatings(weeks, cohorts, days, agents.map((a) => a.agent));
  const me = ratings.find((r) => r.agent === agent)!;
  const rank = [...ratings]
    .sort((a, b) => (b.ovr ?? -1) - (a.ovr ?? -1))
    .findIndex((r) => r.agent === agent);

  const myWeeks = weeks.filter((w) => w.agent === agent);
  // Week-by-Week shows finished weeks only (the current partial week lives in
  // the live tracker above); goal pace still uses all weeks for real MTD.
  const last8 = myWeeks
    .filter((w) => !isWeekInProgress(w.week_start))
    .slice(-RATING_WINDOW_WEEKS);
  const pace = goalPace(myWeeks);

  const myBadges = awardBadges(weeks, days, 12, await departedAgentSet()).filter(
    (b) => b.agent === agent
  );
  const myCohorts = cohorts
    .filter((c) => c.agent === agent && (c.submissions ?? 0) > 0)
    .slice(-8);

  return (
    <div className="space-y-6">
      <Link href="/roster" className="text-xs uppercase tracking-wider text-mute hover:text-gold">
        ← Roster
      </Link>

      <Panel className="!p-6">
        <div className="flex flex-wrap items-center gap-5">
          <AgentAvatar agent={agent} size={96} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="display text-3xl font-bold uppercase tracking-wide text-ink">
                {agent}
              </h1>
              <span className="rounded-full border border-up/50 bg-up/10 px-2 py-0.5 text-[11px] uppercase tracking-wider text-up">
                {me.status}
              </span>
            </div>
            <div className="mt-1 text-sm text-mute">
              {me.tenureMo != null ? `${me.tenureMo.toFixed(0)} months in` : "tenure —"} · roster
              rank #{rank + 1} of {ratings.length}
            </div>
            <div className="mt-2 text-right sm:text-left">
              <Sparkline values={me.formSales} width={160} height={30} />
              <div className="text-[10px] uppercase tracking-wider text-faint">
                sales form · last {RATING_WINDOW_WEEKS} weeks
              </div>
            </div>
          </div>
          <div className="text-center">
            <div
              className="num display text-7xl font-bold leading-none"
              style={{ color: tierColor(me.ovr) }}
            >
              {me.ovr ?? "—"}
            </div>
            <div
              className="display text-xs uppercase tracking-widest"
              style={{ color: me.ovr != null ? tierColor(me.ovr) : "var(--color-faint)" }}
            >
              {me.ovr != null ? tierOf(me.ovr).label : "Overall"}
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-x-8 gap-y-3 md:grid-cols-2">
          {ATTR_ORDER.map((k) => (
            <AttributeBar key={k} attr={me.attrs[k]} />
          ))}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-faint">
          {FORM_EXPLAINER} Ratings run 40–99 and are for feel — the raw stat beside each rating
          is what decisions get made on. PLC counts only cohorts that are mostly resolved.
        </p>
      </Panel>

      <LiveWeekPanel live={live} scope="agent" />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <SectionTitle sub={`goal ${fmtMoney(DEFAULT_MONTHLY_GOAL)}/mo (week-grain approx.)`}>
            Monthly Goal Pace
          </SectionTitle>
          <div className="flex items-baseline gap-3">
            <span className="num display text-4xl font-bold text-ink">{fmtMoney(pace.mtd)}</span>
            <span className={`text-sm ${pace.onPace ? "text-up" : "text-down"}`}>
              {pace.onPace ? "on pace" : "behind pace"} · target-to-date {fmtMoney(pace.paceTarget)}
            </span>
          </div>
          <div className="mt-3 h-2 w-full rounded-full bg-navy">
            <div
              className="attr-fill h-full rounded-full"
              style={{
                width: `${Math.min(100, (100 * pace.mtd) / pace.goal)}%`,
                backgroundColor: pace.onPace ? "var(--color-up)" : "var(--color-warn)",
              }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-faint">
            <span>$0</span>
            <span>{fmtMoney(pace.goal)}</span>
          </div>
        </Panel>

        <Panel>
          <SectionTitle sub="last 12 weeks">Trophy Case</SectionTitle>
          {myBadges.length === 0 ? (
            <p className="text-sm text-mute">No hardware yet in this window — plenty of season left.</p>
          ) : (
            <ul className="space-y-2">
              {[...myBadges].reverse().map((b, i) => {
                const isLatest = b.week_start === myBadges[myBadges.length - 1].week_start;
                return (
                <li
                  key={i}
                  className={`flex items-center gap-2 rounded-sm text-sm ${isLatest ? "badge-unlock px-1" : ""}`}
                  style={isLatest ? ({ "--d": `${i * 130}ms` } as React.CSSProperties) : undefined}
                >
                  <span className={`text-gold ${isLatest ? "badge-icon" : ""}`}>{BADGE_META[b.badge].icon}</span>
                  <span className="display font-semibold uppercase tracking-wider text-gold">
                    {BADGE_META[b.badge].name}
                  </span>
                  <span className="num text-mute">
                    wk {fmtWeek(b.week_start)} · {b.detail}
                  </span>
                </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel>
        <SectionTitle sub={`last ${RATING_WINDOW_WEEKS} weeks`}>Week-by-Week</SectionTitle>
        <div className="overflow-x-auto">
          <table className="num w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                <th className="py-2 pr-4">Week</th>
                <th className="py-2 pr-4 text-right">
                  <HeaderTip label="Leads" tip="Billable leads received that week." align="right" />
                </th>
                <th className="py-2 pr-4 text-right">
                  <HeaderTip label="Sales" tip="Policies sold that week." align="right" />
                </th>
                <th className="py-2 pr-4 text-right">
                  <HeaderTip
                    label="Close"
                    tip="Sales ÷ leads that week — lead count in parentheses; small weeks swing hard."
                    align="right"
                  />
                </th>
                <th className="py-2 pr-4 text-right">
                  <HeaderTip label="Premium" tip="Submitted premium that week." align="right" />
                </th>
                <th className="py-2 pr-4 text-right">
                  <HeaderTip
                    label="WoW sales"
                    tip="Change in sales vs this agent's prior week."
                    align="right"
                  />
                </th>
                <th className="py-2 text-right">
                  <HeaderTip
                    label="WoW premium"
                    tip="Change in premium vs this agent's prior week."
                    align="right"
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {[...last8].reverse().map((w) => (
                <tr key={w.week_start} className="border-b border-edge/50">
                  <td className="py-2 pr-4 text-mute">{fmtWeek(w.week_start)}</td>
                  <td className="py-2 pr-4 text-right">{fmtInt(w.leads)}</td>
                  <td className="py-2 pr-4 text-right">{fmtInt(w.sales)}</td>
                  <td className="py-2 pr-4 text-right">
                    {fmtPct(w.close_rate_pct)}{" "}
                    <span className="text-faint">({fmtInt(w.leads)})</span>
                  </td>
                  <td className="py-2 pr-4 text-right">{fmtMoney(w.premium)}</td>
                  <td className="py-2 pr-4 text-right">
                    <Delta value={w.wow_sales} format={(v) => fmtInt(v)} />
                  </td>
                  <td className="py-2 text-right">
                    <Delta value={w.wow_premium} format={(v) => fmtMoney(v)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <SectionTitle sub="place rate per submission-month cohort · low maturity = rate not baked yet">
          Placement Cohorts
        </SectionTitle>
        {myCohorts.length === 0 ? (
          <p className="text-sm text-mute">No cohort data for this agent yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                  <th className="py-2 pr-4">
                    <HeaderTip
                      label="Cohort"
                      tip="Submission month — every policy submitted that month is tracked as one cohort."
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Submissions"
                      tip="Policies submitted in the cohort month."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Placed"
                      tip="Submissions from that month that have gone in force."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Place rate"
                      tip="Placed ÷ submissions for the cohort. Only meaningful once the cohort matures — check the maturity column."
                      align="right"
                    />
                  </th>
                  <th className="py-2 text-right">
                    <HeaderTip
                      label="Maturity"
                      tip="(Placed + declined) ÷ submissions — how 'baked' the cohort is. Under 70% the rate will still move as pendings resolve."
                      align="right"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...myCohorts].reverse().map((c) => {
                  const immature = (c.maturity_pct ?? 0) < 70;
                  return (
                    <tr key={c.cohort_month} className="border-b border-edge/50">
                      <td className="py-2 pr-4 text-mute">{fmtMonth(c.cohort_month)}</td>
                      <td className="py-2 pr-4 text-right">{fmtInt(c.submissions)}</td>
                      <td className="py-2 pr-4 text-right">{fmtInt(c.placed)}</td>
                      <td className={`py-2 pr-4 text-right ${immature ? "text-faint" : ""}`}>
                        {fmtPct(c.place_rate_pct)}{" "}
                        <span className="text-faint">
                          ({fmtInt(c.placed)}/{fmtInt(c.submissions)})
                        </span>
                      </td>
                      <td className={`py-2 text-right ${immature ? "text-warn" : "text-mute"}`}>
                        {fmtPct(c.maturity_pct, 0)}
                        {immature && " · early"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
