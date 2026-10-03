import { sortHand, type Card, type Game } from "@app/shared";
import {
  GAME_END_SCORE,
  PASS_COUNT,
  TWO_OF_CLUBS,
  dealHands,
  isHeart,
  legalPlays,
  passDirection,
  passTarget,
  points,
  scoreRound,
  trickWinner,
} from "./rules.js";
import type { HeartsMove, HeartsState } from "./types.js";

// Hartenjagen: avoid hearts (1 point each) and ♠Q (13). Rounds continue until
// someone reaches 100 points; the lowest score wins.

const hand = (state: HeartsState, id: string) => state.hands[id] as Card[];
const nextPlayer = (state: HeartsState, id: string) =>
  state.players[(state.players.indexOf(id) + 1) % state.players.length];

function startRound(state: HeartsState): void {
  // Seat anyone who joined mid-game; they get a fresh hand and a 0 score.
  if (state.pending.length) {
    const incoming = state.pending.filter((id) => !state.players.includes(id) && !state.left.includes(id));
    state.players = [...state.players, ...incoming];
    for (const id of incoming) state.scores[id] ??= 0;
    state.pending = [];
  }
  state.roundNumber += 1;
  const hands = dealHands(state.players);
  state.hands = Object.fromEntries(state.players.map((id) => [id, sortHand(hands[id])]));
  state.passDirection = passDirection(state.roundNumber, state.players.length);
  state.passes = {};
  state.passed = Object.fromEntries(state.players.map((id) => [id, false]));
  state.received = {};
  state.trick = [];
  state.lastTrick = null;
  state.heartsBroken = false;
  state.tricksPlayed = 0;
  state.taken = Object.fromEntries(state.players.map((id) => [id, 0]));

  if (state.passDirection === "none") startPlay(state);
  else {
    state.phase = "passing";
    state.toPlay = null;
  }
}

/** Everyone has passed (or there is no passing): whoever holds ♣2 leads. */
function startPlay(state: HeartsState): void {
  state.phase = "playing";
  state.toPlay = state.players.find((id) => hand(state, id).some((c) => c.id === TWO_OF_CLUBS))!;
}

function exchangePasses(state: HeartsState): void {
  const n = state.players.length;
  state.players.forEach((giver, i) => {
    const receiver = state.players[passTarget(i, state.passDirection, n)];
    const ids = state.passes[giver];
    const cards = hand(state, giver).filter((c) => ids.includes(c.id));
    state.hands[giver] = hand(state, giver).filter((c) => !ids.includes(c.id));
    state.received[receiver] = ids;
    state.hands[receiver] = [...hand(state, receiver), ...cards];
  });
  for (const id of state.players) state.hands[id] = sortHand(hand(state, id));
}

function finishTrick(state: HeartsState): void {
  const winner = trickWinner(state.trick);
  state.taken[winner] += state.trick.reduce((sum, p) => sum + points(p.card), 0);
  state.lastTrick = { plays: state.trick, winner };
  state.trick = [];
  state.tricksPlayed += 1;

  if (hand(state, winner).length > 0) {
    state.toPlay = winner;
    return;
  }
  // Last trick of the round.
  const { points: roundPoints, moon } = scoreRound(state.taken);
  for (const id of state.players) state.scores[id] += roundPoints[id];
  state.history.push({ round: state.roundNumber, points: roundPoints, moon });
  state.phase = "roundEnd";
  state.toPlay = null;
}

/** Lowest score among players still at the table; a tie is a draw. */
function lowest(state: HeartsState): string | "draw" {
  const present = state.players.filter((id) => !state.left.includes(id));
  if (present.length === 0) return "draw";
  const best = Math.min(...present.map((id) => state.scores[id]));
  const leaders = present.filter((id) => state.scores[id] === best);
  return leaders.length === 1 ? leaders[0] : "draw";
}

