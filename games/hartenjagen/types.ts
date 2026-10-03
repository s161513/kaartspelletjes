import type { Card } from "@app/shared";

export type Phase = "passing" | "playing" | "roundEnd";
export type PassDirection = "left" | "right" | "across" | "none";

export interface Play {
  playerId: string;
  card: Card;
}

export interface RoundResult {
  round: number;
  /** Penalty points each player got this round (after a moon is applied). */
  points: Record<string, number>;
  /** Player who shot the moon, if anyone. */
  moon: string | null;
}

export interface HeartsState {
  /** Seat order; "left" is the next player in this list. */
  players: string[];
  /** Cards in hand. Other players' cards are `null` in a player's view. */
  hands: Record<string, (Card | null)[]>;
  phase: Phase;
  roundNumber: number;
  passDirection: PassDirection;
  /** Card ids each player chose to pass (only your own in your view). */
  passes: Record<string, string[]>;
  /** Who has chosen their cards to pass (public). */
  passed: Record<string, boolean>;
  /** Card ids you received this round (only your own in your view). */
  received: Record<string, string[]>;
  /** Cards in the trick being played, in play order. */
  trick: Play[];
  /** The last completed trick, shown until the next card is played. */
  lastTrick: { plays: Play[]; winner: string } | null;
  /** Player whose turn it is, or null when nobody needs to play. */
  toPlay: string | null;
  heartsBroken: boolean;
  /** Completed tricks this round (0 = still the first trick). */
  tricksPlayed: number;
  /** Penalty points taken this round so far (before a moon is applied). */
  taken: Record<string, number>;
  /** Total score over all rounds — lowest wins. */
  scores: Record<string, number>;
  history: RoundResult[];
  /** Players who left; the game ends as soon as anyone leaves. */
  left: string[];
  /** Late-joiners spectating now; dealt in at the start of the next round. */
  pending: string[];
}

export type HeartsMove =
  | { type: "pass"; cards: string[] }
  | { type: "play"; card: string }
  | { type: "nextRound" };
