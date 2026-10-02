import { randomInt } from "node:crypto";
import {
  deal, RANK_VALUES, sortHand, type Card, type Game, type MoveResult, type Rank,
} from "@app/shared";
import {
  advanceRun, assignRoles, effectiveRank, exchangePairs, hasLegalFollow,
  MIN_CARDS_PER_PLAYER, rankLabel, TURN_MS,
} from "./rules.js";
import type {
  PresidentenMove, PresidentenState, PresidentenView,
} from "./types.js";

const secureRandom = () => randomInt(0x100000000) / 0x100000000;

// The 3 of clubs (from deck 0) always leads a hand.
const OPENER_ID = "clubs-3#0";

/** Seat of the ♣3 holder — the opener — or the first player still holding cards. */
function openerSeat(s: PresidentenState): number {
  const seat = s.players.findIndex((id) => (s.hands[id] ?? []).some((c) => c.id === OPENER_ID));
  if (seat >= 0) return seat;
  const anyWithCards = s.players.findIndex((id) => hasCards(s, id));
  return anyWithCards >= 0 ? anyWithCards : 0;
}

export function createGame(
  playerIds: string[],
  rng = secureRandom,
  now = Date.now(),
): PresidentenState {
  if (playerIds.length < 3 || new Set(playerIds).size !== playerIds.length) {
    throw new Error("Presidenten requires at least 3 unique players");
  }
  const { hands } = deal(playerIds.length, { minCardsPerPlayer: MIN_CARDS_PER_PLAYER, rng });
  const state: PresidentenState = {
    players: [...playerIds],
    hands: Object.fromEntries(playerIds.map((id, i) => [id, hands[i]])),
    pile: [],
    top: null,
    finished: [],
    turnIndex: 0,
    currentCount: null,
    currentRankValue: null,
    runRankValue: null,
    runCount: 0,
    lastPlayerId: null,
    passedThisTrick: [],
    phase: "PLAY",
    winner: null,
    version: 0,
    deadline: null,
    round: 1,
    roles: null,
    exchange: null,
    left: [],
    lastTrick: null,
  };
  state.turnIndex = openerSeat(state); // the ♣3 holder opens
  armTimer(state, now);
  return state;
}

const hasCards = (s: PresidentenState, id: string) => (s.hands[id]?.length ?? 0) > 0;
const activeIds = (s: PresidentenState) => s.players.filter((id) => hasCards(s, id));
const isContender = (s: PresidentenState, id: string) =>
  hasCards(s, id) && !s.passedThisTrick.includes(id);
/** Finishers still in the room — used when a hand ends. */
const presentFinishers = (s: PresidentenState) =>
  s.finished.filter((id) => !s.left.includes(id));
/** Seated players still in the room — used during the exchange. */
const presentPlayers = (s: PresidentenState) =>
  s.players.filter((id) => !s.left.includes(id));

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

  if (state.phase === "EXCHANGE") {
    const ex = state.exchange!;
    const pair = ex.pairs[0];
    if (!pair || pair.winner !== playerId) return fail("Not your turn to exchange");
    if (move.type === "request") {
      if (ex.step !== "request") return fail("Pick a card to give back first");
      if (Object.keys(move).some((k) => !["type", "rank"].includes(k))) {
        return fail("Unexpected request fields");
      }
      if (typeof move.rank !== "string" || !(move.rank in RANK_VALUES)) {
        return fail("Pick a valid rank");
      }
      return { ok: true, move: { type: "request", rank: move.rank as Rank } };
    }
    if (move.type === "giveBack") {
      if (ex.step !== "giveBack") return fail("Ask for a card first");
      if (Object.keys(move).some((k) => !["type", "cardId"].includes(k))) {
        return fail("Unexpected giveBack fields");
      }
      if (typeof move.cardId !== "string") return fail("Pick a card to give back");
      if (!(state.hands[playerId] ?? []).some((c) => c.id === move.cardId)) {
        return fail("You do not own that card");
      }
      return { ok: true, move: { type: "giveBack", cardId: move.cardId } };
    }
    return fail("Finish the card exchange first");
  }

  // PLAY phase
  if (state.players[state.turnIndex] !== playerId) return fail("Not your turn");

  if (move.type === "pass") {
    if (Object.keys(move).some((k) => k !== "type")) return fail("Unexpected pass fields");
    // Pass is always allowed on your turn — leading passes simply rotate the lead.
    return { ok: true, move: { type: "pass" } };
  }

  if (move.type === "play") {
    if (state.passedThisTrick.includes(playerId)) {
      return fail("You already passed this trick");
    }
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

  if (next.phase === "EXCHANGE") {
    applyExchange(next, move as Extract<PresidentenMove, { type: "request" | "giveBack" }>);
    armTimer(next, now);
    return next;
  }

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
    // NB: passes stick for the whole trick — a player who passed stays out even
    // when someone later plays a higher group. `clearTrick` resets the list.

    if (!hasCards(next, playerId)) next.finished.push(playerId);

    if (run.burned) {
      // Pile is burned; whoever laid the 4th leads a fresh trick (or the next
      // active player, if that was their last card).
      next.lastTrick = { by: playerId, cards: picked };
      clearTrick(next);
      resumeAfterTrickWin(next, seat);
    } else {
      advanceTurn(next, seat);
    }
  } else if (next.currentCount === null) {
    // Pass while leading a fresh trick: nothing to win, just rotate the lead.
    rotateLead(next, seat);
  } else {
    if (!next.passedThisTrick.includes(playerId)) next.passedThisTrick.push(playerId);
    advanceTurn(next, seat);
  }

  checkHandOver(next);
  if (next.phase === "PLAY") {
    settle(next);
    checkHandOver(next);
  }
  armTimer(next, now);
  return next;
}

