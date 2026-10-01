import { test } from "node:test";
import assert from "node:assert/strict";
import type { Card, Rank, Suit } from "@app/shared";
import { bestHand, compareHands, evaluate5 } from "./hand.js";
import { buildPots } from "./pots.js";
import game, { STARTING_CHIPS, raiseBounds } from "./logic.js";
import type { PokerMove, PokerState } from "./types.js";

// "Ah" = ace of hearts, "Td" = ten of diamonds, …
const SUITS: Record<string, Suit> = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };
function c(code: string): Card {
  const rank = (code[0] === "T" ? "10" : code[0]) as Rank;
  const suit = SUITS[code[1]];
  return { rank, suit, deck: 0, id: `${suit}-${rank}#0` };
}
const cards = (codes: string) => codes.split(" ").map(c);

// ---------------------------------------------------------------------------
// Hand evaluation
// ---------------------------------------------------------------------------

test("recognises every hand category", () => {
  const names = [
    ["2h 7d 9c Js Kh", "High Card"],
    ["2h 2d 9c Js Kh", "One Pair"],
    ["2h 2d 9c 9s Kh", "Two Pair"],
    ["2h 2d 2c Js Kh", "Three of a Kind"],
    ["5h 6d 7c 8s 9h", "Straight"],
    ["2h 7h 9h Jh Kh", "Flush"],
    ["2h 2d 2c Ks Kh", "Full House"],
    ["2h 2d 2c 2s Kh", "Four of a Kind"],
    ["5h 6h 7h 8h 9h", "Straight Flush"],
    ["Th Jh Qh Kh Ah", "Royal Flush"],
  ];
  for (const [hand, name] of names) assert.equal(evaluate5(cards(hand)).name, name, hand);
});

test("ace-low straight is the lowest straight", () => {
  const wheel = evaluate5(cards("Ah 2d 3c 4s 5h"));
  const sixHigh = evaluate5(cards("2d 3c 4s 5h 6h"));
  assert.equal(wheel.name, "Straight");
  assert.ok(compareHands(sixHigh, wheel) > 0);
});

test("kickers decide between equal pairs, identical hands tie", () => {
  const board = cards("Kh Kd 8c 4s 2h");
  const aceKicker = bestHand([...board, ...cards("As 3d")]);
  const queenKicker = bestHand([...board, ...cards("Qs 3c")]);
  assert.ok(compareHands(aceKicker, queenKicker) > 0);

  const playsTheBoard = cards("Ah Kh Qh Jh Th");
  assert.equal(compareHands(bestHand([...playsTheBoard, c("2c"), c("3c")]),
    bestHand([...playsTheBoard, c("2d"), c("3d")])), 0);
});

test("bestHand picks the best five of seven", () => {
  assert.equal(bestHand(cards("2h 2d 2c 9s 9h Ad Kc")).name, "Full House");
  assert.equal(bestHand(cards("2h 5h 9h Jh 3c 4d Kh")).name, "Flush");
});

// ---------------------------------------------------------------------------
// Side pots
// ---------------------------------------------------------------------------

test("side pots for three different all-ins", () => {
  const pots = buildPots([
    { id: "a", amount: 50, folded: false },
    { id: "b", amount: 200, folded: false },
    { id: "c", amount: 500, folded: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 150, eligible: ["a", "b", "c"] },
    { amount: 300, eligible: ["b", "c"] },
    { amount: 300, eligible: ["c"] }, // c's uncalled bet
  ]);
});

test("folded chips stay in the pot", () => {
  const pots = buildPots([
    { id: "a", amount: 100, folded: true },
    { id: "b", amount: 100, folded: false },
    { id: "c", amount: 100, folded: false },
  ]);
  assert.deepEqual(pots, [{ amount: 300, eligible: ["b", "c"] }]);
});

// ---------------------------------------------------------------------------
// Game flow
// ---------------------------------------------------------------------------

function move(state: PokerState, m: PokerMove, who = state.seats[state.toAct!].id): PokerState {
  const v = game.validateMove(state, who, m);
  assert.ok(v.ok, `${who} ${JSON.stringify(m)}: ${v.ok ? "" : v.error}`);
  return game.applyMove(state, who, v.move);
}

