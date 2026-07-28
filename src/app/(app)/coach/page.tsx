import { coachConfigured } from "@/lib/coach";
import { getViewer } from "@/lib/auth";
import CoachChat from "@/components/CoachChat";
import { Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CoachPage() {
  const viewer = await getViewer();
  const isAgent = viewer?.role === "agent";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="display text-3xl font-bold uppercase tracking-widest text-ink">
          Ask Coach
        </h1>
        <p className="text-sm text-mute">
          {isAgent ? (
            <>
              Questions about your rating, the stack rank, this week&apos;s pace — plus your own
              book: a day-by-day breakdown of your recent production and effort, your policies,
              chargebacks, pay periods, placement cohorts, and lead mix. Coach only ever sees{" "}
              <span className="text-ink">your</span> data, never anyone else&apos;s.
            </>
          ) : (
            <>
              Questions about ratings, the stack rank, True HP, place rate, this week&apos;s pace,
              or what a cold streak means — Coach answers from the same numbers on the board. Name
              any agent to pull their individual book: policies, chargebacks, pay periods, placement
              cohorts, lead mix, and a day-by-day breakdown.
            </>
          )}
        </p>
      </header>

      <Panel>
        <CoachChat configured={coachConfigured()} role={isAgent ? "agent" : "manager"} />
      </Panel>

      <p className="text-[11px] text-faint">
        {isAgent
          ? "Coach sees the agent-safe board data plus your own commission ledger, pay periods, placement cohorts, and lead-source mix — scoped to your login and enforced row-by-row in the database. Settled pay months are frozen; the commission team's statement is the source of truth. Answers are generated and can be imperfect."
          : "Coach sees the board data for the whole team, and — when you name an agent — that agent's full book (policies, pay, cohorts, lead mix, day-by-day). Managers are authorized for all agent data. Settled pay months are frozen; the commission team's statement is the source of truth. Answers are generated and can be imperfect."}
      </p>
    </div>
  );
}
