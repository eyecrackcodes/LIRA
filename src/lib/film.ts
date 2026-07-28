import "server-only";
import type { CallTranscriptRow } from "./types";

/**
 * The Film Room — gamified coaching on real call transcripts (spec: item 8
 * in APP-PROMPT.md). Phase A only: read-only library + session comparison.
 * Coach pins/notes and the three film badges need a writable app table this
 * project doesn't have yet (the warehouse is read-only) — deferred.
 *
 * PRIVACY: transcripts carry client names/health/bank details. Every caller
 * into this module MUST gate with canViewAgentFilm() — managers see all film,
 * an agent sees only their OWN.
 */

// ---------------------------------------------------------------------------
// Day grouping — day_sales/day_premium/day_dials/trigger are day-level
// context repeated on every call captured that day; overall_score and
// duration_sec are per-call (confirmed against real rows, not just the doc).
// ---------------------------------------------------------------------------

export interface FilmDay {
  agent: string;
  call_date: string;
  trigger: "hot" | "cold";
  day_sales: number | null;
  day_premium: number | null;
  day_dials: number | null;
  calls: CallTranscriptRow[];
}

export function buildFilmDays(rows: CallTranscriptRow[]): FilmDay[] {
  const byKey = new Map<string, FilmDay>();
  for (const r of rows) {
    const key = `${r.agent}__${r.call_date}`;
    let day = byKey.get(key);
    if (!day) {
      day = {
        agent: r.agent,
        call_date: r.call_date,
        trigger: r.trigger,
        day_sales: r.day_sales,
        day_premium: r.day_premium,
        day_dials: r.day_dials,
        calls: [],
      };
      byKey.set(key, day);
    }
    day.calls.push(r);
  }
  return [...byKey.values()].sort((a, b) => (a.call_date < b.call_date ? 1 : -1));
}

/** Best call of a day = highest score; ties broken by longest call. */
export function bestCallOf(day: FilmDay): CallTranscriptRow {
  return [...day.calls].sort((a, b) => {
    const s = (b.overall_score ?? -1) - (a.overall_score ?? -1);
    if (s !== 0) return s;
    return (b.duration_sec ?? 0) - (a.duration_sec ?? 0);
  })[0];
}

/**
 * The agent's own best hot-day call — the "this is you at your best" anchor
 * for the Back-on-Track flow. Highest day_sales, tie-broken by the day's
 * best call score, tie-broken by most recent.
 */
export function pickBestHotCall(days: FilmDay[]): CallTranscriptRow | null {
  const hotDays = days.filter((d) => d.trigger === "hot" && d.calls.length > 0);
  if (hotDays.length === 0) return null;
  const ranked = [...hotDays].sort((a, b) => {
    const s = (b.day_sales ?? 0) - (a.day_sales ?? 0);
    if (s !== 0) return s;
    const scoreA = bestCallOf(a).overall_score ?? -1;
    const scoreB = bestCallOf(b).overall_score ?? -1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.call_date < b.call_date ? 1 : -1;
  });
  return bestCallOf(ranked[0]);
}

/** Most recent cold-day call — the default "slump day" side of a session. */
export function pickLatestColdCall(days: FilmDay[]): CallTranscriptRow | null {
  const coldDays = days.filter((d) => d.trigger === "cold" && d.calls.length > 0);
  if (coldDays.length === 0) return null;
  return bestCallOf(coldDays[0]); // days already sorted newest-first
}

// ---------------------------------------------------------------------------
// Transcript parsing.
//
// Attention emits turns as "Name (Role):\n<utterance>", where Role — when
// present — is "Salesperson" / "Prospect" (also "Automated System", a bank
// rep, etc.). Two things make the raw labels unreliable and drove this rewrite:
//   1. The name is STT-guessed and mangled — one rep in our own data showed up
//      under seven different surname spellings plus "Unknown Salesperson",
//      sometimes varying WITHIN a single call, and a rep who goes by a nickname
//      never matches their transcribed legal first name.
//   2. The old parser required a bare "Name:\n" header, so any call with the
//      "(Salesperson)" role suffix failed to split at all and collapsed into
//      one speaker.
// So instead of trusting the name, we resolve every turn to a ROLE — Agent /
// Client / Other — using (in priority) the parenthetical role, role keywords in
// the label, the agent's own name, and finally who actually speaks the sales
// script. STT name-variants of the one agent collapse into a single "Agent".
// The raw transcribed label is always kept and shown small for context.
// ---------------------------------------------------------------------------

