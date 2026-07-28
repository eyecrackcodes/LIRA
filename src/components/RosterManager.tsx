"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retireAgent, reinstateAgent, type ActionResult } from "@/app/(app)/roster/actions";
import { Panel, SectionTitle } from "@/components/ui";
import { fmtWeek } from "@/lib/format";

interface Departure {
  agent: string;
  departedOn: string | null;
  note: string | null;
}

/**
 * Manager-only roster management — "hang up the jersey". Retiring an agent
 * writes the app-owned override (survives the nightly dim_agent rebuild) and
 * drops them from every active-roster surface immediately. Reinstate removes it.
 */
export default function RosterManager({
  activeAgents,
  departures,
}: {
  activeAgents: string[];
  departures: Departure[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [agent, setAgent] = useState("");
  const [departedOn, setDepartedOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<ActionResult>, okText: string) => {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setMsg({ ok: true, text: okText });
        setAgent("");
        setNote("");
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error ?? "Something went wrong." });
      }
    });
  };

  const onRetire = () => {
    if (!agent) {
      setMsg({ ok: false, text: "Pick an agent first." });
      return;
    }
    if (!confirm(`Hang up ${agent}'s jersey? They'll drop off every active-roster view immediately.`)) {
      return;
    }
    run(() => retireAgent({ agent, departedOn, note }), `${agent}'s jersey is hung up.`);
  };

  return (
    <Panel>
      <SectionTitle sub="managers only · removes an agent from every active-roster view · survives the nightly rebuild">
        Roster Management
      </SectionTitle>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-faint">
          Agent
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            className="min-w-48 rounded-sm border border-edge bg-navy px-3 py-2 text-sm text-ink focus:border-gold-dim focus:outline-none"
          >
            <option value="">Select an agent…</option>
            {activeAgents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-faint">
          Departed on
          <input
            type="date"
            value={departedOn}
            onChange={(e) => setDepartedOn(e.target.value)}
            className="rounded-sm border border-edge bg-navy px-3 py-2 text-sm text-ink focus:border-gold-dim focus:outline-none"
          />
        </label>

        <label className="flex flex-1 flex-col gap-1 text-xs uppercase tracking-wider text-faint">
          Note (optional)
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Resigned, terminated, transferred…"
            className="min-w-40 rounded-sm border border-edge bg-navy px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-gold-dim focus:outline-none"
          />
        </label>

        <button
          type="button"
          onClick={onRetire}
          disabled={pending}
          className="display rounded-sm border border-gold-dim bg-navy px-4 py-2 text-sm font-bold uppercase tracking-wider text-gold transition-colors hover:bg-gold-dim/20 disabled:cursor-not-allowed disabled:border-edge disabled:text-faint"
        >
          {pending ? "Working…" : "Hang up jersey"}
        </button>
      </div>

      {msg && (
        <p className={`mt-3 text-sm ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>
      )}

      <div className="mt-4 border-t border-edge pt-4">
        <div className="mb-2 text-xs uppercase tracking-wider text-faint">
          Hung-up jerseys ({departures.length})
        </div>
        {departures.length === 0 ? (
          <p className="text-sm text-mute">No one retired app-side.</p>
        ) : (
          <ul className="space-y-1.5">
            {departures.map((d) => (
              <li key={d.agent} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold text-ink">{d.agent}</span>
                {d.departedOn && (
                  <span className="num text-mute">departed {fmtWeek(d.departedOn)}</span>
                )}
                {d.note && <span className="text-faint">· {d.note}</span>}
                <button
                  type="button"
                  onClick={() =>
                    run(() => reinstateAgent(d.agent), `${d.agent} is back on the active roster.`)
                  }
                  disabled={pending}
                  className="ml-auto whitespace-nowrap rounded-sm border border-edge px-2 py-1 text-xs uppercase tracking-wider text-mute transition-colors hover:border-gold-dim hover:text-gold disabled:cursor-not-allowed disabled:text-faint"
                >
                  Reinstate
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
