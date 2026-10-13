// Simulation for the Lab 8 report: training data for the P(scum) model, and
// demos that show the context changes behaviour.
//
//   npx tsx games/presidenten/assist/simulate.ts --dataset      # training data → out/rounds.csv
//   npx tsx games/presidenten/assist/simulate.ts --ab           # A/B: same hand, different context
//   npx tsx games/presidenten/assist/simulate.ts --sensitivity  # one context variable at a time
//   npx tsx games/presidenten/assist/simulate.ts                # learner run + chart
//   npx tsx games/presidenten/assist/simulate.ts --weak         # do weak players gain? (bar chart)
//
// Everything is played with the *real* game logic (logic.ts). A bot's "skill"
// is the chance that it plays the advisor's best move; otherwise it picks a
// random legal option.
//
// Note: the game deals every new hand with a secure RNG (logic.ts), so only the
// first deal and the bots' choices are seeded — numbers vary a little per run.
//
// Output goes to assist/out/ (git-ignored). Node-only (fs); never imported by
// the browser.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Card, Rank } from "@app/shared";
import { RANK_VALUES } from "@app/shared";
import { applyMove, createGame, playerView, validateMove } from "../logic.js";
import { REQUEST_RANKS } from "../rules.js";
import type { PresidentenMove, PresidentenState, PresidentenView, Role } from "../types.js";
import { advise, adviseGiveBack, adviseRequest, followsAdvice, hintFor } from "./advisor.js";
import {
  appendRound, demoHistory, MemoryStore, type HelpLevel, type RoundRecord,
} from "./context.js";
import {
  encode, extractFeatures, FEATURE_NAMES, handStrength, makeContext, type RawContext,
} from "./features.js";
import { BASE_RATE, computeHelp, levelFor, thresholdsAt } from "./score.js";

/** T1/T2 on the scale of the P we show at a table of four (see score.ts). */
const THRESHOLDS = thresholdsAt(4);
import { METRICS, TRAINED_ON } from "./model.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");

// ---------------------------------------------------------------------------
// Shared set-up
// ---------------------------------------------------------------------------

const ROUNDS = 300;
const LEARNER = "learner";
const PLAYERS = [LEARNER, "bot1", "bot2", "bot3"];
const BOT_SKILL = 0.4; // chance the opponents play the advisor's best move (an average table)
const SKILL_START = 0; // the learner's skill grows linearly …
const SKILL_END = 1; // … over the run
/** How likely the learner follows a hint, per help level. */
const FOLLOW: Record<HelpLevel, number> = { 0: 0, 1: 0.75, 2: 0.9 };
const ROUND_MINUTES = 4; // simulated time per round
const ROUNDS_PER_SESSION = 15; // then a long break → new session
const STUCK_AFTER_MOVES = 3000; // a normal hand takes well under 200 moves

/** Small seeded PRNG (mulberry32) so runs are repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// ---------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------

interface Decision {
  move: PresidentenMove;
  hinted: boolean; // a hint was on screen for this move
  followed: boolean; // and the bot made the hinted move
}

function toMove(option: ReturnType<typeof advise>[number]): PresidentenMove {
  return option.kind === "pass" ? { type: "pass" } : { type: "play", cardIds: option.cardIds };
}

/**
 * One decision. `skill` = chance of playing the advisor's best move on its own;
 * otherwise a random legal option. With a hint on screen the bot first rolls
 * to follow the hint. `blunder` (dataset only, see effectiveForm) = chance of
 * a careless move: the option the advisor rates *worst*.
 */
function decide(
  view: PresidentenView,
  skill: number,
  level: HelpLevel,
  missed: Rank[],
  rnd: () => number,
  blunder = 0,
): Decision {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];

  if (view.phase === "EXCHANGE") {
    const step = view.exchange!.step;
    if (step === "request") {
      const rank = rnd() < skill ? adviseRequest(view.myHand, missed) : pick(REQUEST_RANKS);
      return { move: { type: "request", rank }, hinted: false, followed: false };
    }
    const cardId = rnd() < skill ? adviseGiveBack(view.myHand)! : pick(view.myHand).id;
    return { move: { type: "giveBack", cardId }, hinted: false, followed: false };
  }

  const options = advise({
    hand: view.myHand,
    currentCount: view.currentCount,
    currentRankValue: view.currentRank ? RANK_VALUES[view.currentRank as Rank] : null,
  });
  const hint = hintFor(level, options);
  if (hint && rnd() < FOLLOW[level]) {
    return { move: toMove(hint.best), hinted: true, followed: true };
  }
  if (blunder > 0 && rnd() < blunder) {
    const move = toMove(options[options.length - 1]);
    return { move, hinted: hint !== null, followed: hint !== null && followsAdvice(options[0], move) };
  }
  const move = toMove(rnd() < skill ? options[0] : pick(options));
  return { move, hinted: hint !== null, followed: hint !== null && followsAdvice(options[0], move) };
}

