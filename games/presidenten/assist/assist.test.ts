import { test } from "node:test";
import assert from "node:assert/strict";
import { RANK_VALUES, type Card, type Rank, type Suit } from "@app/shared";
import {
  advise, adviseGiveBack, adviseRequest, followsAdvice, hintFor, type Advice,
} from "./advisor.js";
import {
  appendRound, demoHistory, MemoryStore, SESSION_GAP_MS, summarize, WINDOW, type RoundRecord,
} from "./context.js";
import {
  AVERAGE_HAND_STRENGTH, encode, extractFeatures, FEATURE_NAMES, handStrength, makeContext, SCUM_PRIOR,
} from "./features.js";
import { FEATURES, GOLDEN, INTERCEPT, METRICS } from "./model.js";
import {
  BASE_RATE, computeHelp, levelFor, modelMatchesFeatures, predictScum, thresholdsAt, THRESHOLDS,
} from "./score.js";
import { notePlay, roundToLog } from "./tracker.js";
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
  assert.equal(s.lastPlaces, 0, "and so did the old last places");
});

test("a new player gets a neutral prior, not 0% or 100%", () => {
  const s = summarize(history(["scum"]), T0);
  assert.ok(s.winRate > 0.1 && s.winRate < 0.25, `${s.winRate}`);
  const newcomer = computeHelp(extractFeatures([], T0));
  assert.ok(Math.abs(newcomer.p - 0.25) < 0.1, `an average newcomer is near the base rate (${newcomer.p})`);
  assert.equal(newcomer.level, 0, "and plays without hints");
});

test("helped rounds count half in the Scum count too (half evidence, half prior)", () => {
  const unaided = extractFeatures(history(Array(WINDOW).fill("scum"), 0), T0 + 200 * MIN);
  const helped = extractFeatures(history(Array(WINDOW).fill("scum"), 1), T0 + 200 * MIN);
  assert.equal(unaided.scum_count_20, WINDOW);
  assert.equal(helped.scum_count_20, WINDOW * (0.5 * 1 + 0.5 * SCUM_PRIOR));
});

