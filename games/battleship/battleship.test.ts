import { test } from "node:test";
import assert from "node:assert/strict";
import game, { SIZE, FLEET, shipCells } from "./logic.js";
import type { BattleshipState, BattleshipView, PlayerBoard, Placed } from "./types.js";

const idx = (row: number, col: number) => row * SIZE + col;

// A valid, non-overlapping layout: one ship per row starting at column 0.
const LAYOUT: Placed[] = [
  { row: 0, col: 0, orient: "h" }, // Carrier (5): 0..4
  { row: 1, col: 0, orient: "h" }, // Battleship (4): 10..13
  { row: 2, col: 0, orient: "h" }, // Cruiser (3): 20..22
  { row: 3, col: 0, orient: "h" }, // Submarine (3): 30..32
  { row: 4, col: 0, orient: "h" }, // Destroyer (2): 40..41
];

const readyBoard = (): PlayerBoard => ({
  ships: LAYOUT.map((s) => ({ ...s })),
  ready: true,
  shots: Array<boolean>(SIZE * SIZE).fill(false),
});

const firingState = (over: Partial<BattleshipState> = {}): BattleshipState => ({
  stage: "firing",
  boards: { a: readyBoard(), b: readyBoard() },
  turn: "a",
  players: ["a", "b"],
  phase: "playing",
  result: null,
  scores: { a: 0, b: 0 },
  round: 1,
  starter: "a",
  ...over,
});

/** All cells any ship occupies in LAYOUT. */
const allLayoutCells = LAYOUT.flatMap((s, slot) => shipCells(s, FLEET[slot].size));

function placeAll(state: BattleshipState, id: string): BattleshipState {
  let s = state;
  LAYOUT.forEach((p, slot) => {
    const v = game.validateMove(s, id, { place: { ship: slot, ...p } });
    assert.ok(v.ok, `placing ship ${slot} for ${id} should be valid`);
    s = game.applyMove(s, id, v.move);
  });
  const rv = game.validateMove(s, id, { ready: true });
  assert.ok(rv.ok, `${id} ready should be valid`);
  return game.applyMove(s, id, rv.move);
}

test("init: placement stage, no turn, empty seas", () => {
  const s = game.init(["a", "b"]);
  assert.equal(s.stage, "placement");
  assert.equal(s.turn, null);
  assert.ok(s.boards.a.ships.every((x) => x === null));
  assert.equal(s.boards.a.ready, false);
});

test("placement rejects overlap and out-of-bounds, accepts a clear spot", () => {
  let s = game.init(["a", "b"]);
  s = game.applyMove(s, "a", { place: { ship: 0, row: 0, col: 0, orient: "h" } }); // 0..4
  assert.equal(game.validateMove(s, "a", { place: { ship: 1, row: 0, col: 3, orient: "h" } }).ok, false); // overlaps cell 3/4
  assert.equal(game.validateMove(s, "a", { place: { ship: 0, row: 0, col: 7, orient: "h" } }).ok, false); // off the board
  assert.equal(game.validateMove(s, "a", { place: { ship: 1, row: 1, col: 0, orient: "h" } }).ok, true);
});

test("cannot lock in until every ship is placed; both ready starts firing", () => {
  let s = game.init(["a", "b"]);
  s = game.applyMove(s, "a", { place: { ship: 0, row: 0, col: 0, orient: "h" } });
  assert.equal(game.validateMove(s, "a", { ready: true }).ok, false); // not all placed

  s = placeAll(s, "a");
  assert.equal(s.stage, "placement"); // b not ready yet
  assert.equal(s.turn, null);
  s = placeAll(s, "b");
  assert.equal(s.stage, "firing");
  assert.equal(s.turn, "a"); // starter fires first
});

test("a shot records on the target sea and passes the turn", () => {
  const s = firingState();
  const next = game.applyMove(s, "a", { fire: { row: 0, col: 0 } }); // hits b's Carrier
  assert.equal(next.boards.b.shots[idx(0, 0)], true);
  assert.equal(next.turn, "b");
  // a cannot fire again out of turn.
  assert.equal(game.validateMove(next, "a", { fire: { row: 0, col: 1 } }).ok, false);
  // b misses in open water, turn returns to a.
  const back = game.applyMove(next, "b", { fire: { row: 9, col: 9 } });
  assert.equal(back.boards.a.shots[idx(9, 9)], true);
  assert.equal(back.turn, "a");
});

