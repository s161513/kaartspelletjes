import { test } from "node:test";
import assert from "node:assert/strict";
import game from "./logic.js";
import type { Cell, TicTacToeState } from "./types.js";

// Play a list of cells, alternating players, returning the final state.
function play(cells: number[]) {
  let state = game.init(["a", "b"]);
  for (const cell of cells) {
    const v = game.validateMove(state, state.turn!, { cell });
    assert.ok(v.ok, `move ${cell} should be valid`);
    state = game.applyMove(state, state.turn!, v.move);
  }
  return state;
}

// A board from mark cells ("X"/"O"/null); a=X, b=O.
const withBoard = (cells: Cell[], turn: string | null = null): TicTacToeState => ({
  board: cells,
  turn,
  marks: { a: "X", b: "O" },
});

test("first player wins with a top row", () => {
  const state = play([0, 3, 1, 4, 2]);
  assert.deepEqual(game.result(state), { over: true, winner: "a" });
});

test("full board without a line is a draw", () => {
  const state = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.deepEqual(game.result(state), { over: true, winner: "draw" });
});

test("rejects moves out of turn and on taken cells", () => {
  const state = play([4]);
  assert.equal(game.validateMove(state, "a", { cell: 0 }).ok, false);
  assert.equal(game.validateMove(state, "b", { cell: 4 }).ok, false);
});

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

for (const line of LINES) {
  test(`detects the winning line ${line.join("-")}`, () => {
    const cells = Array<Cell>(9).fill(null);
    for (const i of line) cells[i] = "X";
    assert.deepEqual(game.result(withBoard(cells)), { over: true, winner: "a" });
  });
}

test("the second player (O) can win too", () => {
  const cells = Array<Cell>(9).fill(null);
  for (const i of [6, 7, 8]) cells[i] = "O";
  assert.deepEqual(game.result(withBoard(cells)), { over: true, winner: "b" });
});

test("rejects malformed and out-of-range moves", () => {
  const s = game.init(["a", "b"]);
  for (const bad of [null, {}, { cell: "1" }, { cell: 1.5 }, { cell: 9 }, { cell: -1 }]) {
    assert.equal(game.validateMove(s, "a", bad as never).ok, false, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("no moves are accepted once the game is over", () => {
  const won = play([0, 3, 1, 4, 2]); // a takes the top row
  assert.equal(won.turn, null);
  assert.equal(game.validateMove(won, "a", { cell: 5 }).ok, false);
  assert.equal(game.validateMove(won, "b", { cell: 5 }).ok, false);
});

test("places the right mark, alternates turns, and is not over mid-game", () => {
  let s = game.init(["a", "b"]);
  assert.equal(s.turn, "a");
  s = game.applyMove(s, "a", { cell: 0 });
  assert.equal(s.board[0], "X");
  assert.equal(s.turn, "b");
  assert.deepEqual(game.result(s), { over: false });
  s = game.applyMove(s, "b", { cell: 4 });
  assert.equal(s.board[4], "O");
  assert.equal(s.turn, "a");
});
