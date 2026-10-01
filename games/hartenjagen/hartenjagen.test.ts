import { test } from "node:test";
import assert from "node:assert/strict";
import type { Card, Rank, Suit } from "@app/shared";
import game from "./logic.js";
import {
  deckFor,
  legalPlays,
  passDirection,
  passTarget,
  scoreRound,
  trickWinner,
} from "./rules.js";
import type { HeartsMove, HeartsState, Play } from "./types.js";

// "Qs" = queen of spades, "Th" = ten of hearts, …
const SUITS: Record<string, Suit> = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };
function c(code: string): Card {
  const rank = (code[0] === "T" ? "10" : code[0]) as Rank;
  const suit = SUITS[code[1]];
  return { rank, suit, deck: 0, id: `${suit}-${rank}#0` };
}
const cards = (codes: string) => codes.split(" ").map(c);
const plays = (...entries: [string, string][]): Play[] =>
  entries.map(([playerId, code]) => ({ playerId, card: c(code) }));

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

test("deck splits evenly and always holds ♣2 and all 26 points", () => {
  for (const [n, perPlayer] of [[3, 17], [4, 13], [5, 10], [6, 8]]) {
    const deck = deckFor(n);
    assert.equal(deck.length, n * perPlayer, `${n} players`);
    assert.ok(deck.some((x) => x.id === "clubs-2#0"));
    assert.equal(deck.filter((x) => x.suit === "hearts").length, 13);
    assert.ok(deck.some((x) => x.suit === "spades" && x.rank === "Q"));
  }
  assert.throws(() => deckFor(2));
});

test("pass direction rotates per table size", () => {
  const four = [1, 2, 3, 4, 5].map((r) => passDirection(r, 4));
  assert.deepEqual(four, ["left", "right", "across", "none", "left"]);
  const three = [1, 2, 3, 4].map((r) => passDirection(r, 3));
  assert.deepEqual(three, ["left", "right", "none", "left"]);
  assert.equal(passTarget(0, "left", 4), 1);
  assert.equal(passTarget(0, "right", 4), 3);
  assert.equal(passTarget(1, "across", 6), 4);
});

test("first trick: lead ♣2, no points when discarding", () => {
  assert.deepEqual(legalPlays(cards("2c 9c Ah"), [], true, false).map((x) => x.id), ["clubs-2#0"]);
  // void in clubs on the first trick: hearts and ♠Q are not allowed…
  const discard = legalPlays(cards("Qs Ah 4d"), plays(["a", "2c"]), true, false);
  assert.deepEqual(discard.map((x) => x.id), ["diamonds-4#0"]);
  // …unless that's all you have
  assert.equal(legalPlays(cards("Qs Ah"), plays(["a", "2c"]), true, false).length, 2);
});

test("must follow suit, hearts lead only once broken", () => {
  assert.deepEqual(
    legalPlays(cards("3d Kd Ah"), plays(["a", "9d"]), false, false).map((x) => x.rank),
    ["3", "K"],
  );
  assert.deepEqual(legalPlays(cards("3d Ah"), [], false, false).map((x) => x.suit), ["diamonds"]);
  assert.equal(legalPlays(cards("3d Ah"), [], false, true).length, 2);
  assert.equal(legalPlays(cards("2h Ah"), [], false, false).length, 2, "only hearts left");
});

test("highest card of the led suit wins the trick", () => {
  assert.equal(trickWinner(plays(["a", "9d"], ["b", "Ad"], ["c", "Ks"], ["d", "2d"])), "b");
  assert.equal(trickWinner(plays(["a", "9d"], ["b", "Ac"], ["c", "Ah"])), "a");
});

test("shooting the moon gives everyone else 26", () => {
  assert.deepEqual(scoreRound({ a: 26, b: 0, c: 0 }), { points: { a: 0, b: 26, c: 26 }, moon: "a" });
  assert.deepEqual(scoreRound({ a: 13, b: 13, c: 0 }), { points: { a: 13, b: 13, c: 0 }, moon: null });
});

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function move(state: HeartsState, who: string, m: HeartsMove): HeartsState {
  const v = game.validateMove(state, who, m);
  assert.ok(v.ok, `${who} ${JSON.stringify(m)}: ${v.ok ? "" : v.error}`);
  return game.applyMove(state, who, v.move);
}

const handOf = (s: HeartsState, id: string) => s.hands[id] as Card[];

