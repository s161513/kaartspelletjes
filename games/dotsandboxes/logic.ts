import type { Game } from "@app/shared";
import type { DotsState, DotsMove } from "./types.js";

// Game rules, run on the server. The server calls these in this order:
//   init()          once, when the host starts the game
//   validateMove()  for every move a client sends (reject bad/out-of-turn moves)
//   applyMove()     only for moves that passed validation
//   result()        after each move, to see whether the game is over

export const ROWS = 5;
export const COLS = 5;

export const hLen = (cols: number, rows: number) => (rows + 1) * cols;
export const vLen = (cols: number, rows: number) => rows * (cols + 1);

const hIdx = (cols: number, r: number, c: number) => r * cols + c;
const vIdx = (cols: number, r: number, c: number) => r * (cols + 1) + c;
const boxIdx = (cols: number, r: number, c: number) => r * cols + c;

/** Is the box at (r,c) fully enclosed by claimed edges? */
export function boxComplete(
  h: (string | null)[],
  v: (string | null)[],
  cols: number,
  r: number,
  c: number,
): boolean {
  return (
    h[hIdx(cols, r, c)] !== null &&
    h[hIdx(cols, r + 1, c)] !== null &&
    v[vIdx(cols, r, c)] !== null &&
    v[vIdx(cols, r, c + 1)] !== null
  );
}

/** The boxes (as [r,c]) that border a given edge — one or two of them. */
function bordering(
  line: "h" | "v",
  i: number,
  rows: number,
  cols: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (line === "h") {
    const r = Math.floor(i / cols);
    const c = i % cols;
    if (r - 1 >= 0) out.push([r - 1, c]); // box above
    if (r < rows) out.push([r, c]); // box below
  } else {
    const r = Math.floor(i / (cols + 1));
    const c = i % (cols + 1);
    if (c - 1 >= 0) out.push([r, c - 1]); // box to the left
    if (c < cols) out.push([r, c]); // box to the right
  }
  return out;
}

/** Count boxes each player owns this round. */
export function boxCounts(state: DotsState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of state.players) out[id] = 0;
  for (const owner of state.owners) {
    if (owner !== null) out[owner] = (out[owner] ?? 0) + 1;
  }
  return out;
}

function freshBoard(rows: number, cols: number) {
  return {
    h: Array<string | null>(hLen(cols, rows)).fill(null),
    v: Array<string | null>(vLen(cols, rows)).fill(null),
    owners: Array<string | null>(rows * cols).fill(null),
  };
}

const opponent = (state: DotsState, playerId: string): string =>
  state.players.find((id) => id !== playerId)!;

const isAgain = (move: DotsMove): move is { again: true } => "again" in move;

const dotsAndBoxes: Game<DotsState, DotsMove> = {
  init(playerIds) {
    const [p1, p2] = playerIds;
    return {
      rows: ROWS,
      cols: COLS,
      ...freshBoard(ROWS, COLS),
      turn: p1,
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
      if (
        typeof move !== "object" ||
        move === null ||
        (move as { again?: unknown }).again !== true
      ) {
        return { ok: false, error: "Round is over — play again" };
      }
      return { ok: true, move: { again: true } };
    }

    // phase === "playing": only edge claims on your turn.
    if (
      typeof move === "object" &&
      move !== null &&
      (move as { again?: unknown }).again === true
    ) {
      return { ok: false, error: "Game in progress" };
    }
    if (state.turn !== playerId) return { ok: false, error: "Not your turn" };
    if (typeof move !== "object" || move === null) {
      return { ok: false, error: "Malformed move" };
    }
    const line = (move as { line?: unknown }).line;
    const i = (move as { i?: unknown }).i;
    if (line !== "h" && line !== "v") return { ok: false, error: "Malformed move" };
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0) {
      return { ok: false, error: "Malformed move" };
    }
    const edges = line === "h" ? state.h : state.v;
    if (i >= edges.length) return { ok: false, error: "Edge out of range" };
    if (edges[i]) return { ok: false, error: "Line already claimed" };
    return { ok: true, move: { line, i } };
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
        ...freshBoard(state.rows, state.cols),
        phase: "playing",
        result: null,
        round: state.round + 1,
        starter,
        turn: starter,
      };
    }

    // Claim the edge.
    const h = state.h.slice();
    const v = state.v.slice();
    if (move.line === "h") h[move.i] = playerId;
    else v[move.i] = playerId;

    // Claim any box this edge just completed; the player keeps the turn if so.
    const owners = state.owners.slice();
    let completed = 0;
    for (const [r, c] of bordering(move.line, move.i, state.rows, state.cols)) {
      const bi = boxIdx(state.cols, r, c);
      if (owners[bi] === null && boxComplete(h, v, state.cols, r, c)) {
        owners[bi] = playerId;
        completed++;
      }
    }

    const allClaimed = h.every((x) => x !== null) && v.every((x) => x !== null);
    if (allClaimed) {
      // Round over: most boxes wins.
      const tally: Record<string, number> = {};
      for (const id of state.players) tally[id] = 0;
      for (const o of owners) if (o !== null) tally[o]++;
      const [p1, p2] = state.players;
      let winner: string | "draw";
      if (tally[p1] === tally[p2]) winner = "draw";
      else winner = tally[p1] > tally[p2] ? p1 : p2;

      const scores = { ...state.scores };
      if (winner !== "draw") scores[winner] = (scores[winner] ?? 0) + 1;
      return {
        ...state,
        h,
        v,
        owners,
        turn: null,
        phase: "intermission",
        result: winner,
        scores,
        draws: winner === "draw" ? state.draws + 1 : state.draws,
      };
    }

    // Completing a box earns another move; otherwise hand off.
    const turn = completed > 0 ? playerId : opponent(state, playerId);
    return { ...state, h, v, owners, turn };
  },

  result() {
    return { over: false };
  },
};

export default dotsAndBoxes;
