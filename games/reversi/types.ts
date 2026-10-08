export type Disc = "B" | "W";
export type Cell = Disc | null;

export interface ReversiState {
  /** length 64, row-major, row 0 = top. Index = row * 8 + col. */
  board: Cell[];
  /** playerId whose turn it is during play; null in intermission. */
  turn: string | null;
  /** playerId -> disc colour (fixed for the whole session). */
  discs: Record<string, Disc>;
  /** Seat order [p1, p2]. */
  players: string[];
  /** "playing" a round, or "intermission" between rounds. */
  phase: "playing" | "intermission";
  /** Last finished round's winner (playerId), "draw", or null while playing. */
  result: string | "draw" | null;
  /** Cumulative wins per player across rounds. */
  scores: Record<string, number>;
  /** Cumulative drawn rounds. */
  draws: number;
  /** 1-based round counter. */
  round: number;
  /** Who moved first this round (used to rotate the starter). */
  starter: string;
  /** True when the previous player had to pass (no legal move). */
  passed: boolean;
}

/** Place a disc (during play) or request the next round (intermission). */
export type ReversiMove = { cell: number } | { again: true };