/** Who has to act right now? */
function actor(s: PresidentenState): string | null {
  if (s.phase === "PLAY") return s.players[s.turnIndex];
  if (s.phase === "EXCHANGE") return s.exchange?.pairs[0]?.winner ?? null;
  return null;
}

/**
 * Tracks the ranks the current loser turned out not to have during the
 * exchange (reset for every new pair), so a skilled bot doesn't ask twice.
 */
function missTracker() {
  let missed: Rank[] = [];
  let missedFor = "";
  return (view: PresidentenView): Rank[] => {
    const pairKey = view.exchange ? `${view.round}:${view.exchange.done}` : "";
    if (pairKey !== missedFor) {
      missed = [];
      missedFor = pairKey;
    }
    if (view.exchange?.lastMiss && !missed.includes(view.exchange.lastMiss as Rank)) {
      missed.push(view.exchange.lastMiss as Rank);
    }
    return missed;
  };
}

// ===========================================================================
// --dataset: training data for the P(scum) model
// ===========================================================================
//
// A population of simulated players plays in "rooms" (one per simulated
// evening/day, at different times of day). A room has four seats; every
// player who sits down plays their own number of rounds and then leaves, and
// a fresh player from the population takes the seat. So at one table one
// player may have just started while another has been playing for two hours
// — session length differs per player, as in a real room. Every player keeps
// their *own* context memory (a MemoryStore), exactly like a browser does per
// nickname. For every player and every round we write one CSV row:
//
//   features   computed with features.ts from the history *before* the round
//              and the hand after the exchange (so nothing from the round's
//              own outcome leaks in)
//   label      became_scum = finished last (role "scum")
//
// The data is generated WITHOUT any help (help_level = 0 everywhere). If the
// help were on, the model would partly learn the effect of its own hints (a
// helped weak player looks less likely to be Scum → gets less help → the
// feedback loop). ml/train.py also filters on help_level = 0; on this data
// that removes nothing — it is a safeguard for future, logged data.
//
// HONESTY NOTE — injected effects. Real players get tired and tilt; bots do
// not. So we deliberately *build in* the behaviour we want the model to be
// able to find (see `effectiveForm`):
//   - late at night (peak around 02:00) players make more careless moves,
//   - after about 45 minutes in a session they slowly get tired,
//   - after a losing streak of 3+ rounds they "tilt" ("losing" = not winning:
//     at a table of four only the President wins, so this is "3+ rounds
//     since I was last President" — common even for an average player),
// and weak players suffer more from all three than strong ones. The model
// therefore *can* only rediscover these effects; it says nothing about real
// people. The part that is not injected: how strongly these effects actually
// change who ends up as Scum, given the real rules, the exchange and the
// other three players at the table. (Result: fatigue and tilt come through;
// the night effect mostly does not, because everyone at the table shares the
// clock and there is always exactly one Scum — see features.ts `encode`.)

const POPULATION = 48; // players: 16 weak, 16 average, 16 strong
const TABLE = 4;
const TARGET_ROWS = 24_000; // stop after this many CSV rows (= 6000 hands)
const ROOM_ROUNDS = [30, 100] as const; // rounds a room stays open
const SEAT_ROUNDS = [6, 45] as const; // rounds one player stays (their session)
const DATASET_SEED = 2026;

type Profile = "weak" | "average" | "strong";
/**
 * `skill`: base chance of playing the best move. `vulnerability`: how much of
 * the night/fatigue/tilt effect this profile gets (weak players most).
 */
const PROFILES: Record<Profile, { skill: number; vulnerability: number }> = {
  weak: { skill: 0.25, vulnerability: 1 },
  average: { skill: 0.5, vulnerability: 0.5 },
  strong: { skill: 0.8, vulnerability: 0.15 },
};
const SKILL_NOISE = 0.07; // per-player spread around the profile's skill

// Strength of the injected effects: the blunder chance per move at full effect.
const NIGHT_BLUNDER = 0.45;
const FATIGUE_BLUNDER = 0.4;
const TILT_BLUNDER = 0.2;

interface SimPlayer {
  id: number;
  name: string;
  profile: Profile;
  skill: number; // base skill, profile + noise
  vulnerability: number;
  store: MemoryStore; // this player's own context memory
}

/** Standard normal from two uniforms (Box–Muller). */
function gaussian(rnd: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
}

function makePopulation(rnd: () => number): SimPlayer[] {
  const profiles: Profile[] = ["weak", "average", "strong"];
  return Array.from({ length: POPULATION }, (_, id) => {
    const profile = profiles[id % profiles.length];
    return {
      id,
      name: `p${id}`,
      profile,
      skill: clamp01(PROFILES[profile].skill + SKILL_NOISE * gaussian(rnd)),
      vulnerability: PROFILES[profile].vulnerability,
      store: new MemoryStore(),
    };
  });
}

