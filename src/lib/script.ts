import type { TranscriptTurn } from "./film";

/**
 * Script-section detection for the Film Room reader.
 *
 * Goal (per the coaching ask): let a reviewer jump straight to the part of the
 * call they care about — the opening/disclosure, the discovery, the health
 * questions, the quote, the close/application, the wrap. The final-expense
 * telesales script runs in a predictable order and is spoken by the AGENT, so
 * we scan agent turns for the first phrase that marks each stage and anchor a
 * jump-link to it. Same spirit as objection moments: a navigation aid, not a
 * grade — a stage that never fires just means the call didn't clearly reach it
 * (or the words differed), which is itself useful to see.
 */

export type ScriptSection =
  | "intro"
  | "discovery"
  | "health"
  | "quote"
  | "close"
  | "wrap";

export const SCRIPT_SECTIONS: Record<
  ScriptSection,
  { label: string; blurb: string; color: string }
> = {
  intro: {
    label: "Intro & disclosure",
    blurb: "Greeting, name, recorded-line + licensed disclosure.",
    color: "var(--color-gold)",
  },
  discovery: {
    label: "Discovery",
    blurb: "Who the coverage is for and why — the reason behind the call.",
    color: "var(--color-teal)",
  },
  health: {
    label: "Health questions",
    blurb: "Date of birth, medications, and health underwriting.",
    color: "var(--color-purple)",
  },
  quote: {
    label: "The quote",
    blurb: "Coverage amount and the monthly premium presentation.",
    color: "var(--color-blue)",
  },
  close: {
    label: "Close & application",
    blurb: "Beneficiary, banking/draft date — writing the application.",
    color: "var(--color-up)",
  },
  wrap: {
    label: "Wrap-up",
    blurb: "Confirmation, approval, welcome, and next steps.",
    color: "var(--color-mute)",
  },
};

/** Presentation order = the order the script is supposed to run in. */
export const SCRIPT_ORDER: ScriptSection[] = [
  "intro",
  "discovery",
  "health",
  "quote",
  "close",
  "wrap",
];

/**
 * Patterns are matched against AGENT turns only (the salesperson runs the
 * script). Kept lenient — this is navigation, so a near-miss that lands the
 * reader a couple turns early is fine; the risk we avoid is anchoring the wrong
 * STAGE, so each stage's phrases are distinctive to that stage.
 */
