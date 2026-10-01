import type { Game } from "@app/shared";
import type { TicTacToeState, TicTacToeMove } from "./types.js";

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

/** Find the playerId of the winner from the board + marks, or null. */
function winningPlayer(state: TicTacToeState): string | null {
  for (const [a, b, c] of LINES) {
    const v = state.board[a];
    if (v && v === state.board[b] && v === state.board[c]) {
      // `v` is the mark; map it back to the player who owns that mark.
      const owner = Object.entries(state.marks).find(([, m]) => m === v);
      return owner ? owner[0] : null;
    }
  }
  return null;
}

const ticTacToe: Game<TicTacToeState, TicTacToeMove> = {
  init(playerIds) {
    // First player is X and moves first.
    const [p1, p2] = playerIds;
    return {
      board: Array(9).fill(null),
      turn: p1,
      marks: { [p1]: "X", [p2]: "O" },
    };
  },

  validateMove(state, playerId, move) {
    if (state.turn === null) return { ok: false, error: "Game is over" };
    if (state.turn !== playerId) return { ok: false, error: "Not your turn" };
    if (
      typeof move !== "object" ||
      move === null ||
      typeof (move as TicTacToeMove).cell !== "number"
    ) {
      return { ok: false, error: "Malformed move" };
    }
    const cell = (move as TicTacToeMove).cell;
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) {
      return { ok: false, error: "Cell out of range" };
    }
    if (state.board[cell] !== null) {
      return { ok: false, error: "Cell already taken" };
    }
    return { ok: true, move: { cell } };
  },

  applyMove(state, playerId, move) {
    const board = state.board.slice();
    board[move.cell] = state.marks[playerId];

    const next: TicTacToeState = {
      board,
      turn: state.turn,
      marks: state.marks,
    };

    // If this move ends the game, clear the turn; otherwise hand off.
    const winner = winningPlayer(next);
    const full = board.every((c) => c !== null);
    if (winner || full) {
      next.turn = null;
    } else {
      const other = Object.keys(state.marks).find((id) => id !== playerId)!;
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

export default ticTacToe;