/**
 * INJECTED EFFECT (see the honesty note above): how a player plays this round,
 * given their context. Each effect is a number 0 … 1:
 *   night   a smooth bump peaking at 02:00, zero between 08:00 and 20:00
 *   fatigue grows from 45 minutes into the session, full after 165 minutes
 *   tilt    grows from the 3rd round in a row without a win (= without being
 *           President, at four players), full at 6
 * Together they set a *blunder* chance: on that share of moves the player
 * makes a careless play (the option the advisor rates worst: wasting 2s,
 * splitting pairs, passing when it could shed a card). A blunder hurts at any
 * skill level; simply lowering `skill` would not, because a weak player
 * already plays close to random.
 */
function effectiveForm(p: SimPlayer, ctx: RawContext): { skill: number; blunder: number } {
  const night = Math.max(0, Math.cos((2 * Math.PI * (ctx.hour_of_day - 2)) / 24)) ** 2;
  const fatigue = clamp01((ctx.session_minutes - 45) / 120);
  const tilt = clamp01((ctx.loss_streak - 2) / 4);
  const effect = NIGHT_BLUNDER * night + FATIGUE_BLUNDER * fatigue + TILT_BLUNDER * tilt;
  return { skill: p.skill, blunder: clamp01(p.vulnerability * effect) };
}

/** Room opening times: weighted towards the evening, with real late-night play. */
const START_HOURS = [10, 12, 14, 15, 16, 17, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 0, 1];

/** "2026-10-07T21:34" in local time (the time zone the hours were simulated in). */
function localStamp(t: number): string {
  const d = new Date(t);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

const CSV_COLUMNS = [
  "round_id", "player_id", "profile", "session_id", "played_at",
  ...FEATURE_NAMES, "hour_of_day", "help_level", "final_role", "became_scum",
] as const;

interface Seat {
  player: SimPlayer;
  sessionId: string; // for the CSV: room + seat stint
  roundsLeft: number; // rounds until this player leaves the room
}

interface PendingRow {
  seat: Seat;
  start: number;
  ctx: RawContext; // features before the round (hand filled in when play starts)
}

function dataset(): void {
  const rnd = seeded(DATASET_SEED);
  const population = makePopulation(rnd);
  const lines: string[] = [CSV_COLUMNS.join(",")];
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const between = ([lo, hi]: readonly [number, number]) => lo + Math.floor(rnd() * (hi - lo + 1));
  let rows = 0;
  let scum = 0;
  let skipped = 0;
  let rooms = 0;
  let stints = 0;
  const started = Date.now();

  for (let room = 0; rows < TARGET_ROWS; room++) {
    rooms++;
    // Rooms are two simulated days apart, so even a room that runs all night
    // ends before the next one opens: a player's sessions never overlap.
    const openHour = pick(START_HOURS) + rnd();
    let now = new Date(2026, 0, 1 + 2 * room).getTime() + openHour * 60 * 60_000;
    const pace = 2.5 + rnd() * 4.5; // minutes per round in this room (2.5 … 7)
    const roomRounds = between(ROOM_ROUNDS);
    const left = new Set<SimPlayer>(); // who already left this room (no coming back tonight)

    const sitDown = (taken: Seat[]): Seat => {
      const free = population.filter((p) => !taken.some((s) => s.player === p));
      const fresh = free.filter((p) => !left.has(p));
      // (Only in a very long room could everyone have left once; then anyone free may return.)
      const p = pick(fresh.length ? fresh : free);
      stints++;
      return { player: p, sessionId: `R${String(room).padStart(4, "0")}-${p.id}`, roundsLeft: between(SEAT_ROUNDS) };
    };
    const seats: Seat[] = [];
    while (seats.length < TABLE) seats.push(sitDown(seats));

    let state = createGame(seats.map((s) => s.player.name), rnd, now);
    let round = 0; // round whose pending rows are open
    let pending: PendingRow[] = [];
    let captured = false; // hand strength taken at the start of PLAY
    let moves = 0;
    const missed = missTracker();
    const form = new Map<string, { skill: number; blunder: number }>();

    /** A new round begins: context and (injected) form per player, from their history so far. */
    const openRound = () => {
      round = state.round;
      captured = false;
      moves = 0;
      pending = seats.map((seat) => {
        const ctx = extractFeatures(seat.player.store.load(), now);
        form.set(seat.player.name, effectiveForm(seat.player, ctx));
        return { seat, start: now, ctx };
      });
    };
    openRound();

    for (let played = 0; played < roomRounds;) {
      if (!captured && state.phase === "PLAY") {
        // Exchange done (or none): this is the hand the player starts with.
        for (const row of pending) row.ctx.hand_strength = handStrength(state.hands[row.seat.player.name]);
        captured = true;
      }
      const id = actor(state);
      if (!id) break; // GAME_OVER: can't happen, nobody leaves mid-hand
      if (++moves > STUCK_AFTER_MOVES) {
        // Known game bug: when the last players hold only lone 2s nobody can
        // ever play (a 2 can't be played alone), so the hand never ends. Very
        // rare; drop the round's rows and re-deal a fresh game for the table.
        skipped++;
        state = createGame(seats.map((s) => s.player.name), rnd, now);
        openRound();
        continue;
      }
      const view = playerView(state, id, now);
      const f = form.get(id)!;
      const d = decide(view, f.skill, 0, missed(view), rnd, f.blunder);
      const ok = validateMove(state, id, d.move);
      if (!ok.ok) throw new Error(`bot made an illegal move: ${ok.error} ${JSON.stringify(d.move)}`);
      state = applyMove(state, id, d.move, now);
      if (state.round === round) continue;

      // Hand over: the new roles are this round's result.
      now += (pace + (rnd() - 0.5) * 2) * 60_000;
      for (const { seat, start, ctx } of pending) {
        const role: Role = state.roles![seat.player.name];
        const became = role === "scum" ? 1 : 0;
        const x = encode(ctx);
        lines.push([
          rows, seat.player.id, seat.player.profile, seat.sessionId, localStamp(start),
          ...FEATURE_NAMES.map((f) => (Number.isInteger(x[f]) ? x[f] : x[f].toFixed(5))),
          ctx.hour_of_day, 0, role, became,
        ].join(","));
        rows++;
        scum += became;
        // Only now, after the row is written, does the round enter the memory.
        const store = seat.player.store;
        store.save(appendRound(store.load(), { role, helpLevel: 0, hintsShown: 0, hintsFollowed: 0 }, now));
        seat.roundsLeft--;
      }
      played++;

      // Players whose session is over leave; newcomers take their seats. The
      // table then starts a fresh game (no exchange), like a real room would.
      let changed = false;
      for (let i = 0; i < seats.length; i++) {
        if (seats[i].roundsLeft > 0) continue;
        left.add(seats[i].player);
        seats[i] = sitDown(seats);
        changed = true;
      }
      if (changed) state = createGame(seats.map((s) => s.player.name), rnd, now);
      openRound();
    }
  }

  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, "rounds.csv");
  writeFileSync(file, lines.join("\n") + "\n");
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`${rows} rows (${rows / TABLE} hands, ${rooms} rooms, ${stints} player sessions, `
    + `${POPULATION} players) in ${secs}s`);
  console.log(`Scum share: ${(scum / rows).toFixed(3)} (expected 0.25 at a table of four)`);
  if (skipped) console.log(`Skipped ${skipped} stuck hand(s) (lone-2s bug)`);
  console.log(`Wrote ${file}`);
}

