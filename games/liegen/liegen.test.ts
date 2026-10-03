import { test } from "node:test";
import assert from "node:assert/strict";
import game from "./logic.js";
import type { LiegenState, LiegenMove } from "./types.js";

// Liegen (Mexen / liar's dice). Rolls are two dice shown high-digit-first, so
// "53" means a 5 and a 3. Rank order, weakest → strongest:
//   31 32 41 42 43 51 52 53 54 61 62 63 64 65  (non-doubles)
//   11 22 33 44 55 66                           (doubles)
//   21                                          (Mex, the strongest)

function makeState(over: Partial<LiegenState> = {}): LiegenState {
  const players: LiegenState["players"] = {};
  for (const id of ["a", "b", "c"]) players[id] = { id, strikes: 0, status: "active" };
  return {
    turn: "a",
    players,
    playerOrder: ["a", "b", "c"],
    currentClaim: null,
    currentAdvice: false,
    lastClaimPlayerId: null,
    gameState: "WAITING_FOR_FIRST_SHAKE",
    logs: [],
    secretRoll: null,
    ...over,
  };
}

const vm = (s: LiegenState, id: string, m: LiegenMove) => game.validateMove(s, id, m);
const am = (s: LiegenState, id: string, m: LiegenMove) => game.applyMove(s, id, m);

/** A Math.random stub that yields a fixed queue of values, then throws. */
function rng(values: number[]) {
  let i = 0;
  return () => {
    if (i >= values.length) throw new Error("rng exhausted");
    return values[i++];
  };
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

test("init seats every player active with no strikes, waiting for the first shake", () => {
  const s = game.init(["a", "b", "c"]);
  assert.ok(["a", "b", "c"].includes(s.turn!), "turn is one of the players");
  assert.deepEqual(s.playerOrder, ["a", "b", "c"]);
  for (const id of ["a", "b", "c"]) {
    assert.equal(s.players[id].strikes, 0);
    assert.equal(s.players[id].status, "active");
  }
  assert.equal(s.gameState, "WAITING_FOR_FIRST_SHAKE");
  assert.equal(s.currentClaim, null);
  assert.equal(s.secretRoll, null);
});

// ---------------------------------------------------------------------------
// validateMove
// ---------------------------------------------------------------------------

test("only the player whose turn it is may act", () => {
  assert.equal(vm(makeState(), "b", { action: "shake" }).ok, false);
  assert.equal(vm(makeState(), "a", { action: "shake" }).ok, true);
});

test("shake is legal before a claim but not while a claim is awaited, nor on Mex", () => {
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_FIRST_SHAKE" }), "a", { action: "shake" }).ok, true);
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 43 }), "a", { action: "shake" }).ok, true);
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_CLAIM" }), "a", { action: "shake" }).ok, false);
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 21 }), "a", { action: "shake" }).ok, false);
});

test("a claim is only legal while one is awaited, must be a real roll, and must raise", () => {
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_CLAIM" }), "a", { action: "claim", value: 43 }).ok, true);
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_CLAIM" }), "a", { action: "claim", value: 21 }).ok, true, "Mex is a valid claim");
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_ACTION" }), "a", { action: "claim", value: 43 }).ok, false);
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_CLAIM" }), "a", { action: "claim", value: 99 }).ok, false);
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_CLAIM", currentClaim: 43 }), "a", { action: "claim", value: 32 }).ok, false, "32 is lower than 43");
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_CLAIM", currentClaim: 43 }), "a", { action: "claim", value: 51 }).ok, true);
});

test("blind pass requires an open action, a higher value, and is barred on Mex", () => {
  const base = makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 43, lastClaimPlayerId: "a", turn: "b" });
  assert.equal(vm(base, "b", { action: "blind_pass", value: 51 }).ok, true);
  assert.equal(vm(base, "b", { action: "blind_pass", value: 32 }).ok, false, "must be higher");
  assert.equal(vm(base, "b", { action: "blind_pass", value: 99 }).ok, false, "must be a real roll");
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 21, turn: "b" }), "b", { action: "blind_pass", value: 21 }).ok, false);
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_CLAIM", currentClaim: 43 }), "a", { action: "blind_pass", value: 51 }).ok, false);
});

