export interface DotsState {
  /** Board dimensions in boxes. */
  rows: number;
  cols: number;
  /** Horizontal edges, row-major: claimer's playerId or null. Length (rows + 1) * cols. */
  h: (string | null)[];
  /** Vertical edges, row-major: claimer's playerId or null. Length rows * (cols + 1). */
  v: (string | null)[];
  /** Box owners (playerId) or null, row-major: length rows * cols. */
  owners: (string | null)[];
  /** playerId whose turn it is during play; null in intermission. */
  turn: string | null;
  /** Seat order [p1, p2]. */
  players: string[];
  /** "playing" a round, or "intermission" between rounds. */
  phase: "playing" | "intermission";
  /** Last finished round's winner (playerId), "draw", or null while playing. */
  result: string | "draw" | null;
  /** Cumulative round wins per player across rounds. */
  scores: Record<string, number>;
  /** Cumulative drawn rounds. */
  draws: number;
  /** 1-based round counter. */
  round: number;
  /** Who moved first this round (used to rotate the starter). */
  starter: string;
}

/** Claim an edge (during play) or request the next round (intermission). */
export type DotsMove = { line: "h" | "v"; i: number } | { again: true };