/** Everyone passes their first three cards. */
function passAll(s: HeartsState): HeartsState {
  for (const id of s.players) s = move(s, id, { type: "pass", cards: handOf(s, id).slice(0, 3).map((x) => x.id) });
  return s;
}

/** Play one random legal card for whoever is to play. */
function playRandom(s: HeartsState): HeartsState {
  const id = s.toPlay!;
  const legal = legalPlays(handOf(s, id), s.trick, s.tricksPlayed === 0, s.heartsBroken);
  return move(s, id, { type: "play", card: legal[Math.floor(Math.random() * legal.length)].id });
}

test("passing exchanges three cards and ♣2 leads", () => {
  let s = game.init(["a", "b", "c", "d"]);
  assert.equal(s.phase, "passing");
  assert.equal(s.passDirection, "left");
  const fromA = handOf(s, "a").slice(0, 3).map((x) => x.id);

  s = passAll(s);
  assert.equal(s.phase, "playing");
  assert.deepEqual(s.received.b, fromA, "a passed to the left (b)");
  assert.ok(fromA.every((id) => handOf(s, "b").some((x) => x.id === id)));
  for (const id of s.players) assert.equal(handOf(s, id).length, 13);
  assert.ok(handOf(s, s.toPlay!).some((x) => x.id === "clubs-2#0"));
  assert.equal(game.validateMove(s, s.toPlay!, { type: "play", card: handOf(s, s.toPlay!).find((x) => x.id !== "clubs-2#0")!.id }).ok, false);
});

test("a full round scores 26 points and moves to the next round", () => {
  let s = passAll(game.init(["a", "b", "c", "d"]));
  while (s.phase === "playing") s = playRandom(s);
  assert.equal(s.phase, "roundEnd");
  const total = Object.values(s.history[0].points).reduce((a, b) => a + b, 0);
  assert.equal(total, s.history[0].moon ? 78 : 26);

  s = move(s, "c", { type: "nextRound" });
  assert.equal(s.roundNumber, 2);
  assert.equal(s.passDirection, "right");
});

test("the game ends at 100; lowest wins, a tie is a draw", () => {
  const s = game.init(["a", "b", "c"]);
  s.phase = "roundEnd";
  s.scores = { a: 100, b: 40, c: 70 };
  assert.deepEqual(game.result(s), { over: true, winner: "b" });
  s.scores = { a: 100, b: 40, c: 40 };
  assert.deepEqual(game.result(s), { over: true, winner: "draw" });
  s.scores = { a: 99, b: 40, c: 40 };
  assert.deepEqual(game.result(s), { over: false });
});

test("leaving ends the game; lowest score among the others wins", () => {
  let s = game.init(["a", "b", "c"]);
  s.scores = { a: 5, b: 30, c: 20 };
  s = game.playerLeft!(s, "a");
  assert.deepEqual(game.result(s), { over: true, winner: "c" });
});

test("playerView hides other hands and passes", () => {
  let s = game.init(["a", "b", "c", "d"]);
  s = move(s, "a", { type: "pass", cards: handOf(s, "a").slice(0, 3).map((x) => x.id) });
  const view = game.playerView!(s, "b") as HeartsState;
  assert.ok(view.hands.b.every((x) => x !== null));
  assert.deepEqual(view.hands.a, Array(13).fill(null));
  assert.deepEqual(view.passes, {});
  assert.equal(view.passed.a, true, "but everyone sees who has passed");
});

test("random games: every round is worth 26 and every game finishes", () => {
  for (let g = 0; g < 200; g++) {
    const players = ["a", "b", "c", "d", "e", "f"].slice(0, 3 + (g % 4));
    let s = game.init(players);
    for (let turn = 0; !game.result(s).over; turn++) {
      assert.ok(turn < 5000, "game should finish");
      if (s.phase === "passing") s = passAll(s);
      else if (s.phase === "playing") s = playRandom(s);
      else s = move(s, players[0], { type: "nextRound" });
    }
    for (const round of s.history) {
      const total = Object.values(round.points).reduce((a, b) => a + b, 0);
      assert.equal(total, round.moon ? 26 * (players.length - 1) : 26);
    }
    const sum = s.history.reduce((acc, r) => acc + Object.values(r.points).reduce((a, b) => a + b, 0), 0);
    assert.equal(Object.values(s.scores).reduce((a, b) => a + b, 0), sum);
  }
});
