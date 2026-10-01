export type Cell = "X" | "O" | null;

export interface TicTacToeState {
  board: Cell[]; // length 9, index 0..8 (row-major)
  /** playerId whose turn it is, or null when the game is over. */
  turn: string | null;
  /** playerId -> mark */
  marks: Record<string, "X" | "O">;
}

export interface TicTacToeMove {
  cell: number; // 0..8
}
