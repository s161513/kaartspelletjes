// Which finished round goes into the history, and with which help level.
//
// Pure bookkeeping for panel.ts, kept separate so it can be tested without a
// browser. The rule: a round is written to the history only if this player
// was seated and saw that round's PLAY phase live, and the very next view
// shows the round after it. That rules out
//   - a watcher who gets dealt in: they get role "citizen" for the hand they
//     only watched (logic.ts), which must not count as a round they played;
//   - a reload: the round in progress at the reload is logged at its end, but
//     a round that ended before the reload is never logged twice;
//   - skipped rounds (a disconnect spanning a whole hand).
// The help level stored is what was actually applied during that round's
// play (the highest level that was on), not whatever is switched on in the
// first view of the next round.

import type { Role } from "../types.js";
import type { HelpLevel } from "./context.js";

/** The round this player is (or was last) seated in during PLAY. */
export interface PlayedRound {
  round: number;
  helpLevel: HelpLevel; // highest level applied during this round's play (0 = help off)
}

/** Note one view in which I am seated and the round is in PLAY. */
export function notePlay(prev: PlayedRound | null, round: number, appliedLevel: HelpLevel): PlayedRound {
  if (prev && prev.round === round) {
    return { round, helpLevel: Math.max(prev.helpLevel, appliedLevel) as HelpLevel };
  }
  return { round, helpLevel: appliedLevel };
}

/**
 * On a new view: the finished round to log, or null. `role` = my role in the
 * new view, i.e. the result of the round that just ended.
 */
export function roundToLog(
  played: PlayedRound | null,
  view: { round: number; role: Role | null },
): { role: Role; helpLevel: HelpLevel } | null {
  if (!played || !view.role || view.round !== played.round + 1) return null;
  return { role: view.role, helpLevel: played.helpLevel };
}
