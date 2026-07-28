import { BRAND_FULL } from "./brand";
import "server-only";
import fs from "node:fs";
import path from "node:path";
import {
  getActiveAgents,
  getAgentEfficiency,
  getAgentWeeks,
  getDailyActivity,
  getPlacementCohorts,
  getFreshness,
} from "./queries";
import {
  buildRatings,
  tierOf,
  NORM_WINDOW_WEEKS,
  RATING_WINDOW_WEEKS,
  type Tier,
} from "./ratings";
import { awardBadges, BADGE_META, type BadgeKey } from "./badges";
import { departedAgentSet } from "./roster";
import { latestCompleteWeekStart } from "./weeks";
import { fmtInt, fmtMoney, fmtPct, fmtWeek, agentSlug, agentInitials } from "./format";

/**
 * Weekly stack rank — the agent-facing cut of the ratings engine.
 * STRICTLY no commission/pay data here: this feeds an email every agent sees.
 * Ranking is by OVR (tier ranking), which is rate-normalized by construction —
 * we never rank raw premium alone, and every rate shows its denominator.
 *
 * True HP ("horsepower") comes straight from the official `agent_efficiency`
 * scorecard: HP × place rate — output speed discounted by placement quality.
 * EFF is the official efficiency score behind bonuses (same snapshot).
 */

export interface StackRankRow {
  rank: number | null; // null = not ranked yet (no core production data)
  agent: string;
  ovr: number | null;
  tier: Tier;
  /** latest-week stats (null when the agent has no row that week) */
  weekPremium: number | null;
  weekSales: number | null;
  weekClose: number | null;
  weekLeads: number | null;
  /** official scorecard (agent_efficiency nightly snapshot) */
  trueHp: number | null;
  effScore: number | null;
  effTier: string | null; // e.g. "Silver"; null when the sheet shows "-"
  rpaMinPerDay: number | null;
  /** baked place rate across matured cohorts (n = submissions) */
  placeRate: number | null;
  placeN: number;
  badges: { key: BadgeKey; detail: string }[];
}

export interface StackRank {
  weekStart: string | null;
  rows: StackRankRow[];
  syncedAt: string | null;
}

export async function buildStackRank(): Promise<StackRank> {
  const [agents, weeks, cohorts, days, efficiency, freshness] = await Promise.all([
    getActiveAgents(),
    getAgentWeeks({ sinceDays: NORM_WINDOW_WEEKS * 7 + 7 }),
    getPlacementCohorts(),
    getDailyActivity({ sinceDays: NORM_WINDOW_WEEKS * 7 + 7 }),
    getAgentEfficiency(),
    getFreshness(),
  ]);
  const effByAgent = new Map(efficiency.map((e) => [e.agent, e]));

  const ratings = buildRatings(weeks, cohorts, days, agents.map((a) => a.agent)).sort(
    (a, b) => (b.ovr ?? -1) - (a.ovr ?? -1)
  );

  // Headline the last COMPLETED week, not the partial current one — the board's
  // premium/sales/close columns must be a finished week's numbers so they read
  // as a real result, not a Tuesday-morning fraction.
  const weekStart = latestCompleteWeekStart(weeks.map((w) => w.week_start));
  const latestRows = new Map(
    weeks.filter((w) => w.week_start === weekStart).map((w) => [w.agent, w])
  );

  const badgeAwards = awardBadges(weeks, days, 1, await departedAgentSet()).filter(
    (b) => b.week_start === weekStart
  );
  const badgesByAgent = new Map<string, { key: BadgeKey; detail: string }[]>();
  for (const b of badgeAwards) {
    if (!badgesByAgent.has(b.agent)) badgesByAgent.set(b.agent, []);
    badgesByAgent.get(b.agent)!.push({ key: b.badge, detail: b.detail });
  }

  let rankCounter = 0;
  const rows: StackRankRow[] = ratings.map((r) => {
    const lw = latestRows.get(r.agent) ?? null;
    const eff = effByAgent.get(r.agent) ?? null;
    // A 0 score on the scorecard means "not scored yet", not a real zero;
    // true_hp = 0 likewise just means no baked place rate to multiply by.
    const scored = eff != null && (eff.efficiency_score ?? 0) > 0;
    const trueHp = scored && (eff.true_hp ?? 0) > 0 ? eff.true_hp : null;
    return {
      rank: r.ovr != null ? ++rankCounter : null,
      agent: r.agent,
      ovr: r.ovr,
      tier: tierOf(r.ovr),
      weekPremium: lw?.premium ?? null,
      weekSales: lw?.sales ?? null,
      weekClose: lw?.close_rate_pct ?? null,
      weekLeads: lw?.leads ?? null,
      trueHp,
      effScore: scored ? eff.efficiency_score : null,
      effTier: scored && eff.tier && eff.tier !== "-" ? eff.tier : null,
      rpaMinPerDay: r.attrs.HUS.raw,
      placeRate: r.attrs.PLC.raw,
      placeN: r.attrs.PLC.sample,
      badges: badgesByAgent.get(r.agent) ?? [],
    };
  });

  return { weekStart, rows, syncedAt: freshness.maxSyncedAt };
}