test("losing streak and session reset after a long pause", () => {
  const r = history(["president", "citizen", "scum", "scum"]);
  assert.equal(summarize(r, lastAt(r)).lossStreak, 3);
  // The streak only counts this session: losses before a break don't carry over.
  const after = appendRound(r, { role: "citizen", helpLevel: 0, hintsShown: 0, hintsFollowed: 0 },
    lastAt(r) + SESSION_GAP_MS + MIN);
  assert.equal(summarize(after, lastAt(after)).lossStreak, 1);
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
// Features
// ---------------------------------------------------------------------------

test("the generated model uses exactly the features the code extracts", () => {
  assert.deepEqual([...FEATURES], [...FEATURE_NAMES]);
  assert.ok(modelMatchesFeatures());
  assert.ok(METRICS.auc > 0.6, `trained model should beat chance clearly (AUC ${METRICS.auc})`);
});

test("extractFeatures on an empty history: an average newcomer", () => {
  const f = extractFeatures([], T0);
  assert.equal(f.scum_count_20, WINDOW * SCUM_PRIOR, "missing rounds count as average");
  assert.equal(f.table_size, 4);
  assert.equal(f.loss_streak, 0);
  assert.equal(f.rounds_in_session, 0);
  assert.equal(f.session_minutes, 0);
  assert.equal(f.hour_of_day, 15);
  assert.equal(f.hand_strength, AVERAGE_HAND_STRENGTH, "no hand → an average hand");
  for (const v of Object.values(encode(f))) assert.ok(Number.isFinite(v));
});

test("hand strength counts 2s, aces and kings, scaled to a 13-card hand", () => {
  // 13 cards (four players): the plain sum.
  assert.equal(handStrength(hand("2h 2s Ad Kc 9h 3c 4c 5c 6c 7c 8c Tc Jc")), 3 + 3 + 2 + 1);
  // 6 cards: the same 9 points are worth more per card.
  assert.equal(handStrength(hand("2h 2s Ad Kc 9h 3c")), (9 * 13) / 6);
  assert.equal(handStrength(hand("3c 4d 5h Qs")), 0);
  assert.equal(handStrength([]), AVERAGE_HAND_STRENGTH, "empty hand → average");
});

test("hour encoding is cyclic: 23:00 is next to 00:00", () => {
  const at = (h: number) => encode(makeContext({ hour_of_day: h }));
  const dist = (a: number, b: number) => Math.hypot(at(a).hour_sin - at(b).hour_sin, at(a).hour_cos - at(b).hour_cos);
  assert.ok(Math.abs(dist(23, 0) - dist(0, 1)) < 1e-9);
  assert.ok(dist(23, 0) < dist(12, 0));
});

test("no leakage: features for round n don't depend on round n's outcome", () => {
  const before = history(["citizen", "scum", "president", "citizen"]);
  const now = lastAt(before) + 5 * MIN; // round n starts
  const startHand = hand("4h 9d Jh Kd Ac 2s");
  const f = extractFeatures(before, now, startHand);
  assert.equal(f.rounds_in_session, before.length);
  // Round n ends (as President or as Scum) and lands in the history. The
  // features *at the start* of round n must not change either way.
  for (const role of ["president", "scum"] as Role[]) {
    const after = appendRound(before, { role, helpLevel: 0, hintsShown: 0, hintsFollowed: 0 }, now + 4 * MIN);
    assert.deepEqual(extractFeatures(after, now, startHand), f, `round n as ${role}`);
  }
  // Only for round n + 1 does the outcome count.
  const lost = appendRound(before, { role: "scum", helpLevel: 0, hintsShown: 0, hintsFollowed: 0 }, now + 4 * MIN);
  assert.notDeepEqual(extractFeatures(lost, now + 4 * MIN, startHand), f);
});

// ---------------------------------------------------------------------------
// The model: P(scum) → level, and the A/B demonstration
// ---------------------------------------------------------------------------

test("P(scum) is a probability, and the contributions explain it exactly", () => {
  for (const ctx of [makeContext(), makeContext({ winrate_20: 0, scum_count_20: 20, loss_streak: 30 }),
    makeContext({ winrate_20: 1, scum_count_20: 0, hand_strength: 25 })]) {
    const { p, contributions } = predictScum(ctx);
    assert.ok(p > 0 && p < 1, `P = ${p}`);
    // log-odds = intercept + Σ contributions (what the UI shows as reasons)
    const sum = Object.values(contributions).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(Math.log(p / (1 - p)) - (INTERCEPT + sum)) < 1e-9);
  }
});

test("TypeScript reproduces sklearn's predictions (golden cases from train.py)", () => {
  assert.ok(GOLDEN.length >= 3);
  for (const g of GOLDEN) {
    const { p } = predictScum({ ...g.raw });
    assert.ok(Math.abs(p - g.p) < 1e-5, `TS ${p} vs sklearn ${g.p}`);
  }
});

test("coefficient signs make sense (monotonic in the main features)", () => {
  const p = (over: Parameters<typeof makeContext>[0]) => predictScum(makeContext(over)).p;
  assert.ok(p({ loss_streak: 4 }) > p({ loss_streak: 0 }), "a losing streak raises P");
  assert.ok(p({ scum_count_20: 10 }) > p({ scum_count_20: 2 }), "more recent Scum finishes raise P");
  assert.ok(p({ winrate_20: 0.6 }) < p({ winrate_20: 0.1 }), "a higher win rate lowers P");
  assert.ok(p({ hand_strength: 12 }) < p({ hand_strength: 2 }), "a stronger hand lowers P");
  // Strictly monotonic over a range, not just at two points.
  for (let k = 0; k < 8; k++) assert.ok(p({ loss_streak: k + 1 }) > p({ loss_streak: k }));
});

test("levelFor follows the trained thresholds", () => {
  const [t1, t2] = THRESHOLDS;
  assert.ok(t1 > 0 && t1 < t2 && t2 < 1);
  assert.equal(levelFor(t1 - 1e-6), 0);
  assert.equal(levelFor(t1), 1);
  assert.equal(levelFor(t2 - 1e-6), 1);
  assert.equal(levelFor(t2), 2);
});

test("A/B: same hand and table, different history → different help", () => {
  const now = T0 + 120 * MIN;
  const startHand = hand("3h 4s 5h 6c 7c 7d 8s 9h Tc Jd Qs Kh Ac");
  const weak = computeHelp(extractFeatures(demoHistory("weak", now), now, startHand));
  const strong = computeHelp(extractFeatures(demoHistory("strong", now), now, startHand));
  // Robust to retraining: only the ordering and "the weak player gets help".
  assert.ok(weak.p > strong.p, `weak ${weak.p} > strong ${strong.p}`);
  assert.ok(weak.level > strong.level);
  assert.ok(weak.level >= 1);
  assert.ok(weak.factors.length > 0 && weak.factors[0].contribution > 0, "top reason pushes P up");

  const options = advise({ hand: hand("5h 8s Jd Ac 7c 7d"), currentCount: 1, currentRankValue: v("6") });
  assert.ok(hintFor(weak.level, options), "struggling player: a hint");
  assert.equal(hintFor(strong.level, options), null, "strong player: no hint");
});

test("context switch off: everyone gets the table's base rate and no help", () => {
  const now = T0 + 120 * MIN;
  for (const n of [3, 4, 5]) {
    const weak = computeHelp(extractFeatures(demoHistory("weak", now), now, undefined, n), { useContext: false });
    const strong = computeHelp(extractFeatures(demoHistory("strong", now), now, undefined, n), { useContext: false });
    for (const d of [weak, strong]) {
      assert.ok(Math.abs(d.p - 1 / n) < 1e-12, `P = 1/${n}`);
      assert.equal(d.pModel, BASE_RATE);
      assert.equal(d.usedContext, false);
      assert.deepEqual(d.factors, []);
      assert.equal(d.level, 0, "base rate → level 0 → no help");
    }
  }
});

test("table size shifts the shown P to 1/n but not the level", () => {
  for (const ctx of [makeContext(), makeContext({ winrate_20: 0.05, scum_count_20: 12, loss_streak: 6 })]) {
    const at4 = computeHelp(ctx);
    const at3 = computeHelp({ ...ctx, table_size: 3 });
    const at6 = computeHelp({ ...ctx, table_size: 6 });
    assert.ok(at3.p > at4.p && at4.p > at6.p, "more players → each less likely last");
    assert.equal(at3.level, at4.level);
    assert.equal(at6.level, at4.level);
    assert.equal(at3.pModel, at4.pModel);
    // The displayed thresholds move the same way, so "P vs threshold" stays consistent.
    assert.equal(at3.p >= thresholdsAt(3)[0], at4.level >= 1);
  }
});

// ---------------------------------------------------------------------------
// Which rounds go into the history (tracker.ts, used by panel.ts)
// ---------------------------------------------------------------------------

test("a normal round is logged once, with the help level used during its play", () => {
  let played = notePlay(null, 3, 0);
  played = notePlay(played, 3, 2); // help came on during the round
  played = notePlay(played, 3, 0);
  assert.deepEqual(roundToLog(played, { round: 4, role: "scum" }), { role: "scum", helpLevel: 2 });
  assert.equal(roundToLog(played, { round: 3, role: "citizen" }), null, "same round: nothing to log yet");
});

test("a watcher who gets dealt in does not get a fake round", () => {
  // Watching round 3 (not seated → panel never calls notePlay), dealt in as a citizen for round 4.
  assert.equal(roundToLog(null, { round: 4, role: "citizen" }), null);
});

test("a reload never logs a round twice, and skipped rounds are not logged", () => {
  // After a reload the tracker starts empty: the round that already ended is not logged again.
  assert.equal(roundToLog(null, { round: 5, role: "president" }), null);
  // Missed a whole hand (disconnected): played round 3, next view is round 5.
  assert.equal(roundToLog(notePlay(null, 3, 1), { round: 5, role: "scum" }), null);
  // No role yet (first hand of a game): nothing to log.
  assert.equal(roundToLog(notePlay(null, 1, 0), { round: 2, role: null }), null);
});