// ===========================================================================
// Learner run (default) and --weak: does the adaptive help work?
// ===========================================================================
//
// Four bots; one of them, the "learner", starts out weak and slowly gets
// better. When play starts in a round we predict its P(scum) from its own
// history and hand (features.ts + score.ts) and, when it gets a hint, it
// follows it with a probability that grows with the level. We then expect:
//   - lots of help early on (low win rate, often scum)
//   - the help fading out as the learner improves
//   - a better win rate than the same learner without any help

interface Row {
  round: number;
  skill: number;
  p: number; // predicted P(scum) for the round
  level: HelpLevel;
  role: string;
  won: boolean;
  rollingWinRate: number; // over the last 20 rounds
  hintsShown: number;
  hintsFollowed: number;
}

/**
 * Play until `rounds` hands are done and return one row per hand for the
 * learner. `withHelp = false` = the same learner without any help (level 0).
 * `skillAt(i)` is the learner's skill in hand i (default: the linear learning
 * curve; a constant for a player who never improves).
 */
function run(
  withHelp: boolean,
  seed: number,
  rounds = ROUNDS,
  skillAt = (r: number) => SKILL_START + (SKILL_END - SKILL_START) * (r / ROUNDS),
): Row[] {
  const rnd = seeded(seed);
  const store = new MemoryStore();
  const rows: Row[] = [];
  let now = new Date(2026, 9, 7, 14, 0).getTime();
  let state = createGame(PLAYERS, rnd, now);
  let round = state.round;
  const missed = missTracker();
  let shown = 0;
  let followed = 0;

  // The help level is fixed for a whole round, decided when play starts
  // (after the exchange): history before the round + the hand it starts with.
  let decision = { p: BASE_RATE, level: 0 as HelpLevel };
  let decided = false;

  let movesThisHand = 0;
  while (rows.length < rounds) {
    if (!decided && state.phase === "PLAY") {
      const help = computeHelp(extractFeatures(store.load(), now, state.hands[LEARNER]));
      decision = { p: help.p, level: withHelp ? help.level : 0 };
      decided = true;
    }
    const id = actor(state);
    if (!id) break; // GAME_OVER: can't happen without players leaving
    if (++movesThisHand > STUCK_AFTER_MOVES) {
      // Known game bug: when the last players hold only lone 2s nobody can
      // ever play (a 2 can't be played alone), so the hand never ends. Very
      // rare (~1 in 6000 hands); skip it with a fresh deal, not counted.
      state = createGame(PLAYERS, rnd, now);
      round = state.round;
      movesThisHand = 0;
      decided = false;
      shown = 0;
      followed = 0;
      continue;
    }

    const view = playerView(state, id, now);
    const isLearner = id === LEARNER;
    const d = decide(view, isLearner ? skillAt(rows.length) : BOT_SKILL,
      isLearner ? decision.level : 0, missed(view), rnd);
    if (isLearner && d.hinted) shown++;
    if (isLearner && d.followed) followed++;

    const ok = validateMove(state, id, d.move);
    if (!ok.ok) throw new Error(`bot made an illegal move: ${ok.error} ${JSON.stringify(d.move)}`);
    state = applyMove(state, id, d.move, now);

    if (state.round !== round) {
      // A hand just ended: log it into the learner's context memory.
      round = state.round;
      movesThisHand = 0;
      const role = state.roles![LEARNER];
      const records: RoundRecord[] = appendRound(store.load(), {
        role, helpLevel: decision.level, hintsShown: shown, hintsFollowed: followed,
      }, now);
      store.save(records);
      const last = records[records.length - 1];
      const window = records.slice(-20);
      rows.push({
        round: rows.length + 1,
        skill: skillAt(rows.length),
        p: decision.p,
        level: decision.level,
        role,
        won: last.won,
        rollingWinRate: window.filter((r) => r.won).length / window.length,
        hintsShown: shown,
        hintsFollowed: followed,
      });
      shown = 0;
      followed = 0;
      decided = false;
      now += rows.length % ROUNDS_PER_SESSION === 0 ? 3 * 60 * 60_000 : ROUND_MINUTES * 60_000;
    }
  }
  return rows;
}

