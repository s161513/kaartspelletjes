// Help score: turns the context summary into "how much help does this player
// get right now". This is where context changes behaviour — the same hand and
// table produce no hint for one player and a highlighted move with an
// explanation for another, purely because of their history.
//
//   score = 0.5 · (1 − winRate)        structural level (long term)
//         + 0.3 · scumRate             how often they end at the bottom
//         + 0.2 · min(lossStreak/3, 1) short-term tilt (session)
//         + fatigue bonus              late at night / long session (environment)
//
//   score < 0.7 → level 0  no help
//         < 0.8 → level 1  best move highlighted in blue
//         else  → level 2  best move plus a one-line explanation
//
// Help is deliberately reserved for players who are clearly struggling: an
// average player (score ≈ 0.4) plays without hints.

import type { ContextSummary, HelpLevel } from "./context.js";

export const WEIGHTS = { winRate: 0.5, scumRate: 0.3, lossStreak: 0.2 } as const;
/** A losing streak of this many rounds counts as "full" tilt. */
export const STREAK_CAP = 3;
/** Small nudge for tired players. */
export const FATIGUE_BONUS = 0.05;
export const LONG_SESSION_MINUTES = 60;
/** Thresholds between levels 0|1 and 1|2. */
export const THRESHOLDS = [0.7, 0.8] as const;

/** One term of the score, kept separately so the UI can explain it. */
export interface Factor {
  label: string;
  value: string; // human-readable input, e.g. "35%"
  contribution: number; // how much it adds to the score
}

export interface HelpDecision {
  score: number; // 0 … 1
  level: HelpLevel;
  factors: Factor[];
  usedContext: boolean;
}

export interface HelpOptions {
  /**
   * The context switch for the demo: with `false` the memory is ignored and
   * everyone gets the same fixed level — no adaptation at all.
   */
  useContext?: boolean;
  fixedLevel?: HelpLevel;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function levelFor(score: number): HelpLevel {
  if (score < THRESHOLDS[0]) return 0;
  if (score < THRESHOLDS[1]) return 1;
  return 2;
}

export function computeHelp(summary: ContextSummary, options: HelpOptions = {}): HelpDecision {
  const { useContext = true, fixedLevel = 0 } = options;
  if (!useContext) return { score: 0, level: fixedLevel, factors: [], usedContext: false };

  const tired = summary.sessionMinutes >= LONG_SESSION_MINUTES
    || summary.hour >= 23 || summary.hour < 6;

  const factors: Factor[] = [
    {
      label: "Win rate (last rounds)",
      value: pct(summary.winRate),
      contribution: WEIGHTS.winRate * (1 - summary.winRate),
    },
    {
      label: "Scum rate",
      value: pct(summary.scumRate),
      contribution: WEIGHTS.scumRate * summary.scumRate,
    },
    {
      label: "Losing streak",
      value: String(summary.lossStreak),
      contribution: WEIGHTS.lossStreak * Math.min(summary.lossStreak / STREAK_CAP, 1),
    },
    {
      label: "Fatigue (late or long session)",
      value: tired ? "yes" : "no",
      contribution: tired ? FATIGUE_BONUS : 0,
    },
  ];
  const score = Math.min(1, factors.reduce((sum, f) => sum + f.contribution, 0));
  return { score, level: levelFor(score), factors, usedContext: true };
}
