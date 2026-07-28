import { redirect } from "next/navigation";
import { requireManager } from "@/lib/auth";
import { getActiveAgents, getMailerSnapshots } from "@/lib/queries";
import { getThanksioOrders, type ThanksioOrder } from "@/lib/thanksio";
import { agentSlug, fmtInt, fmtWeek } from "@/lib/format";
import { Panel, SectionTitle, StatTile, Delta } from "@/components/ui";
import { MailerChart } from "@/components/charts";
import MailerExplorer from "@/components/MailerExplorer";

export const revalidate = 900;

export default async function MailerPage() {
  if (!(await requireManager())) redirect("/"); // marketing spend — manager-only

  // Live from thanks.io. The warehouse snapshot (upstream nightly ETL job) is currently
  // writing zeros for sends, so we read orders straight from the source and fall
  // back to the snapshot only if the API call fails.
  try {
    const [rawOrders, agents] = await Promise.all([getThanksioOrders(), getActiveAgents()]);

    // thanks.io image templates are named with truncated agent slugs ("eric-m",
    // "drew-i"); resolve them to real dim_agent names so the UI speaks the
    // team's vocabulary. Unresolved names fall back to the raw template name.
    const resolveAgent = (tpl: string): string => {
      const needle = tpl.toLowerCase();
      return agents.find((a) => agentSlug(a.agent).includes(needle))?.agent ?? tpl;
    };
    const orders: ThanksioOrder[] = rawOrders.map((o) =>
      o.templateName ? { ...o, templateName: resolveAgent(o.templateName) } : o
    );

    return (
      <div className="space-y-6">
        <header>
          <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
            Mailer Engagement
          </h1>
          <p className="text-sm text-mute">
            QR scans, delivery, spend, and creative performance — live from thanks.io. Ties the
            postcard spend to actual engagement.
          </p>
        </header>
        <MailerExplorer orders={orders} />
      </div>
    );
  } catch (e) {
    return <SnapshotMailer error={e instanceof Error ? e.message : String(e)} />;
  }
}

/** Fallback: warehouse snapshot view, used only when the thanks.io call fails. */
async function SnapshotMailer({ error }: { error: string | null }) {
  const snaps = await getMailerSnapshots(180);

  // Counters are cumulative — diff consecutive snapshots for per-day engagement.
  // Clamp negative diffs (counter resets) to zero rather than plotting nonsense.
  const daily = snaps.slice(1).map((s, i) => {
    const prev = snaps[i];
    return {
      day: fmtWeek(s.snap_date),
      date: s.snap_date,
      scans: Math.max(0, (s.total_scans ?? 0) - (prev.total_scans ?? 0)),
      uniques: Math.max(0, (s.unique_scans ?? 0) - (prev.unique_scans ?? 0)),
      sends: Math.max(0, (s.total_sends ?? 0) - (prev.total_sends ?? 0)),
    };
  });

  const latest = snaps[snaps.length - 1];
  const last7 = daily.slice(-7);
  const prior7 = daily.slice(-14, -7);
  const sumBy = (xs: typeof daily, k: "scans" | "sends" | "uniques") =>
    xs.reduce((s, d) => s + d[k], 0);

  const scans7 = sumBy(last7, "scans");
  const scansPrior7 = sumBy(prior7, "scans");
  const sends7 = sumBy(last7, "sends");
  const per100 =
    (latest?.total_sends ?? 0) > 0
      ? (100 * (latest?.total_scans ?? 0)) / (latest?.total_sends ?? 1)
      : null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
          Mailer Engagement
        </h1>
        <p className="text-sm text-mute">
          QR scans vs cards out (Thanks.io counters, snapped daily at 6 PM). Ties the postcard
          spend to actual engagement.
        </p>
      </header>

      {error && (
        <p className="text-xs text-mute">
          Live thanks.io feed unavailable ({error}); showing the nightly warehouse snapshot
          instead.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile
          label="Cards out (lifetime)"
          value={fmtInt(latest?.total_sends)}
          sample={latest ? `as of ${fmtWeek(latest.snap_date)}` : undefined}
        />
        <StatTile
          label="Scans — last 7 days"
          value={fmtInt(scans7)}
          delta={<Delta value={scans7 - scansPrior7} format={(v) => `${fmtInt(v)} vs prior 7d`} />}
        />
        <StatTile label="Cards sent — last 7 days" value={fmtInt(sends7)} />
        <StatTile
          label="Scans per 100 cards"
          value={per100 != null ? per100.toFixed(1) : "—"}
          sample="lifetime cumulative"
        />
      </div>

      <Panel>
        <SectionTitle sub="daily deltas from cumulative counters · resets clamp to 0">
          Scans & Sends by Day
        </SectionTitle>
        {daily.length < 2 ? (
          <p className="text-sm text-mute">
            Not enough snapshots yet — the 6 PM job needs a few days of history before this trend
            means anything.
          </p>
        ) : (
          <MailerChart data={daily} />
        )}
      </Panel>
    </div>
  );
}
