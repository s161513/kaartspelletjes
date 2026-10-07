import { test } from "node:test";
import assert from "node:assert/strict";
import { RANK_VALUES, type Card, type Rank, type Suit } from "@app/shared";
import {
  advise, adviseGiveBack, adviseRequest, followsAdvice, hintFor, type Advice,
} from "./advisor.js";
import {
  appendRound, demoHistory, MemoryStore, SESSION_GAP_MS, summarize, WINDOW, type RoundRecord,
} from "./context.js";
import { computeHelp, levelFor } from "./score.js";
import type { Role } from "../types.js";

// "7h" = seven of hearts, "Th" = ten of hearts, "2s" = two of spades, …
const SUITS: Record<string, Suit> = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };
function c(code: string): Card {
  const rank = (code[0] === "T" ? "10" : code[0]) as Rank;
  const suit = SUITS[code[1]];
  return { rank, suit, deck: 0, id: `${suit}-${rank}#0` };
}
const hand = (codes: string) => codes.split(" ").map(c);
const ids = (codes: string) => codes.split(" ").map((x) => c(x).id);
const v = (rank: Rank) => RANK_VALUES[rank];
const best = (a: Advice[]) => a[0];
const cardsOf = (a: Advice) => (a.kind === "play" ? [...a.cardIds].sort() : "pass");

const MIN = 60_000;
const T0 = new Date(2026, 9, 7, 15, 0).getTime(); // 15:00, not "late"

function history(roles: Role[], helpLevel: 0 | 1 = 0, start = T0): RoundRecord[] {
  let r: RoundRecord[] = [];
  roles.forEach((role, i) => {
    r = appendRound(r, { role, helpLevel, hintsShown: 0, hintsFollowed: 0 }, start + i * 5 * MIN);
  });
  return r;
}
const lastAt = (r: RoundRecord[]) => r[r.length - 1].at;

// ---------------------------------------------------------------------------
// Advisor: legal moves
// ---------------------------------------------------------------------------

test("only plays that meet the table with enough cards are offered", () => {
  const options = advise({ hand: hand("4h 9h 9s Kd"), currentCount: 2, currentRankValue: v("8") });
  const plays = options.filter((o) => o.kind === "play");
  assert.deepEqual(plays.map(cardsOf), [ids("9h 9s").sort()]);
  assert.ok(options.some((o) => o.kind === "pass"), "following → pass is an option");
});

test("a wild 2 fills a group but a group of only 2s is never offered", () => {
  const options = advise({ hand: hand("2h 2s Kd"), currentCount: 2, currentRankValue: v("9") });
  const plays = options.filter((o) => o.kind === "play");
  // K+2 and K+2+2 (more cards than the table is allowed); never 2+2 alone.
  assert.deepEqual(
    plays.map((p) => String(cardsOf(p))).sort(),
    [ids("Kd 2h").sort(), ids("Kd 2h 2s").sort()].map(String).sort(),
  );
  assert.equal((plays[0] as Extract<Advice, { kind: "play" }>).cardIds.length, 3, "with 3 cards left, going out wins");
});

test("the ♣3 holder is told to open with the ♣3", () => {
  const options = advise({ hand: hand("3c 3h 5d 9s"), currentCount: null, currentRankValue: null });
  for (const o of options) {
    assert.equal(o.kind, "play");
    assert.ok(o.kind === "play" && o.cardIds.includes(c("3c").id));
  }
  assert.deepEqual(cardsOf(best(options)), ids("3c 3h").sort(), "and keeps the 3s together");
});

// ---------------------------------------------------------------------------
// Advisor: heuristics
// ---------------------------------------------------------------------------

test("follow with the lowest cards that beat the table", () => {
  const options = advise({ hand: hand("5h 8s Jd Ac 7c 7d"), currentCount: 1, currentRankValue: v("6") });
  assert.deepEqual(cardsOf(best(options)), ids("8s"), "the 8, not a 7 from the pair");
});

test("save wild 2s: a natural pair beats a card plus a 2", () => {
  const options = advise({ hand: hand("4h 6s 6h 9d 2c Jh Kd"), currentCount: 2, currentRankValue: v("5") });
  assert.deepEqual(cardsOf(best(options)), ids("6s 6h").sort());
});

test("prefer shedding cards over passing (a pass locks you out of the trick)", () => {
  const options = advise({ hand: hand("4h 9d Jh Kd Ac"), currentCount: 1, currentRankValue: v("Q") });
  assert.deepEqual(cardsOf(best(options)), ids("Kd"));
});

test("lead with the lowest complete group", () => {
  const options = advise({ hand: hand("5h 5s 8d Ks Kh"), currentCount: null, currentRankValue: null });
  assert.deepEqual(cardsOf(best(options)), ids("5h 5s").sort());
});

test("almost out: finish, using a 2 if needed", () => {
  const options = advise({ hand: hand("Qh 2s"), currentCount: 2, currentRankValue: v("J") });
  assert.deepEqual(cardsOf(best(options)), ids("Qh 2s").sort());
  assert.match(best(options).reason, /finish/);
});

