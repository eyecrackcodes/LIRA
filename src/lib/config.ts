/**
 * Business constants — the numbers that encode YOUR comp plan.
 *
 * These are the knobs most likely to differ between teams. They live here (not
 * inline) so adapting the template to your plan is one file, not a grep.
 * Everything is overridable by env var so you can change it without a rebuild.
 */

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Monthly draw (advance against commission). Commission payable for a
 * statement month = max(0, net commission − draw). Set to 0 if your team has
 * no draw, and the payable math collapses to plain net — no other change needed.
 */
export const MONTHLY_DRAW = num(process.env.MONTHLY_DRAW, 4000);

/** Monthly submitted-production goal per rep, used for the goal-pace tracker. */
export const MONTHLY_GOAL = num(process.env.MONTHLY_GOAL, 50_000);

/** Formatted draw for prose/tooltips — "$4,000". */
export const DRAW_LABEL = `$${MONTHLY_DRAW.toLocaleString("en-US")}`;