export type SpeakerRole = "agent" | "client" | "other" | "unknown";

export interface TranscriptTurn {
  /** Friendly, resolved label: "Agent" | "Client" | "Other" | "Speaker N". */
  speaker: string;
  role: SpeakerRole;
  /** The raw label as transcribed (incl. role) — shown small, context only. */
  rawSpeaker: string;
  text: string;
  wordCount: number;
}

// Header: start-of-line, a name (anything up to a "(" or ":"), an optional
// "(role)", then ":" and end-of-line. Capped in length/words so a stray
// "Okay so the plan is:" mid-utterance doesn't get read as a speaker.
const TURN_START = /(?:^|\n)[ \t]*([A-Za-z][^:\n(]{0,58})(?:\(([^)\n]{1,40})\))?[ \t]*:[ \t]*\n/g;

const RE_OTHER = /\b(automated|voicemail|ivr|answering|system|bank)\b/;
const RE_AGENT = /\b(salesperson|sales|agent)\b/;
const RE_CLIENT = /\b(prospect|customer|client)\b/;

// Phrases the SALESPERSON says (final-expense script) — the tiebreaker that
// identifies the agent when there's no role annotation and the name is useless.
const AGENT_PHRASES = [
  "luminary life",
  "millionaire life",
  "final expense",
  "recorded line",
  "pleasure speaking",
  "pleasure of speaking",
  "who do i have",
  "date of birth",
  "beneficiary",
  "social security",
  "monthly premium",
  "spell your",
  "your last name",
  "routing",
  "coverage",
  "licensed",
];

const wordCount = (s: string) => (s ? s.split(/\s+/).filter(Boolean).length : 0);

/** Strip role words/fillers to a bare personal name for grouping + matching. */
function cleanName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(
      /\b(unknown|unidentified|speaker|the|caller|mr|mrs|ms|agent|salesperson|sales|rep|representative|prospect|customer|client|automated|system|voicemail)\b/g,
      " "
    )
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function explicitRole(label: string): SpeakerRole {
  const s = label.toLowerCase();
  if (RE_OTHER.test(s)) return "other";
  if (RE_AGENT.test(s)) return "agent";
  if (RE_CLIENT.test(s)) return "client";
  return "unknown";
}

interface RawTurn {
  name: string; // transcribed personal name (role stripped from parens)
  roleTag: string; // parenthetical role, if any
  rawSpeaker: string; // full transcribed label
  text: string;
  words: number;
  groupKey: string;
}

/**
 * Resolve every turn to Agent / Client / Other. agentName (the roster name) is
 * an extra signal — matched on any name token ≥ 3 chars, so "Dana Reyes" still
 * catches a transcribed "Dana Reyess"; it just won't fire when the rep goes by
 * initials or a nickname that shares no token with their roster name.
 */