test("exchange: ask for the strongest rank you lack, give back the weakest single", () => {
  assert.equal(adviseRequest(hand("2h Ah 9s"), []), "K");
  assert.equal(adviseRequest(hand("Ah 9s"), ["2"]), "K");
  assert.equal(adviseGiveBack(hand("4h 4s 6d Ks 2c")), c("6d").id);
});

test("following a hint ignores suits", () => {
  const advice: Advice = { kind: "play", cardIds: ids("7s"), cost: 0, reason: "" };
  assert.ok(followsAdvice(advice, { type: "play", cardIds: ids("7h") }));
  assert.ok(!followsAdvice(advice, { type: "play", cardIds: ids("8h") }));
  assert.ok(!followsAdvice(advice, { type: "pass" }));
});

test("hint shape per level", () => {
  const options = advise({ hand: hand("4h 6s 9d Kd"), currentCount: 1, currentRankValue: v("3") });
  assert.equal(hintFor(0, options), null);
  assert.equal(hintFor(1, options)!.best, options[0], "level 1: only the best move");
  assert.equal(hintFor(1, options)!.reason, null);
  assert.ok(hintFor(2, options)!.reason, "level 2: plus an explanation");
});

// ---------------------------------------------------------------------------
// Context memory
// ---------------------------------------------------------------------------

test("the long-term window only looks at the last rounds", () => {
  const old = history(Array(30).fill("scum"));
  const recent = history(Array(WINDOW).fill("president"), 0, lastAt(old) + 5 * MIN);
  const s = summarize([...old, ...recent], lastAt(recent));
  assert.equal(s.rounds, WINDOW);
  assert.ok(s.winRate > 0.85, `old scum rounds fell out of the window (${s.winRate})`);
  assert.ok(s.scumRate < 0.1);
});

test("a new player gets a neutral prior, not 0% or 100%", () => {
  const s = summarize(history(["scum"]), T0);
  assert.ok(s.winRate > 0.2 && s.winRate < 0.34);
  assert.equal(computeHelp(summarize([], T0)).level, 0, "an average newcomer plays without hints");
});

test("losing streak and session reset after a long pause", () => {
  const r = history(["president", "citizen", "scum", "scum"]);
  assert.equal(summarize(r, lastAt(r)).lossStreak, 3);
  assert.equal(summarize(r, lastAt(r)).sessionRounds, 4);
  const later = lastAt(r) + SESSION_GAP_MS + MIN;
  assert.equal(summarize(r, later).lossStreak, 0);
  assert.equal(summarize(r, later).sessionRounds, 0);
  const next = appendRound(r, { role: "citizen", helpLevel: 0, hintsShown: 0, hintsFollowed: 0 }, later);
  assert.notEqual(next[4].sessionId, next[3].sessionId);
});

test("rounds won with help count for less", () => {
  const unaided = summarize(history(Array(10).fill("president"), 0), T0 + 50 * MIN);
  const helped = summarize(history(Array(10).fill("president"), 1), T0 + 50 * MIN);
  assert.ok(helped.winRate < unaided.winRate);
});

test("MemoryStore round-trips and clears", () => {
  const store = new MemoryStore();
  store.save(history(["scum"]));
  assert.equal(store.load().length, 1);
  store.clear();
  assert.equal(store.load().length, 0);
});

// ---------------------------------------------------------------------------
// Score → level, and the A/B demonstration
// ---------------------------------------------------------------------------

test("level thresholds", () => {
  assert.equal(levelFor(0.69), 0);
  assert.equal(levelFor(0.7), 1);
  assert.equal(levelFor(0.89), 1);
  assert.equal(levelFor(0.9), 2);
});

test("A/B: same hand and table, different history → different help", () => {
  const now = T0 + 120 * MIN;
  const weak = computeHelp(summarize(demoHistory("weak", now), now));
  const strong = computeHelp(summarize(demoHistory("strong", now), now));
  assert.equal(weak.level, 2);
  assert.equal(strong.level, 0);

  const options = advise({ hand: hand("5h 8s Jd Ac 7c 7d"), currentCount: 1, currentRankValue: v("6") });
  assert.ok(hintFor(weak.level, options)?.reason, "struggling player: highlight + explanation");
  assert.equal(hintFor(strong.level, options), null, "strong player: no hint");
});

test("context switch off: history is ignored", () => {
  const now = T0 + 120 * MIN;
  const off = computeHelp(summarize(demoHistory("weak", now), now), { useContext: false });
  assert.equal(off.level, 0);
  assert.equal(off.usedContext, false);
});

test("fatigue nudges the score late at night", () => {
  const r = history(["citizen", "citizen", "citizen"]);
  const day = computeHelp(summarize(r, lastAt(r)));
  const late = new Date(2026, 9, 7, 23, 30).getTime();
  const night = computeHelp(summarize(history(["citizen", "citizen", "citizen"], 0, late - 10 * MIN), late));
  assert.ok(night.score > day.score);
});
