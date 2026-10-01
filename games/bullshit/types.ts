import type { Card, Rank } from "@app/shared";

export const BULLSHIT_WINDOW_MS = 3000;
export const REVEAL_MS = 2400;
// A game-specific ordering; the shared card library remains ace-high.
export const CLAIM_RANKS: readonly Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export type BullshitPhase = "TURN" | "CHALLENGE_WINDOW" | "RESOLVING_CHALLENGE" | "GAME_OVER";

export interface LastPlay {
  id: string;
  playerId: string;
  rank: Rank;
  cards: Card[];
}

export interface Reveal {
  cards: Card[];
  challengerId: string;
  automatic: boolean;
  loserId: string;
  lied: boolean;
  pileCount: number;
}

// Server-only state. No client imports this as its rendering state.
export interface BullshitState {
  roundId: string;
  players: string[];
  hands: Record<string, Card[]>;
  pile: Card[];
  turnIndex: number;
  rankIndex: number;
  phase: BullshitPhase;
  version: number;
  deadline: number | null;
  lastPlay: LastPlay | null;
  reveal: Reveal | null;
  winner: string | null;
}

// Explicit allowlist for the wire, used for EVERY game event.
export interface BullshitView {
  roundId: string;
  selfId: string;
  myHand: Card[];
  players: { id: string; cardCount: number }[];
  pileCount: number;
  turn: string | null;
  /** Last claim, or A at the start of a cleared trick. */
  claimedRank: Rank;
  allowedClaimRanks: Rank[];
  minimumPlayCount: number;
  phase: BullshitPhase;
  version: number;
  deadline: number | null;
  serverNow: number;
  lastPlay: { id: string; playerId: string; rank: Rank; count: number } | null;
  reveal: Reveal | null;
  winner: string | null;
}

export type BullshitMove =
  | { type: "playCards"; cardIds: string[]; claimedRank: Rank; playVersion: number; roundId: string }
  | { type: "challenge"; playId: string; roundId: string };