export function parseTranscript(raw: string, agentName?: string): TranscriptTurn[] {
  const text = raw ?? "";
  const matches = [...text.matchAll(TURN_START)];

  if (matches.length === 0) {
    const cleaned = text.replace(/\s+/g, " ").trim();
    return cleaned
      ? [{ speaker: "Speaker 1", role: "unknown", rawSpeaker: "Speaker 1", text: cleaned, wordCount: wordCount(cleaned) }]
      : [];
  }

  const raws: RawTurn[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const name = m[1].trim();
    const roleTag = (m[2] ?? "").trim();
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const body = text.slice(start, end).replace(/\s+/g, " ").trim();
    if (!body) continue;
    // Reject over-long "names" that are really an utterance ending in a colon.
    if (wordCount(name) > 5 && !roleTag) continue;
    const clean = cleanName(name);
    const rawSpeaker = roleTag ? `${name} (${roleTag})` : name;
    raws.push({
      name,
      roleTag,
      rawSpeaker,
      text: body,
      words: wordCount(body),
      groupKey: clean || explicitRole(`${name} ${roleTag}`) || rawSpeaker,
    });
  }

  // Aggregate per speaker group: explicit role votes + sales-script phrase hits.
  interface Group {
    key: string;
    firstToken: string;
    agentVotes: number;
    clientVotes: number;
    otherVotes: number;
    scriptHits: number;
    order: number;
  }
  const groups = new Map<string, Group>();
  const agentTokens = (agentName ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);

  for (const t of raws) {
    let g = groups.get(t.groupKey);
    if (!g) {
      g = {
        key: t.groupKey,
        firstToken: cleanName(t.name).split(" ")[0] ?? "",
        agentVotes: 0,
        clientVotes: 0,
        otherVotes: 0,
        scriptHits: 0,
        order: groups.size,
      };
      groups.set(t.groupKey, g);
    }
    const role = explicitRole(`${t.name} ${t.roleTag}`);
    if (role === "agent") g.agentVotes++;
    else if (role === "client") g.clientVotes++;
    else if (role === "other") g.otherVotes++;
    // Roster-name match is an agent vote too.
    if (agentTokens.length && agentTokens.some((tok) => t.groupKey.includes(tok)))
      g.agentVotes++;
    const lc = t.text.toLowerCase();
    for (const p of AGENT_PHRASES) if (lc.includes(p)) g.scriptHits++;
  }

  const groupList = [...groups.values()];
  // The agent is whoever runs the script most (script hits), with explicit
  // "Salesperson" votes as the tiebreaker. Only trust it if there's a signal.
  const agentPrimary = groupList
    .slice()
    .sort((a, b) => b.scriptHits - a.scriptHits || b.agentVotes - a.agentVotes)[0];
  const hasAgentSignal =
    agentPrimary && (agentPrimary.scriptHits > 0 || agentPrimary.agentVotes > 0);

  const roleOf = (g: Group): SpeakerRole => {
    if (g.otherVotes > g.agentVotes && g.otherVotes > g.clientVotes) return "other";
    if (g.agentVotes > 0) return "agent";
    if (hasAgentSignal && g === agentPrimary) return "agent";
    // STT variant of the agent's name (same first name, no client role).
    if (
      hasAgentSignal &&
      g.clientVotes === 0 &&
      g.firstToken &&
      g.firstToken === agentPrimary.firstToken
    )
      return "agent";
    if (g.clientVotes > 0) return "client";
    // Once an agent is known, the other voices in a sales call are the client.
    if (hasAgentSignal) return "client";
    return "unknown";
  };

  const roleByKey = new Map<string, SpeakerRole>();
  for (const g of groupList) roleByKey.set(g.key, roleOf(g));

  // Fallback labels for any group we genuinely couldn't resolve (keeps the old
  // "Speaker N" behavior so an unlabeled call never regresses to blank).
  const speakerNo = new Map<string, number>();
  const labelFor = (key: string, role: SpeakerRole): string => {
    if (role === "agent") return "Agent";
    if (role === "client") return "Client";
    if (role === "other") return "Other";
    if (!speakerNo.has(key)) speakerNo.set(key, speakerNo.size + 1);
    return `Speaker ${speakerNo.get(key)}`;
  };

  return raws.map((t) => {
    const role = roleByKey.get(t.groupKey) ?? "unknown";
    return {
      speaker: labelFor(t.groupKey, role),
      role,
      rawSpeaker: t.rawSpeaker,
      text: t.text,
      wordCount: t.words,
    };
  });
}

/** First few turns as an "opening exchange" proxy — no timestamps exist to
 *  cut a real first-60-seconds window, so this is turn-count based. */
export function openingExchange(turns: TranscriptTurn[], maxTurns = 6): TranscriptTurn[] {
  return turns.slice(0, maxTurns);
}

export interface TalkShare {
  speaker: string;
  words: number;
  pct: number;
}

/** Talk-time share estimated by word count (no per-utterance timestamps to
 *  measure real seconds) — label this "approx." wherever it's shown. */
export function talkTimeShare(turns: TranscriptTurn[]): TalkShare[] {
  const byspeaker = new Map<string, number>();
  let total = 0;
  for (const t of turns) {
    byspeaker.set(t.speaker, (byspeaker.get(t.speaker) ?? 0) + t.wordCount);
    total += t.wordCount;
  }
  return [...byspeaker.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([speaker, words]) => ({ speaker, words, pct: total > 0 ? (100 * words) / total : 0 }));
}

/** Not Tailwind-utility-backed colors — see globals.css :root block. */
const SPEAKER_COLORS = [
  "var(--color-teal)",
  "var(--color-purple)",
];

/** Agent = gold (the person we're coaching), Client = blue, Other = muted. */
export function speakerColor(speaker: string): string {
  if (speaker === "Agent") return "var(--color-gold)";
  if (speaker === "Client") return "var(--color-blue)";
  if (speaker === "Other") return "var(--color-mute)";
  const idx = Number(speaker.replace(/\D/g, "")) - 1;
  return SPEAKER_COLORS[idx % SPEAKER_COLORS.length] ?? "var(--color-mute)";
}

export function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