test("calling a bluff needs an open claim", () => {
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 43, turn: "b" }), "b", { action: "call_bluff" }).ok, true);
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_CLAIM" }), "a", { action: "call_bluff" }).ok, false);
  assert.equal(vm(makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: null }), "a", { action: "call_bluff" }).ok, false);
  assert.equal(vm(makeState(), "a", { action: "nonsense" as unknown as LiegenMove["action"] }).ok, false);
});

// ---------------------------------------------------------------------------
// applyMove — shake / claim / blind pass
// ---------------------------------------------------------------------------

test("shaking rolls the dice (high digit first) and then awaits a claim", (t) => {
  t.mock.method(Math, "random", rng([0.7, 0.4])); // 5 and 3 → "53"
  const s = am(makeState(), "a", { action: "shake" });
  assert.equal(s.secretRoll, 53);
  assert.equal(s.gameState, "WAITING_FOR_CLAIM");
});

test("shaking a 2 and a 1 is Mex (21)", (t) => {
  t.mock.method(Math, "random", rng([1 / 6, 0])); // 2 and 1 → max·10+min = 21
  const s = am(makeState(), "a", { action: "shake" });
  assert.equal(s.secretRoll, 21);
});

test("a claim records the value, opens the action and passes the turn on", () => {
  const s = am(makeState({ gameState: "WAITING_FOR_CLAIM", secretRoll: 53 }), "a", { action: "claim", value: 53, withAdvice: true });
  assert.equal(s.currentClaim, 53);
  assert.equal(s.currentAdvice, true);
  assert.equal(s.lastClaimPlayerId, "a");
  assert.equal(s.gameState, "WAITING_FOR_ACTION");
  assert.equal(s.turn, "b", "the next active player must respond");
});

test("a blind pass raises the claim and passes on without revealing", () => {
  const s = am(makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 43, lastClaimPlayerId: "a", turn: "b" }), "b", { action: "blind_pass", value: 51 });
  assert.equal(s.currentClaim, 51);
  assert.equal(s.lastClaimPlayerId, "b");
  assert.equal(s.gameState, "WAITING_FOR_ACTION");
  assert.equal(s.turn, "c");
});

test("the turn skips eliminated players", () => {
  const st = makeState({ gameState: "WAITING_FOR_CLAIM", secretRoll: 53 });
  st.players.b.status = "eliminated";
  const s = am(st, "a", { action: "claim", value: 53 });
  assert.equal(s.turn, "c", "b is skipped");
});

// ---------------------------------------------------------------------------
// applyMove — call bluff resolution
// ---------------------------------------------------------------------------

test("calling a true claim (roll ≥ claim) costs the caller a strike", () => {
  const st = makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 43, lastClaimPlayerId: "a", secretRoll: 53, turn: "b" });
  const s = am(st, "b", { action: "call_bluff" });
  assert.equal(s.players.b.strikes, 1, "caller was wrong");
  assert.equal(s.players.a.strikes, 0);
  assert.equal(s.gameState, "SHOWING_REVEAL");
  assert.equal(s.turn, "b", "the loser leads the next round");
});

test("calling a bluff (roll < claim) costs the claimer a strike", () => {
  const st = makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 53, lastClaimPlayerId: "a", secretRoll: 43, turn: "b" });
  const s = am(st, "b", { action: "call_bluff" });
  assert.equal(s.players.a.strikes, 1, "claimer lied");
  assert.equal(s.players.b.strikes, 0);
  assert.equal(s.turn, "a");
});

test("with advice the roll must STRICTLY beat the claim — an exact match is a bluff", () => {
  const exact = am(makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 43, currentAdvice: true, lastClaimPlayerId: "a", secretRoll: 43, turn: "b" }), "b", { action: "call_bluff" });
  assert.equal(exact.players.a.strikes, 1, "equal is not strictly higher → claimer loses");
  const beaten = am(makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 43, currentAdvice: true, lastClaimPlayerId: "a", secretRoll: 53, turn: "b" }), "b", { action: "call_bluff" });
  assert.equal(beaten.players.b.strikes, 1, "strictly higher → caller loses");
});

