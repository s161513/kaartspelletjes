import type { Game } from "@app/shared";
import type { Cell, Disc, ReversiState, ReversiMove } from "./types.js";

// Game rules, run on the server. The server calls these in this order:
//   init()          once, when the host starts the game
//   validateMove()  for every move a client sends (reject bad/out-of-turn moves)
//   applyMove()     only for moves that passed validation
//   result()        after each move, to see whether the game is over

export const SIZE = 8;

const idx = (row: number, col: number): number => row * SIZE + col;

// All eight directions a line of flanked discs can run.
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const other = (c: Disc): Disc => (c === "B" ? "W" : "B");

/**
 * The discs that would flip if `colour` plays `cell`, across all directions.
 * Empty array means the move is illegal (it must flank ≥1 opponent disc).
 */
export function flips(board: Cell[], cell: number, colour: Disc): number[] {
  if (board[cell] !== null) return [];
  const row = Math.floor(cell / SIZE);
  const col = cell % SIZE;
  const foe = other(colour);
  const out: number[] = [];

  for (const [dr, dc] of DIRS) {
    const run: number[] = [];
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[idx(r, c)] === foe) {
      run.push(idx(r, c));
      r += dr;
      c += dc;
    }
    // A run of opponent discs is only captured if it ends on one of ours.
    if (run.length > 0 && r >= 0 && r < SIZE && c >= 0 && c < SIZE && board[idx(r, c)] === colour) {
      out.push(...run);
    }
  }
  return out;
}

/** Every cell `colour` could legally play on this board. */
export function legalMoves(board: Cell[], colour: Disc): number[] {
  const moves: number[] = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] === null && flips(board, i, colour).length > 0) moves.push(i);
  }
  return moves;
}

export function hasLegalMove(board: Cell[], colour: Disc): boolean {
  for (let i = 0; i < board.length; i++) {
    if (board[i] === null && flips(board, i, colour).length > 0) return true;
  }
  return false;
}

export function counts(board: Cell[]): { B: number; W: number } {
  let B = 0;
  let W = 0;
  for (const c of board) {
    if (c === "B") B++;
    else if (c === "W") W++;
  }
  return { B, W };
}

function emptyBoard(): Cell[] {
  const board = Array<Cell>(SIZE * SIZE).fill(null);
  // Standard Othello opening: two diagonal pairs in the centre.
  board[idx(3, 3)] = "W";
  board[idx(3, 4)] = "B";
  board[idx(4, 3)] = "B";
  board[idx(4, 4)] = "W";
  return board;
}

/** The player who isn't `playerId` (2-player game). */
const opponent = (state: ReversiState, playerId: string): string =>
  state.players.find((id) => id !== playerId)!;

const isAgain = (move: ReversiMove): move is { again: true } => "again" in move;

/** Decide the winner from the final disc counts. */
function winnerFrom(state: ReversiState): string | "draw" {
  const { B, W } = counts(state.board);
  if (B === W) return "draw";
  const colour: Disc = B > W ? "B" : "W";
  return state.players.find((id) => state.discs[id] === colour)!;
}

/**
 * After a move, settle whose turn it is. Black/White alternate, but a player
 * with no legal move is skipped (one pass). If neither can move, the round ends.
 * Returns the fully-resolved next state.
 */
function settleTurn(state: ReversiState, justMovedColour: Disc): ReversiState {
  const nextColour = other(justMovedColour);
  const nextId = state.players.find((id) => state.discs[id] === nextColour)!;
  if (hasLegalMove(state.board, nextColour)) {
    return { ...state, turn: nextId, passed: false };
  }
  // Next player must pass; does the player who just moved still have a move?
  if (hasLegalMove(state.board, justMovedColour)) {
    const sameId = state.players.find((id) => state.discs[id] === justMovedColour)!;
    return { ...state, turn: sameId, passed: true };
  }
  // Neither can move — the round is over.
  const winner = winnerFrom(state);
  const scores = { ...state.scores };
  if (winner !== "draw") scores[winner] = (scores[winner] ?? 0) + 1;
  return {
    ...state,
    turn: null,
    phase: "intermission",
    result: winner,
    scores,
    draws: winner === "draw" ? state.draws + 1 : state.draws,
    passed: false,
  };
}

const reversi: Game<ReversiState, ReversiMove> = {
  init(playerIds) {
    // First player is Black and moves first (Othello convention).
    const [p1, p2] = playerIds;
    return {
      board: emptyBoard(),
      turn: p1,
      discs: { [p1]: "B", [p2]: "W" },
      players: [p1, p2],
      phase: "playing",
      result: null,
      scores: { [p1]: 0, [p2]: 0 },
      draws: 0,
      round: 1,
      starter: p1,
      passed: false,
    };
  },

  validateMove(state, playerId, move) {
    if (!state.players.includes(playerId)) {
      return { ok: false, error: "Not a player" };
    }

    if (state.phase === "intermission") {
      if (
        typeof move !== "object" ||
        move === null ||
        (move as { again?: unknown }).again !== true
      ) {
        return { ok: false, error: "Round is over — play again" };
      }
      return { ok: true, move: { again: true } };
    }

    // phase === "playing": only disc placements on your turn.
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
    if (flips(state.board, cell, state.discs[playerId]).length === 0) {
      return { ok: false, error: "Move must flank an opponent disc" };
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
      const p1 = starter;
      const p2 = opponent(state, starter);
      return {
        ...state,
        board: emptyBoard(),
        // Starter always plays Black (first) this round.
        discs: { [p1]: "B", [p2]: "W" },
        phase: "playing",
        result: null,
        round: state.round + 1,
        starter,
        turn: starter,
        passed: false,
      };
    }

    // Place a disc and flip the flanked run(s).
    const colour = state.discs[playerId];
    const toFlip = flips(state.board, move.cell, colour);
    const board = state.board.slice();
    board[move.cell] = colour;
    for (const i of toFlip) board[i] = colour;

    return settleTurn({ ...state, board }, colour);
  },

  result() {
    return { over: false };
  },
};

export default reversi;
