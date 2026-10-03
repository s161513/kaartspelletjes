export type Cell = "R" | "Y" | null;

export interface Connect4State {
  /** length 42, row-major, row 0 = top. Index = row * 7 + col. */
  board: Cell[];
  /** playerId whose turn it is during play; null in intermission. */
  turn: string | null;
  /** playerId -> disc colour (fixed for the whole session). */
  discs: Record<string, "R" | "Y">;
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

/** A disc drop (during play) or a request to start the next round (intermission). */
export type Connect4Move = { col: number } | { again: true };
