/** Dobble symbols are numeric IDs, unrelated to the platform's rank/suit cards. */
export type DobbleCard = number[];
export interface DobbleMove {
  type: "symbolClick";
  roundId: string;
  symbolId: number;
}
export interface DobbleRound {
  id: string;
  number: number;
  center: DobbleCard;
  status: "active" | "completed";
  winnerId: string | null;
  matchedSymbol: number | null;
}
/** The public player-specific wire format. Never contains other players' hands. */
export interface DobbleView {
  playerIds: string[];
  scores: Record<string, number>;
  target: number;
  paused: boolean;
  winnerId: string | null;
  round: DobbleRound & { own: DobbleCard };
}
/** Server-only state, still plain JSON as required by the platform contract. */
export interface DobbleState {
  playerIds: string[];
  activeIds: string[];
  /** Watchers queued to be dealt in at the start of the next round. */
  joining: string[];
  scores: Record<string, number>;
  target: number;
  paused: boolean;
  winnerId: string | null;
  blockedUntil: Record<string, number>;
  round: DobbleRound & { hands: Record<string, DobbleCard>; nextAt: number | null };
}