function toCsv(rows: Row[]): string {
  const head = "round,skill,p_scum,help_level,role,won,rolling_win_rate,hints_shown,hints_followed";
  const lines = rows.map((r) => [
    r.round, r.skill.toFixed(3), r.p.toFixed(3), r.level, r.role, r.won ? 1 : 0,
    r.rollingWinRate.toFixed(3), r.hintsShown, r.hintsFollowed,
  ].join(","));
  return [head, ...lines].join("\n") + "\n";
}

/** A self-contained SVG line chart: P(scum), win rate and skill per round. */
function toSvg(rows: Row[], baseline: Row[]): string {
  const W = 960, H = 420, L = 56, R = 20, T = 40, B = 50;
  const x = (i: number) => L + (i / (rows.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v) * (H - T - B);
  const path = (vals: number[]) =>
    vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const levelFill = ["transparent", "#bae6fd", "#7dd3fc"];
  const bands = rows.map((r, i) => {
    const w = (W - L - R) / rows.length;
    return `<rect x="${(x(i) - w / 2).toFixed(1)}" y="${T}" width="${(w + 0.5).toFixed(1)}" height="${H - T - B}" fill="${levelFill[r.level]}" opacity="0.55"/>`;
  }).join("");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) =>
    `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#ddd"/>`
    + `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="12">${v}</text>`).join("");
  // The two thresholds the P(scum) line has to cross for level 1 and 2.
  const thresholds = THRESHOLDS.map((t, i) =>
    `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#2563eb" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"/>`
    + `<text x="${W - R - 4}" y="${y(t) - 4}" text-anchor="end" font-size="11" fill="#2563eb">T${i + 1} = ${t.toFixed(2)}</text>`).join("");
  const xTicks = rows.filter((_, i) => i % 50 === 0 || i === rows.length - 1).map((r) =>
    `<text x="${x(r.round - 1)}" y="${H - B + 18}" text-anchor="middle" font-size="12">${r.round}</text>`).join("");
  const legend = [
    ["#2563eb", "P(scum)", ""], ["#16a34a", "win rate (last 20), with help", ""],
    ["#16a34a", "win rate, no help", "5 4"], ["#6b7280", "learner skill", "2 3"],
  ].map(([color, label, dash], i) =>
    `<g transform="translate(${L + i * 215},${T - 18})"><line x1="0" x2="24" y1="0" y2="0" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash}"/>`
    + `<text x="30" y="4" font-size="12">${label}</text></g>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">
<rect width="${W}" height="${H}" fill="white"/>
${bands}${grid}${thresholds}${xTicks}
<path d="${path(baseline.map((r) => r.rollingWinRate))}" fill="none" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="5 4"/>
<path d="${path(rows.map((r) => r.skill))}" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="2 3"/>
<path d="${path(rows.map((r) => r.rollingWinRate))}" fill="none" stroke="#16a34a" stroke-width="2.5"/>
<path d="${path(rows.map((r) => r.p))}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
${legend}
<text x="${(L + W - R) / 2}" y="${H - 12}" text-anchor="middle" font-size="13">round (background: help level 0 · 1 · 2)</text>
</svg>
`;
}