/** Replace the hole cards and the rest of the deck (dealt from the end). */
function rig(state: PokerState, holes: string[], boardCards: string): PokerState {
  holes.forEach((h, i) => (state.seats[i].hole = cards(h)));
  state.deck = cards(boardCards).reverse();
  return state;
}

test("heads-up: dealer posts small blind and acts first preflop, last after", () => {
  let s = game.init(["a", "b"]);
  assert.equal(s.dealer, 0);
  assert.equal(s.seats[0].bet, 10);
  assert.equal(s.seats[1].bet, 20);
  assert.equal(s.seats[s.toAct!].id, "a");

  s = move(s, { type: "call" });
  assert.equal(s.seats[s.toAct!].id, "b", "big blind gets the option");
  s = move(s, { type: "check" });
  assert.equal(s.phase, "flop");
  assert.equal(s.board.length, 3);
  assert.equal(s.seats[s.toAct!].id, "b", "non-dealer acts first after the flop");
});

test("three players: blinds, UTG first, everyone else folds", () => {
  let s = game.init(["a", "b", "c"]);
  assert.deepEqual([s.dealer, s.smallBlind, s.bigBlind], [0, 1, 2]);
  assert.equal(s.seats[s.toAct!].id, "a");

  s = move(s, { type: "raise", to: 60 });
  s = move(s, { type: "fold" });
  s = move(s, { type: "fold" });
  assert.equal(s.phase, "showdown");
  assert.equal(s.lastResult?.uncontested, true);
  assert.equal(s.seats[0].chips, STARTING_CHIPS + 10 + 20);
});

test("minimum raise and short all-in rules", () => {
  let s = game.init(["a", "b", "c"]);
  const tooSmall = game.validateMove(s, "a", { type: "raise", to: 30 });
  assert.equal(tooSmall.ok, false);
  s = move(s, { type: "raise", to: 60 }); // raise of 40
  assert.equal(game.validateMove(s, "b", { type: "raise", to: 90 }).ok, false);
  assert.equal(game.validateMove(s, "b", { type: "raise", to: 100 }).ok, true);
});

test("all-in preflop runs out the board and splits side pots", () => {
  let s = game.init(["a", "b", "c"]);
  s.seats[0].chips = 100; // a is short
  rig(s, ["Ah As", "Kh Ks", "2c 7d"], "Qd 9s 4c 3h 8h");

  s = move(s, { type: "raise", to: 100 }); // a all-in
  s = move(s, { type: "raise", to: 1000 }); // b all-in (had 990 behind + 10)
  s = move(s, { type: "call" }); // c calls all-in

  assert.equal(s.phase, "showdown");
  assert.equal(s.board.length, 5);
  // a wins the main pot (3 × 100), b wins the side pot (2 × 900).
  assert.equal(s.seats[0].chips, 300);
  assert.equal(s.seats[1].chips, 1800);
  assert.equal(s.seats[2].chips, 0);
  assert.deepEqual(game.result(s), { over: false });

  s = move(s, { type: "nextHand" }, "a");
  assert.equal(s.seats[2].out, true, "busted player sits out");
  assert.equal(s.seats[2].hole.length, 0);
  assert.notEqual(s.seats[s.toAct!].id, "c");
});

test("game ends when one player has all the chips", () => {
  let s = game.init(["a", "b"]);
  rig(s, ["Ah As", "2c 7d"], "Ad Kc 4c 3h 8h");
  s = move(s, { type: "raise", to: 1000 });
  s = move(s, { type: "call" });
  assert.deepEqual(game.result(s), { over: true, winner: "a" });
  assert.equal(s.seats[0].chips, 2 * STARTING_CHIPS);
});

test("blinds double every 10 hands", () => {
  let s = game.init(["a", "b"]);
  for (let hand = 1; hand < 11; hand++) {
    s = move(s, { type: "fold" });
    s = move(s, { type: "nextHand" }, "a");
  }
  assert.equal(s.handNumber, 11);
  assert.deepEqual(s.blinds, { small: 20, big: 40 });
});

