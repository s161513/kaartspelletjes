import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGames, games } from "../server/src/games/loader.js";

// Cross-cutting checks that hold for EVERY game plug-in, run through the real
// loader. This is the safety net that a brand-new game folder (like liegen was)
// can't silently ship without — it asserts each game honours the shared
// `Game`/`GameMeta` contract from shared/game.ts.

await loadGames();
const entries = [...games.values()];
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

test("the loader discovers all the expected game folders", () => {
  const found = [...games.keys()].sort();
  for (const expected of ["bullshit", "dobble", "hartenjagen", "liegen", "poker", "presidenten", "tictactoe"]) {
    assert.ok(found.includes(expected), `loader did not discover "${expected}" (found: ${found.join(", ")})`);
  }
});

for (const { meta, logic } of entries) {
  test(`${meta.id}: meta is well-formed (id matches folder, sane player bounds)`, () => {
    assert.ok(games.get(meta.id), "meta.id must be the key it was registered under");
    assert.equal(typeof meta.title, "string");
    assert.ok(meta.title.length > 0, "a non-empty title");
    assert.ok(Number.isInteger(meta.minPlayers) && meta.minPlayers >= 1, "minPlayers ≥ 1");
    assert.ok(Number.isInteger(meta.maxPlayers) && meta.maxPlayers >= meta.minPlayers, "maxPlayers ≥ minPlayers");
  });

  for (const n of new Set([meta.minPlayers, meta.maxPlayers])) {
    test(`${meta.id}: boots a fresh game with ${n} players and is not already over`, () => {
      const state = logic.init(ids(n));
      assert.ok(state !== null && state !== undefined, "init returns a state");
      assert.equal(logic.result(state).over, false, "a brand-new game must not be over");
    });
  }

  test(`${meta.id}: initial state is plain JSON (survives a serialise round-trip)`, () => {
    // The framework sends state over WebSockets, so it must be structured-clone /
    // JSON safe: no Map/Set/class instances, no `undefined` holes.
    const state = logic.init(ids(meta.minPlayers));
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  });

  test(`${meta.id}: playerView (when present) gives every player a serialisable projection`, () => {
    if (!logic.playerView) return; // fully-public games (e.g. tic-tac-toe) are fine without one
    const players = ids(meta.minPlayers);
    const state = logic.init(players);
    for (const id of players) {
      const view = logic.playerView(state, id);
      assert.ok(view !== undefined, `playerView(${id}) returns something`);
      assert.doesNotThrow(() => JSON.stringify(view), "the projection is JSON-serialisable");
    }
  });

  test(`${meta.id}: mid-game join hooks are implemented as a pair`, () => {
    // joinable() === !!(addPlayer && seatedPlayers); one without the other is a bug.
    assert.equal(!!logic.addPlayer, !!logic.seatedPlayers, "addPlayer and seatedPlayers must come together");
    if (logic.addPlayer && logic.seatedPlayers) {
      const players = ids(meta.minPlayers);
      const seated = logic.seatedPlayers(logic.init(players));
      assert.ok(Array.isArray(seated), "seatedPlayers returns an array");
      for (const id of players) assert.ok(seated.includes(id), `${id} is seated at init`);
    }
  });

  test(`${meta.id}: advance/nextUpdateIn are implemented as a pair`, () => {
    // A server-driven transition needs both the timer (nextUpdateIn) and the
    // transition (advance); one without the other never fires.
    assert.equal(!!logic.advance, !!logic.nextUpdateIn, "advance and nextUpdateIn must come together");
  });
}
