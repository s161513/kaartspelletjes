// Simulation for the Lab 8 report: shows that the context changes behaviour.
//
//   npx tsx games/presidenten/assist/simulate.ts          # learner run + chart
//   npx tsx games/presidenten/assist/simulate.ts --ab     # A/B: same hand, two histories
//   npx tsx games/presidenten/assist/simulate.ts --weak   # do weak players gain? (bar chart)
//
// Four bots play Presidenten with the *real* game logic (logic.ts). One of
// them, the "learner", starts out weak and slowly gets better. Before every
// round we compute its help level from its own history (context.ts + score.ts)
// and, when it gets a hint, it follows it with a probability that grows with
// the level. We then expect:
//   - lots of help early on (low win rate, often scum)
//   - the help fading out as the learner improves
//   - a better win rate than the same learner without any help
//
// Note: the game deals every new hand with a secure RNG (logic.ts), so only the
// first deal and the bots' choices are seeded — numbers vary a little per run.
//
// Output: assist/out/rounds.csv and assist/out/help.svg (open in a browser).
// Node-only (fs); never imported by the browser.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Card, Rank } from "@app/shared";
import { RANK_VALUES } from "@app/shared";
import { applyMove, createGame, playerView, validateMove } from "../logic.js";
import { REQUEST_RANKS } from "../rules.js";
import type { PresidentenMove, PresidentenState, PresidentenView } from "../types.js";
import { advise, adviseGiveBack, adviseRequest, followsAdvice, hintFor } from "./advisor.js";
import {
  appendRound, demoHistory, MemoryStore, summarize, type HelpLevel, type RoundRecord,
} from "./context.js";
import { computeHelp } from "./score.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");

// ---------------------------------------------------------------------------
// Set-up
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
 * to follow the hint.
 */
function decide(
  view: PresidentenView,
  skill: number,
  level: HelpLevel,
  missed: Rank[],
  rnd: () => number,
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
  const move = toMove(rnd() < skill ? options[0] : pick(options));
  return { move, hinted: hint !== null, followed: hint !== null && followsAdvice(options[0], move) };
}

