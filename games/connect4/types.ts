export type Cell = "R" | "Y" | null;

export interface Connect4State {
  /** length 42, row-major, row 0 = top. Index = row * 7 + col. */
  board: Cell[];
  /** playerId whose turn it is, or null when the game is over. */
  turn: string | null;
  /** playerId -> disc colour */
  discs: Record<string, "R" | "Y">;
}

export interface Connect4Move {
  col: number; // 0..6
}
