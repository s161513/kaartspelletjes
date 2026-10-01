import { randomInt } from "node:crypto";
import {
  deal, RANK_VALUES, sortHand, type Card, type Game, type MoveResult,
} from "@app/shared";
import { advanceRun, effectiveRank, hasLegalFollow, rankLabel, TURN_MS } from "./rules.js";
import type { PresidentenMove, PresidentenState, PresidentenView } from "./types.js";

const secureRandom = () => randomInt(0x100000000) / 0x100000000;

export function createGame(
  playerIds: string[],
  rng = secureRandom,
  now = Date.now(),
): PresidentenState {
  if (playerIds.length < 3 || playerIds.length > 8 || new Set(playerIds).size !== playerIds.length) {
    throw new Error("Presidenten requires 3–8 unique players");
  }
  const { hands } = deal(playerIds.length, { decks: 1, rng });
  const state: PresidentenState = {
    players: [...playerIds],
    hands: Object.fromEntries(playerIds.map((id, i) => [id, hands[i]])),
    pile: [],
    top: null,
    finished: [],
    turnIndex: Math.floor(rng() * playerIds.length),
    currentCount: null,
    currentRankValue: null,
    runRankValue: null,
    runCount: 0,
    lastPlayerId: null,
    passedSinceLastPlay: [],
    phase: "PLAY",
    winner: null,
    version: 0,
    deadline: null,
  };
  armTimer(state, now);
  return state;
}

const hasCards = (s: PresidentenState, id: string) => (s.hands[id]?.length ?? 0) > 0;
const activeIds = (s: PresidentenState) => s.players.filter((id) => hasCards(s, id));
const isContender = (s: PresidentenState, id: string) =>
  hasCards(s, id) && !s.passedSinceLastPlay.includes(id);

/** Next seat strictly after `fromSeat` (cyclic) matching `ok`, or -1 if none. */
function nextSeat(s: PresidentenState, fromSeat: number, ok: (id: string) => boolean): number {
  const n = s.players.length;
  for (let step = 1; step <= n; step++) {
    const seat = (fromSeat + step) % n;
    if (ok(s.players[seat])) return seat;
  }
  return -1;
}

export function validateMove(
  state: PresidentenState,
  playerId: string,
  raw: unknown,
): MoveResult<PresidentenMove> {
  const fail = (error: string): MoveResult<PresidentenMove> => ({ ok: false, error });
  if (!state.players.includes(playerId)) return fail("You are not seated in this game");
  if (state.phase === "GAME_OVER") return fail("Game is over");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("Malformed move");
  const move = raw as Record<string, unknown>;
  if (state.players[state.turnIndex] !== playerId) return fail("Not your turn");

  if (move.type === "pass") {
    if (Object.keys(move).some((k) => k !== "type")) return fail("Unexpected pass fields");
    // Pass is always allowed on your turn — leading passes simply rotate the lead.
    return { ok: true, move: { type: "pass" } };
  }

  if (move.type === "play") {
    if (Object.keys(move).some((k) => !["type", "cardIds"].includes(k))) {
      return fail("Unexpected play fields");
    }
    const ids = move.cardIds;
    if (!Array.isArray(ids) || ids.length < 1 || !ids.every((id) => typeof id === "string")) {
      return fail("Select one or more cards");
    }
    if (new Set(ids).size !== ids.length) return fail("Duplicate card IDs");
    const hand = state.hands[playerId];
    const cards = (ids as string[]).map((id) => hand.find((c) => c.id === id));
    if (cards.some((c) => c === undefined)) return fail("You do not own those cards");
    const picked = cards as Card[];

    const eff = effectiveRank(picked);
    if (!eff.ok) return fail(eff.error);

    if (state.currentCount !== null) {
      // You may play more cards than are on the table, but never fewer.
      if (picked.length < state.currentCount) {
        return fail(`You must play at least ${state.currentCount} card(s)`);
      }
      if (eff.group.value < (state.currentRankValue ?? 0)) {
        return fail("You must play an equal or higher rank");
      }
    }

    // You may not go out on a 2: the hand-emptying play must contain no 2.
    if (picked.length === hand.length && picked.some((c) => c.rank === "2")) {
      return fail("You cannot finish on a 2 — hold it back and play something else");
    }

    return { ok: true, move: { type: "play", cardIds: [...(ids as string[])] } };
  }

  return fail("Unknown action");
}