test("a third strike eliminates the player and ends the game", () => {
  const st = makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 53, lastClaimPlayerId: "a", secretRoll: 43, turn: "b" });
  st.players.a.strikes = 2;
  const s = am(st, "b", { action: "call_bluff" });
  assert.equal(s.players.a.strikes, 3);
  assert.equal(s.players.a.status, "eliminated");
  assert.equal(s.turn, null);
  assert.deepEqual(game.result(s), { over: true, winner: "a" });
});

test("the game is not over while everyone still has strikes left", () => {
  assert.deepEqual(game.result(makeState()), { over: false });
});

// ---------------------------------------------------------------------------
// advance / nextUpdateIn — the between-rounds reveal pause
// ---------------------------------------------------------------------------

test("the reveal pauses ~5s, then advance starts the next round for the loser", () => {
  assert.equal(game.nextUpdateIn!(makeState({ gameState: "SHOWING_REVEAL" })), 5000);
  assert.equal(game.nextUpdateIn!(makeState({ gameState: "WAITING_FOR_ACTION" })), null);

  const s = game.advance!(makeState({ gameState: "SHOWING_REVEAL", currentClaim: 43, secretRoll: 53, turn: "b" }));
  assert.equal(s.currentClaim, null);
  assert.equal(s.secretRoll, null);
  assert.equal(s.gameState, "WAITING_FOR_FIRST_SHAKE");
});

test("advance does not reopen play once the game is over (turn is null)", () => {
  const s = game.advance!(makeState({ gameState: "SHOWING_REVEAL", turn: null, currentClaim: 43, secretRoll: 53 }));
  assert.equal(s.gameState, "SHOWING_REVEAL");
  assert.equal(s.currentClaim, null);
});

// ---------------------------------------------------------------------------
// playerView — the secret roll must not leak
// ---------------------------------------------------------------------------

test("only the shaker sees the roll while they owe a claim; everyone sees it at the reveal", () => {
  const shaking = makeState({ gameState: "WAITING_FOR_CLAIM", currentClaim: null, secretRoll: 53, turn: "a" });
  assert.equal((game.playerView!(shaking, "a") as LiegenState).secretRoll, 53, "the shaker sees their own roll");
  assert.equal((game.playerView!(shaking, "b") as LiegenState).secretRoll, null, "others do not");

  const acting = makeState({ gameState: "WAITING_FOR_ACTION", currentClaim: 43, secretRoll: 53, turn: "b" });
  assert.equal((game.playerView!(acting, "b") as LiegenState).secretRoll, null, "hidden once a claim is on the table");

  const reveal = makeState({ gameState: "SHOWING_REVEAL", secretRoll: 53 });
  assert.equal((game.playerView!(reveal, "a") as LiegenState).secretRoll, 53);
  assert.equal((game.playerView!(reveal, "c") as LiegenState).secretRoll, 53);
});

// ---------------------------------------------------------------------------
// A short end-to-end round through the real reducers
// ---------------------------------------------------------------------------

test("a full round: shake → claim → call a bluff → reveal → next round", (t) => {
  t.mock.method(Math, "random", rng([0, 0])); // 1 and 1 → "11" (a double, a weak-ish roll)
  let s = makeState({ turn: "a" }); // deterministic seat order for the walkthrough
  s = am(s, "a", { action: "shake" });
  assert.equal(s.gameState, "WAITING_FOR_CLAIM");
  // a over-claims a Mex (21) while actually holding 11 → a bluff.
  s = am(s, "a", { action: "claim", value: 21 });
  assert.equal(s.currentClaim, 21);
  assert.equal(s.turn, "b");
  // On Mex the only legal reply is to call.
  assert.equal(vm(s, "b", { action: "shake" }).ok, false);
  s = am(s, "b", { action: "call_bluff" });
  assert.equal(s.players.a.strikes, 1, "a lied about the Mex");
  assert.equal(s.gameState, "SHOWING_REVEAL");
  s = game.advance!(s);
  assert.equal(s.gameState, "WAITING_FOR_FIRST_SHAKE");
  assert.equal(s.turn, "a", "the loser leads again");
});
