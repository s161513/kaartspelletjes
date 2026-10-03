import type { Game } from "@app/shared";
import type { Cell, Connect4State, Connect4Move } from "./types.js";

// Game rules, run on the server. The server calls these in this order:
//   init()          once, when the host starts the game
//   validateMove()  for every move a client sends (reject bad/out-of-turn moves)
//   applyMove()     only for moves that passed validation
//   result()        after each move, to see whether the game is over

export const COLS = 7;
export const ROWS = 6;

const idx = (row: number, col: number): number => row * COLS + col;

/** The lowest empty row in a column, or -1 if the column is full. */
function lowestEmptyRow(board: Cell[], col: number): number {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[idx(row, col)] === null) return row;
  }
  return -1;
}

// Four forward directions to scan for a line: right, down, down-right, down-left.
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * The four-in-a-row, if any: the winning colour and the 4 cell indices that
 * form the line. Used by the server to decide the winner and by the view to
 * highlight the winning discs.
 */
export function winningLine(
  board: Cell[],
): { colour: "R" | "Y"; cells: number[] } | null {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const colour = board[idx(row, col)];
      if (!colour) continue;
      for (const [dr, dc] of DIRS) {
        const cells = [idx(row, col)];
        let r = row + dr;
        let c = col + dc;
        while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[idx(r, c)] === colour) {
          cells.push(idx(r, c));
          if (cells.length === 4) return { colour, cells };
          r += dr;
          c += dc;
        }
      }
    }
  }
  return null;
}

/** The colour that has four in a row, or null. */
function winningColour(board: Cell[]): "R" | "Y" | null {
  return winningLine(board)?.colour ?? null;
}

/** Find the playerId of the winner from the board + discs, or null. */
function winningPlayer(state: Connect4State): string | null {
  const colour = winningColour(state.board);
  if (!colour) return null;
  // Map the winning colour back to the player who owns it.
  const owner = Object.entries(state.discs).find(([, d]) => d === colour);
  return owner ? owner[0] : null;
}

const connect4: Game<Connect4State, Connect4Move> = {
  init(playerIds) {
    // First player is Red and moves first.
    const [p1, p2] = playerIds;
    return {
      board: Array<Cell>(COLS * ROWS).fill(null),
      turn: p1,
      discs: { [p1]: "R", [p2]: "Y" },
    };
  },

  validateMove(state, playerId, move) {
    if (state.turn === null) return { ok: false, error: "Game is over" };
    if (state.turn !== playerId) return { ok: false, error: "Not your turn" };
    if (
      typeof move !== "object" ||
      move === null ||
      typeof (move as Connect4Move).col !== "number"
    ) {
      return { ok: false, error: "Malformed move" };
    }
    const col = (move as Connect4Move).col;
    if (!Number.isInteger(col) || col < 0 || col >= COLS) {
      return { ok: false, error: "Column out of range" };
    }
    if (lowestEmptyRow(state.board, col) === -1) {
      return { ok: false, error: "Column is full" };
    }
    return { ok: true, move: { col } };
  },

  applyMove(state, playerId, move) {
    const board = state.board.slice();
    const row = lowestEmptyRow(board, move.col);
    board[idx(row, move.col)] = state.discs[playerId];

    const next: Connect4State = {
      board,
      turn: state.turn,
      discs: state.discs,
    };

    // If this move ends the game, clear the turn; otherwise hand off.
    const won = winningColour(board) !== null;
    const full = board.every((c) => c !== null);
    if (won || full) {
      next.turn = null;
    } else {
      const other = Object.keys(state.discs).find((id) => id !== playerId)!;
      next.turn = other;
    }
    return next;
  },

  result(state) {
    const winner = winningPlayer(state);
    if (winner) return { over: true, winner };
    if (state.board.every((c) => c !== null)) return { over: true, winner: "draw" };
    return { over: false };
  },
};

export default connect4;