/** Resolve one exchange action, advancing the queue (and starting play when done). */
function applyExchange(
  s: PresidentenState,
  move: Extract<PresidentenMove, { type: "request" | "giveBack" }>,
): void {
  const ex = s.exchange!;
  const pair = ex.pairs[0];

  if (move.type === "request") {
    const loserHand = s.hands[pair.loser] ?? [];
    const card = loserHand.find((c) => c.rank === move.rank);
    if (!card) {
      ex.lastMiss = move.rank;
      return;
    }
    s.hands[pair.loser] = loserHand.filter((c) => c.id !== card.id);
    s.hands[pair.winner].push(card);
    ex.lastMiss = null;
    ex.step = "giveBack";
    return;
  }

  // giveBack: hand one of the winner's own cards to the loser, then advance.
  const card = s.hands[pair.winner].find((c) => c.id === move.cardId)!;
  s.hands[pair.winner] = s.hands[pair.winner].filter((c) => c.id !== card.id);
  s.hands[pair.loser].push(card);
  ex.pairs.shift();
  ex.step = "request";
  ex.lastMiss = null;
  if (ex.pairs.length === 0) finishExchange(s);
}

/** Set (or clear) the countdown for the player now on turn (PLAY phase only). */
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
  s.passedThisTrick = [];
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
  const lastId = s.lastPlayerId;
  const lastSeat = lastId === null ? -1 : s.players.indexOf(lastId);
  // The trick is won once nobody but the last player is still contending.
  if (next === -1 || next === lastSeat) {
    if (lastId !== null) s.lastTrick = { by: lastId, cards: s.top ?? [] };
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
    if (!s.passedThisTrick.includes(cur)) s.passedThisTrick.push(cur);
    advanceTurn(s, seat);
  }
}

/**
 * When only one player is left holding cards the hand is over. With three or
 * more players still around, standings are assigned, a fresh hand is dealt and
 * the between-hand exchange begins; otherwise the whole game ends.
 */
function checkHandOver(s: PresidentenState): void {
  if (s.phase !== "PLAY") return;
  const active = activeIds(s);
  if (active.length > 1) return;
  for (const id of active) {
    if (!s.finished.includes(id)) s.finished.push(id);
  }

  const present = presentFinishers(s);
  if (present.length < 3) {
    s.phase = "GAME_OVER";
    s.winner = present[0] ?? s.finished[0] ?? null;
    s.exchange = null;
    return;
  }

  const roles = assignRoles(present);
  const pairs = exchangePairs(present);
  dealNewHand(s, present); // deal the next hand first, so winners have cards to give back
  s.roles = roles;
  s.winner = null;
  if (pairs.length === 0) {
    s.phase = "PLAY"; // no winner/loser pairs to exchange — play begins immediately
    s.exchange = null;
    s.turnIndex = openerSeat(s); // the ♣3 holder opens
  } else {
    s.phase = "EXCHANGE";
    s.exchange = { pairs, step: "request", lastMiss: null, total: pairs.length };
  }
}

