// Context memory for the adaptive help (Lab 8 "Context is King").
//
// The help layer adapts to *who* is playing. It keeps one record per finished
// round (hand) and derives three layers of context from that history (turned
// into model inputs by features.ts, and into P(scum) by score.ts):
//
//   long term   win rate and scum rate over a sliding window of recent rounds
//               → the player's structural level
//   session     losing streak and rounds played in this sitting → short-term
//               "tilt"
//   environment time of day and session length → fatigue
//
// (The fourth layer, the game state itself — hand, table — is not stored: the
// advisor reads it live from the view.)
//
// Storage is behind a tiny `ContextStore` interface so the same code runs in
// the browser (localStorage, per nickname) and in the Node simulation/tests
// (in memory). Everything here is pure TypeScript with no DOM or Node imports.

import type { Role } from "../types.js";

/** 0 = no help, 1 = best move highlighted, 2 = plus an explanation. See score.ts. */
export type HelpLevel = 0 | 1 | 2;

/** One finished round from the point of view of one player. */
export interface RoundRecord {
  at: number; // epoch ms when the round finished
  sessionId: string; // rounds less than SESSION_GAP_MS apart share a session
  role: Role; // standing this round earned (president … scum)
  won: boolean; // finished in the winners' tier
  scum: boolean; // finished as Scum or Vice-Scum
  helpLevel: HelpLevel; // help that was active during the round
  hintsShown: number; // turns on which a hint was displayed
  hintsFollowed: number; // of those, turns where the player made the hinted move
}

/** Long-term window: only the most recent rounds describe the current level. */
export const WINDOW = 20;
/** A pause longer than this starts a new session. */
export const SESSION_GAP_MS = 30 * 60_000;
/** Raw history kept for the record (and the "forget me" button to wipe). */
const MAX_STORED = 200;

/**
 * Every round played *with* help (won or lost) counts as only half a round of
 * evidence, so that help which lifts the results does not immediately switch
 * itself off again (the dependency loop). Applied to both the win rate and
 * the Scum count.
 */
export const HELPED_ROUND_WEIGHT = 0.5;

/**
 * Bayesian smoothing: we pretend every player starts with PRIOR_ROUNDS
 * "average" rounds. A brand-new player therefore gets a neutral estimate
 * instead of 0% or 100% after a single hand.
 *
 * "Average" is taken at a table of four, the table size the P(scum) model is
 * trained on: there exactly one player wins (President) and one ends last
 * (Scum), so both priors are 1/4. (At other sizes the winners' tier is about
 * a third; see tierSize in rules.ts — score.ts corrects P for the table size.)
 */
export const PRIOR_ROUNDS = 3;
export const PRIOR_WIN_RATE = 1 / 4;
/** Expected share of last places (role "scum") for an average player at four. */
export const PRIOR_LAST_PLACE = 1 / 4;

const WIN_ROLES = new Set<Role>(["president", "vice-president", "winner"]);
const SCUM_ROLES = new Set<Role>(["scum", "vice-scum"]);

export const isWin = (role: Role): boolean => WIN_ROLES.has(role);
export const isScum = (role: Role): boolean => SCUM_ROLES.has(role);

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface ContextStore {
  load(): RoundRecord[];
  save(records: RoundRecord[]): void;
  clear(): void;
}

/** In-memory store, for the simulation and tests. */
export class MemoryStore implements ContextStore {
  private records: RoundRecord[];
  constructor(initial: RoundRecord[] = []) {
    this.records = structuredClone(initial);
  }
  load(): RoundRecord[] {
    return structuredClone(this.records);
  }
  save(records: RoundRecord[]): void {
    this.records = structuredClone(records);
  }
  clear(): void {
    this.records = [];
  }
}

/**
 * Browser store. Keyed by nickname, because the game's player ids are random
 * per room; the nickname is the only identity that survives across games.
 * Storage can be unavailable (private mode, blocked site data), so every access
 * is guarded and failure simply means "no history".
 */
export class LocalStorageStore implements ContextStore {
  private readonly key: string;
  constructor(nickname: string) {
    this.key = `presidenten-assist:${nickname.trim().toLowerCase()}`;
  }
  load(): RoundRecord[] {
    try {
      const raw = localStorage.getItem(this.key);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as RoundRecord[]) : [];
    } catch {
      return [];
    }
  }
  save(records: RoundRecord[]): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(records));
    } catch {
      // Storage full or blocked: the help still works, it just won't remember.
    }
  }
  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Writing history
// ---------------------------------------------------------------------------

export interface RoundOutcome {
  role: Role;
  helpLevel: HelpLevel;
  hintsShown: number;
  hintsFollowed: number;
}

