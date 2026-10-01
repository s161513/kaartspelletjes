import { test } from "node:test";
import assert from "node:assert/strict";
import game from "./logic.js";

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
