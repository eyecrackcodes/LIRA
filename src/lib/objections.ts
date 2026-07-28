import type { TranscriptTurn } from "./film";

/**
 * Objection-moment detection for the Game Day tape (Session View).
 *
 * Goal (per the coaching ask): quickly isolate the moments where a CLIENT
 * raised an objection and the AGENT had an opportunity to handle it, so a
 * hot-day call and a cold-day call can be compared category-by-category —
 * "did they handle price differently on the day they closed vs. the day they
 * didn't?"
 *
 * This is deliberately a TRIAGE aid, not an auto-grader. The warehouse stores
 * only the raw transcript and a single rolled-up `overall_score` — Attention's
 * per-criterion "OBJECTION HANDLING ASSESSMENT" text is NOT mirrored (see
 * FILM-ROOM-PROMPT.md / DATA-CONTRACT.md), so there's no structured truth to
 * read. We detect candidate moments from the transcript instead.
 *
 * Two things make this reliable enough to ship where a naive keyword scan
 * would (rightly) have been rejected:
 *   1. We only inspect CLIENT turns (role resolution from parseTranscript) and
 *      pair them with the following AGENT turns — objection topics like price
 *      and health saturate normal FE calls, but *client resistance phrasing*
 *      in a client turn is a far tighter signal.
 *   2. Patterns are calibrated against real transcripts and biased toward
 *      precision — a missed moment is cheaper than a noisy false one, because a
 *      human coach reads every surfaced moment.
 */

export type ObjectionCategory =
  | "think"
  | "privacy"
  | "spouse"
  | "money"
  | "payment"
  | "trust"
  | "existing"
  | "not_interested";

export const OBJECTION_CATEGORIES: Record<
  ObjectionCategory,
  { label: string; blurb: string; color: string }
> = {
  think: {
    label: "Wants to think it over",
    blurb: "Stall — needs to think about it, wants to wait, 'call me back'.",
    color: "var(--color-gold)",
  },
  privacy: {
    label: "Won't share info",
    blurb: "Uncomfortable giving Social Security, bank, or personal info.",
    color: "var(--color-purple)",
  },
  spouse: {
    label: "Needs to consult",
    blurb: "Wants to talk it over with a spouse, child, or family first.",
    color: "var(--color-teal)",
  },
  money: {
    label: "Can't afford it",
    blurb: "Affordability — too expensive, over budget, on a fixed income.",
    color: "var(--color-blue)",
  },
  payment: {
    label: "Can't fund now",
    blurb: "No money in the account right now / payday timing.",
    color: "var(--color-up)",
  },
  trust: {
    label: "Skeptical",
    blurb: "Scam fear, 'who are you with', legitimacy doubt.",
    color: "var(--color-down)",
  },
  existing: {
    label: "Already covered",
    blurb: "Says they already have insurance or coverage.",
    color: "var(--color-mute)",
  },
  not_interested: {
    label: "Brush-off",
    blurb: "Not interested, take me off the list, stop calling.",
    color: "var(--color-down)",
  },
};

// Leads with the objections the coaches care about most.
export const OBJECTION_ORDER: ObjectionCategory[] = [
  "think",
  "privacy",
  "spouse",
  "money",
  "payment",
  "trust",
  "existing",
  "not_interested",
];

/**
 * Patterns calibrated against real transcripts and biased HARD toward precision
 * — these fire only on client resistance phrasing, not on answers to the
 * agent's script questions. Notably we do NOT match bare mentions ("my
 * daughter", "social security", "not right now") because those are almost
 * always answers to "who's the beneficiary?" / "what's your income?" / "have
 * you heard of Northwind Mutual?", not objections. First match wins per turn.
 */