/** Who has to act right now? */
function actor(s: PresidentenState): string | null {
  if (s.phase === "PLAY") return s.players[s.turnIndex];
  if (s.phase === "EXCHANGE") return s.exchange?.pairs[0]?.winner ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------

interface Row {
  round: number;
  skill: number;
  score: number;
  level: HelpLevel;
  role: string;
  won: boolean;
  rollingWinRate: number; // over the last 20 rounds
  hintsShown: number;
  hintsFollowed: number;
}

/**
 * Play until `rounds` hands are done and return one row per hand for the
 * learner. `skillAt(i)` is the learner's skill in hand i (default: the linear
 * learning curve; a constant for a player who never improves).
 */
function run(
  useContext: boolean,
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
  let missed: Rank[] = [];
  let missedFor = "";
  let shown = 0;
  let followed = 0;

  // The help level is fixed for a whole round, from the history *before* it.
  let decision = computeHelp(summarize(store.load(), now), { useContext });

  let movesThisHand = 0;
  while (rows.length < rounds) {
    const id = actor(state);
    if (!id) break; // GAME_OVER: can't happen without players leaving
    if (++movesThisHand > STUCK_AFTER_MOVES) {
      // Known game bug: when the last players hold only lone 2s nobody can
      // ever play (a 2 can't be played alone), so the hand never ends. Very
      // rare (~1 in 6000 hands); skip it with a fresh deal, not counted.
      state = createGame(PLAYERS, rnd, now);
      round = state.round;
      movesThisHand = 0;
      continue;
    }

    const view = playerView(state, id, now);
    // Ranks the current loser turned out not to have (reset for every new pair).
    const pairKey = view.exchange ? `${view.round}:${view.exchange.done}` : "";
    if (pairKey !== missedFor) {
      missed = [];
      missedFor = pairKey;
    }
    if (view.exchange?.lastMiss && !missed.includes(view.exchange.lastMiss as Rank)) {
      missed.push(view.exchange.lastMiss as Rank);
    }
    const isLearner = id === LEARNER;
    const d = decide(view, isLearner ? skillAt(rows.length) : BOT_SKILL,
      isLearner ? decision.level : 0, missed, rnd);
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
        score: decision.score,
        level: decision.level,
        role,
        won: last.won,
        rollingWinRate: window.filter((r) => r.won).length / window.length,
        hintsShown: shown,
        hintsFollowed: followed,
      });
      shown = 0;
      followed = 0;
      now += rows.length % ROUNDS_PER_SESSION === 0 ? 3 * 60 * 60_000 : ROUND_MINUTES * 60_000;
      decision = computeHelp(summarize(store.load(), now), { useContext });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function toCsv(rows: Row[]): string {
  const head = "round,skill,help_score,help_level,role,won,rolling_win_rate,hints_shown,hints_followed";
  const lines = rows.map((r) => [
    r.round, r.skill.toFixed(3), r.score.toFixed(3), r.level, r.role, r.won ? 1 : 0,
    r.rollingWinRate.toFixed(3), r.hintsShown, r.hintsFollowed,
  ].join(","));
  return [head, ...lines].join("\n") + "\n";
}

/** A self-contained SVG line chart: help score, win rate and skill per round. */
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
  const xTicks = rows.filter((_, i) => i % 50 === 0 || i === rows.length - 1).map((r) =>
    `<text x="${x(r.round - 1)}" y="${H - B + 18}" text-anchor="middle" font-size="12">${r.round}</text>`).join("");
  const legend = [
    ["#2563eb", "help score", ""], ["#16a34a", "win rate (last 20), with help", ""],
    ["#16a34a", "win rate, no help", "5 4"], ["#6b7280", "learner skill", "2 3"],
  ].map(([color, label, dash], i) =>
    `<g transform="translate(${L + i * 215},${T - 18})"><line x1="0" x2="24" y1="0" y2="0" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash}"/>`
    + `<text x="30" y="4" font-size="12">${label}</text></g>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">
<rect width="${W}" height="${H}" fill="white"/>
${bands}${grid}${xTicks}
<path d="${path(baseline.map((r) => r.rollingWinRate))}" fill="none" stroke="#16a34a" stroke-width="1.5" stroke-dasharray="5 4"/>
<path d="${path(rows.map((r) => r.skill))}" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-dasharray="2 3"/>
<path d="${path(rows.map((r) => r.rollingWinRate))}" fill="none" stroke="#16a34a" stroke-width="2.5"/>
<path d="${path(rows.map((r) => r.score))}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
${legend}
<text x="${(L + W - R) / 2}" y="${H - 12}" text-anchor="middle" font-size="13">round (background: help level 0 · 1 · 2)</text>
</svg>
`;
}

// ---------------------------------------------------------------------------
// A/B demo: identical hand and table, different context
// ---------------------------------------------------------------------------

function ab(): void {
  const card = (rank: Rank, suit: Card["suit"]): Card => ({ rank, suit, deck: 0, id: `${suit}-${rank}#0` });
  const hand = [card("5", "hearts"), card("7", "clubs"), card("7", "diamonds"),
    card("8", "spades"), card("J", "diamonds"), card("A", "clubs")];
  const table = { currentCount: 1, currentRankValue: RANK_VALUES["6"] };
  const now = new Date(2026, 9, 7, 15, 0).getTime();
  const options = advise({ hand, ...table });
  const label = (o: (typeof options)[number]) =>
    o.kind === "pass" ? "pass" : o.cardIds.map((id) => id.replace(/#0$/, "")).join(" + ");

  console.log("Hand: 5♥ 7♣ 7♦ 8♠ J♦ A♣ — table: a single 6\n");
  const cases: [string, RoundRecord[], boolean][] = [
    ["Player A (weak history)", demoHistory("weak", now), true],
    ["Player B (strong history)", demoHistory("strong", now), true],
    ["Player A, context OFF", demoHistory("weak", now), false],
    ["New player (no history)", [], true],
  ];
  for (const [name, history, useContext] of cases) {
    const help = computeHelp(summarize(history, now), { useContext });
    const hint = hintFor(help.level, options);
    console.log(`${name}: score ${help.score.toFixed(2)} → level ${help.level}`);
    for (const f of help.factors) {
      console.log(`    ${f.label.padEnd(32)} ${f.value.padStart(5)}  +${f.contribution.toFixed(2)}`);
    }
    console.log(hint
      ? `  → highlight ${label(hint.best)}`
        + (hint.reason ? `\n  → "${hint.reason}"` : "")
      : "  → no hint");
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Does help actually help a weak player? (--weak)
// ---------------------------------------------------------------------------
//
// Unlike the main run, these players never improve: each plays WEAK_ROUNDS
// hands at a fixed skill, once without help and once with the adaptive help.
// Result: assist/out/weak-players.svg, a grouped bar chart for the report.

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

const pct = (v: number) => `${Math.round(v * 100)}%`;

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
<text x="40" y="70" font-size="14" fill="${C.ink2}">The help lifts weak players to about the table average, then switches itself off.</text>
<g transform="translate(${W - 300},58)">
  <rect width="14" height="14" rx="3" fill="${C.off}"/><text x="20" y="12" font-size="13" fill="${C.ink}">Without help</text>
  <rect x="130" width="14" height="14" rx="3" fill="${C.on}"/><text x="150" y="12" font-size="13" fill="${C.ink}">With adaptive help</text>
</g>
${parts.join("\n")}
<text x="40" y="${H - 14}" font-size="11.5" fill="${C.muted}">Simulation with the real game rules: ${WEAK_ROUNDS} rounds per bar, 4 players; the player follows a hint in 75–90% of turns. Line: fair share at a table of four.</text>
</svg>
`;
}

// ---------------------------------------------------------------------------

if (process.argv.includes("--ab")) {
  ab();
} else if (process.argv.includes("--weak")) {
  const results = weakExperiment();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "weak-players.svg"), weakSvg(results));
  console.log(`\nWrote ${join(OUT, "weak-players.svg")}`);
} else {
  const SEED = 42;
  const withHelp = run(true, SEED);
  const without = run(false, SEED);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "rounds.csv"), toCsv(withHelp));
  writeFileSync(join(OUT, "help.svg"), toSvg(withHelp, without));

  const winRate = (rows: Row[]) => rows.filter((r) => r.won).length / rows.length;
  const thirds = [0, 1, 2].map((k) => withHelp.slice((k * ROUNDS) / 3, ((k + 1) * ROUNDS) / 3));
  const avg = (rows: Row[], f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const shown = withHelp.reduce((s, r) => s + r.hintsShown, 0);
  const followed = withHelp.reduce((s, r) => s + r.hintsFollowed, 0);

  console.log(`${ROUNDS} rounds, learner skill ${SKILL_START} → ${SKILL_END}\n`);
  const thirdsWithout = [0, 1, 2].map((k) => without.slice((k * ROUNDS) / 3, ((k + 1) * ROUNDS) / 3));
  console.log("             avg help level   avg score   win rate   win rate without help");
  thirds.forEach((rows, k) => console.log(
    `  part ${k + 1}/3        ${avg(rows, (r) => r.level).toFixed(2)}          `
    + `${avg(rows, (r) => r.score).toFixed(2)}       ${pct(winRate(rows)).padStart(4)}       `
    + `${pct(winRate(thirdsWithout[k])).padStart(4)}`));
  console.log(`\nWin rate with help:    ${pct(winRate(withHelp))}`);
  console.log(`Win rate without help: ${pct(winRate(without))}`);
  console.log(`Hints followed:        ${followed}/${shown} (${shown ? pct(followed / shown) : "-"})`);
  console.log(`\nWrote ${join(OUT, "rounds.csv")} and ${join(OUT, "help.svg")}`);
}