function learner(): void {
  const SEED = 42;
  const withHelp = run(true, SEED);
  const without = run(false, SEED);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "learner.csv"), toCsv(withHelp));
  writeFileSync(join(OUT, "help.svg"), toSvg(withHelp, without));

  const winRate = (rows: Row[]) => rows.filter((r) => r.won).length / rows.length;
  const thirds = (rows: Row[]) => [0, 1, 2].map((k) => rows.slice((k * ROUNDS) / 3, ((k + 1) * ROUNDS) / 3));
  const avg = (rows: Row[], f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const shown = withHelp.reduce((s, r) => s + r.hintsShown, 0);
  const followed = withHelp.reduce((s, r) => s + r.hintsFollowed, 0);

  console.log(`${ROUNDS} rounds, learner skill ${SKILL_START} → ${SKILL_END}`
    + ` · thresholds T1 ${THRESHOLDS[0].toFixed(2)}, T2 ${THRESHOLDS[1].toFixed(2)}\n`);
  const withoutThirds = thirds(without);
  console.log("             avg P(scum)   avg help level   rounds helped   win rate   win rate without help");
  thirds(withHelp).forEach((rows, k) => console.log(
    `  part ${k + 1}/3      ${avg(rows, (r) => r.p).toFixed(2)}          ${avg(rows, (r) => r.level).toFixed(2)}`
    + `             ${pct(avg(rows, (r) => (r.level > 0 ? 1 : 0))).padStart(4)}          `
    + `${pct(winRate(rows)).padStart(4)}       ${pct(winRate(withoutThirds[k])).padStart(4)}`));
  console.log(`\nWin rate with help:    ${pct(winRate(withHelp))}`);
  console.log(`Win rate without help: ${pct(winRate(without))}`);
  console.log(`Hints followed:        ${followed}/${shown} (${shown ? pct(followed / shown) : "-"})`);
  console.log(`\nWrote ${join(OUT, "learner.csv")} and ${join(OUT, "help.svg")}`);
}

// --weak: unlike the learner, these players never improve: each plays
// WEAK_ROUNDS hands at a fixed skill, once without help and once with the
// adaptive help. Result: assist/out/weak-players.svg, a grouped bar chart.

const WEAK_ROUNDS = 3000;
const WEAK_PLAYERS = [
  { label: "Very weak", note: "random moves", skill: 0 },
  { label: "Weak", note: "20% best moves", skill: 0.2 },
  { label: "Average", note: "40% best moves", skill: 0.4 },
];

interface WeakResult {
  label: string;
  note: string;
  off: { win: number; scum: number };
  on: { win: number; scum: number; helped: number };
}

function weakExperiment(): WeakResult[] {
  const share = (rows: Row[], f: (r: Row) => boolean) => rows.filter(f).length / rows.length;
  return WEAK_PLAYERS.map(({ label, note, skill }) => {
    const off = run(false, 11, WEAK_ROUNDS, () => skill);
    const on = run(true, 11, WEAK_ROUNDS, () => skill);
    const isScum = (r: Row) => r.role === "scum";
    console.log(`${label.padEnd(10)} win ${pct(share(off, (r) => r.won))} → ${pct(share(on, (r) => r.won))}`
      + `   scum ${pct(share(off, isScum))} → ${pct(share(on, isScum))}`
      + `   help in ${pct(share(on, (r) => r.level > 0))} of rounds`);
    return {
      label,
      note,
      off: { win: share(off, (r) => r.won), scum: share(off, isScum) },
      on: { win: share(on, (r) => r.won), scum: share(on, isScum), helped: share(on, (r) => r.level > 0) },
    };
  });
}

