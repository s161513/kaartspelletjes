import type { Card } from "@app/shared";

export type PresidentenPhase = "PLAY" | "GAME_OVER";

// Server-only authoritative state. Never sent to clients directly; every event
// is projected per player through `playerView` so hands stay private.
export interface PresidentenState {
  players: string[]; // seat order, fixed for the round
  hands: Record<string, Card[]>;
  pile: Card[]; // all cards played in the current (and prior burned) tricks
  top: Card[] | null; // the current winning group on the pile (for display)
  finished: string[]; // finishing order so far; index 0 = President
  turnIndex: number; // index into `players` whose turn it is
  // Current trick requirement to follow (null = fresh trick, leader's free choice).
  currentCount: number | null; // group size that must be matched
  currentRankValue: number | null; // effective rank value that must be beaten or met
  // Running same-rank tally for the burn rule (four of a rank in a row).
  runRankValue: number | null;
  runCount: number;
  lastPlayerId: string | null; // who laid the current top (wins the trick on all-pass)
  passedSinceLastPlay: string[]; // active players who have passed since `lastPlayerId` played
  phase: PresidentenPhase;
  winner: string | null; // first player out (President)
  version: number; // bumped every applied move, lets the view drop stale selections
  deadline: number | null; // epoch ms when the current turn auto-resolves (null when over)
}

// Explicit allowlist for the wire — the only shape a client ever receives.
export interface PresidentenView {
  selfId: string;
  myHand: Card[];
  players: { id: string; cardCount: number; finishPlace: number | null }[];
  pileCount: number;
  pileTop: Card[] | null; // the cards of the current top play (for display)
  turn: string | null;
  currentCount: number | null;
  currentRank: string | null; // human label of the rank to beat, e.g. "Q"
  canPass: boolean; // false while leading a fresh trick
  phase: PresidentenPhase;
  winner: string | null;
  version: number;
  deadline: number | null; // when the current turn auto-resolves, for the countdown
  serverNow: number; // server clock at projection time, to sync the countdown
}

export type PresidentenMove =
  | { type: "play"; cardIds: string[] }
  | { type: "pass" };