export function applyMove(
  state: PresidentenState,
  playerId: string,
  move: PresidentenMove,
  now = Date.now(),
): PresidentenState {
  const checked = validateMove(state, playerId, move);
  if (!checked.ok) throw new Error(checked.error);
  const next: PresidentenState = structuredClone(state);
  next.version++;
  const seat = next.players.indexOf(playerId);

  if (move.type === "play") {
    const picked = move.cardIds.map((id) => next.hands[playerId].find((c) => c.id === id)!);
    next.hands[playerId] = next.hands[playerId].filter((c) => !move.cardIds.includes(c.id));
    next.pile.push(...picked);
    next.top = picked;

    const group = (effectiveRank(picked) as { ok: true; group: { value: number } }).group;
    // Only natural cards count toward a burn — wild 2s copy the rank but are not real cards of it.
    const naturalCount = picked.filter((c) => c.rank !== "2").length;
    const run = advanceRun(next.runRankValue, next.runCount, group.value, naturalCount);
    next.currentCount = picked.length;
    next.currentRankValue = group.value;
    next.runRankValue = run.runValue;
    next.runCount = run.runCount;
    next.lastPlayerId = playerId;
    next.passedSinceLastPlay = [];

    if (!hasCards(next, playerId)) next.finished.push(playerId);

    if (run.burned) {
      // Pile is burned; whoever laid the 4th leads a fresh trick (or the next
      // active player, if that was their last card).
      clearTrick(next);
      resumeAfterTrickWin(next, seat);
    } else {
      advanceTurn(next, seat);
    }
  } else if (next.currentCount === null) {
    // Pass while leading a fresh trick: nothing to win, just rotate the lead.
    rotateLead(next, seat);
  } else {
    if (!next.passedSinceLastPlay.includes(playerId)) next.passedSinceLastPlay.push(playerId);
    advanceTurn(next, seat);
  }

  checkRoundOver(next);
  if (next.phase === "PLAY") {
    settle(next);
    checkRoundOver(next);
  }
  armTimer(next, now);
  return next;
}

/** Set (or clear) the countdown for the player now on turn. */
function armTimer(s: PresidentenState, now: number): void {
  s.deadline = s.phase === "PLAY" ? now + TURN_MS : null;
}

/** Discard the current trick and reset the follow requirement. */
function clearTrick(s: PresidentenState): void {
  s.pile = [];
  s.top = null;
  s.currentCount = null;
  s.currentRankValue = null;
  s.runRankValue = null;
  s.runCount = 0;
  s.lastPlayerId = null;
  s.passedSinceLastPlay = [];
}

/** Seat the lead after a trick was won: the winner, or the next active player. */
function resumeAfterTrickWin(s: PresidentenState, winnerSeat: number): void {
  if (hasCards(s, s.players[winnerSeat])) s.turnIndex = winnerSeat;
  else {
    const seat = nextSeat(s, winnerSeat, (id) => hasCards(s, id));
    if (seat >= 0) s.turnIndex = seat;
  }
}

/** Pass while leading just hands the fresh trick to the next active player. */
function rotateLead(s: PresidentenState, fromSeat: number): void {
  const seat = nextSeat(s, fromSeat, (id) => hasCards(s, id));
  if (seat >= 0) s.turnIndex = seat;
}

/** Move play on after a non-burning play or a pass, resolving an all-pass win. */
function advanceTurn(s: PresidentenState, fromSeat: number): void {
  const next = nextSeat(s, fromSeat, (id) => isContender(s, id));
  const lastSeat = s.lastPlayerId === null ? -1 : s.players.indexOf(s.lastPlayerId);
  // The trick is won once nobody but the last player is still contending.
  if (next === -1 || next === lastSeat) {
    clearTrick(s);
    if (lastSeat >= 0) resumeAfterTrickWin(s, lastSeat);
    return;
  }
  s.turnIndex = next;
}

