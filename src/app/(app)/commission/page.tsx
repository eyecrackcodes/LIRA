import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, isManager } from "@/lib/auth";
import { getCommissionLedger } from "@/lib/queries";
import { computeUwMix } from "@/lib/underwriting";
import { fmtInt, fmtMoneyCents, fmtMoney, fmtMonth, fmtPct, fmtSignedMoney } from "@/lib/format";
import { HeaderTip, Panel, SectionTitle, StatTile } from "@/components/ui";
import { WaterfallChart } from "@/components/charts";
import { MONTHLY_DRAW } from "@/lib/config";

export const dynamic = "force-dynamic"; // viewer-scoped — never cache one role's render for another

// Monthly draw per agent — payable = max(0, Σnet − draw). Net can be negative;
// payable cannot. Configure the amount in src/lib/config.ts.
export { MONTHLY_DRAW } from "@/lib/config";

interface AgentMonth {
  agent: string;
  gross: number;
  chargebacks: number;
  net: number;
  payable: number;
  policies: number;
  chargedBack: number;
  origins: Set<string>;
}

export default async function CommissionPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const viewer = await getViewer();
  const manager = isManager(viewer);
  // Pay data: managers see the team; an agent sees ONLY their own rows.
  // Anyone else (role "none" slips past the layout only in theory) gets nothing.
  if (!manager && !(viewer?.role === "agent" && viewer.agent)) redirect("/");

  // TEMPORARY (2026-07-12): agent view is parked while the commission numbers
  // are validated against the commission team's statements. Managers keep the
  // full page. Delete this block to re-open the agent self-view below — the
  // own-rows scoping is still in place.
  if (!manager) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
            My Commission
          </h1>
        </header>
        <Panel>
          <div className="flex items-start gap-3">
            <span className="text-2xl" aria-hidden>
              🚧
            </span>
            <div>
              <div className="display mb-1 text-sm font-bold uppercase tracking-wider text-gold">
                Under construction
              </div>
              <p className="text-sm leading-relaxed text-mute">
                We&apos;re validating commission numbers against the commission team&apos;s
                statements before turning this page on. Your personal commission view — policies,
                chargebacks, and payable after draw — will unlock here once every number ties out.
                Until then, your pay questions go to your manager as usual.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  const { month: monthParam } = await searchParams;
  const allRows = await getCommissionLedger();
  const fullLedger = manager
    ? allRows
    : allRows.filter(
        (r) =>
          r.agent === viewer!.agent ||
          (r.agent_email ?? "").toLowerCase() === viewer!.email
      );

  if (!manager && fullLedger.length === 0) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
            My Commission
          </h1>
        </header>
        <Panel>
          <p className="text-sm text-mute">
            No commission history on the ledger yet — rows appear after your first policy is
            paid. If that seems wrong, ask your manager.
          </p>
        </Panel>
      </div>
    );
  }

  // A handful of rows carry no statement_month — surface, don't silently drop.
  const unassigned = fullLedger.filter((r) => r.statement_month == null);
  const ledger = fullLedger.filter(
    (r): r is (typeof fullLedger)[number] & { statement_month: string } =>
      r.statement_month != null
  );

  const months = [...new Set(ledger.map((r) => r.statement_month))].sort();
  const month = monthParam && months.includes(monthParam) ? monthParam : months[months.length - 1];
  const rows = ledger.filter((r) => r.statement_month === month);

  const byAgent = new Map<string, AgentMonth>();
  for (const r of rows) {
    const a = byAgent.get(r.agent) ?? {
      agent: r.agent,
      gross: 0,
      chargebacks: 0,
      net: 0,
      payable: 0,
      policies: 0,
      chargedBack: 0,
      origins: new Set<string>(),
    };
    a.gross += r.commission ?? 0;
    a.chargebacks += r.chargeback ?? 0;
    a.net += r.net ?? 0;
    a.policies += 1;
    if (r.status === "Charged Back") a.chargedBack += 1;
    if (r.origin) a.origins.add(r.origin);
    byAgent.set(r.agent, a);
  }
  const agentRows = [...byAgent.values()]
    .map((a) => ({ ...a, payable: Math.max(0, a.net - MONTHLY_DRAW) }))
    .sort((a, b) => b.payable - a.payable || b.net - a.net);

  const gross = agentRows.reduce((s, a) => s + a.gross, 0);
  const chargebacks = agentRows.reduce((s, a) => s + a.chargebacks, 0);
  const net = agentRows.reduce((s, a) => s + a.net, 0);
  const payable = agentRows.reduce((s, a) => s + a.payable, 0);
  const drawApplied = agentRows.reduce(
    (s, a) => s + Math.min(Math.max(a.net, 0), MONTHLY_DRAW),
    0
  );

  const waterfall = [
    { name: "Gross", base: 0, delta: gross, kind: "pos" as const },
    { name: "Chargebacks", base: gross + chargebacks, delta: -chargebacks, kind: "neg" as const },
    { name: "Net", base: 0, delta: net, kind: "total" as const },
    { name: "Draw applied", base: net - drawApplied, delta: drawApplied, kind: "neg" as const },
    { name: "Payable", base: 0, delta: payable, kind: "total" as const },
  ];

  const recentChargebacks = ledger
    .filter((r) => r.status === "Charged Back")
    .sort((a, b) => (b.chargeback_month ?? "").localeCompare(a.chargeback_month ?? ""))
    .slice(0, 15);

  // Underwriting mix + net effective rate over the ENTIRE book (all statement
  // months) — a stable, large-sample read, not the single-month snapshot above.
  const uwMix = computeUwMix(fullLedger);


  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
          {manager ? "Commission Center" : "My Commission"}
        </h1>
        <p className="text-sm text-mute">
          {manager
            ? "Statement months are frozen snapshots — the commission team's statement is the source of truth for actual pay."
            : "Your policies only. Statement months are frozen snapshots — the commission team's statement is the source of truth for actual pay."}
        </p>
      </header>

      <div className="flex flex-wrap gap-1">
        {months.slice(-12).map((m) => (
          <Link
            key={m}
            href={`/commission?month=${m}`}
            className={`display rounded-sm border px-3 py-1.5 text-xs uppercase tracking-wider ${
              m === month
                ? "border-gold-dim bg-navy text-gold"
                : "border-edge text-mute hover:border-edge2 hover:text-ink"
            }`}
          >
            {fmtMonth(m)}
          </Link>
        ))}
      </div>

      {unassigned.length > 0 && (
        <div className="rounded-sm border border-edge bg-panel px-4 py-2 text-xs text-mute">
          {unassigned.length} ledger row{unassigned.length === 1 ? "" : "s"} with no statement
          month (excluded from monthly math): {unassigned.map((r) => r.policy_key).join(", ")}
        </div>
      )}


      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile label="Gross commission" value={fmtMoney(gross)} sample={`${fmtInt(rows.length)} policies`} />
        <StatTile label="Chargebacks" value={<span className="text-down">{fmtSignedMoney(chargebacks)}</span>} />
        <StatTile label="Net" value={fmtMoney(net)} />
        <StatTile label="Payable" value={<span className="text-gold">{fmtMoney(payable)}</span>} sample={manager ? `after $${MONTHLY_DRAW.toLocaleString("en-US")} draw × agent` : `after $${MONTHLY_DRAW.toLocaleString("en-US")} monthly draw`} />
      </div>

      <Panel>
        <SectionTitle sub={`statement month ${fmtMonth(month)} · ${manager ? "team totals" : "your totals"}`}>
          Net-After-Draw Waterfall
        </SectionTitle>
        <WaterfallChart data={waterfall} />
      </Panel>

      {manager ? (
        <Panel>
          <SectionTitle sub="payable = max(0, Σnet − draw) per agent · net is signed">
            Agent Breakdown — {fmtMonth(month)}
          </SectionTitle>
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                  <th className="py-2 pr-4">Agent</th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Policies"
                      tip="Ledger rows for this statement month (paid or charged back)."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Gross"
                      tip="Commission earned this statement month, before chargebacks."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Chargebacks"
                      tip="Commission clawed back on lapsed/cancelled policies (always ≤ 0)."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Net"
                      tip="Gross + chargebacks. Signed — can go negative on a heavy chargeback month."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Payable"
                      tip={`max(0, net − $${MONTHLY_DRAW.toLocaleString("en-US")} monthly draw). Net can be negative; payable can't. The commission team's statement is the source of truth.`}
                      align="right"
                    />
                  </th>
                  <th className="py-2 text-left">
                    <HeaderTip
                      label="Origin"
                      tip="Where the ledger row came from: SEED (historical import), CAPTURE (nightly), or a June correction."
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {agentRows.map((a) => (
                  <tr key={a.agent} className="border-b border-edge/50">
                    <td className="py-2 pr-4 text-ink">{a.agent}</td>
                    <td className="py-2 pr-4 text-right">
                      {fmtInt(a.policies)}
                      {a.chargedBack > 0 && (
                        <span className="text-down"> ({a.chargedBack} CB)</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right">{fmtMoneyCents(a.gross)}</td>
                    <td className={`py-2 pr-4 text-right ${a.chargebacks < 0 ? "text-down" : "text-faint"}`}>
                      {a.chargebacks < 0 ? fmtMoneyCents(a.chargebacks) : "—"}
                    </td>
                    <td className={`py-2 pr-4 text-right ${a.net < 0 ? "text-down" : ""}`}>
                      {fmtMoneyCents(a.net)}
                    </td>
                    <td className={`py-2 pr-4 text-right font-semibold ${a.payable > 0 ? "text-gold" : "text-faint"}`}>
                      {fmtMoneyCents(a.payable)}
                    </td>
                    <td className="py-2 text-left text-[11px] uppercase tracking-wider text-faint">
                      {[...a.origins].join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        <Panel>
          <SectionTitle sub={`your policies paid or charged back in ${fmtMonth(month)}`}>
            Policy Detail — {fmtMonth(month)}
          </SectionTitle>
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                  <th className="py-2 pr-4">Policy</th>
                  <th className="py-2 pr-4">Carrier</th>
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Premium"
                      tip="Commissionable annual premium on the policy."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4 text-right">Rate</th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Net"
                      tip="Commission after any chargeback on this policy."
                      align="right"
                    />
                  </th>
                  <th className="py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.policy_key}-${i}`} className="border-b border-edge/50">
                    <td className="py-2 pr-4 text-mute">{r.policy_key}</td>
                    <td className="py-2 pr-4 text-mute">{r.carrier ?? "—"}</td>
                    <td className="py-2 pr-4 text-mute">{r.product ?? "—"}</td>
                    <td className="py-2 pr-4 text-right">{fmtMoneyCents(r.commissionable_premium)}</td>
                    <td className="py-2 pr-4 text-right text-mute">{r.rate ?? "—"}</td>
                    <td className={`py-2 pr-4 text-right ${(r.net ?? 0) < 0 ? "text-down" : ""}`}>
                      {fmtMoneyCents(r.net)}
                    </td>
                    <td
                      className={`py-2 text-left text-[11px] uppercase tracking-wider ${
                        r.status === "Charged Back" ? "text-down" : "text-faint"
                      }`}
                    >
                      {r.status ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {manager && uwMix.totalPolicies > 0 && (
        <Panel>
          <SectionTitle sub="entire book · net effective = net commission ÷ commissionable premium (net is after chargebacks)">
            Underwriting Mix &amp; Net Effective Rate
          </SectionTitle>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <span className="num display text-5xl font-bold text-gold">
              {fmtPct(uwMix.blendedNetEffRatePct, 1)}
            </span>
            <span className="num text-sm text-mute">
              blended net effective rate · {fmtMoney(uwMix.totalNet)} net on{" "}
              {fmtMoney(uwMix.totalCommPremium)} premium · {fmtInt(uwMix.totalPolicies)} policies
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-edge pt-3 text-sm">
            <span className="num text-mute">
              <HeaderTip
                label={`Gross effective: ${fmtPct(uwMix.blendedGrossEffRatePct, 1)}`}
                tip="Gross commission ÷ commissionable premium, before chargebacks. The gap between gross and net effective is the chargeback drag."
              />
            </span>
            <span className={`num ${uwMix.unclassifiedPct > 0 ? "text-warn" : "text-mute"}`}>
              <HeaderTip
                label={`${fmtInt(uwMix.unclassifiedPolicies)} unclassified (${fmtPct(uwMix.unclassifiedPct, 1)})`}
                tip="Policies with a blank/null uw_type or the literal 'Unknown'. Excluded from no math, but their UW class is unmapped at the source — map it upstream to sharpen this mix."
              />
            </span>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="num w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                  <th className="py-2 pr-4">UW type</th>
                  <th className="py-2 pr-4 text-right">Policies</th>
                  <th className="py-2 pr-4 text-right">% book</th>
                  <th className="py-2 pr-4 text-right">Comm. premium</th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip label="Gross eff." tip="Gross commission ÷ commissionable premium." align="right" />
                  </th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Net eff."
                      tip="Net commission (after chargebacks) ÷ commissionable premium — what the shop actually keeps."
                      align="right"
                    />
                  </th>
                  <th className="py-2 text-right">
                    <HeaderTip
                      label="CB drag"
                      tip="Chargebacks as a share of gross commission for this UW class. More negative = more clawback risk."
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
                    <td className="py-2 pr-4 text-right text-mute">{fmtPct(b.grossEffRatePct, 1)}</td>
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
          <p className="mt-3 text-[11px] text-faint">
            A richer mix (more Level, less GI/Graded) both pays a higher net effective rate and
            takes less chargeback drag. Unclassified rows carry a blank or &quot;Unknown&quot;
            uw_type — mapping them at the source tightens this read.
          </p>
        </Panel>
      )}

      <Panel>
        <SectionTitle sub={manager ? "most recent 15 across all months" : "your most recent, across all months"}>
          Chargeback Log
        </SectionTitle>
        {recentChargebacks.length === 0 ? (
          <p className="text-sm text-faint">No chargebacks on record. Keep it that way.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="num w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs uppercase tracking-wider text-faint">
                  {manager && <th className="py-2 pr-4">Agent</th>}
                  <th className="py-2 pr-4">Carrier</th>
                  <th className="py-2 pr-4">Policy</th>
                  <th className="py-2 pr-4 text-right">
                    <HeaderTip
                      label="Chargeback"
                      tip="Commission clawed back on this policy after lapse/cancellation."
                      align="right"
                    />
                  </th>
                  <th className="py-2 pr-4">
                    <HeaderTip label="CB month" tip="Month the chargeback hit." />
                  </th>
                  <th className="py-2">
                    <HeaderTip
                      label="Statement month"
                      tip="The frozen production month the policy was originally paid in."
                      align="right"
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentChargebacks.map((r, i) => (
                  <tr key={`${r.policy_key}-${i}`} className="border-b border-edge/50">
                    {manager && <td className="py-2 pr-4 text-ink">{r.agent}</td>}
                    <td className="py-2 pr-4 text-mute">{r.carrier ?? "—"}</td>
                    <td className="py-2 pr-4 text-mute">{r.policy_key}</td>
                    <td className="py-2 pr-4 text-right text-down">{fmtMoneyCents(r.chargeback)}</td>
                    <td className="py-2 pr-4 text-mute">{r.chargeback_month ? fmtMonth(r.chargeback_month) : "—"}</td>
                    <td className="py-2 text-mute">{fmtMonth(r.statement_month)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