/* ── Email renderer ──────────────────────────────────────────────────────
   Email-safe HTML: table layout, inline styles only, no external assets.
   Draft for review — nothing sends automatically yet. */

// Hardcoded on purpose: this HTML is a standalone document (email clients,
// or the srcDoc preview iframe) with no access to the app's CSS variables —
// the live app's --tier-*/--color-* tokens flip with light/dark/colorblind
// mode, but the email is always this one fixed dark palette.
const C = {
  bg: "#0a0e17",
  panel: "#111726",
  navy: "#12203a",
  edge: "#232c42",
  ink: "#e8ecf4",
  mute: "#8b95ab",
  faint: "#5c6680",
  gold: "#e9b64b",
};

// Mirrors ratings.ts tierOf(), but with literal hex instead of var(--tier-*)
// since those custom properties don't exist inside this isolated document.
const EMAIL_TIER_COLOR: Record<string, string> = {
  Elite: C.gold,
  Star: "#3ddc8e",
  Starter: "#5b8dd6",
  Rotation: C.mute,
  Development: "#ff6b5e",
  "No data": C.faint,
};
const tierColorFor = (label: string) => EMAIL_TIER_COLOR[label] ?? C.mute;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const hpText = (v: number | null) => (v == null ? "—" : `$${Math.round(v)}/hr`);

// Resolve whichever headshot extension actually exists on disk (same
// png-then-jpg convention as <AgentAvatar>), cached per process — email
// HTML can't retry on <img onerror> the way the live app does.
const AGENT_DIR = path.join(process.cwd(), "public", "agents");
const avatarExtCache = new Map<string, string | null>();
function avatarExt(agent: string): string | null {
  const slug = agentSlug(agent);
  if (avatarExtCache.has(slug)) return avatarExtCache.get(slug) ?? null;
  let ext: string | null = null;
  for (const candidate of ["png", "jpg"]) {
    if (fs.existsSync(path.join(AGENT_DIR, `${slug}.${candidate}`))) {
      ext = candidate;
      break;
    }
  }
  avatarExtCache.set(slug, ext);
  return ext;
}

// Relative by default (resolves fine against the app's own origin in the
// srcDoc preview). For a *sent* email, mail clients have no "current page"
// to resolve a relative path against, so set NEXT_PUBLIC_APP_URL to an
// absolute production URL before wiring this up to real automation.
const EMAIL_ASSET_BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

function avatarHtml(agent: string, size: number): string {
  const ext = avatarExt(agent);
  if (ext) {
    const src = `${EMAIL_ASSET_BASE}/agents/${agentSlug(agent)}.${ext}`;
    return `<img src="${src}" width="${size}" height="${size}" alt="" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;background-color:${C.navy};vertical-align:middle;border:0;" />`;
  }
  return `<div style="display:inline-block;width:${size}px;height:${size}px;border-radius:50%;background-color:${C.navy};color:${C.gold};font-family:Arial,sans-serif;font-weight:bold;font-size:${Math.round(size * 0.34)}px;line-height:${size}px;text-align:center;vertical-align:middle;">${esc(agentInitials(agent))}</div>`;
}

