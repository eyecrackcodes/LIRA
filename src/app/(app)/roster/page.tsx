import Link from "next/link";
import {
  getActiveAgents,
  getAgentWeeks,
  getDailyActivity,
  getPlacementCohorts,
} from "@/lib/queries";
import {
  buildRatings,
  tierColor,
  tierOf,
  FORM_EXPLAINER,
  NORM_WINDOW_WEEKS,
  RATING_WINDOW_WEEKS,
  ATTR_META,
  OVR_WEIGHTS,
  type AttrKey,
  type AgentRating,
} from "@/lib/ratings";
import { awardBadges, type BadgeAward, type BadgeKey } from "@/lib/badges";
import { departedAgentSet, listTableDepartures } from "@/lib/roster";
import { getViewer, isManager } from "@/lib/auth";
import { agentSlug, fmtInt, fmtMoney, fmtPct, fmtWeek } from "@/lib/format";
import AgentAvatar from "@/components/AgentAvatar";
import HardwareShowcase, { type TrailerScene } from "@/components/HardwareShowcase";
import RosterManager from "@/components/RosterManager";
import { HeaderTip, Panel, SectionTitle, Sparkline, TrendArrow } from "@/components/ui";

export const revalidate = 900;

/** Trailer billing order — POTW headlines, then the skill/effort awards. */
const BADGE_PRIORITY: Record<BadgeKey, number> = {
  POTW: 0,
  SNIPER: 1,
  GRINDER: 2,
  IRON_MAN: 3,
  HOT_STREAK: 4,
};

const ATTR_ORDER = Object.keys(OVR_WEIGHTS) as AttrKey[];

function buildScene(
  b: BadgeAward,
  rank: number | null,
  rating: AgentRating | undefined
): TrailerScene {
  const lw = rating?.latestWeek ?? null;
  return {
    badge: b.badge,
    agent: b.agent,
    detail: b.detail,
    weekLabel: fmtWeek(b.week_start),
    rank,
    ovr: rating?.ovr ?? null,
    stats: [
      {
        label: "Close rate",
        value: `${fmtPct(lw?.close_rate_pct)} (${fmtInt(lw?.sales)}/${fmtInt(lw?.leads)})`,
      },
      { label: "Premium this week", value: fmtMoney(lw?.premium) },
      { label: "Sales", value: fmtInt(lw?.sales) },
      {
        label: "Hustle",
        value:
          rating?.attrs.HUS.raw != null
            ? `${(rating.attrs.HUS.raw / 60).toFixed(1)} hrs/day`
            : "—",
      },
    ],
    attrs: ATTR_ORDER.map((k) => {
      const a = rating?.attrs[k];
      return {
        key: k,
        rating: a?.rating ?? null,
        rawText: a?.raw != null ? ATTR_META[k].describe(a.raw) : "—",
      };
    }),
    formSales: rating?.formSales ?? [],
    cardHref: `/roster/${agentSlug(b.agent)}`,
  };
}

export default async function RosterPage() {
  const [agents, weeks, cohorts, days, viewer] = await Promise.all([
    getActiveAgents(),
    getAgentWeeks({ sinceDays: NORM_WINDOW_WEEKS * 7 + 7 }),
    getPlacementCohorts(),
    getDailyActivity({ sinceDays: NORM_WINDOW_WEEKS * 7 + 7 }),
    getViewer(),
  ]);
  const manager = isManager(viewer);
  const departures = manager ? await listTableDepartures() : [];

  const ratings = buildRatings(
    weeks,
    cohorts,
    days,
    agents.map((a) => a.agent)
  ).sort((a, b) => (b.ovr ?? -1) - (a.ovr ?? -1));

  const badges = awardBadges(weeks, days, 1, await departedAgentSet());
  const latestBadgeWeek = badges[badges.length - 1]?.week_start;
  const thisWeeksBadges = badges.filter((b) => b.week_start === latestBadgeWeek);

  // Trailer scenes: top three get medals and play #3 → #2 → #1 (podium at the
  // end); anything beyond three plays after as un-ranked bonus scenes.
  const ratingByAgent = new Map(ratings.map((r) => [r.agent, r]));
  const billed = [...thisWeeksBadges].sort(
    (a, b) => BADGE_PRIORITY[a.badge] - BADGE_PRIORITY[b.badge]
  );
  const medalists = billed.slice(0, 3).map((b, i) => ({ award: b, rank: i + 1 }));
  const rest = billed.slice(3).map((b) => ({ award: b, rank: null as number | null }));
  const scenes: TrailerScene[] = [...medalists.reverse(), ...rest].map(({ award, rank }) =>
    buildScene(award, rank, ratingByAgent.get(award.agent))
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
          Roster
        </h1>
        <p className="text-sm text-mute">
          {ratings.length} active agents · sorted by OVR ·{" "}
          <HeaderTip label="rated on recent form" tip={FORM_EXPLAINER} />
        </p>
      </header>

      {scenes.length > 0 && (
        <Panel>
          <SectionTitle sub={latestBadgeWeek ? `week of ${fmtWeek(latestBadgeWeek)}` : undefined}>
            This Week&apos;s Hardware
          </SectionTitle>
          <HardwareShowcase
            scenes={scenes}
            weekLabel={latestBadgeWeek ? fmtWeek(latestBadgeWeek) : ""}
          />
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ratings.map((r, idx) => {
          const cls = r.attrs.CLS;
          const vol = r.attrs.VOL;
          return (
            <Link
              key={r.agent}
              href={`/roster/${agentSlug(r.agent)}`}
              className="card-in group rounded-md border border-edge bg-panel p-4 transition-colors hover:border-gold-dim"
              style={{ animationDelay: `${Math.min(idx * 40, 400)}ms` }}
            >
              <div className="flex items-center gap-3">
                <AgentAvatar agent={r.agent} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-ink group-hover:text-gold">
                    {r.agent}
                  </div>
                  <div className="text-xs text-mute">
                    {r.tenureMo != null ? `${r.tenureMo.toFixed(0)} mo tenure` : "tenure —"}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="num display text-4xl font-bold leading-none"
                    style={{ color: tierColor(r.ovr) }}
                  >
                    {r.ovr ?? "—"}
                  </div>
                  <div
                    className="display text-[10px] uppercase tracking-widest"
                    style={{ color: r.ovr != null ? tierColor(r.ovr) : "var(--color-faint)" }}
                  >
                    {r.ovr != null ? tierOf(r.ovr).label : "OVR"}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                <div className="space-y-1 text-xs">
                  <div className="num text-mute">
                    <span className="display font-bold text-ink">CLS {cls.rating ?? "—"}</span>{" "}
                    · {cls.raw != null ? `${cls.raw.toFixed(1)}%` : "—"}{" "}
                    <span className="text-faint">({cls.sample} leads)</span>{" "}
                    <TrendArrow trend={cls.trend} />
                  </div>
                  <div className="num text-mute">
                    <span className="display font-bold text-ink">VOL {vol.rating ?? "—"}</span>{" "}
                    · {vol.raw != null ? `$${Math.round(vol.raw).toLocaleString("en-US")}/wk` : "—"}{" "}
                    <TrendArrow trend={vol.trend} />
                  </div>
                </div>
                <div className="text-right">
                  <Sparkline values={r.formSales} width={100} height={26} />
                  <div className="text-[10px] uppercase tracking-wider text-faint">
                    sales · last {RATING_WINDOW_WEEKS} weeks
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {manager && (
        <RosterManager
          activeAgents={ratings.map((r) => r.agent)}
          departures={departures}
        />
      )}
    </div>
  );
}
