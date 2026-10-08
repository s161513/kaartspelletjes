import type { Game } from "@app/shared";
import type { Cell, GomokuState, GomokuMove } from "./types.js";

// Game rules, run on the server. The server calls these in this order:
//   init()          once, when the host starts the game
//   validateMove()  for every move a client sends (reject bad/out-of-turn moves)
//   applyMove()     only for moves that passed validation
//   result()        after each move, to see whether the game is over

export const SIZE = 15;
export const NEED = 5;

const idx = (row: number, col: number): number => row * SIZE + col;

// Four forward directions to scan for a line: right, down, down-right, down-left.
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * The five-in-a-row, if any: the winning colour and the 5 cell indices that
 * form the line. Used by the server to decide the winner and by the view to
 * highlight the winning stones.
 */
export function winningLine(
  board: Cell[],
): { colour: "B" | "W"; cells: number[] } | null {
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const colour = board[idx(row, col)];
      if (!colour) continue;
      for (const [dr, dc] of DIRS) {
        const cells = [idx(row, col)];
        let r = row + dr;
        let c = col + dc;
        while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[idx(r, c)] === colour) {
          cells.push(idx(r, c));
          if (cells.length === NEED) return { colour, cells };
          r += dr;
          c += dc;
        }
      }
    }
  }
  return null;
}

/** The colour that has five in a row, or null. */
function winningColour(board: Cell[]): "B" | "W" | null {
  return winningLine(board)?.colour ?? null;
}

const emptyBoard = (): Cell[] => Array<Cell>(SIZE * SIZE).fill(null);

/** The player who isn't `playerId` (2-player game). */
const opponent = (state: GomokuState, playerId: string): string =>
  state.players.find((id) => id !== playerId)!;

/** A move is a "start next round" request rather than a stone placement. */
const isAgain = (move: GomokuMove): move is { again: true } => "again" in move;

const gomoku: Game<GomokuState, GomokuMove> = {
  init(playerIds) {
    // First player is Black and moves first.
    const [p1, p2] = playerIds;
    return {
      board: emptyBoard(),
      turn: p1,
      stones: { [p1]: "B", [p2]: "W" },
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
      // Either player may start the next round; placements are not accepted.
      if (
        typeof move !== "object" ||
        move === null ||
        (move as { again?: unknown }).again !== true
      ) {
        return { ok: false, error: "Round is over — play again" };
      }
      return { ok: true, move: { again: true } };
    }

    // phase === "playing": only stone placements on your turn.
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
      typeof (move as { cell?: unknown }).cell !== "number"
    ) {
      return { ok: false, error: "Malformed move" };
    }
    const cell = (move as { cell: number }).cell;
    if (!Number.isInteger(cell) || cell < 0 || cell >= SIZE * SIZE) {
      return { ok: false, error: "Cell out of range" };
    }
    if (state.board[cell] !== null) {
      return { ok: false, error: "Cell already taken" };
    }
    return { ok: true, move: { cell } };
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

    // Place a stone.
    const board = state.board.slice();
    board[move.cell] = state.stones[playerId];

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

export default gomoku;
