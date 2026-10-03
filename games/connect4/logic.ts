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

const emptyBoard = (): Cell[] => Array<Cell>(COLS * ROWS).fill(null);

/** The player who isn't `playerId` (2-player game). */
const opponent = (state: Connect4State, playerId: string): string =>
  state.players.find((id) => id !== playerId)!;

/** A move is a "start next round" request rather than a disc drop. */
const isAgain = (move: Connect4Move): move is { again: true } => "again" in move;

const connect4: Game<Connect4State, Connect4Move> = {
  init(playerIds) {
    // First player is Red and moves first.
    const [p1, p2] = playerIds;
    return {
      board: emptyBoard(),
      turn: p1,
      discs: { [p1]: "R", [p2]: "Y" },
      players: [p1, p2],
      phase: "playing",
      result: null,
      scores: { [p1]: 0, [p2]: 0 },
      draws: 0,
      round: 1,
      starter: p1,
    };
  },

  validateMove(state, playerId, move) {
    if (!state.players.includes(playerId)) {
      return { ok: false, error: "Not a player" };
    }

    if (state.phase === "intermission") {
      // Either player may start the next round; drops are not accepted.
      if (
        typeof move !== "object" ||
        move === null ||
        (move as { again?: unknown }).again !== true
      ) {
        return { ok: false, error: "Round is over — play again" };
      }
      return { ok: true, move: { again: true } };
    }

    // phase === "playing": only disc drops on your turn.
    if (
      typeof move === "object" &&
      move !== null &&
      (move as { again?: unknown }).again === true
    ) {
      return { ok: false, error: "Game in progress" };
    }
    if (state.turn !== playerId) return { ok: false, error: "Not your turn" };
    if (
      typeof move !== "object" ||
      move === null ||
      typeof (move as { col?: unknown }).col !== "number"
    ) {
      return { ok: false, error: "Malformed move" };
    }
    const col = (move as { col: number }).col;
    if (!Number.isInteger(col) || col < 0 || col >= COLS) {
      return { ok: false, error: "Column out of range" };
    }
    if (lowestEmptyRow(state.board, col) === -1) {
      return { ok: false, error: "Column is full" };
    }
    return { ok: true, move: { col } };
  },

  applyMove(state, playerId, move) {
    // Start the next round: fresh board, the loser goes first.
    if (isAgain(move)) {
      const prev = state.result;
      const starter =
        prev === "draw" || prev === null
          ? opponent(state, state.starter) // alternate after a draw
          : opponent(state, prev); // loser of the last round starts
      return {
        ...state,
        board: emptyBoard(),
        phase: "playing",
        result: null,
        round: state.round + 1,
        starter,
        turn: starter,
      };
    }

    // Drop a disc.
    const board = state.board.slice();
    const row = lowestEmptyRow(board, move.col);
    board[idx(row, move.col)] = state.discs[playerId];

    const won = winningColour(board) !== null;
    const full = board.every((c) => c !== null);

    if (won || full) {
      const winner = won ? playerId : "draw";
      const scores = { ...state.scores };
      if (winner !== "draw") scores[winner] = (scores[winner] ?? 0) + 1;
      return {
        ...state,
        board,
        turn: null,
        phase: "intermission",
        result: winner,
        scores,
        draws: winner === "draw" ? state.draws + 1 : state.draws,
      };
    }

    return { ...state, board, turn: opponent(state, playerId) };
  },

  // The session plays forever: it only ends when the host presses "End game"
  // (framework `endGame`) or a player leaves. So a round ending is never "over".
  result() {
    return { over: false };
  },
};

export default connect4;
