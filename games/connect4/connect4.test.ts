import { test } from "node:test";
import assert from "node:assert/strict";
import game, { COLS, ROWS, winningLine } from "./logic.js";
import type { Cell, Connect4State } from "./types.js";

// Drop discs into the given columns, alternating players, returning the final
// state. a = Red (moves first), b = Yellow.
function play(cols: number[]) {
  let state = game.init(["a", "b"]);
  for (const col of cols) {
    const v = game.validateMove(state, state.turn!, { col });
    assert.ok(v.ok, `move in column ${col} should be valid`);
    state = game.applyMove(state, state.turn!, v.move);
  }
  return state;
}

// Build a state directly from a board (a = Red, b = Yellow).
const withBoard = (board: Cell[], turn: string | null = null): Connect4State => ({
  board,
  turn,
  discs: { a: "R", b: "Y" },
});

const empty = (): Cell[] => Array<Cell>(COLS * ROWS).fill(null);
const idx = (row: number, col: number) => row * COLS + col;

// Place a run of four discs of `colour` starting at (row,col) in direction (dr,dc).
function line(colour: Cell, row: number, col: number, dr: number, dc: number): Cell[] {
  const board = empty();
  for (let i = 0; i < 4; i++) board[idx(row + i * dr, col + i * dc)] = colour;
  return board;
}

test("horizontal four wins for the player who made it", () => {
  // a: cols 0,1,2,3 (bottom row); b: col 6 three times.
  const state = play([0, 6, 1, 6, 2, 6, 3]);
  assert.deepEqual(game.result(state), { over: true, winner: "a" });
});

test("vertical four wins", () => {
  // a stacks column 0; b stacks column 1.
  const state = play([0, 1, 0, 1, 0, 1, 0]);
  assert.deepEqual(game.result(state), { over: true, winner: "a" });
});

test("detects a '\\' diagonal (down-right)", () => {
  assert.deepEqual(game.result(withBoard(line("R", 0, 0, 1, 1))), {
    over: true,
    winner: "a",
  });
});

test("detects a '/' diagonal (down-left)", () => {
  assert.deepEqual(game.result(withBoard(line("R", 0, 3, 1, -1))), {
    over: true,
    winner: "a",
  });
});

test("winningLine reports the four cell indices of the line", () => {
  // Bottom-row horizontal line for Red at columns 0..3 (row 5).
  const win = winningLine(line("R", 5, 0, 0, 1));
  assert.ok(win, "a line should be found");
  assert.deepEqual(
    [...win!.cells].sort((a, b) => a - b),
    [0, 1, 2, 3].map((c) => (ROWS - 1) * COLS + c),
  );
  assert.equal(win!.colour, "R");
});

test("the second player (Yellow) can win too", () => {
  assert.deepEqual(game.result(withBoard(line("Y", 5, 0, 0, 1))), {
    over: true,
    winner: "b",
  });
});

test("a full board without a line is a draw", () => {
  const board = empty();
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      // A brick pattern that never yields four in a row in any direction.
      board[idx(row, col)] = ((row >> 1) + col) % 2 === 0 ? "R" : "Y";
    }
  }
  assert.deepEqual(game.result(withBoard(board)), { over: true, winner: "draw" });
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
  assert.deepEqual(game.result(s), { over: false });
});

test("rejects moves out of turn", () => {
  const s = game.init(["a", "b"]);
  assert.equal(game.validateMove(s, "b", { col: 0 }).ok, false);
});

test("rejects a move into a full column", () => {
  // Fill column 0: a and b alternate dropping there (6 discs).
  const s = play([0, 0, 0, 0, 0, 0]);
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

test("no moves are accepted once the game is over", () => {
  const won = play([0, 1, 0, 1, 0, 1, 0]); // a wins vertically in column 0
  assert.equal(won.turn, null);
  assert.equal(game.validateMove(won, "a", { col: 5 }).ok, false);
  assert.equal(game.validateMove(won, "b", { col: 5 }).ok, false);
});
