export type Cell = "B" | "W" | null;

export interface GomokuState {
  /** length 225, row-major, row 0 = top. Index = row * 15 + col. */
  board: Cell[];
  /** playerId whose turn it is during play; null in intermission. */
  turn: string | null;
  /** playerId -> stone colour (fixed for the whole session). */
  stones: Record<string, "B" | "W">;
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
}

/** Place a stone (during play) or request the next round (intermission). */
export type GomokuMove = { cell: number } | { again: true };