/**
 * Immediately auto-pass any following player with no legal play, so the game
 * never waits on someone who cannot act. A leader can always play, so this only
 * skips followers and stops once the trick resolves into a fresh lead.
 */
function settle(s: PresidentenState): void {
  for (let guard = 0; guard <= s.players.length * 2; guard++) {
    if (s.phase !== "PLAY" || s.currentCount === null) return;
    const seat = s.turnIndex;
    const cur = s.players[seat];
    if (!hasCards(s, cur)) return;
    if (hasLegalFollow(s.hands[cur], s.currentCount, s.currentRankValue ?? 0)) return;
    if (!s.passedSinceLastPlay.includes(cur)) s.passedSinceLastPlay.push(cur);
    advanceTurn(s, seat);
  }
}

function checkRoundOver(s: PresidentenState): void {
  const active = activeIds(s);
  if (active.length <= 1) {
    for (const id of active) if (!s.finished.includes(id)) s.finished.push(id);
    s.phase = "GAME_OVER";
    s.winner = s.finished[0] ?? null;
  }
}

/** Server-driven turn timeout: auto-pass a follower, auto-play low for a leader. */
export function advance(state: PresidentenState, now = Date.now()): PresidentenState {
  if (state.phase !== "PLAY" || state.deadline === null || now < state.deadline) return state;
  const cur = state.players[state.turnIndex];
  let move: PresidentenMove;
  if (state.currentCount === null) {
    const lowest = state.hands[cur]
      .filter((c) => c.rank !== "2")
      .sort((a, b) => RANK_VALUES[a.rank] - RANK_VALUES[b.rank])[0];
    move = lowest ? { type: "play", cardIds: [lowest.id] } : { type: "pass" };
  } else {
    move = { type: "pass" };
  }
  return applyMove(state, cur, move, now);
}

export function playerView(
  state: PresidentenState,
  playerId: string,
  now = Date.now(),
): PresidentenView {
  return {
    selfId: playerId,
    myHand: sortHand(state.hands[playerId] ?? []),
    players: state.players.map((id) => {
      const place = state.finished.indexOf(id);
      return { id, cardCount: state.hands[id]?.length ?? 0, finishPlace: place < 0 ? null : place + 1 };
    }),
    pileCount: state.pile.length,
    pileTop: state.top ? structuredClone(state.top) : null,
    turn: state.phase === "GAME_OVER" ? null : state.players[state.turnIndex],
    currentCount: state.currentCount,
    currentRank: state.currentRankValue === null ? null : rankLabel(state.currentRankValue),
    canPass: state.currentCount !== null,
    phase: state.phase,
    winner: state.winner,
    version: state.version,
    deadline: state.deadline,
    serverNow: now,
  };
}

export function playerLeft(state: PresidentenState, playerId: string): PresidentenState {
  if (!state.players.includes(playerId) || state.phase === "GAME_OVER") return state;
  const next: PresidentenState = structuredClone(state);
  const now = Date.now();
  const wasTurn = next.players[next.turnIndex] === playerId;
  const seat = next.players.indexOf(playerId);
  // Fold their hand: drop it so they leave the active rotation.
  next.hands[playerId] = [];
  next.passedSinceLastPlay = next.passedSinceLastPlay.filter((id) => id !== playerId);
  if (next.lastPlayerId === playerId) {
    // Their play no longer stands; hand the lead to the next active player.
    clearTrick(next);
    resumeAfterTrickWin(next, seat);
  } else if (wasTurn) {
    advanceTurn(next, seat);
  }
  checkRoundOver(next);
  if (next.phase === "PLAY") {
    settle(next);
    checkRoundOver(next);
  }
  armTimer(next, now);
  return next;
}

export default {
  init: createGame,
  validateMove,
  applyMove,
  result: (state) => ({
    over: state.phase === "GAME_OVER",
    winner: state.winner ?? undefined,
  }),
  playerView,
  playerLeft,
  nextUpdateIn: (state) =>
    state.deadline === null ? null : Math.max(0, state.deadline - Date.now()),
  advance: (state) => advance(state),
} satisfies Game<PresidentenState, PresidentenMove>;
