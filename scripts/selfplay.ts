// Self-play: let bots play a game against each other, using the real game
// logic and each game's botMove at a chosen difficulty.
//
//   npx tsx scripts/selfplay.ts <gameId> [players] [games] [difficulty]
//
//   npx tsx scripts/selfplay.ts presidenten 5 20 hard
//   npx tsx scripts/selfplay.ts reversi 2 50 normal
//
// Prints a win table per seat. Round-based games (connect4, reversi, …) are
// scored per round ("intermission"); the others per full game.

import { loadGames, games } from "../server/src/games/loader.ts";
import type { BotDifficulty } from "@app/shared";

const gameId = process.argv[2] ?? "presidenten";
const nPlayers = Math.max(2, Number(process.argv[3] ?? 4) || 4);
const nGames = Math.max(1, Number(process.argv[4] ?? 20) || 20);
const difficulty = (process.argv[5] ?? "hard") as BotDifficulty;
if (!["easy", "normal", "hard"].includes(difficulty)) {
  console.error(`difficulty must be easy|normal|hard, got "${difficulty}"`);
  process.exit(1);
}

async function main() {
await loadGames();
const entry = games.get(gameId);
if (!entry) {
  console.error(`unknown game "${gameId}". Available: ${[...games.keys()].join(", ")}`);
  process.exit(1);
}
const game = entry.logic;
if (!game.botMove) {
  console.error(`${gameId} has no botMove — no bot support for this game`);
  process.exit(1);
}
if (nPlayers < entry.meta.minPlayers || nPlayers > entry.meta.maxPlayers) {
  console.error(`${gameId} needs ${entry.meta.minPlayers}–${entry.meta.maxPlayers} players, got ${nPlayers}`);
  process.exit(1);
}

const ids = Array.from({ length: nPlayers }, (_, i) => `p${i + 1}`);
const wins = new Map<string, number>(ids.map((id) => [id, 0]));
let draws = 0;
let unfinished = 0;

for (let g = 0; g < nGames; g++) {
  let state = game.init([...ids]);
  let winner: string | "draw" | undefined;
  for (let guard = 0; guard < 5000; guard++) {
    const r = game.result(state);
    if (r.over) { winner = r.winner ?? "draw"; break; }
    // Session/round games never report over on their own: score the round.
    // connect4/reversi/gomoku/dots/battleship pause in "intermission";
    // presidenten moves to "EXCHANGE" (finished[0] was the hand's President).
    const st = state as { phase?: string; result?: string | "draw"; roles?: Record<string, string> };
    if (st.phase === "intermission") { winner = st.result ?? "draw"; break; }
    // presidenten: a hand ended (roles assigned); the President of that hand wins it.
    if (st.phase === "EXCHANGE" && st.roles) {
      winner = Object.entries(st.roles).find(([, r]) => r === "president")?.[0] ?? "draw";
      break;
    }
    let acted = false;
    for (const seat of ids) {
      const mv = game.botMove!(state, seat, difficulty);
      if (mv === null || mv === undefined) continue;
      const checked = game.validateMove(state, seat, mv);
      if (!checked.ok) continue;
      if (process.env.SELFPLAY_DEBUG === "2" && g === 0 && guard % 50 === 0) {
        console.log(`  move ${guard}: ${seat} ${JSON.stringify(mv)} phase=${(state as { phase?: string }).phase} count=${(state as { currentCount?: number }).currentCount}`);
      }
      state = game.applyMove(state, seat, checked.move);
      acted = true;
      break;
    }
    if (game.result(state).over) continue;
    if (!acted) {
      // Timer-driven games (dobble, bullshit, presidenten) advance on their own.
      if (game.advance && game.nextUpdateIn && game.nextUpdateIn(state) !== null) {
        state = game.advance(state);
      } else break;
    }
  }
  if (winner === undefined) {
    unfinished++;
    if (process.env.SELFPLAY_DEBUG) {
      const st = state as { phase?: string; turnIndex?: number; players?: string[]; hands?: Record<string, unknown[]>; exchange?: unknown };
      console.log(`  unfinished: phase=${st.phase} turn=${st.players?.[st.turnIndex ?? 0]} hands=${JSON.stringify(Object.fromEntries(Object.entries(st.hands ?? {}).map(([k, v]) => [k, v.length])))} exchange=${JSON.stringify(st.exchange)}`);
    }
  }
  else if (winner === "draw") draws++;
  else wins.set(winner, (wins.get(winner) ?? 0) + 1);
}

console.log(`self-play: ${gameId} · ${nPlayers} players · ${nGames} games · difficulty=${difficulty}`);
for (const id of ids) {
  const w = wins.get(id) ?? 0;
  console.log(`  ${id}: ${w} wins (${Math.round((w / nGames) * 100)}%)`);
}
console.log(`  draws: ${draws}${unfinished ? ` · unfinished: ${unfinished}` : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