const hartenjagen: Game<HeartsState, HeartsMove> = {
  init(playerIds) {
    const state: HeartsState = {
      players: [...playerIds],
      hands: {},
      phase: "passing",
      roundNumber: 0,
      passDirection: "none",
      passes: {},
      passed: {},
      received: {},
      trick: [],
      lastTrick: null,
      toPlay: null,
      heartsBroken: false,
      tricksPlayed: 0,
      taken: {},
      scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
      history: [],
      left: [],
      pending: [],
    };
    startRound(state);
    return state;
  },

  validateMove(state, playerId, raw) {
    if (!state.players.includes(playerId)) return { ok: false, error: "You are not in this game" };
    const move = raw as Partial<HeartsMove> | null;

    switch (move?.type) {
      case "nextRound":
        if (state.phase !== "roundEnd") return { ok: false, error: "The round is still running" };
        return { ok: true, move: { type: "nextRound" } };

      case "pass": {
        if (state.phase !== "passing") return { ok: false, error: "Not passing now" };
        if (state.passed[playerId]) return { ok: false, error: "You already passed" };
        const cards = (move as { cards?: unknown }).cards;
        if (!Array.isArray(cards) || cards.length !== PASS_COUNT || new Set(cards).size !== PASS_COUNT) {
          return { ok: false, error: `Choose ${PASS_COUNT} different cards` };
        }
        const mine = new Set(hand(state, playerId).map((c) => c.id));
        if (!cards.every((id) => typeof id === "string" && mine.has(id))) {
          return { ok: false, error: "You can only pass cards from your hand" };
        }
        return { ok: true, move: { type: "pass", cards: cards as string[] } };
      }

      case "play": {
        if (state.phase !== "playing") return { ok: false, error: "Not playing now" };
        if (state.toPlay !== playerId) return { ok: false, error: "Not your turn" };
        const id = (move as { card?: unknown }).card;
        const card = hand(state, playerId).find((c) => c.id === id);
        if (!card) return { ok: false, error: "That card is not in your hand" };
        const legal = legalPlays(hand(state, playerId), state.trick, state.tricksPlayed === 0, state.heartsBroken);
        if (!legal.some((c) => c.id === card.id)) return { ok: false, error: whyIllegal(state, card) };
        return { ok: true, move: { type: "play", card: card.id } };
      }

      default:
        return { ok: false, error: "Malformed move" };
    }
  },

  applyMove(prev, playerId, move) {
    const state = structuredClone(prev);
    switch (move.type) {
      case "nextRound":
        startRound(state);
        break;

      case "pass":
        state.passes[playerId] = move.cards;
        state.passed[playerId] = true;
        if (state.players.every((id) => state.passed[id])) {
          exchangePasses(state);
          startPlay(state);
        }
        break;

      case "play": {
        const card = hand(state, playerId).find((c) => c.id === move.card)!;
        state.hands[playerId] = hand(state, playerId).filter((c) => c.id !== move.card);
        state.trick.push({ playerId, card });
        if (isHeart(card)) state.heartsBroken = true;
        if (state.trick.length === state.players.length) finishTrick(state);
        else state.toPlay = nextPlayer(state, playerId);
        break;
      }
    }
    return state;
  },

  result(state) {
    if (state.left.length > 0) return { over: true, winner: lowest(state) };
    if (state.phase !== "roundEnd") return { over: false };
    const reached = state.players.some((id) => state.scores[id] >= GAME_END_SCORE);
    return reached ? { over: true, winner: lowest(state) } : { over: false };
  },

  // Hearts can't continue with a player missing: the game ends, lowest score wins.
  playerLeft(state, playerId) {
    return { ...state, left: [...state.left, playerId], toPlay: null };
  },

  // Park late-joiners until the next round deals them in (see startRound). Keep
  // the queue in sync with who is still in the room; departures are handled by
  // playerLeft, so the running round is untouched here.
  playersChanged(state, _connectedIds, memberIds) {
    const seated = new Set(state.players);
    const kept = state.pending.filter((id) => memberIds.includes(id));
    const added = memberIds.filter((id) => !seated.has(id) && !kept.includes(id));
    const pending = [...kept, ...added];
    const same = pending.length === state.pending.length
      && pending.every((id, i) => id === state.pending[i]);
    return same ? state : { ...state, pending };
  },

  playerView(state, playerId) {
    return {
      ...state,
      hands: Object.fromEntries(
        state.players.map((id) => [id, id === playerId ? state.hands[id] : state.hands[id].map(() => null)]),
      ),
      passes: playerId in state.passes ? { [playerId]: state.passes[playerId] } : {},
      received: playerId in state.received ? { [playerId]: state.received[playerId] } : {},
    } satisfies HeartsState;
  },
};

/** A friendly reason for an illegal card. */
function whyIllegal(state: HeartsState, card: Card): string {
  if (state.trick.length > 0) {
    const lead = state.trick[0].card.suit;
    if (card.suit !== lead) return `You must follow ${lead}`;
  }
  if (state.tricksPlayed === 0) {
    return state.trick.length === 0 ? "The first trick starts with ♣2" : "No points in the first trick";
  }
  return "Hearts aren't broken yet";
}

export default hartenjagen;