const PATTERNS: { category: ObjectionCategory; rx: RegExp }[] = [
  {
    category: "privacy",
    rx: /\b(not comfortable|don'?t feel comfortable|uncomfortable (with|giving)|why do you (need|want) my (social|bank|account|routing|checking|information|info)|not giving (out |you )?my (social|bank|account|routing|card|information|info|number)|don'?t give (out )?my (social|bank|account|number)|not giving that out|don'?t give that out|leery (about|of) giving|hesitant to give|(not gonna|not going to|won'?t) give (out )?my (social|bank)|don'?t want to give (out )?my (social|bank|number|information|account))\b/i,
  },
  {
    category: "spouse",
    rx: /\b(talk (to|with) my (husband|wife|son|daughter|kids|children|family|spouse)|run it by my|check with my (husband|wife|son|daughter|kids|family)|discuss (it |this )?with my|let me (talk|check|speak) (to|with) my (husband|wife|son|daughter|kids|children|family|spouse)|my (husband|wife|son|daughter) (has to|needs to|would have to|wants to|would want to)|before i talk to my)\b/i,
  },
  {
    category: "money",
    // NB: "(just|only) ... social security" removed — "I'm only on social
    // security" is the standard ANSWER to the income question on nearly every
    // FE call, not pushback. Real affordability resistance still matches via
    // "can't afford" / "on a fixed income" / "too expensive" etc.
    rx: /\b(can'?t afford|cannot afford|can'?t really afford|too expensive|expensive for me|out of my budget|over my budget|on a fixed income|don'?t have that kind of money|too much for me|that'?s too much|can'?t swing|more than i (can|want to) (spend|pay|afford)|too rich for my|tight on money)\b/i,
  },
  {
    category: "payment",
    rx: /\b(nothing (in|on) my (account|bank|chime|card)|can'?t pay.{0,10}(today|right now)|don'?t get paid until|not until (payday|the first|next)|(don'?t|do not) have (the money|any money|that money|enough).{0,14}(right now|today|until|yet|on hand|this)|no money.{0,10}(right now|today|until)|until i get paid|wait until.{0,10}(payday|the first|my check|i get paid))\b/i,
  },
  {
    category: "think",
    rx: /\b(think (about|on) (it|that|this)|need to think about|(have|gotta|got) to think about|think it over|talk it over|go over (it|this|my budget|everything|the numbers) with|sleep on it|not ready (to|yet)|(wanna|want to) wait|hold off (on|for)|do (some|a little) more (research|homework)|look into it (more|further)|need (a little |some )?time to (think|decide)|not (gonna|going to) decide (today|right now)|let me get back to you|call (you|me) back (later|tomorrow|next|in a|this)|some other time)\b/i,
  },
  {
    category: "trust",
    rx: /\b(is this a scam|sounds like a scam|is this (for )?real|is this legit|is this legitimate|who are you with|how did you get my (number|info|information)|too good to be true|don'?t trust|is this some kind of)\b/i,
  },
  {
    category: "existing",
    rx: /\b(i already have (insurance|coverage|a policy|life)|already got (insurance|a policy|coverage)|have insurance through|through (work|my job|my employer)|got a policy already|already covered|i'?m already covered|have another policy)\b/i,
  },
  {
    category: "not_interested",
    rx: /\b(not interested|no thank you|take me off (your|the) (list|call)|stop calling|don'?t call me|remove me from|lose my number|not gonna do it|i'?ll pass|leave me alone)\b/i,
  },
];

// "think" is the noisiest category — the client often says "let me think" while
// recalling a fact (a birth date, a medication) or dismissively/in past tense
// ("didn't think about it until lately"). Skip those; keep real stalls.
const THINK_FALSE_POSITIVE =
  /\b(didn'?t|hadn'?t|don'?t even|never|haven'?t|wasn'?t) (ever |really )?(think|thought)|trying to think|wreck my brain|let me think\b(?![^.]*\babout (it|that|this))/i;

export interface ObjectionMoment {
  category: ObjectionCategory;
  label: string;
  /** Index into the turns array — used to anchor/highlight in the reader. */
  turnIndex: number;
  clientText: string;
  /** The phrase that triggered the match, for transparency. */
  matched: string;
  /** The agent's immediate reply (next agent turns), or "" if none followed. */
  agentResponse: string;
  /** True when the agent gave a substantive reply rather than a filler/no-op. */
  responded: boolean;
}

export interface ObjectionProfile {
  moments: ObjectionMoment[];
  countsByCategory: Partial<Record<ObjectionCategory, number>>;
  total: number;
  respondedCount: number;
}

/** Words in an agent reply below which we treat it as filler ("Okay.", "Yeah."). */
const SUBSTANTIVE_REPLY_WORDS = 8;
/** How many turns after the objection to scan for the agent's reply. */
const REPLY_WINDOW = 5;
/** Suppress a repeat of the same category within this many turns. */
const DEDUP_TURN_GAP = 10;

export function detectObjections(turns: TranscriptTurn[]): ObjectionProfile {
  const moments: ObjectionMoment[] = [];
  const lastSeenAt = new Map<ObjectionCategory, number>();

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role !== "client" || turn.wordCount < 3) continue;

    for (const { category, rx } of PATTERNS) {
      const m = turn.text.match(rx);
      if (!m) continue;
      if (category === "think" && THINK_FALSE_POSITIVE.test(turn.text)) continue;

      // Collapse the same objection restated across adjacent client turns.
      const prev = lastSeenAt.get(category);
      if (prev != null && i - prev <= DEDUP_TURN_GAP) {
        lastSeenAt.set(category, i);
        break;
      }
      lastSeenAt.set(category, i);

      const replyTurns: string[] = [];
      for (let j = i + 1; j < turns.length && j <= i + REPLY_WINDOW; j++) {
        if (turns[j].role === "agent") replyTurns.push(turns[j].text);
        else if (turns[j].role === "client" && replyTurns.length > 0) break;
      }
      const agentResponse = replyTurns.join("  ").trim();
      const responded =
        agentResponse.split(/\s+/).filter(Boolean).length >= SUBSTANTIVE_REPLY_WORDS;

      moments.push({
        category,
        label: OBJECTION_CATEGORIES[category].label,
        turnIndex: i,
        clientText: turn.text,
        matched: m[0],
        agentResponse,
        responded,
      });
      break; // one moment per client turn (highest-priority category)
    }
  }

  const countsByCategory: Partial<Record<ObjectionCategory, number>> = {};
  let respondedCount = 0;
  for (const mo of moments) {
    countsByCategory[mo.category] = (countsByCategory[mo.category] ?? 0) + 1;
    if (mo.responded) respondedCount++;
  }

  return { moments, countsByCategory, total: moments.length, respondedCount };
}

export interface ObjectionCompareRow {
  category: ObjectionCategory;
  label: string;
  blurb: string;
  color: string;
  hot: ObjectionMoment[];
  cold: ObjectionMoment[];
}

/**
 * Union of the two calls' objection vectors, category-aligned for the
 * side-by-side Game Day comparison. Categories absent from both are omitted.
 */
export function compareObjections(
  hot: ObjectionProfile,
  cold: ObjectionProfile
): ObjectionCompareRow[] {
  return OBJECTION_ORDER.map((category) => ({
    category,
    label: OBJECTION_CATEGORIES[category].label,
    blurb: OBJECTION_CATEGORIES[category].blurb,
    color: OBJECTION_CATEGORIES[category].color,
    hot: hot.moments.filter((m) => m.category === category),
    cold: cold.moments.filter((m) => m.category === category),
  })).filter((row) => row.hot.length > 0 || row.cold.length > 0);
}
