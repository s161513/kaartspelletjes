import { test } from "node:test";
import assert from "node:assert/strict";
import { RANK_VALUES, type Card, type Rank, type Suit } from "@app/shared";
import game, { advance, applyMove, validateMove } from "./logic.js";
import { advanceRun, effectiveRank, hasLegalFollow, sortForDisplay, TURN_MS } from "./rules.js";
import type { PresidentenMove, PresidentenState } from "./types.js";

// "7h" = seven of hearts, "Th" = ten of hearts, "2s" = two of spades, …
const SUITS: Record<string, Suit> = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };
function c(code: string): Card {
  const rank = (code[0] === "T" ? "10" : code[0]) as Rank;
  const suit = SUITS[code[1]];
  return { rank, suit, deck: 0, id: `${suit}-${rank}#0` };
}
const cards = (codes: string) => (codes ? codes.split(" ").map(c) : []);
const id = (code: string) => c(code).id;
const v = (rank: Rank) => RANK_VALUES[rank];

function makeState(hands: Record<string, string>, over: Partial<PresidentenState> = {}): PresidentenState {
  const players = Object.keys(hands);
  return {
    players,
    hands: Object.fromEntries(players.map((p) => [p, cards(hands[p])])),
    pile: [], top: null, finished: [], turnIndex: 0,
    currentCount: null, currentRankValue: null, runRankValue: null, runCount: 0,
    lastPlayerId: null, passedSinceLastPlay: [], phase: "PLAY", winner: null, version: 0,
    deadline: null,
    ...over,
  };
}
const play = (ids: string[]): PresidentenMove => ({ type: "play", cardIds: ids });
const pass: PresidentenMove = { type: "pass" };

// ---------------------------------------------------------------------------
// Rules: the wild 2 and the burn tally
// ---------------------------------------------------------------------------

test("effectiveRank: a 2 copies the rank it is grouped with", () => {
  assert.deepEqual(effectiveRank(cards("7h 7s")), { ok: true, group: { rank: "7", value: 7 } });
  assert.deepEqual(effectiveRank(cards("7h 2s")), { ok: true, group: { rank: "7", value: 7 } });
});

test("effectiveRank: only-2s and mixed non-2 ranks are illegal", () => {
  assert.equal(effectiveRank(cards("2h 2s")).ok, false);
  assert.equal(effectiveRank(cards("7h 8s")).ok, false);
  assert.equal(effectiveRank([]).ok, false);
});

test("sortForDisplay orders 3 … A then the wild 2 last", () => {
  const order = sortForDisplay(cards("2h Ah 3h Kh 2s")).map((c) => c.rank);
  assert.deepEqual(order, ["3", "K", "A", "2", "2"]);
});

test("advanceRun burns on four of a rank, either at once or in a row", () => {
  assert.equal(advanceRun(null, 0, v("7"), 4).burned, true); // all at once
  assert.equal(advanceRun(v("7"), 2, v("7"), 2).burned, true); // two pairs in a row
  assert.equal(advanceRun(v("7"), 2, v("7"), 1).burned, false); // only three so far
  assert.equal(advanceRun(v("7"), 3, v("8"), 1).runCount, 1); // higher rank resets the run
});

// ---------------------------------------------------------------------------
// Move validation
// ---------------------------------------------------------------------------

test("a leading pass is allowed and rotates the lead to the next player", () => {
  const s = makeState({ a: "7h", b: "8h", c: "9h" });
  assert.equal(validateMove(s, "a", pass).ok, true);
  const after = applyMove(s, "a", pass);
  assert.equal(after.currentCount, null, "still a fresh trick");
  assert.equal(after.pile.length, 0);
  assert.equal(after.players[after.turnIndex], "b", "lead moved to b");
});

