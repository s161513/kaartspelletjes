import type { Card } from "@app/shared";

export type Phase = "preflop" | "flop" | "turn" | "river" | "showdown";

export interface Seat {
  id: string;
  chips: number;
  /** Hole cards; `null` = hidden from the receiving player (see playerView). */
  hole: (Card | null)[];
  /** Chips put in during the current betting round. */
  bet: number;
  /** Chips put in during the whole hand (used for side pots). */
  totalBet: number;
  folded: boolean;
  allIn: boolean;
  /** Busted: no chips left at the start of a hand. Skipped for the rest of the game. */
  out: boolean;
  /** Has acted since the last full raise in this betting round. */
  acted: boolean;
}

export interface PotResult {
  amount: number;
  winners: string[];
  /** Winning hand name; null if nobody else could win it (folds or an uncalled bet). */
  handName: string | null;
}

export interface HandResult {
  pots: PotResult[];
  /** playerId -> hand name, for every player who went to showdown. */
  shown: Record<string, string>;
  /** True when the hand ended because everyone else folded. */
  uncontested: boolean;
}

export interface LogEntry {
  /** Player the line is about, or null for table messages. */
  who: string | null;
  text: string;
}

export interface PokerState {
  seats: Seat[];
  /** Remaining deck. Never sent to clients (playerView empties it). */
  deck: Card[];
  board: Card[];
  phase: Phase;
  /** Seat indexes of the button and blinds for the current hand. */
  dealer: number;
  smallBlind: number;
  bigBlind: number;
  /** Seat index whose turn it is, or null between hands. */
  toAct: number | null;
  /** Highest bet in the current betting round. */
  currentBet: number;
  /** Minimum size of the next raise (the last full raise, at least the big blind). */
  minRaise: number;
  handNumber: number;
  blinds: { small: number; big: number };
  lastResult: HandResult | null;
  log: LogEntry[];
  /** Late-joiners spectating now; seated with a fresh stack at the next hand. */
  pending: string[];
}

export type PokerMove =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  | { type: "raise"; to: number }
  | { type: "nextHand" };
