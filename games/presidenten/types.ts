import type { Card, Rank } from "@app/shared";

export type PresidentenPhase = "PLAY" | "EXCHANGE" | "GAME_OVER";

// The standings a player carries into the next hand, derived from the finishing
// order of the previous one (see `assignRoles` in rules.ts).
export type Role =
  | "president"
  | "vice-president"
  | "winner"
  | "citizen"
  | "loser"
  | "vice-scum"
  | "scum";

// The most recently completed trick, shown in the corner: who took it and the
// cards they took it with. `pile` and `burned` drive the sweep animation.
export interface LastTrick {
  by: string;
  cards: Card[]; // the winning group
  pile: Card[]; // the whole pile that was won/burned, so it can all sweep away
  burned: boolean; // cleared by four of a kind rather than won by passes
}

export interface ExchangePair {
  winner: string; // a top-tier finisher (President first)
  loser: string; // the paired bottom-tier finisher (Scum first)
}

// Between-hand card exchange. Pairs are a queue: the current pair is `pairs[0]`
// and is shifted off once its give-back completes.
export interface ExchangeState {
  pairs: ExchangePair[];
  step: "request" | "giveBack";
  lastMiss: string | null; // rank label the current loser just didn't have
  total: number; // original number of pairs, for "pair x of y" display
}

// Server-only authoritative state. Never sent to clients directly; every event
// is projected per player through `playerView` so hands stay private.
export interface PresidentenState {
  players: string[]; // seat order, re-seated to finishing order each new hand
  hands: Record<string, Card[]>;
  pile: Card[]; // all cards played in the current (and prior burned) tricks
  top: Card[] | null; // the current winning group on the pile (for display)
  finished: string[]; // finishing order so far; index 0 = President
  turnIndex: number; // index into `players` whose turn it is (PLAY phase)
  // Current trick requirement to follow (null = fresh trick, leader's free choice).
  currentCount: number | null; // group size that must be matched
  currentRankValue: number | null; // effective rank value that must be beaten or met
  // Running same-rank tally for the burn rule (four of a rank in a row).
  runRankValue: number | null;
  runCount: number;
  lastPlayerId: string | null; // who laid the current top (wins the trick on all-pass)
  passedThisTrick: string[]; // players who passed this trick — out until it resolves
  phase: PresidentenPhase;
  winner: string | null; // set only at GAME_OVER (when too few players remain)
  version: number; // bumped every applied move, lets the view drop stale selections
  deadline: number | null; // epoch ms when the current turn auto-resolves (null when over)
  round: number; // 1-based hand counter
  roles: Record<string, Role> | null; // carried from the previous hand (null on the first)
  exchange: ExchangeState | null; // present only during the EXCHANGE phase
  left: string[]; // ids that have left the room and must be dropped on re-deal
  lastTrick: LastTrick | null; // most recent completed trick this hand (null on a fresh deal)
  pending: string[]; // late-joiners spectating now, dealt in at the next hand
}

// The exchange view a client receives while the EXCHANGE phase is active.
export interface ExchangeView {
  activeWinner: string; // whose exchange turn it is
  loser: string; // the loser they are paired with right now
  step: "request" | "giveBack";
  lastMiss: string | null;
  done: number; // pairs already completed
  total: number; // total pairs this exchange
}

// Explicit allowlist for the wire — the only shape a client ever receives.
export interface PresidentenView {
  selfId: string;
  myHand: Card[];
  players: {
    id: string;
    cardCount: number;
    finishPlace: number | null;
    role: Role | null;
    passed: boolean; // out of the current trick (passed or auto-skipped)
  }[];
  pile: Card[]; // the full (public, face-up) pile, for a stacked look
  pileCount: number;
  pileTop: Card[] | null; // the cards of the current top play (for display)
  topBy: string | null; // who laid the current top (so their play can fly in from their seat)
  turn: string | null; // who must act (the on-turn player, or active exchange winner)
  currentCount: number | null;
  currentRank: string | null; // human label of the rank to beat, e.g. "Q"
  canPass: boolean; // false while leading a fresh trick
  phase: PresidentenPhase;
  winner: string | null;
  version: number;
  deadline: number | null; // when the current turn auto-resolves, for the countdown
  serverNow: number; // server clock at projection time, to sync the countdown
  round: number;
  exchange: ExchangeView | null;
  lastTrick: LastTrick | null; // winner + winning cards of the last completed trick
  spectating: boolean; // you joined mid-game; you'll be dealt in next hand
}

export type PresidentenMove =
  | { type: "play"; cardIds: string[] }
  | { type: "pass" }
  | { type: "request"; rank: Rank }
  | { type: "giveBack"; cardId: string };