export function renderStackRankEmail({ weekStart, rows, syncedAt }: StackRank): string {
  const weekLabel = weekStart ? fmtWeek(weekStart) : "—";
  const top3 = rows.filter((r) => r.ovr != null).slice(0, 3);

  const medalRow = top3
    .map((r, i) => {
      const medals = ["🥇", "🥈", "🥉"];
      const tc = tierColorFor(r.tier.label);
      return `
        <td align="center" style="padding:12px 8px;">
          <div style="font-size:22px;line-height:1;">${medals[i]}</div>
          <div style="padding-top:6px;">${avatarHtml(r.agent, 56)}</div>
          <div style="font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:${C.ink};padding-top:6px;">${esc(r.agent)}</div>
          <div style="font-family:Arial,sans-serif;font-size:22px;font-weight:bold;color:${tc};">${r.ovr}</div>
          <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${tc};">${esc(r.tier.label)}</div>
        </td>`;
    })
    .join("");

  const bodyRows = rows
    .map((r) => {
      const badgeText = r.badges
        .map((b) => `${BADGE_META[b.key].icon} ${BADGE_META[b.key].name}`)
        .join(" · ");
      const closeText =
        r.weekClose != null ? `${fmtPct(r.weekClose)} <span style="color:${C.faint};">(${fmtInt(r.weekLeads)})</span>` : "—";
      const placeText =
        r.placeRate != null
          ? `${fmtPct(r.placeRate, 0)} <span style="color:${C.faint};">(n=${fmtInt(r.placeN)})</span>`
          : `<span style="color:${C.faint};">baking</span>`;
      const tc = tierColorFor(r.tier.label);
      return `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid ${C.edge};font-family:Arial,sans-serif;font-size:13px;color:${C.mute};">${r.rank ?? "—"}</td>
        <td style="padding:8px 10px;border-bottom:1px solid ${C.edge};font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:${C.ink};white-space:nowrap;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:8px;">${avatarHtml(r.agent, 32)}</td>
            <td style="font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:${C.ink};white-space:nowrap;vertical-align:middle;">${esc(r.agent)}</td>
          </tr></table>
        </td>
        <td align="center" style="padding:8px 10px;border-bottom:1px solid ${C.edge};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;color:${tc};">${r.ovr ?? "—"}<div style="font-size:9px;letter-spacing:1px;text-transform:uppercase;font-weight:normal;">${esc(r.tier.label)}</div></td>
        <td align="right" style="padding:8px 10px;border-bottom:1px solid ${C.edge};font-family:Arial,sans-serif;font-size:13px;color:${C.ink};">${fmtMoney(r.weekPremium)}</td>
        <td align="right" style="padding:8px 10px;border-bottom:1px solid ${C.edge};font-family:Arial,sans-serif;font-size:13px;color:${C.ink};">${fmtInt(r.weekSales)}</td>
        <td align="right" style="padding:8px 10px;border-bottom:1px solid ${C.edge};font-family:Arial,sans-serif;font-size:13px;color:${C.ink};">${closeText}</td>
        <td align="right" style="padding:8px 10px;border-bottom:1px solid ${C.edge};font-family:Arial,sans-serif;font-size:13px;color:${C.gold};font-weight:bold;">${hpText(r.trueHp)}</td>
        <td align="right" style="padding:8px 10px;border-bottom:1px solid ${C.edge};font-family:Arial,sans-serif;font-size:13px;color:${C.ink};">${placeText}</td>
        <td style="padding:8px 10px;border-bottom:1px solid ${C.edge};font-family:Arial,sans-serif;font-size:12px;color:${C.gold};">${badgeText || `<span style="color:${C.faint};">—</span>`}</td>
      </tr>`;
    })
    .join("");

  const th = (label: string, align = "right") =>
    `<th align="${align}" style="padding:8px 10px;border-bottom:2px solid ${C.edge};font-family:Arial,sans-serif;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:${C.faint};">${label}</th>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${BRAND_FULL} Weekly Stack Rank</title></head>
<body style="margin:0;padding:0;background-color:${C.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.bg};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="720" cellpadding="0" cellspacing="0" style="max-width:720px;width:100%;">

        <tr><td style="padding-bottom:4px;font-family:Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.gold};">${esc(BRAND_FULL)}</td></tr>
        <tr><td style="padding-bottom:2px;font-family:Arial,sans-serif;font-size:26px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:${C.ink};">Weekly Stack Rank</td></tr>
        <tr><td style="padding-bottom:18px;font-family:Arial,sans-serif;font-size:13px;color:${C.mute};">Week of ${esc(weekLabel)} · ranked by OVR — your last ${RATING_WINDOW_WEEKS} weeks of work, graded against the team</td></tr>

        ${top3.length === 3 ? `
        <tr><td style="padding-bottom:18px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.panel};border:1px solid ${C.edge};border-radius:6px;">
            <tr>${medalRow}</tr>
          </table>
        </td></tr>` : ""}

        <tr><td>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.panel};border:1px solid ${C.edge};border-radius:6px;">
            <tr>
              ${th("#", "left")}
              ${th("Agent", "left")}
              ${th("OVR", "center")}
              ${th("Premium (wk)")}
              ${th("Sales")}
              ${th("Close (leads)")}
              ${th("True HP")}
              ${th("Place rate")}
              ${th("Hardware", "left")}
            </tr>
            ${bodyRows}
          </table>
        </td></tr>

        <tr><td style="padding-top:14px;font-family:Arial,sans-serif;font-size:11px;line-height:1.6;color:${C.faint};">
          OVR (40–99) blends closing, placement, production, hustle, discipline, and consistency over your last ${RATING_WINDOW_WEEKS} weeks, graded on a curve against the team — one hot or cold week moves it a little, never all of it.
          True HP (horsepower) = hourly premium × place rate, from the official efficiency scorecard — output speed discounted by placement quality. "—" means not scored yet.
          Place rate counts only submission months that are mostly resolved ("baking" = too early to judge). Every rate shows its count — nobody is ranked on raw premium alone.
          <br>Data through nightly sync${syncedAt ? ` · last updated ${esc(new Date(syncedAt).toLocaleString("en-US", { timeZone: "America/Los_Angeles" }))} PT` : ""}. Not live.
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