test("a follower must beat the rank and may play more cards, but never fewer", () => {
  let s = makeState({ a: "7h", b: "6h 8h 8s", c: "9h Th" });
  s = applyMove(s, "a", play([id("7h")])); // leads a single 7
  assert.equal(s.players[s.turnIndex], "b");
  assert.equal(validateMove(s, "b", play([id("6h")])).ok, false, "6 cannot beat 7");
  assert.equal(validateMove(s, "b", play([id("8h")])).ok, true, "a single 8 beats the 7");
  assert.equal(
    validateMove(s, "b", play([id("8h"), id("8s")])).ok,
    true,
    "a pair of 8s (more cards) is allowed on a single",
  );
});

test("a follower may not play fewer cards than the table", () => {
  let s = makeState({ a: "7h 7s 3h", b: "8h 8s", c: "9h 9s" });
  s = applyMove(s, "a", play([id("7h"), id("7s")])); // leads a pair
  assert.equal(s.currentCount, 2);
  assert.equal(s.players[s.turnIndex], "b");
  assert.equal(validateMove(s, "b", play([id("8h")])).ok, false, "a single cannot follow a pair");
  assert.equal(validateMove(s, "b", play([id("8h"), id("8s")])).ok, true, "a pair follows a pair");
});

test("playing more cards than required ratchets the count up for the next player", () => {
  let s = makeState({ a: "7h 3h", b: "8h 8s", c: "9h 9s" });
  s = applyMove(s, "a", play([id("7h")])); // leads a single 7
  assert.equal(s.currentCount, 1);
  s = applyMove(s, "b", play([id("8h"), id("8s")])); // a pair of 8s on a single — allowed
  assert.equal(s.currentCount, 2, "the table now requires at least two");
  assert.equal(s.players[s.turnIndex], "c");
  assert.equal(validateMove(s, "c", play([id("9h")])).ok, false, "c can no longer play a single");
});

test("you cannot finish on a 2", () => {
  const s = makeState({ a: "7h 2s", b: "3h 3s", c: "4h 4s" });
  assert.equal(validateMove(s, "a", play([id("7h"), id("2s")])).ok, false, "pair empties hand via a 2");
  assert.equal(validateMove(s, "a", play([id("7h")])).ok, true, "single 7 keeps the 2 back");
});

// ---------------------------------------------------------------------------
// Trick flow
// ---------------------------------------------------------------------------

test("when everyone else passes, the last player wins the trick and leads again", () => {
  // b and c can both follow the 7, so they are not auto-skipped — they choose to pass.
  let s = makeState({ a: "7h 7s", b: "8h 9h", c: "Th Jh" });
  s = applyMove(s, "a", play([id("7h")]));
  assert.equal(s.players[s.turnIndex], "b");
  s = applyMove(s, "b", pass);
  s = applyMove(s, "c", pass);
  assert.equal(s.pile.length, 0, "pile is cleared");
  assert.equal(s.currentCount, null, "a leads a fresh trick");
  assert.equal(s.players[s.turnIndex], "a");
});

test("two matching pairs in a row burn the pile; the fourth-layer leads", () => {
  let s = makeState({ a: "7h 7s", b: "7d 7c 3h", c: "8h 8s" });
  s = applyMove(s, "a", play([id("7h"), id("7s")]));
  assert.equal(s.runCount, 2);
  s = applyMove(s, "b", play([id("7d"), id("7c")]));
  assert.equal(s.pile.length, 0, "pile burned");
  assert.equal(s.currentCount, null);
  assert.equal(s.players[s.turnIndex], "b", "b laid the fourth and still holds 3h, so b leads");
});

test("four of a rank at once burns; the player keeps the lead", () => {
  let s = makeState({ a: "7h 7s 7d 7c 3h", b: "5h 5s", c: "9h 9s" });
  s = applyMove(s, "a", play([id("7h"), id("7s"), id("7d"), id("7c")]));
  assert.equal(s.pile.length, 0, "pile burned");
  assert.equal(s.players[s.turnIndex], "a", "a still holds 3h and leads");
});

