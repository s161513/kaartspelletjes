import { test } from "node:test";
import assert from "node:assert/strict";
import game, { SIZE, NEED, winningLine } from "./logic.js";
import type { Cell, GomokuState } from "./types.js";

// Place stones on the given cell indices, alternating players, returning the
// final state. a = Black (moves first), b = White. Stops where the sequence ends.
function play(cellsSeq: number[]) {
  let state = game.init(["a", "b"]);
  for (const cell of cellsSeq) {
    const v = game.validateMove(state, state.turn!, { cell });
    assert.ok(v.ok, `move on cell ${cell} should be valid`);
    state = game.applyMove(state, state.turn!, v.move);
  }
  return state;
}

const empty = (): Cell[] => Array<Cell>(SIZE * SIZE).fill(null);
const idx = (row: number, col: number) => row * SIZE + col;

const stateFrom = (board: Cell[], overrides: Partial<GomokuState> = {}): GomokuState => ({
  board,
  turn: "a",
  stones: { a: "B", b: "W" },
  players: ["a", "b"],
  phase: "playing",
  result: null,
  scores: { a: 0, b: 0 },
  draws: 0,
  round: 1,
  starter: "a",
  ...overrides,
});

// Place a run of NEED stones of `colour` starting at (row,col) in direction (dr,dc).
function line(colour: Cell, row: number, col: number, dr: number, dc: number): Cell[] {
  const board = empty();
  for (let i = 0; i < NEED; i++) board[idx(row + i * dr, col + i * dc)] = colour;
  return board;
}

test("Black makes five in a row on the top edge and wins", () => {
  // a (Black) plays (0,0..4); b (White) answers on row 1 cols 0..3.
  const s = play([
    idx(0, 0), idx(1, 0),
    idx(0, 1), idx(1, 1),
    idx(0, 2), idx(1, 2),
    idx(0, 3), idx(1, 3),
    idx(0, 4),
  ]);
  assert.equal(s.phase, "intermission");
  assert.equal(s.result, "a");
  assert.equal(s.turn, null);
  assert.equal(s.scores.a, 1);
  assert.equal(s.scores.b, 0);
});

test("four in a row is not yet a win", () => {
  const s = play([
    idx(0, 0), idx(1, 0),
    idx(0, 1), idx(1, 1),
    idx(0, 2), idx(1, 2),
    idx(0, 3),
  ]);
  assert.equal(s.phase, "playing");
  assert.equal(s.result, null);
});

test("White can win too", () => {
  // Black plays spaced-out filler (col 0, rows 5/7/9/11/13 — never consecutive);
  // White makes five across the top row and wins on its 5th move.
  const s = play([
    idx(5, 0), idx(0, 0),
    idx(7, 0), idx(0, 1),
    idx(9, 0), idx(0, 2),
    idx(11, 0), idx(0, 3),
    idx(13, 0), idx(0, 4),
  ]);
  assert.equal(s.phase, "intermission");
  assert.equal(s.result, "b");
  assert.equal(s.scores.b, 1);
});

test("winningLine detects all four directions and reports NEED cells", () => {
  assert.equal(winningLine(line("B", 0, 0, 0, 1))?.colour, "B"); // horizontal
  assert.equal(winningLine(line("B", 0, 0, 1, 0))?.colour, "B"); // vertical
  assert.equal(winningLine(line("W", 0, 0, 1, 1))?.colour, "W"); // '\' diagonal
  const up = winningLine(line("W", 0, 4, 1, -1)); // '/' diagonal
  assert.equal(up?.colour, "W");
  assert.equal(up?.cells.length, NEED);
});

test("an empty board has no line", () => {
  assert.equal(winningLine(empty()), null);
});

test("stones land where placed and turns alternate", () => {
  let s = game.init(["a", "b"]);
  assert.equal(s.turn, "a");
  s = game.applyMove(s, "a", { cell: idx(7, 7) });
  assert.equal(s.board[idx(7, 7)], "B");
  assert.equal(s.turn, "b");
  s = game.applyMove(s, "b", { cell: idx(7, 8) });
  assert.equal(s.board[idx(7, 8)], "W");
  assert.equal(s.turn, "a");
  assert.equal(s.phase, "playing");
});

test("result() is never over — the session plays forever", () => {
  assert.deepEqual(game.result(game.init(["a", "b"])), { over: false });
});

test("rejects moves out of turn", () => {
  const s = game.init(["a", "b"]);
  assert.equal(game.validateMove(s, "b", { cell: 0 }).ok, false);
});

test("rejects a move onto a taken cell", () => {
  const s = play([idx(7, 7)]);
  assert.equal(game.validateMove(s, s.turn!, { cell: idx(7, 7) }).ok, false);
});

test("rejects malformed and out-of-range moves", () => {
  const s = game.init(["a", "b"]);
  for (const bad of [null, {}, { cell: "1" }, { cell: 1.5 }, { cell: SIZE * SIZE }, { cell: -1 }]) {
    assert.equal(
      game.validateMove(s, "a", bad as never).ok,
      false,
      `${JSON.stringify(bad)} should be rejected`,
    );
  }
});

test("rejects 'again' while a round is in progress", () => {
  const s = game.init(["a", "b"]);
  assert.equal(game.validateMove(s, "a", { again: true } as never).ok, false);
});

test("during intermission placements are rejected and 'again' restarts the round", () => {
  const won = play([
    idx(0, 0), idx(1, 0),
    idx(0, 1), idx(1, 1),
    idx(0, 2), idx(1, 2),
    idx(0, 3), idx(1, 3),
    idx(0, 4),
  ]); // a wins; now intermission
  assert.equal(won.phase, "intermission");
  assert.equal(game.validateMove(won, "a", { cell: idx(5, 5) }).ok, false);
  assert.equal(game.validateMove(won, "b", { cell: idx(5, 5) }).ok, false);

  const v = game.validateMove(won, "b", { again: true } as never);
  assert.ok(v.ok, "'again' should be accepted during intermission");

  const next = game.applyMove(won, "b", v.ok ? v.move : ({ again: true } as never));
  assert.equal(next.phase, "playing");
  assert.equal(next.round, 2);
  assert.deepEqual(next.board, empty());
  assert.equal(next.result, null);
  assert.equal(next.starter, "b"); // the loser starts next round
  assert.equal(next.turn, "b");
  assert.equal(next.scores.a, 1); // cumulative score preserved
});

test("a full board with no line is a draw", () => {
  // Build a full board with a repeating pattern that never yields five in a row,
  // leaving one cell empty for the final move.
  const board = empty();
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      // (row + floor(col/2)) % 2 yields runs of at most 2 same-colour cells in
      // every direction (horizontal, vertical, both diagonals) — never five.
      board[idx(row, col)] = (row + Math.floor(col / 2)) % 2 === 0 ? "B" : "W";
    }
  }
  assert.equal(winningLine(board), null, "pattern must have no five in a row");

  const last = idx(0, 0);
  const colour = board[last]!;
  board[last] = null;
  const starter = colour === "B" ? "a" : "b"; // whoever owns that cell plays it
  const s = stateFrom(board, { turn: starter });
  const next = game.applyMove(s, starter, { cell: last });
  assert.equal(next.phase, "intermission");
  assert.equal(next.result, "draw");
  assert.equal(next.draws, 1);
  assert.deepEqual(next.scores, { a: 0, b: 0 });
});
