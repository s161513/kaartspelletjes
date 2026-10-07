import { test } from "node:test";
import assert from "node:assert/strict";
import game, { COLS, ROWS, winningLine } from "./logic.js";
import type { Cell, Connect4State } from "./types.js";

// Drop discs into the given columns, alternating players, returning the final
// state. a = Red (moves first), b = Yellow. Stops wherever the sequence ends.
function play(cols: number[]) {
  let state = game.init(["a", "b"]);
  for (const col of cols) {
    const v = game.validateMove(state, state.turn!, { col });
    assert.ok(v.ok, `move in column ${col} should be valid`);
    state = game.applyMove(state, state.turn!, v.move);
  }
  return state;
}

const empty = (): Cell[] => Array<Cell>(COLS * ROWS).fill(null);
const idx = (row: number, col: number) => row * COLS + col;

// A full Connect4State wrapping a given board (a = Red, b = Yellow).
const stateFrom = (board: Cell[], overrides: Partial<Connect4State> = {}): Connect4State => ({
  board,
  turn: "a",
  discs: { a: "R", b: "Y" },
  players: ["a", "b"],
  phase: "playing",
  result: null,
  scores: { a: 0, b: 0 },
  draws: 0,
  round: 1,
  starter: "a",
  ...overrides,
});

// Place a run of four discs of `colour` starting at (row,col) in direction (dr,dc).
function line(colour: Cell, row: number, col: number, dr: number, dc: number): Cell[] {
  const board = empty();
  for (let i = 0; i < 4; i++) board[idx(row + i * dr, col + i * dc)] = colour;
  return board;
}

// A full board with a brick pattern that never yields four in a row.
function drawnBoard(): Cell[] {
  const board = empty();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      board[idx(row, col)] = ((row >> 1) + col) % 2 === 0 ? "R" : "Y";
    }
  }
  return board;
}

test("a horizontal four ends the round in the maker's favour", () => {
  // a: cols 0,1,2,3 (bottom row); b: col 6 three times.
  const s = play([0, 6, 1, 6, 2, 6, 3]);
  assert.equal(s.phase, "intermission");
  assert.equal(s.result, "a");
  assert.equal(s.turn, null);
  assert.equal(s.scores.a, 1);
  assert.equal(s.scores.b, 0);
});

test("a vertical four ends the round", () => {
  const s = play([0, 1, 0, 1, 0, 1, 0]); // a stacks column 0
  assert.equal(s.phase, "intermission");
  assert.equal(s.result, "a");
  assert.equal(s.scores.a, 1);
});

test("the second player (Yellow) can win too", () => {
  const s = play([0, 1, 0, 1, 0, 1, 2, 1]); // b stacks column 1
  assert.equal(s.phase, "intermission");
  assert.equal(s.result, "b");
  assert.equal(s.scores.b, 1);
});

test("winningLine detects both diagonals and reports the cells", () => {
  const down = winningLine(line("R", 0, 0, 1, 1)); // '\' diagonal
  assert.equal(down?.colour, "R");
  assert.equal(down?.cells.length, 4);

  const up = winningLine(line("R", 0, 3, 1, -1)); // '/' diagonal
  assert.equal(up?.colour, "R");

  const horiz = winningLine(line("R", 5, 0, 0, 1)); // bottom row 0..3
  assert.deepEqual(
    [...horiz!.cells].sort((a, b) => a - b),
    [0, 1, 2, 3].map((c) => (ROWS - 1) * COLS + c),
  );
});

test("a brick-pattern full board has no line (no false positives)", () => {
  assert.equal(winningLine(drawnBoard()), null);
});

test("filling the last cell with no line is a draw", () => {
  // Full brick board except (0,0); a (Red) drops there to match the pattern.
  const board = drawnBoard();
  board[idx(0, 0)] = null;
  const s = stateFrom(board, { turn: "a" });
  const v = game.validateMove(s, "a", { col: 0 });
  assert.ok(v.ok);
  const next = game.applyMove(s, "a", v.move);
  assert.equal(next.phase, "intermission");
  assert.equal(next.result, "draw");
  assert.equal(next.draws, 1);
  assert.deepEqual(next.scores, { a: 0, b: 0 });
});

test("discs stack to the bottom and turns alternate", () => {
  let s = game.init(["a", "b"]);
  assert.equal(s.turn, "a");
  s = game.applyMove(s, "a", { col: 3 });
  assert.equal(s.board[idx(ROWS - 1, 3)], "R"); // bottom row
  assert.equal(s.turn, "b");
  s = game.applyMove(s, "b", { col: 3 });
  assert.equal(s.board[idx(ROWS - 2, 3)], "Y"); // stacked on top
  assert.equal(s.turn, "a");
  assert.equal(s.phase, "playing");
});

test("result() is never over — the session plays forever", () => {
  assert.deepEqual(game.result(game.init(["a", "b"])), { over: false });
  const won = play([0, 1, 0, 1, 0, 1, 0]);
  assert.deepEqual(game.result(won), { over: false });
});

test("rejects moves out of turn", () => {
  const s = game.init(["a", "b"]);
  assert.equal(game.validateMove(s, "b", { col: 0 }).ok, false);
});

test("rejects a move into a full column", () => {
  const s = play([0, 0, 0, 0, 0, 0]); // 6 alternating discs, no win
  assert.equal(s.phase, "playing");
  assert.equal(game.validateMove(s, s.turn!, { col: 0 }).ok, false);
});

test("rejects malformed and out-of-range moves", () => {
  const s = game.init(["a", "b"]);
  for (const bad of [null, {}, { col: "1" }, { col: 1.5 }, { col: COLS }, { col: -1 }]) {
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

test("during intermission drops are rejected and 'again' restarts the round", () => {
  const won = play([0, 1, 0, 1, 0, 1, 0]); // a wins; now intermission
  assert.equal(won.phase, "intermission");
  // Drops are rejected for both players.
  assert.equal(game.validateMove(won, "a", { col: 5 }).ok, false);
  assert.equal(game.validateMove(won, "b", { col: 5 }).ok, false);
  // Either player may start the next round.
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

test("after a draw the starter alternates", () => {
  const board = drawnBoard();
  board[idx(0, 0)] = null;
  const drawn = game.applyMove(stateFrom(board, { turn: "a", starter: "a" }), "a", { col: 0 });
  assert.equal(drawn.result, "draw");
  const next = game.applyMove(drawn, "a", { again: true });
  assert.equal(next.starter, "b"); // alternated from the previous starter (a)
  assert.equal(next.turn, "b");
});
