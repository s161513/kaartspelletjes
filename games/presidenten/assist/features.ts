// Feature extraction for the P(scum) model (Lab 8 "Context is King").
//
// Turns the context memory (context.ts) plus the hand the player holds when
// play starts into the fixed list of numbers the logistic regression in
// score.ts / model.ts expects. The *same* function runs in three places:
//
//   simulate.ts --dataset   writes one CSV row per player per round (training)
//   panel.ts (browser)      predicts P(scum) for the live player
//   assist.test.ts          checks the features
//
// so the training data and the live predictions can never drift apart.
//
// No leakage: every feature describes the situation *before* the round is
// played — the history only holds rounds that already finished, and the hand
// is the one dealt (after the exchange), before any card is played. The
// outcome of the round itself (its role) only ever becomes the *label*.
//
// Pure TypeScript, no DOM or Node imports: it runs in the browser and in Node.

import type { Card, Rank } from "@app/shared";
import { PRIOR_LAST_PLACE, summarize, type RoundRecord } from "./context.js";

/**
 * The model's inputs, in order. This list is the contract between the CSV
 * columns (simulate.ts), the Python training script (ml/train.py) and the
 * generated model (model.ts `FEATURES`); a test checks that they agree.
 */
export const FEATURE_NAMES = [
  "winrate_20",
  "scum_count_20",
  "loss_streak",
  "rounds_in_session",
  "session_minutes",
  "hour_sin",
  "hour_cos",
  "hand_strength",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
/** Model input: one number per feature (before standardisation). */
export type FeatureVector = Record<FeatureName, number>;

/**
 * The context in human terms, before the hour is encoded. This is what gets
 * stored per round (SQLite `rounds` table) and shown in the UI.
 */
export interface RawContext {
  // long term (last WINDOW = 20 rounds)
  winrate_20: number; // smoothed, help-weighted share of won rounds (context.ts)
  scum_count_20: number; // last places in the window; missing/helped rounds partly count as average
  // session
  // Rounds in a row without a *win* — a finish in the winners' tier
  // (President / Vice-President / Winner) — within this session. At a table
  // of four only the President wins, so this is "rounds since I was last
  // President", and a streak of 3+ is common even for an average player.
  loss_streak: number;
  rounds_in_session: number; // rounds already finished in this session
  session_minutes: number; // minutes since the end of the session's first round
  // environment
  hour_of_day: number; // local hour, 0–23
  // game state
  hand_strength: number; // strong cards in the hand, as a 13-card hand, see handStrength()
  // Not a model input: players at the table. The model is trained at four;
  // score.ts shifts P for other sizes.
  table_size: number;
}

/** The table size the model is trained on (simulate.ts --dataset). */
export const TRAINED_TABLE_SIZE = 4;
/** Cards per player at the trained table size (52 / 4). */
const TRAINED_HAND_SIZE = 13;

/** Re-exported for the tests: a newcomer's missing rounds count this much each. */
export const SCUM_PRIOR = PRIOR_LAST_PLACE;

// ---------------------------------------------------------------------------
// Hand strength
// ---------------------------------------------------------------------------

/**
 * Points per card. In Presidenten the wild 2 is the strongest card (it beats
 * everything and fills any group), then aces and kings: these are the cards
 * that win tricks and let you get out. Everything below a king can be beaten
 * by them, so we ignore it. 2 = 3 points, A = 2, K = 1.
 *
 * Why this matters: in the exchange the President asks the Scum for a rank
 * (usually a strong one) and gives back a card of their own choice, so last
 * round's Scum often starts with a weaker hand — exactly the kind of
 * situation the help is for.
 */
const CARD_POINTS: Partial<Record<Rank, number>> = { "2": 3, A: 2, K: 1 };

/**
 * Strength of an average hand when we don't know it: a 13-card hand from one
 * 52-card deck holding 4 × (3 + 2 + 1) = 24 points → 13/52 · 24 = 6. That is
 * also the mean of the training data, so an unknown hand pulls P neither way.
 */
export const AVERAGE_HAND_STRENGTH = 6;

/**
 * Sum of CARD_POINTS over the hand, scaled to a 13-card hand (× 13 / cards):
 * with 3 players a hand has ~17 cards, with 5 about 10, and the model only
 * knows 13-card hands (four players). At four players this is the plain sum,
 * an integer 0 … ~25. An empty hand counts as average.
 */
export function handStrength(hand: readonly Card[]): number {
  if (hand.length === 0) return AVERAGE_HAND_STRENGTH;
  const points = hand.reduce((sum, c) => sum + (CARD_POINTS[c.rank] ?? 0), 0);
  return (points * TRAINED_HAND_SIZE) / hand.length;
}

// ---------------------------------------------------------------------------
// Context → features
// ---------------------------------------------------------------------------

/**
 * Raw context for a player who is about to play a round at time `now`.
 * `records` = that player's finished rounds (oldest first; any that end after
 * `now` are ignored). `hand` = the hand they hold when play starts (after the
 * exchange); without one (or with a hand that is no longer the starting hand,
 * see panel.ts) we assume an average hand. `tableSize` = players dealt in.
 */
export function extractFeatures(
  records: readonly RoundRecord[],
  now: number,
  hand?: readonly Card[],
  tableSize = TRAINED_TABLE_SIZE,
): RawContext {
  // Guard against leakage: only rounds that had finished by `now` count, even
  // if the caller's history already holds later ones.
  const s = summarize(records.filter((r) => r.at <= now), now);
  return {
    winrate_20: s.winRate,
    // Last place only ("scum"), not vice-scum: that is what the model predicts.
    scum_count_20: s.lastPlaces,
    loss_streak: s.lossStreak,
    rounds_in_session: s.sessionRounds,
    session_minutes: s.sessionMinutes,
    hour_of_day: s.hour,
    hand_strength: hand ? handStrength(hand) : AVERAGE_HAND_STRENGTH,
    table_size: tableSize,
  };
}

/**
 * Raw context → model input. Only the hour needs encoding.
 *
 * Hour of day as sin/cos (a point on a circle) rather than the raw number:
 *   - it is cyclic: 23:00 and 00:00 are neighbours, not 23 apart;
 *   - a linear model on (sin, cos) can express any single bump over the day
 *     (a · cos(2π(h − peak)/24)), and *learns* where the bump is. So we don't
 *     have to pick a "late night" cut-off by hand (is 22:00 late? 23:30?);
 *     the data decides, and the coefficients show it.
 *
 * What the data showed (see ml/README.md): the hour adds almost nothing.
 * A round at a table of four always has exactly one Scum, and the clock is
 * the same for everyone at the table, so on its own it can never say *who*
 * ends last — at 02:00 the Scum share is still 1 in 4. It could only matter
 * relative to the other players ("tired weak players fall behind"), and even
 * then mostly says something about the *opponents* (at night they are the
 * ones deep into a long session). We tried hour × win-rate interaction
 * terms; they did not improve the test AUC, so the model keeps just sin/cos.
 *
 * Python (ml/train.py) recomputes sin/cos from `hour_of_day` and checks them
 * against the CSV, so both sides stay identical.
 */
export function encode(raw: RawContext): FeatureVector {
  const angle = (2 * Math.PI * raw.hour_of_day) / 24;
  return {
    winrate_20: raw.winrate_20,
    scum_count_20: raw.scum_count_20,
    loss_streak: raw.loss_streak,
    rounds_in_session: raw.rounds_in_session,
    session_minutes: raw.session_minutes,
    hour_sin: Math.sin(angle),
    hour_cos: Math.cos(angle),
    hand_strength: raw.hand_strength,
  };
}

/** A context built by hand, for the demos and tests (defaults: an average player at 15:00). */
export function makeContext(over: Partial<RawContext> = {}): RawContext {
  return {
    winrate_20: 0.25,
    scum_count_20: 5,
    loss_streak: 0,
    rounds_in_session: 5,
    session_minutes: 20,
    hour_of_day: 15,
    hand_strength: AVERAGE_HAND_STRENGTH,
    table_size: TRAINED_TABLE_SIZE,
    ...over,
  };
}