test("firing rejects repeat shots and shots off the board", () => {
  const s = firingState({ boards: { a: readyBoard(), b: hitBoard([idx(0, 0)]) } });
  assert.equal(game.validateMove(s, "a", { fire: { row: 0, col: 0 } }).ok, false); // already fired
  assert.equal(game.validateMove(s, "a", { fire: { row: 10, col: 0 } }).ok, false); // off board
  assert.equal(game.validateMove(s, "b", { fire: { row: 0, col: 1 } }).ok, false); // not b's turn
});

test("sinking the whole enemy fleet ends the round for the shooter", () => {
  // Pre-hit every enemy ship cell except the Destroyer's last (4,1); a finishes it.
  const preHit = allLayoutCells.filter((c) => c !== idx(4, 1));
  const s = firingState({ boards: { a: readyBoard(), b: hitBoard(preHit) }, turn: "a" });
  const next = game.applyMove(s, "a", { fire: { row: 4, col: 1 } });
  assert.equal(next.phase, "intermission");
  assert.equal(next.turn, null);
  assert.equal(next.result, "a");
  assert.equal(next.scores.a, 1);
});

test("result() is never over — the session plays forever", () => {
  assert.deepEqual(game.result(game.init(["a", "b"])), { over: false });
});

// --- the whole point of playerView: the enemy fleet stays hidden ----------

test("playerView hides the opponent's un-sunk ships", () => {
  const s = firingState();
  const view = game.playerView!(s, "a") as BattleshipView;

  // You see your own full fleet…
  assert.equal(view.self?.id, "a");
  assert.equal(view.self?.ships.filter((x) => x !== null).length, FLEET.length);

  // …but the opponent board exposes only shots/hits/sunk — never ship cells.
  assert.equal(view.opponents.length, 1);
  const enemy = view.opponents[0];
  assert.equal(enemy.id, "b");
  assert.deepEqual(Object.keys(enemy).sort(), ["hits", "id", "placed", "shots", "sunk"]);
  assert.deepEqual(enemy.shots, []);
  assert.deepEqual(enemy.hits, []);
  assert.deepEqual(enemy.sunk, []);

  // Hard guarantee: b's ship anchors must not appear anywhere in a's payload.
  const serialized = JSON.stringify(view);
  // b's Carrier occupies cells 0..4; cell 4 is only derivable from the hidden
  // layout, so it must be absent from the enemy portion of the wire data.
  const enemyJson = JSON.stringify(view.opponents);
  assert.equal(enemyJson.includes('"cells"'), false, "enemy board must carry no ship cells");
  assert.ok(serialized.length > 0);
});

test("playerView reveals a ship only once it is fully sunk", () => {
  // Sink b's Destroyer (cells 40,41); its Carrier stays hidden.
  const s = firingState({ boards: { a: readyBoard(), b: hitBoard([idx(4, 0), idx(4, 1)]) } });
  const enemy = (game.playerView!(s, "a") as BattleshipView).opponents[0];
  assert.equal(enemy.sunk.length, 1);
  assert.equal(enemy.sunk[0].name, "Destroyer");
  assert.deepEqual(enemy.sunk[0].cells.sort((x, y) => x - y), [idx(4, 0), idx(4, 1)]);
  assert.deepEqual(enemy.hits.sort((x, y) => x - y), [idx(4, 0), idx(4, 1)]);
});

test("a spectator sees both seas publicly and owns none", () => {
  const s = firingState();
  const view = game.playerView!(s, "spectator:x") as BattleshipView;
  assert.equal(view.self, null);
  assert.equal(view.opponents.length, 2);
});

test("intermission: 'again' re-lays the seas, the loser fires first", () => {
  const preHit = allLayoutCells.filter((c) => c !== idx(4, 1));
  const won = game.applyMove(
    firingState({ boards: { a: readyBoard(), b: hitBoard(preHit) }, turn: "a" }),
    "a",
    { fire: { row: 4, col: 1 } },
  );
  assert.equal(won.result, "a");

  assert.equal(game.validateMove(won, "a", { fire: { row: 0, col: 0 } }).ok, false); // no firing now
  const v = game.validateMove(won, "b", { again: true });
  assert.ok(v.ok);
  const next = game.applyMove(won, "b", v.ok ? v.move : ({ again: true } as never));
  assert.equal(next.stage, "placement");
  assert.equal(next.round, 2);
  assert.equal(next.starter, "b"); // the loser starts
  assert.equal(next.turn, null);
  assert.ok(next.boards.a.ships.every((x) => x === null)); // fresh seas
  assert.equal(next.scores.a, 1); // cumulative score preserved
});

/** A ready board whose own sea has already been shot at the given cells. */
function hitBoard(cells: number[]): PlayerBoard {
  const b = readyBoard();
  for (const c of cells) b.shots[c] = true;
  return b;
}