/** Re-seat to the finishing order and deal everyone a fresh hand (President leads). */
function dealNewHand(s: PresidentenState, present: string[]): void {
  const { hands } = deal(present.length, { minCardsPerPlayer: MIN_CARDS_PER_PLAYER, rng: secureRandom });
  s.players = [...present];
  s.hands = Object.fromEntries(present.map((id, i) => [id, hands[i]]));
  s.pile = [];
  s.top = null;
  s.finished = [];
  s.currentCount = null;
  s.currentRankValue = null;
  s.runRankValue = null;
  s.runCount = 0;
  s.lastPlayerId = null;
  s.passedThisTrick = [];
  s.left = [];
  s.lastTrick = null;
  s.round++;
  s.turnIndex = 0; // placeholder; the real opener is set once play starts
}

/** Close the exchange and hand off to play; the dealt hands stand as they are. */
function finishExchange(s: PresidentenState): void {
  s.exchange = null;
  s.phase = "PLAY";
  s.turnIndex = openerSeat(s); // the ♣3 holder leads the new hand
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

/** Project per-player: only your own hand, opponents as counts, private feed lines. */
export function playerView(
  state: PresidentenState,
  playerId: string,
  now = Date.now(),
): PresidentenView {
  const ex = state.exchange;
  const turn =
    state.phase === "PLAY"
      ? state.players[state.turnIndex]
      : state.phase === "EXCHANGE" && ex?.pairs[0]
        ? ex.pairs[0].winner
        : null;

  return {
    selfId: playerId,
    myHand: sortHand(state.hands[playerId] ?? []),
    players: state.players.map((id) => {
      const place = state.finished.indexOf(id);
      return {
        id,
        cardCount: state.hands[id]?.length ?? 0,
        finishPlace: place < 0 ? null : place + 1,
        role: state.roles?.[id] ?? null,
      };
    }),
    pileCount: state.pile.length,
    pileTop: state.top ? structuredClone(state.top) : null,
    turn,
    currentCount: state.currentCount,
    currentRank: state.currentRankValue === null ? null : rankLabel(state.currentRankValue),
    canPass: state.currentCount !== null,
    phase: state.phase,
    winner: state.winner,
    version: state.version,
    deadline: state.deadline,
    serverNow: now,
    round: state.round,
    exchange:
      state.phase === "EXCHANGE" && ex?.pairs[0]
        ? {
            activeWinner: ex.pairs[0].winner,
            loser: ex.pairs[0].loser,
            step: ex.step,
            lastMiss: ex.lastMiss,
            done: ex.total - ex.pairs.length,
            total: ex.total,
          }
        : null,
    lastTrick: state.lastTrick ? structuredClone(state.lastTrick) : null,
  };
}

export function playerLeft(state: PresidentenState, playerId: string): PresidentenState {
  if (!state.players.includes(playerId) || state.phase === "GAME_OVER") return state;
  const next: PresidentenState = structuredClone(state);
  const now = Date.now();
  if (!next.left.includes(playerId)) next.left.push(playerId);

  if (next.phase === "EXCHANGE") {
    const ex = next.exchange!;
    const currentBefore = ex.pairs[0];
    ex.pairs = ex.pairs.filter((p) => p.winner !== playerId && p.loser !== playerId);
    next.hands[playerId] = []; // fold their freshly dealt hand so play will skip them
    if (presentPlayers(next).length < 3) {
      next.phase = "GAME_OVER";
      next.winner = presentPlayers(next)[0] ?? null;
      next.exchange = null;
    } else if (ex.pairs.length === 0) {
      finishExchange(next);
    } else if (ex.pairs[0] !== currentBefore) {
      // The current pair changed (or was dropped): start it fresh.
      ex.step = "request";
      ex.lastMiss = null;
    }
    armTimer(next, now);
    return next;
  }

  // PLAY
  const wasTurn = next.players[next.turnIndex] === playerId;
  const seat = next.players.indexOf(playerId);
  // Fold their hand: drop it so they leave the active rotation.
  next.hands[playerId] = [];
  next.passedThisTrick = next.passedThisTrick.filter((id) => id !== playerId);
  if (next.lastPlayerId === playerId) {
    // Their play no longer stands; hand the lead to the next active player.
    clearTrick(next);
    resumeAfterTrickWin(next, seat);
  } else if (wasTurn) {
    advanceTurn(next, seat);
  }
  checkHandOver(next);
  if (next.phase === "PLAY") {
    settle(next);
    checkHandOver(next);
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