test("a wild 2 does not count toward the four-of-a-kind burn", () => {
  // a lays two natural 4s; b follows with a real 4 + a wild 2 — only three real 4s, no burn.
  let s = makeState({ a: "4h 4s", b: "4d 2c 9h", c: "Kh Ks" });
  s = applyMove(s, "a", play([id("4h"), id("4s")]));
  assert.equal(s.runCount, 2);
  s = applyMove(s, "b", play([id("4d"), id("2c")]));
  assert.equal(s.runCount, 3, "only natural 4s count — the 2 does not");
  assert.notEqual(s.pile.length, 0, "pile is NOT burned");
});

// ---------------------------------------------------------------------------
// Turn countdown, always-on pass, auto-skip
// ---------------------------------------------------------------------------

test("hasLegalFollow respects count, rank and the go-out-on-2 rule", () => {
  assert.equal(hasLegalFollow(cards("8h"), 1, v("7")), true, "8 beats a required 7");
  assert.equal(hasLegalFollow(cards("8h 8s"), 1, v("7")), true, "a pair satisfies a single (more is ok)");
  assert.equal(hasLegalFollow(cards("8h"), 2, v("7")), false, "a single cannot satisfy a required pair");
  assert.equal(hasLegalFollow(cards("5h"), 1, v("7")), false, "5 cannot beat a 7");
  assert.equal(hasLegalFollow(cards("7h 2s 3d"), 2, v("7")), true, "7 + wild 2, with a spare card");
  assert.equal(hasLegalFollow(cards("7h 2s"), 2, v("7")), false, "cannot go out via a 2");
  assert.equal(hasLegalFollow(cards("7h 7s"), 2, v("7")), true, "a natural pair may go out");
});

test("a follower with no legal play is auto-skipped by the server", () => {
  let s = makeState({ a: "9h 9s", b: "3h 4h", c: "Th Jh" });
  s = applyMove(s, "a", play([id("9h")]));
  assert.equal(s.players[s.turnIndex], "c", "b cannot beat the 9 and is skipped; c is up");
  assert.ok(s.passedSinceLastPlay.includes("b"));
});

test("advance auto-passes a following player whose timer expired", () => {
  let s = makeState({ a: "7h 7s", b: "8h 9h", c: "Th Jh" });
  s = applyMove(s, "a", play([id("7h")]), 1000);
  assert.equal(s.players[s.turnIndex], "b");
  assert.equal(s.deadline, 1000 + TURN_MS);
  const after = advance(s, s.deadline! + 1);
  assert.equal(after.players[after.turnIndex], "c", "b timed out and was passed");
  assert.ok(after.passedSinceLastPlay.includes("b"));
});

test("advance auto-plays the lowest card for a leader who timed out", () => {
  const s = makeState({ a: "5h 9h", b: "6h", c: "7h" }, { deadline: 1000 });
  const after = advance(s, 1001);
  assert.equal(after.pile.length, 1, "one card was auto-played");
  assert.equal(after.top?.[0].id, id("5h"), "the lowest card (5h) was played");
  assert.equal(after.currentCount, 1);
});

// ---------------------------------------------------------------------------
// Finishing order and game over
// ---------------------------------------------------------------------------

test("round ends when one player is left; first out is President", () => {
  const s = makeState({ a: "", b: "", c: "9h" }, { finished: ["a", "b"], turnIndex: 2 });
  const after = applyMove(s, "c", play([id("9h")]));
  assert.equal(after.phase, "GAME_OVER");
  assert.deepEqual(after.finished, ["a", "b", "c"]);
  assert.deepEqual(game.result(after), { over: true, winner: "a" });
});

// ---------------------------------------------------------------------------
// Player view hides other hands
// ---------------------------------------------------------------------------

test("playerView exposes only your own hand plus opponents' counts", () => {
  const s = makeState({ a: "7h 7s", b: "8h", c: "9h 9s 9d" });
  const view = game.playerView!(s, "a") as ReturnType<typeof game.playerView> & {
    myHand: Card[];
    players: { id: string; cardCount: number }[];
  };
  assert.equal(view.myHand.length, 2);
  assert.deepEqual(
    view.players.map((p) => p.cardCount),
    [2, 1, 3],
  );
  assert.ok(!("hands" in view), "server-only hands are never on the wire");
});