test("playerView hides other hands and the deck until showdown", () => {
  let s = game.init(["a", "b"]);
  const view = game.playerView!(s, "a") as PokerState;
  assert.equal(view.deck.length, 0);
  assert.ok(view.seats[0].hole.every((card) => card !== null));
  assert.deepEqual(view.seats[1].hole, [null, null]);

  rig(s, ["Ah As", "2c 7d"], "Ad Kc 4c 3h 8h");
  s = move(s, { type: "call" });
  s = move(s, { type: "check" });
  for (let street = 0; street < 3; street++) {
    s = move(s, { type: "check" });
    s = move(s, { type: "check" });
  }
  const after = game.playerView!(s, "a") as PokerState;
  assert.equal(s.phase, "showdown");
  assert.ok(after.seats[1].hole.every((card) => card !== null), "revealed at showdown");
});

test("a short all-in raise does not reopen betting for players who acted", () => {
  let s = game.init(["a", "b", "c"]);
  s.seats[1].chips = 60; // b (small blind) has 70 in total
  s = move(s, { type: "raise", to: 60 }); // a
  s = move(s, { type: "raise", to: 70 }); // b all-in: raise of only 10
  s = move(s, { type: "call" }); // c
  assert.equal(s.seats[s.toAct!].id, "a");
  assert.equal(game.validateMove(s, "a", { type: "raise", to: 200 }).ok, false);
  assert.equal(game.validateMove(s, "a", { type: "call" }).ok, true);
});

test("random games never create or lose chips and always finish", () => {
  for (let g = 0; g < 200; g++) {
    const players = ["a", "b", "c", "d", "e"].slice(0, 2 + (g % 4));
    const total = players.length * STARTING_CHIPS;
    let s = game.init(players);
    for (let turn = 0; !game.result(s).over; turn++) {
      assert.ok(turn < 20000, "game should finish");
      const inPlay = s.seats.reduce((sum, seat) => sum + seat.chips + seat.totalBet, 0);
      assert.equal(s.phase === "showdown" ? s.seats.reduce((x, seat) => x + seat.chips, 0) : inPlay, total);

      if (s.phase === "showdown") {
        s = move(s, { type: "nextHand" }, players[0]);
        continue;
      }
      const seat = s.seats[s.toAct!];
      assert.equal(seat.out || seat.folded || seat.allIn, false, "only active players get the turn");
      const toCall = s.currentBet - seat.bet;
      const r = Math.random();
      const { min, max, step } = raiseBounds(s, seat);
      if (r < 0.15 && !seat.acted && max > s.currentBet) {
        const to = min + step * Math.floor(Math.random() * ((max - min) / step + 1));
        s = move(s, { type: "raise", to: Math.random() < 0.2 ? max : Math.min(to, max) });
      } else if (r < 0.3 && toCall > 0) {
        s = move(s, { type: "fold" });
      } else {
        s = move(s, toCall > 0 ? { type: "call" } : { type: "check" });
      }
    }
    assert.equal(s.seats.reduce((sum, seat) => sum + seat.chips, 0), total);
  }
});

test("raises go in steps of the small blind, except all-in", () => {
  let s = game.init(["a", "b", "c"]);
  assert.equal(game.validateMove(s, "a", { type: "raise", to: 45 }).ok, false);
  assert.equal(game.validateMove(s, "a", { type: "raise", to: 50 }).ok, true);
  s.seats[0].chips = 73;
  assert.equal(game.validateMove(s, "a", { type: "raise", to: 73 }).ok, true, "all-in");
});

test("a player leaving folds their hand and keeps the game going", () => {
  let s = game.init(["a", "b", "c"]);
  assert.equal(s.seats[s.toAct!].id, "a");
  s = game.playerLeft!(s, "a"); // leaves on their turn
  assert.equal(s.seats[0].out, true);
  assert.equal(s.seats[s.toAct!].id, "b");
  assert.deepEqual(game.result(s), { over: false });

  s = game.playerLeft!(s, "c"); // big blind leaves: b wins the hand and the game
  assert.equal(s.phase, "showdown");
  assert.deepEqual(game.result(s), { over: true, winner: "b" });
});