const PATTERNS: { section: ScriptSection; rx: RegExp }[] = [
  {
    section: "intro",
    rx: /\b(recorded line|record(ing|ed) (this|the) (call|line)|my (full )?name is|this is .{0,25}(department|calling)|licensed (agent|in|insurance)|benefit advisor|who do i have the pleasure|pleasure (of )?speaking|state licensed|for quality (and|&) training|calling (you )?(back )?(from|on behalf|regarding))\b/i,
  },
  {
    // NB: "final expense" is deliberately NOT a discovery signal — it's the
    // department branding in the greeting ("...in the Final Expense
    // Department"), which fired on the intro line. Discovery is who/why.
    section: "discovery",
    rx: /\b(coverage (just )?for (yourself|you and|both)|for yourself or (for )?(both|you and|someone)|what made you (decide|want|look|call)|looking (to get|for) (some )?coverage|protect your (family|loved)|leave (behind|something for)|who (would|will) (this|the coverage|it) be for|reason (for|behind) (the|your) call|planning on (traditional )?(burial|cremation)|take care of.{0,15}(final|funeral|arrangements))\b/i,
  },
  {
    section: "health",
    rx: /\b(date of birth|how old are you|any medications|are you (prescribed|taking)|height and (approximate )?weight|how tall|use of (tobacco|nicotine)|use (any )?tobacco|do you smoke|are you a smoker|diabet|high blood pressure|heart (attack|condition|disease)|health (questions|conditions|history)|treated for|any (medical )?conditions|prescription medication)\b/i,
  },
  {
    // Real quote = pricing. Educating on "term vs whole life" is presentation,
    // not the quote, and fired way too early — so we require a dollar amount
    // tied to a premium/month or an explicit "quoted a $X policy".
    // NB: boundaries are per-alternative, NOT a wrapping \b(...)\b — "$" is a
    // non-word char so a leading \b can never match before it, and a trailing
    // \b after a single \d fails mid-number on multi-digit amounts ("$41").
    // The old wrapped form silently killed every dollar-led pattern here.
    section: "quote",
    rx: /(?:\bmonthly premium\b|\bpremium (?:is|would be|will be|comes|of|at|runs)\b|\$\s?\d[\d,.]*\s*(?:a|per|each|\/)\s*(?:month|mo)\b|\bquoted[^.]{0,25}\$\s?\d|\bcomes? (?:out |up )?to[^.]{0,18}\$\s?\d|\bfor (?:a |an )?\$\s?\d[\d,.]*\s*(?:policy|coverage)\b|\boption (?:one|two|three|1|2|3)[^.]{0,30}\$\s?\d|\b(?:that|this) (?:one |policy )?(?:is|would be|comes to|runs)[^.]{0,12}\$\s?\d|\bfor \$\s?\d[\d,.]*\s*(?:a|per) (?:month|mo)\b)/i,
  },
  {
    // Application only — bank / SSN / draft. Deliberately excluded: bare
    // "social security" (the income question), "debit card" (eligibility
    // pre-qual), and "beneficiary" (often asked during discovery) — all fired
    // long before the actual application.
    section: "close",
    rx: /\b(who do you bank with|what bank (do|you)|routing( number)?|account number|(put in|need|give me|get|verify|read you) your social|social security number|draft date|first (payment|draft)|voided check|electronic funds transfer|bank information|select your (start|draft)|going forward.{0,15}draft)\b/i,
  },
  {
    // Wrap = the approval / issued policy at the END. "Congratulations" alone
    // fired on a social aside mid-call, and "welcome to" matched the carrier's
    // automated recording line — both removed.
    section: "wrap",
    rx: /\b((you'?ve |you have )?been approved|you'?re approved|approved for (the|coverage|immediate|you)|approved at the|you are (both )?(covered|insured)|you'?re (covered|insured|all set|good to go)|both covered|policy number|confirmation number|receive your polic|your (new )?policy will|coverage (starts|begins|is effective))\b/i,
  },
];

export interface ScriptMoment {
  section: ScriptSection;
  label: string;
  color: string;
  /** Index into the turns array — used to anchor/jump in the reader. */
  turnIndex: number;
  /** The phrase that marked the stage, for transparency. */
  matched: string;
}

const PATTERN_BY_SECTION = Object.fromEntries(
  PATTERNS.map((p) => [p.section, p.rx])
) as Record<ScriptSection, RegExp>;

/**
 * Sequential, order-aware detection: we walk the script stages IN ORDER and,
 * for each, take the first agent turn at or after where the previous stage
 * landed (a monotonic cursor). This guarantees the jump-bar always reads
 * intro → discovery → health → quote → close → wrap, and — crucially — stops
 * early phrases from being mislabeled (a "beneficiary" mentioned during
 * discovery isn't counted as the close, and a "monthly premium" recited in the
 * end-of-call recap isn't counted as the quote, because those markers are only
 * looked for once the preceding stage has been passed). A stage with no match
 * after the cursor is simply omitted — it didn't clearly happen in sequence.
 */
export function detectScriptSections(turns: TranscriptTurn[]): ScriptMoment[] {
  const result: ScriptMoment[] = [];
  let cursor = 0;

  for (const section of SCRIPT_ORDER) {
    const rx = PATTERN_BY_SECTION[section];
    for (let i = cursor; i < turns.length; i++) {
      const turn = turns[i];
      if (turn.role !== "agent" || turn.wordCount < 2) continue;
      const m = turn.text.match(rx);
      if (!m) continue;
      result.push({
        section,
        label: SCRIPT_SECTIONS[section].label,
        color: SCRIPT_SECTIONS[section].color,
        turnIndex: i,
        matched: m[0],
      });
      // Next stage must land strictly AFTER this turn — with `i` (not i+1) a
      // single long agent turn could claim two stages and anchor duplicate
      // jump-links to the same paragraph.
      cursor = i + 1;
      break;
    }
  }

  return result;
}
