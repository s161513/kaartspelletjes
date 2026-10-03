import { randomUUID } from "node:crypto";
import type { Game } from "@app/shared";
import type { DobbleMove, DobbleState, DobbleView } from "./types.js";
import { DECK, shuffled } from "./deck.js";

export const TARGET_SCORE = 10;
export const ROUND_DELAY_MS = 1000;
export const WRONG_CLICK_DELAY_MS = 400;

function nextRound(playerIds: string[], previous?: DobbleState["round"]): DobbleState["round"] {
  const cards = shuffled(DECK.filter(card => card !== previous?.center));
  return {
    id: randomUUID(), number: (previous?.number ?? 0) + 1, center: cards.pop()!,
    hands: Object.fromEntries(playerIds.map(id => [id, shuffled(cards.pop()!)])),
    status: "active", winnerId: null, matchedSymbol: null, nextAt: null,
  };
}

const dobble: Game<DobbleState, DobbleMove> = {
  init(playerIds) {
    if (playerIds.length < 2 || playerIds.length > 8 || new Set(playerIds).size !== playerIds.length) {
      throw new Error("Dobble needs 2–8 distinct players");
    }
    return {
      playerIds: [...playerIds], activeIds: [...playerIds],
      scores: Object.fromEntries(playerIds.map(id => [id, 0])),
      target: TARGET_SCORE, paused: false, winnerId: null, blockedUntil: {},
      round: nextRound(playerIds),
    };
  },
  validateMove(state, playerId, raw) {
    if (!state.activeIds.includes(playerId)) return { ok: false, error: "Je neemt niet deel aan deze game." };
    if (state.winnerId) return { ok: false, error: "Het spel is afgelopen." };
    if (state.paused) return { ok: false, error: "Wachten op een tweede verbonden speler." };
    if (!raw || typeof raw !== "object") return { ok: false, error: "Ongeldige klik." };
    const move = raw as DobbleMove;
    if (move.type !== "symbolClick" || typeof move.roundId !== "string" || !Number.isInteger(move.symbolId) || move.symbolId < 0 || move.symbolId >= 57) {
      return { ok: false, error: "Ongeldige klik." };
    }
    if (move.roundId !== state.round.id || state.round.status !== "active") return { ok: false, error: "Deze ronde is al voorbij." };
    if (Date.now() < (state.blockedUntil[playerId] ?? 0)) return { ok: false, error: "Wacht even voor je opnieuw klikt." };
    if (!state.round.hands[playerId]?.includes(move.symbolId) || !state.round.center.includes(move.symbolId)) {
      // The cooldown for this wrong guess is recorded in onInvalidMove so that
      // validateMove stays side-effect-free (per the Game contract).
      return { ok: false, error: "Dat is niet de match. Probeer opnieuw!" };
    }
    return { ok: true, move: { type: "symbolClick", roundId: move.roundId, symbolId: move.symbolId } };
  },
  onInvalidMove(state, playerId, raw) {
    // Mirror validateMove's wrong-guess branch: a well-formed click on the live
    // round that simply isn't the match earns a brief per-player cooldown (anti
    // brute-force). Every other rejection — and a click already cooling down —
    // is a no-op, matching the original behaviour.
    if (!state.activeIds.includes(playerId) || state.winnerId || state.paused) return state;
    if (!raw || typeof raw !== "object") return state;
    const move = raw as DobbleMove;
    if (move.type !== "symbolClick" || typeof move.roundId !== "string" ||
        !Number.isInteger(move.symbolId) || move.symbolId < 0 || move.symbolId >= 57) return state;
    if (move.roundId !== state.round.id || state.round.status !== "active") return state;
    if (Date.now() < (state.blockedUntil[playerId] ?? 0)) return state;
    const matches = state.round.hands[playerId]?.includes(move.symbolId) && state.round.center.includes(move.symbolId);
    if (matches) return state;
    return { ...state, blockedUntil: { ...state.blockedUntil, [playerId]: Date.now() + WRONG_CLICK_DELAY_MS } };
  },
  applyMove(state, playerId, move) {
    const scores = { ...state.scores, [playerId]: state.scores[playerId] + 1 };
    const winnerId = scores[playerId] >= state.target ? playerId : null;
    return {
      ...state, scores, winnerId,
      round: { ...state.round, status: "completed", winnerId: playerId,
        matchedSymbol: move.symbolId, nextAt: winnerId ? null : Date.now() + ROUND_DELAY_MS },
    };
  },
  result: state => ({ over: state.winnerId !== null, ...(state.winnerId ? { winner: state.winnerId } : {}) }),
  playerView(state, playerId): DobbleView {
    return {
      playerIds: [...state.playerIds], scores: { ...state.scores }, target: state.target,
      paused: state.paused, winnerId: state.winnerId,
      round: { id: state.round.id, number: state.round.number, center: [...state.round.center],
        own: [...(state.round.hands[playerId] ?? [])], status: state.round.status,
        winnerId: state.round.winnerId, matchedSymbol: state.round.matchedSymbol },
    };
  },
  nextUpdateIn(state) {
    return !state.paused && !state.winnerId && state.round.nextAt !== null
      ? Math.max(0, state.round.nextAt - Date.now()) : null;
  },
  advance(state) {
    if (state.paused || state.winnerId || state.round.status !== "completed") return state;
    return { ...state, round: nextRound(state.activeIds, state.round) };
  },
  playersChanged(state, connectedIds, memberIds) {
    // Drop players who left the room, then register any late-joiners: they go on
    // the scoreboard immediately and are dealt a hand from the next round (their
    // `own` is empty until then, which the view renders as "spectating").
    const activeIds = state.activeIds.filter(id => memberIds.includes(id));
    const playerIds = [...state.playerIds];
    const scores = { ...state.scores };
    for (const id of memberIds) {
      if (!activeIds.includes(id)) activeIds.push(id);
      if (!playerIds.includes(id)) playerIds.push(id);
      scores[id] ??= 0;
    }
    return { ...state, playerIds, activeIds, scores, paused: activeIds.filter(id => connectedIds.includes(id)).length < 2 };
  },
};

export default dobble;
