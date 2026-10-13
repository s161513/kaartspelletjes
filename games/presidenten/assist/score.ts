// Help decision: a trained logistic regression predicts P(scum), the chance
// that the player finishes this round in last place, from their context
// (features.ts). This is where context changes behaviour: the same hand and
// table produce no hint for one player and a highlighted move with an
// explanation for another, purely because of what the memory says about them.
//
//   z      = INTERCEPT + Σ COEF_i · (x_i − MEAN_i) / SCALE_i
//   P      = 1 / (1 + e^(−z))                      (the logistic function)
//
//   P < T1 → level 0  no help
//     < T2 → level 1  best move highlighted in blue
//     else → level 2  best move plus a one-line explanation
//
// The weights are not chosen by hand: ml/train.py fits them on simulated
// games and writes them to model.ts, together with T1 and T2 (the 70th and
// 90th percentile of the predicted P on the test set — so about 30% of rounds
// get some help and 10% the full explanation).
//
// Transparency: because the model is linear in the standardised features,
// each term COEF_i · (x_i − MEAN_i) / SCALE_i is that feature's own push on
// the log-odds (positive = "more likely Scum"). Those terms are shown to the
// player as the reasons for their help.
//
// Table size: the model only saw tables of four, where 1 in 4 players ends
// last. At a table of n the prior chance is 1/n, so the P we *show* is shifted
// on the log-odds scale (a standard prior correction):
//   P_n = sigmoid(z + logit(1/n) − logit(BASE_RATE))
// The help *level*, however, is decided on the model's own four-player P:
// T1/T2 were chosen at four players, and comparing P_n with them would give
// an average player at a 3-player table (P = 1/3 > T1) help just for sitting
// there. So the level answers "how much more at risk than average is this
// player?", the same question at every table size.

import type { HelpLevel } from "./context.js";
import {
  encode, FEATURE_NAMES, TRAINED_TABLE_SIZE, type FeatureName, type RawContext,
} from "./features.js";
import { BASE_RATE, COEF, FEATURES, INTERCEPT, MEAN, SCALE, THRESHOLDS } from "./model.js";

export { BASE_RATE, THRESHOLDS };

/**
 * The generated model must use the features in the same order as the code.
 * Checked on use rather than on import, so `simulate.ts --dataset` can still
 * generate data for a new feature list before the model is retrained.
 */
export const modelMatchesFeatures = (): boolean =>
  FEATURES.length === FEATURE_NAMES.length
  && FEATURES.every((f, i) => f === FEATURE_NAMES[i]);

/** One reason behind the prediction, for the UI and the console. */
export interface Factor {
  label: string; // e.g. "Losing streak"
  value: string; // human-readable input, e.g. "4 rounds"
  contribution: number; // push on the log-odds; > 0 raises P(scum)
}

export interface HelpDecision {
  p: number; // predicted P(scum) at this table size, 0 … 1 (shown to the player)
  pModel: number; // the model's four-player P, which decides the level
  level: HelpLevel;
  factors: Factor[]; // biggest push first (empty with the context off)
  usedContext: boolean;
}

export interface HelpOptions {
  /**
   * The context switch for the demo: with `false` the memory is ignored and
   * every player gets the base rate (1/n at the table) — and so the same
   * level, which is level 0: no help for anyone.
   */
  useContext?: boolean;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const logit = (p: number) => Math.log(p / (1 - p));

/** Log-odds shift from the trained table (base rate BASE_RATE) to a table of n players. */
export function tableShift(tableSize: number): number {
  const n = Math.max(2, Math.round(tableSize)) || TRAINED_TABLE_SIZE;
  return logit(1 / n) - logit(BASE_RATE);
}

/**
 * The model's own P(scum) (four players, no table-size shift) plus each
 * feature's contribution (coef × standardised value) to the log-odds.
 */
export function predictScum(raw: RawContext): { p: number; contributions: Record<FeatureName, number> } {
  if (!modelMatchesFeatures()) throw new Error("assist/model.ts is out of date: re-run ml/train.py");
  const x = encode(raw);
  const contributions = {} as Record<FeatureName, number>;
  let z = INTERCEPT;
  FEATURE_NAMES.forEach((name, i) => {
    const c = COEF[i] * ((x[name] - MEAN[i]) / SCALE[i]);
    contributions[name] = c;
    z += c;
  });
  return { p: sigmoid(z), contributions };
}

/** T1/T2 expressed on the P scale shown at a table of n (for display only). */
export function thresholdsAt(tableSize: number): [number, number] {
  const shift = tableShift(tableSize);
  return [sigmoid(logit(THRESHOLDS[0]) + shift), sigmoid(logit(THRESHOLDS[1]) + shift)];
}

/** Help level from the model's four-player P (see the table-size note above). */
export function levelFor(p: number): HelpLevel {
  if (p < THRESHOLDS[0]) return 0;
  if (p < THRESHOLDS[1]) return 1;
  return 2;
}

// ---------------------------------------------------------------------------
// Human-readable reasons
// ---------------------------------------------------------------------------

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** Whole numbers as is, others with one decimal (help-weighted counts, scaled hands). */
const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * Features shown to the player. hour_sin and hour_cos are one idea ("time of
 * day", see encode() in features.ts), so their contributions are added up
 * into a single reason.
 */
const GROUPS: { label: string; features: FeatureName[]; value: (r: RawContext) => string }[] = [
  { label: "Win rate (last 20)", features: ["winrate_20"], value: (r) => pct(r.winrate_20) },
  { label: "Scum finishes (last 20)", features: ["scum_count_20"], value: (r) => num(r.scum_count_20) },
  // "Win" = a finish in the winners' tier; at four players that is President only.
  { label: "Rounds without a win (top finish)", features: ["loss_streak"], value: (r) => String(r.loss_streak) },
  { label: "Rounds this session", features: ["rounds_in_session"], value: (r) => String(r.rounds_in_session) },
  { label: "Session length", features: ["session_minutes"], value: (r) => `${r.session_minutes} min` },
  {
    label: "Time of day",
    features: ["hour_sin", "hour_cos"],
    value: (r) => hh(r.hour_of_day),
  },
  { label: "Hand strength (2s, aces, kings)", features: ["hand_strength"], value: (r) => num(r.hand_strength) },
];

/** All reasons, biggest push (either way) first. */
export function explain(raw: RawContext, contributions: Record<FeatureName, number>): Factor[] {
  return GROUPS
    .map((g) => ({
      label: g.label,
      value: g.value(raw),
      contribution: g.features.reduce((sum, f) => sum + contributions[f], 0),
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

// ---------------------------------------------------------------------------

export function computeHelp(raw: RawContext, options: HelpOptions = {}): HelpDecision {
  const { useContext = true } = options;
  const shift = tableShift(raw.table_size);
  if (!useContext) {
    // Context off: no memory, no adaptation — everyone is "the average player".
    return {
      p: sigmoid(logit(BASE_RATE) + shift), // = 1/n
      pModel: BASE_RATE,
      level: levelFor(BASE_RATE),
      factors: [],
      usedContext: false,
    };
  }
  const { p, contributions } = predictScum(raw);
  return {
    p: sigmoid(logit(p) + shift),
    pModel: p,
    level: levelFor(p),
    factors: explain(raw, contributions),
    usedContext: true,
  };
}
