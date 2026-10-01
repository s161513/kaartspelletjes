import { createDeck, shuffle, RANK_VALUES, type Game } from "@app/shared";
import type { TemplateState, TemplateMove } from "./types.js";

// Game rules, run on the server. The server calls these in this order:
//   init()          once, when the host starts the game
//   validateMove()  for every move a client sends (reject bad/out-of-turn moves)
//   applyMove()     only for moves that passed validation
//   result()        after each move, to see whether the game is over

function highest(state: TemplateState): string | "draw" {
  const entries = Object.entries(state.drawn);
  const best = Math.max(...entries.map(([, c]) => RANK_VALUES[c.rank]));
  const winners = entries.filter(([, c]) => RANK_VALUES[c.rank] === best);
  return winners.length === 1 ? winners[0][0] : "draw";
}

const template: Game<TemplateState, TemplateMove> = {
  init(playerIds) {
    return {
      pile: shuffle(createDeck()),
      drawn: {},
      players: playerIds,
      turn: playerIds[0],
    };
  },

  validateMove(state, playerId, move) {
    if (state.turn === null) return { ok: false, error: "Game is over" };
    if (state.turn !== playerId) return { ok: false, error: "Not your turn" };
    if ((move as TemplateMove | null)?.action !== "draw") {
      return { ok: false, error: "Malformed move" };
    }
    return { ok: true, move: { action: "draw" } };
  },

  applyMove(state, playerId) {
    // Return a new state instead of mutating the old one.
    const pile = state.pile.slice();
    const card = pile.pop()!;
    const drawn = { ...state.drawn, [playerId]: card };

    const next = state.players.find((id) => !(id in drawn)) ?? null;
    return { ...state, pile, drawn, turn: next };
  },

  result(state) {
    if (state.turn !== null) return { over: false };
    return { over: true, winner: highest(state) };
  },
};

export default template;
