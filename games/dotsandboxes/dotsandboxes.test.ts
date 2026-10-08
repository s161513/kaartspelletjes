import { test } from "node:test";
import assert from "node:assert/strict";
import game, { ROWS, COLS, hLen, vLen, boxCounts } from "./logic.js";
import type { DotsState } from "./types.js";

/** Build a playing state on a `rows`×`cols` board with everything unclaimed. */
const mk = (rows: number, cols: number, over: Partial<DotsState> = {}): DotsState => ({
  rows,
  cols,
  h: Array<string | null>(hLen(cols, rows)).fill(null),
  v: Array<string | null>(vLen(cols, rows)).fill(null),
  owners: Array<string | null>(rows * cols).fill(null),
  turn: "a",
  players: ["a", "b"],
  phase: "playing",
  result: null,
  scores: { a: 0, b: 0 },
  draws: 0,
  round: 1,
  starter: "a",
  ...over,
});

test("init: 5×5 board with the right edge counts", () => {
  const s = game.init(["a", "b"]);
  assert.equal(s.rows, ROWS);
  assert.equal(s.cols, COLS);
  assert.equal(s.h.length, (ROWS + 1) * COLS);
  assert.equal(s.v.length, ROWS * (COLS + 1));
  assert.equal(s.owners.length, ROWS * COLS);
  assert.equal(s.turn, "a");
});

test("claiming an edge that completes no box passes the turn", () => {
  const s = mk(2, 1, { turn: "a" });
  const next = game.applyMove(s, "a", { line: "v", i: 2 }); // left edge of box (1,0)
  assert.equal(next.phase, "playing");
  assert.equal(next.turn, "b");
  assert.deepEqual(next.owners, [null, null]);
});

test("completing a box claims it and the same player moves again", () => {
  // 2×1 board; box (0,0) already has 3 sides. h[1] is its 4th (shared with box 1).
  const s = mk(2, 1, { turn: "a" });
  s.h[0] = "a"; // top of box 0
  s.v[0] = "a"; // left of box 0
  s.v[1] = "a"; // right of box 0
  const next = game.applyMove(s, "a", { line: "h", i: 1 });
  assert.equal(next.owners[0], "a"); // box 0 claimed
  assert.equal(next.owners[1], null); // box 1 still open
  assert.equal(next.turn, "a"); // keeps the turn
  assert.equal(next.phase, "playing");
});

test("one edge completing two boxes claims both and ends the full board", () => {
  // 1×2 board, everything claimed except the shared middle edge v[1].
  const s = mk(1, 2, { turn: "a" });
  for (let i = 0; i < s.h.length; i++) s.h[i] = "a";
  s.v[0] = "a";
  s.v[2] = "a";
  const next = game.applyMove(s, "a", { line: "v", i: 1 });
  assert.equal(next.owners[0], "a");
  assert.equal(next.owners[1], "a");
  assert.equal(next.phase, "intermission");
  assert.equal(next.turn, null);
  assert.equal(next.result, "a");
  assert.equal(next.scores.a, 1);
  assert.deepEqual(boxCounts(next), { a: 2, b: 0 });
});

test("an even box split is a draw", () => {
  // 1×2 board: box 0 already belongs to a; b completes box 1 as the last edge.
  const s = mk(1, 2, { turn: "b", owners: ["a", null] });
  for (let i = 0; i < s.h.length; i++) s.h[i] = "a";
  s.v[0] = "a";
  s.v[1] = "a";
  // leave the one remaining edge: v[2] right of box 1.
  s.v[2] = null;
  const next = game.applyMove(s, "b", { line: "v", i: 2 });
  assert.equal(next.owners[1], "b");
  assert.equal(next.phase, "intermission");
  assert.equal(next.result, "draw");
  assert.equal(next.draws, 1);
  assert.deepEqual(boxCounts(next), { a: 1, b: 1 });
});

test("result() is never over — the session plays forever", () => {
  assert.deepEqual(game.result(game.init(["a", "b"])), { over: false });
});

test("rejects out-of-turn, claimed, out-of-range, malformed and 'again' moves", () => {
  const s = game.init(["a", "b"]);
  assert.equal(game.validateMove(s, "b", { line: "h", i: 0 }).ok, false); // not b's turn

  const claimed = game.init(["a", "b"]);
  claimed.h[0] = "a";
  assert.equal(game.validateMove(claimed, "a", { line: "h", i: 0 }).ok, false); // taken

  assert.equal(game.validateMove(s, "a", { line: "h", i: s.h.length }).ok, false); // out of range
  for (const bad of [
    null,
    {},
    { line: "x", i: 0 },
    { line: "h" },
    { line: "h", i: -1 },
    { line: "h", i: 1.5 },
  ]) {
    assert.equal(game.validateMove(s, "a", bad as never).ok, false, `${JSON.stringify(bad)}`);
  }
  assert.equal(game.validateMove(s, "a", { again: true } as never).ok, false); // mid-round
});

test("intermission: 'again' restarts a fresh board, the loser starts", () => {
  // Reuse the double-box finish so a wins the round.
  const base = mk(1, 2, { turn: "a" });
  for (let i = 0; i < base.h.length; i++) base.h[i] = "a";
  base.v[0] = "a";
  base.v[2] = "a";
  const won = game.applyMove(base, "a", { line: "v", i: 1 });
  assert.equal(won.phase, "intermission");
  assert.equal(won.result, "a");

  assert.equal(game.validateMove(won, "a", { line: "h", i: 0 }).ok, false); // no claims now
  const v = game.validateMove(won, "b", { again: true } as never);
  assert.ok(v.ok);
  const next = game.applyMove(won, "b", v.ok ? v.move : ({ again: true } as never));
  assert.equal(next.phase, "playing");
  assert.equal(next.round, 2);
  assert.equal(next.starter, "b"); // the loser starts
  assert.equal(next.turn, "b");
  assert.ok(next.h.every((x) => x === null)); // fresh edges
  assert.ok(next.owners.every((o) => o === null));
  assert.equal(next.scores.a, 1); // cumulative score preserved
});