/**
 * Append one finished round. The session id is carried over from the previous
 * record when it is recent enough, otherwise a new session starts.
 */
export function appendRound(
  records: readonly RoundRecord[],
  outcome: RoundOutcome,
  now: number,
): RoundRecord[] {
  const last = records[records.length - 1];
  const sameSession = last !== undefined && now - last.at <= SESSION_GAP_MS;
  const record: RoundRecord = {
    at: now,
    sessionId: sameSession ? last.sessionId : `s${now}`,
    role: outcome.role,
    won: isWin(outcome.role),
    scum: isScum(outcome.role),
    helpLevel: outcome.helpLevel,
    hintsShown: outcome.hintsShown,
    hintsFollowed: outcome.hintsFollowed,
  };
  return [...records, record].slice(-MAX_STORED);
}

// ---------------------------------------------------------------------------
// Reading context
// ---------------------------------------------------------------------------

/** What the memory says about the player at one moment (features.ts builds on this). */
export interface ContextSummary {
  // long term
  rounds: number; // rounds in the window (0 … WINDOW)
  winRate: number; // smoothed, help-weighted share of won rounds
  lastPlaces: number; // help-weighted, prior-filled count of last places (Scum) in the window
  // session
  lossStreak: number; // most recent rounds in a row without a win, within this session
  sessionRounds: number; // rounds in the current session (0 when it lapsed)
  // Minutes since the *end* of the session's first round (records only store
  // when a round finished). The simulation and the browser both use this.
  sessionMinutes: number;
  // environment
  hour: number; // local hour of day, 0–23
  // bookkeeping, for transparency in the UI
  hintsShown: number;
  hintsFollowed: number;
}

export function summarize(records: readonly RoundRecord[], now: number): ContextSummary {
  const window = records.slice(-WINDOW);

  // Long term: weighted, smoothed win rate over the window.
  let weight = PRIOR_ROUNDS;
  let wins = PRIOR_ROUNDS * PRIOR_WIN_RATE;
  // Last places, counted over a full window of WINDOW rounds: a round that is
  // missing (newcomer) counts as average, a helped round as w · actual +
  // (1 − w) · average — half evidence, half prior.
  let lastPlaces = (WINDOW - window.length) * PRIOR_LAST_PLACE;
  for (const r of window) {
    const w = r.helpLevel > 0 ? HELPED_ROUND_WEIGHT : 1;
    weight += w;
    if (r.won) wins += w;
    lastPlaces += w * (r.role === "scum" ? 1 : 0) + (1 - w) * PRIOR_LAST_PLACE;
  }

  const last = records[records.length - 1];
  const live = last !== undefined && now - last.at <= SESSION_GAP_MS;
  const session = live ? records.filter((r) => r.sessionId === last.sessionId) : [];

  // Session: walk back from the newest round while it is not a win. Only this
  // session counts — a fresh session (or one after a break) starts clean.
  let lossStreak = 0;
  for (let i = session.length - 1; i >= 0 && !session[i].won; i--) lossStreak++;
  const sessionStart = session.length ? session[0].at : now;

  return {
    rounds: window.length,
    winRate: wins / weight,
    lastPlaces,
    lossStreak,
    sessionRounds: session.length,
    sessionMinutes: Math.round((now - sessionStart) / 60_000),
    hour: new Date(now).getHours(),
    hintsShown: window.reduce((n, r) => n + r.hintsShown, 0),
    hintsFollowed: window.reduce((n, r) => n + r.hintsFollowed, 0),
  };
}

// ---------------------------------------------------------------------------
// Demo histories, so the A/B effect can be shown without playing 20 rounds
// ---------------------------------------------------------------------------

/**
 * A fixed history for the live demo (`?assistDemo=weak|strong`): a struggling
 * player who keeps ending up as Scum, or a strong one who mostly wins.
 */
export function demoHistory(profile: "weak" | "strong", now: number): RoundRecord[] {
  const pattern: Role[] = profile === "weak"
    ? ["scum", "scum", "citizen", "scum", "vice-scum", "scum", "citizen", "scum", "scum", "scum"]
    : ["president", "vice-president", "president", "citizen", "president",
      "president", "vice-president", "president", "citizen", "president"];
  let records: RoundRecord[] = [];
  // Two passes over the pattern = a full window, the last rounds minutes ago.
  const roles = [...pattern, ...pattern];
  roles.forEach((role, i) => {
    const at = now - (roles.length - i) * 4 * 60_000;
    records = appendRound(records, { role, helpLevel: 0, hintsShown: 0, hintsFollowed: 0 }, at);
  });
  return records;
}