/** Two panels (win rate, scum rate), each with a without/with-help bar pair per player. */
function weakSvg(results: WeakResult[]): string {
  // Colours from the dataviz reference palette: neutral grey for the baseline,
  // blue for "with help" (CVD ΔE 19 apart); every bar is also labelled.
  const C = {
    surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781",
    grid: "#e1e0d9", axis: "#c3c2b7", off: "#a3a29b", on: "#2a78d6",
  };
  const W = 1000, H = 560;
  const top = 150, bottom = 455; // plot area (y)
  const max = 0.6;
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const panels = [
    { title: "How often do they win?", sub: "finished as President", key: "win" as const, x0: 70, ref: 0.25 },
    { title: "How often are they Scum?", sub: "finished as Scum (last)", key: "scum" as const, x0: 540, ref: 0.25 },
  ];
  const panelW = 380, barW = 46, gap = 2;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  /** A bar with a 4px rounded top, anchored square on the baseline. */
  const bar = (x: number, v: number, fill: string, tip: string) => {
    const h = bottom - y(v), r = Math.min(4, h);
    return `<path d="M${x},${bottom}V${y(v) + r}q0,-${r} ${r},-${r}h${barW - 2 * r}q${r},0 ${r},${r}V${bottom}Z" fill="${fill}"><title>${esc(tip)}</title></path>`;
  };

  // A surface-coloured outline keeps value labels readable where they cross a line.
  const halo = `stroke="${C.surface}" stroke-width="4" paint-order="stroke"`;
  const parts: string[] = [];
  for (const p of panels) {
    parts.push(`<text x="${p.x0}" y="${top - 42}" font-size="17" font-weight="700" fill="${C.ink}">${p.title}</text>`);
    parts.push(`<text x="${p.x0}" y="${top - 22}" font-size="13" fill="${C.ink2}">share of rounds ${p.sub}</text>`);
    for (const t of [0, 0.2, 0.4, 0.6]) {
      parts.push(`<line x1="${p.x0}" x2="${p.x0 + panelW}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? C.axis : C.grid}" stroke-width="1"/>`);
      parts.push(`<text x="${p.x0 - 8}" y="${y(t) + 4}" font-size="12" text-anchor="end" fill="${C.muted}">${pct(t)}</text>`);
    }
    // Reference: at a table of four, an average player wins (and loses) 1 in 4.
    parts.push(`<line x1="${p.x0}" x2="${p.x0 + panelW}" y1="${y(p.ref)}" y2="${y(p.ref)}" stroke="${C.ink2}" stroke-width="1.5"/>`);
    parts.push(`<text x="${p.x0 + panelW + 8}" y="${y(p.ref) + 4}" font-size="12" fill="${C.ink2}">1 in 4</text>`);

    results.forEach((r, i) => {
      const groupW = panelW / results.length;
      const cx = p.x0 + groupW * (i + 0.5);
      const xOff = cx - barW - gap / 2, xOn = cx + gap / 2;
      const vOff = r.off[p.key], vOn = r.on[p.key];
      parts.push(bar(xOff, vOff, C.off, `${r.label}, without help: ${pct(vOff)}`));
      parts.push(bar(xOn, vOn, C.on, `${r.label}, with help: ${pct(vOn)}`));
      parts.push(`<text x="${xOff + barW / 2}" y="${y(vOff) - 7}" font-size="13" text-anchor="middle" fill="${C.ink2}" ${halo}>${pct(vOff)}</text>`);
      parts.push(`<text x="${xOn + barW / 2}" y="${y(vOn) - 7}" font-size="14" font-weight="700" text-anchor="middle" fill="${C.ink}" ${halo}>${pct(vOn)}</text>`);
      parts.push(`<text x="${cx}" y="${bottom + 22}" font-size="14" font-weight="600" text-anchor="middle" fill="${C.ink}">${r.label}</text>`);
      parts.push(`<text x="${cx}" y="${bottom + 39}" font-size="11.5" text-anchor="middle" fill="${C.muted}">${esc(r.note)}</text>`);
      parts.push(`<text x="${cx}" y="${bottom + 55}" font-size="11.5" text-anchor="middle" fill="${C.muted}">help: ${pct(r.on.helped)} of rounds</text>`);
    });
  }

  const weakest = results[0];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">
<rect width="${W}" height="${H}" fill="${C.surface}"/>
<text x="40" y="44" font-size="24" font-weight="800" fill="${C.ink}">A very weak player wins ${pct(weakest.on.win)} instead of ${pct(weakest.off.win)} with help</text>
<text x="40" y="70" font-size="14" fill="${C.ink2}">Help goes to the rounds where the model predicts a high P(scum).</text>
<g transform="translate(${W - 300},58)">
  <rect width="14" height="14" rx="3" fill="${C.off}"/><text x="20" y="12" font-size="13" fill="${C.ink}">Without help</text>
  <rect x="130" width="14" height="14" rx="3" fill="${C.on}"/><text x="150" y="12" font-size="13" fill="${C.ink}">With adaptive help</text>
</g>
${parts.join("\n")}
<text x="40" y="${H - 14}" font-size="11.5" fill="${C.muted}">Simulation with the real game rules: ${WEAK_ROUNDS} rounds per bar, 4 players; the player follows a hint in 75–90% of turns. Line: fair share at a table of four.</text>
</svg>
`;
}

// ===========================================================================
// --ab: identical hand and table, different context
// ===========================================================================

const card = (rank: Rank, suit: Card["suit"]): Card => ({ rank, suit, deck: 0, id: `${suit}-${rank}#0` });

function printDecision(name: string, help: ReturnType<typeof computeHelp>, top = 3): void {
  console.log(`${name}: P(scum) ${help.p.toFixed(2)} → level ${help.level}`
    + (help.usedContext ? "" : "  (context OFF: base rate for everyone)"));
  for (const f of help.factors.slice(0, top)) {
    const sign = f.contribution >= 0 ? "+" : "−";
    console.log(`    ${f.label.padEnd(32)} ${f.value.padStart(7)}  ${sign}${Math.abs(f.contribution).toFixed(2)} log-odds`);
  }
}

function ab(): void {
  // The hand the player holds when play starts (after the exchange) …
  const hand = [card("3", "hearts"), card("4", "spades"), card("5", "hearts"), card("6", "clubs"),
    card("7", "clubs"), card("7", "diamonds"), card("8", "spades"), card("9", "hearts"),
    card("10", "clubs"), card("J", "diamonds"), card("Q", "spades"), card("K", "hearts"), card("A", "clubs")];
  // … and the table they face: someone led a single 6.
  const table = { currentCount: 1, currentRankValue: RANK_VALUES["6"] };
  const now = new Date(2026, 9, 7, 15, 0).getTime();
  const options = advise({ hand, ...table });
  const label = (o: (typeof options)[number]) =>
    o.kind === "pass" ? "pass" : o.cardIds.map((id) => id.replace(/#0$/, "")).join(" + ");

  console.log(`Model: ${TRAINED_ON.source} data, n = ${TRAINED_ON.n}, AUC ${METRICS.auc.toFixed(3)}`
    + ` · thresholds T1 ${THRESHOLDS[0].toFixed(2)}, T2 ${THRESHOLDS[1].toFixed(2)} · training base rate ${BASE_RATE.toFixed(3)}`);
  console.log(`Hand: 3♥ 4♠ 5♥ 6♣ 7♣ 7♦ 8♠ 9♥ 10♣ J♦ Q♠ K♥ A♣ (strength ${handStrength(hand)}) — table: a single 6\n`);
  const cases: [string, RoundRecord[], boolean][] = [
    ["Player A (weak history)", demoHistory("weak", now), true],
    ["Player B (strong history)", demoHistory("strong", now), true],
    ["Player A, context OFF", demoHistory("weak", now), false],
    ["New player (no history)", [], true],
  ];
  for (const [name, history, useContext] of cases) {
    const help = computeHelp(extractFeatures(history, now, hand), { useContext });
    printDecision(name, help);
    const hint = hintFor(help.level, options);
    console.log(hint
      ? `  → highlight ${label(hint.best)}` + (hint.reason ? `\n  → "${hint.reason}"` : "")
      : "  → no hint");
    console.log();
  }
}

// ===========================================================================
// --sensitivity: change one context variable, keep everything else fixed
// ===========================================================================

function sensitivity(): void {
  const bases: [string, RawContext][] = [
    ["average player", makeContext()],
    ["weaker player (win rate 10%, 8× scum in 20)", makeContext({ winrate_20: 0.1, scum_count_20: 8 })],
  ];
  const sweeps: [string, (v: number) => Partial<RawContext>, number[], (v: number) => string][] = [
    ["loss_streak", (v) => ({ loss_streak: v }), [0, 1, 2, 3, 4, 6, 8], String],
    // Fatigue on its own (same number of rounds, longer time) …
    ["session_minutes", (v) => ({ session_minutes: v }), [0, 30, 60, 90, 120, 180], (v) => `${v} min`],
    // … and a real session, where rounds and minutes grow together (≈ 4.5 min per round).
    ["session (both)", (v) => ({ session_minutes: v, rounds_in_session: Math.round(v / 4.5) }),
      [0, 30, 60, 90, 120, 180], (v) => `${v} min`],
    ["hour_of_day", (v) => ({ hour_of_day: v }), [15, 18, 21, 23, 0, 2, 4, 8, 12], (v) => `${String(v).padStart(2, "0")}:00`],
    ["hand_strength", (v) => ({ hand_strength: v }), [0, 3, 6, 9, 12], String],
    ["winrate_20", (v) => ({ winrate_20: v }), [0, 0.1, 0.25, 0.4, 0.6], pct],
    // Table size: the shown P moves to the table's base rate 1/n, the level
    // (decided on the four-player scale) stays the same.
    ["table_size", (v) => ({ table_size: v }), [3, 4, 5, 6], (v) => `${v} players`],
  ];
  console.log(`Thresholds: level 1 from P ≥ ${THRESHOLDS[0].toFixed(2)}, level 2 from P ≥ ${THRESHOLDS[1].toFixed(2)}\n`);
  for (const [baseName, base] of bases) {
    const p0 = computeHelp(base);
    console.log(`=== ${baseName}: P(scum) ${p0.p.toFixed(2)} → level ${p0.level}`);
    for (const [name, change, values, fmt] of sweeps) {
      const cells = values.map((v) => {
        const h = computeHelp({ ...base, ...change(v) });
        return `${fmt(v)}: ${h.p.toFixed(2)} L${h.level}`;
      });
      console.log(`  ${name.padEnd(16)} ${cells.join("  ·  ")}`);
    }
    console.log();
  }
  console.log(`(L = help level; context off → everyone the table's base rate, at four players`
    + ` P ${computeHelp(makeContext(), { useContext: false }).p.toFixed(2)} L${levelFor(BASE_RATE)} = no help)`);
}

// ---------------------------------------------------------------------------

if (process.argv.includes("--dataset")) {
  dataset();
} else if (process.argv.includes("--ab")) {
  ab();
} else if (process.argv.includes("--sensitivity")) {
  sensitivity();
} else if (process.argv.includes("--weak")) {
  const results = weakExperiment();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "weak-players.svg"), weakSvg(results));
  console.log(`\nWrote ${join(OUT, "weak-players.svg")}`);
} else {
  learner();
}
