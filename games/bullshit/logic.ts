import { randomInt, randomUUID } from "node:crypto";
import { deal, type Game, type MoveResult } from "@app/shared";
import {
  BULLSHIT_WINDOW_MS, REVEAL_MS, CLAIM_RANKS,
  type BullshitState, type BullshitView, type BullshitMove,
} from "./types.js";

import { getAllowedClaimRanks, getMinimumPlayCount } from "./rules.js";

const secureRandom = () => randomInt(0x100000000) / 0x100000000;

export function createGame(playerIds: string[], rng = secureRandom, roundId: string = randomUUID()): BullshitState {
  if (playerIds.length < 2 || playerIds.length > 8 || new Set(playerIds).size !== playerIds.length) {
    throw new Error("Bullshit requires 2–8 unique players");
  }
  const { hands } = deal(playerIds.length, { decks: 1, rng });
  return {
    roundId, players: [...playerIds],
    hands: Object.fromEntries(playerIds.map((id, i) => [id, hands[i]])),
    pile: [], turnIndex: Math.floor(rng() * playerIds.length), rankIndex: 0,
    phase: "TURN", version: 0, deadline: null, lastPlay: null, reveal: null, winner: null,
  };
}

export function validateMove(state: BullshitState, playerId: string, raw: unknown, now = Date.now()): MoveResult<BullshitMove> {
  const fail = (error: string): MoveResult<BullshitMove> => ({ ok: false, error });
  if (!state.players.includes(playerId)) return fail("You are not seated in this game");
  if (state.phase === "GAME_OVER") return fail("Game is over");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("Malformed move");
  const move = raw as Record<string, unknown>;
  if (move.roundId !== state.roundId) return fail("This action belongs to an earlier round");
  if (move.type === "playCards") {
    if (Object.keys(move).some(key => !["type", "cardIds", "claimedRank", "playVersion", "roundId"].includes(key))) return fail("Unexpected play fields");
    if (state.phase !== "TURN") return fail("Wait until the next turn");
    if (state.players[state.turnIndex] !== playerId) return fail("Not your turn");
    if (move.playVersion !== state.version) return fail("Stale turn version");
    const ids = move.cardIds;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 52 || !ids.every(id => typeof id === "string")) return fail("Select one or more cards");
    if (new Set(ids).size !== ids.length) return fail("Duplicate card IDs");
    if (!ids.every(id => state.hands[playerId].some(card => card.id === id))) return fail("You do not own these cards");
    const minimum = getMinimumPlayCount(state);
    if (ids.length < minimum) return fail("Je moet minstens " + minimum + " kaarten spelen.");
    const allowed = getAllowedClaimRanks(CLAIM_RANKS[state.rankIndex]);
    const claimedRank = allowed.find(rank => rank === move.claimedRank);
    if (!claimedRank) return fail("Je kunt alleen " + allowed.join(", ") + " claimen.");
    return { ok: true, move: { type: "playCards", cardIds: [...ids], claimedRank, playVersion: state.version, roundId: state.roundId } };
  }
  if (move.type === "challenge") {
    if (Object.keys(move).some(key => !["type", "playId", "roundId"].includes(key))) return fail("Unexpected challenge fields");
    if (state.phase !== "CHALLENGE_WINDOW" || state.deadline === null || now >= state.deadline || !state.lastPlay) return fail("Challenge window is closed");
    if (move.playId !== state.lastPlay.id) return fail("Stale play ID");
    if (state.lastPlay.playerId === playerId) return fail("You cannot challenge yourself");
    return { ok: true, move: { type: "challenge", playId: state.lastPlay.id, roundId: state.roundId } };
  }
  return fail("Unknown action");
}

export function applyMove(state: BullshitState, playerId: string, move: BullshitMove, now = Date.now()): BullshitState {
  // Revalidate at the mutation boundary too, including the exact deadline.
  const checked = validateMove(state, playerId, move, now);
  if (!checked.ok) throw new Error(checked.error);
  const next: BullshitState = structuredClone(state);
  next.version++;
  if (move.type === "playCards") {
    const cards = move.cardIds.map(id => next.hands[playerId].find(c => c.id === id)!);
    next.hands[playerId] = next.hands[playerId].filter(c => !move.cardIds.includes(c.id));
    next.pile.push(...cards);
    next.rankIndex = CLAIM_RANKS.indexOf(move.claimedRank);
    next.lastPlay = { id: next.roundId + ":" + next.version, playerId, rank: move.claimedRank, cards };
    next.reveal = null;
    next.phase = "CHALLENGE_WINDOW";
    next.deadline = now + BULLSHIT_WINDOW_MS;
    const followingPlayer = next.players[(next.turnIndex + 1) % next.players.length];
    if (next.hands[followingPlayer].length < getMinimumPlayCount(next)) {
      // A player unable to match the count must challenge, never silently pass
      // or play fewer cards. Use the same authoritative resolution as a click.
      const resolved = applyMove(next, followingPlayer, {
        type: "challenge", playId: next.lastPlay.id, roundId: next.roundId,
      }, now);
      resolved.reveal!.automatic = true;
      return resolved;
    }
  } else {
    const play = next.lastPlay!;
    const lied = play.cards.some(card => card.rank !== play.rank);
    const loserId = lied ? play.playerId : playerId;
    next.reveal = { cards: [...play.cards], challengerId: playerId, automatic: false, loserId, lied, pileCount: next.pile.length };
    next.hands[loserId].push(...next.pile);
    next.pile = [];
    next.phase = "RESOLVING_CHALLENGE";
    next.deadline = now + REVEAL_MS;
  }
  return next;
}

export function advance(state: BullshitState, now = Date.now()): BullshitState {
  if (state.deadline === null || now < state.deadline ||
      (state.phase !== "CHALLENGE_WINDOW" && state.phase !== "RESOLVING_CHALLENGE")) return state;
  const next = { ...state, version: state.version + 1, deadline: null };
  if (!next.hands[next.players[next.turnIndex]].length) {
    next.winner = next.players[next.turnIndex];
    next.phase = "GAME_OVER";
  } else {
    next.turnIndex = (next.turnIndex + 1) % next.players.length;
    // After a pickup, start a fresh trick around A; otherwise retain the last claim.
    if (state.phase === "RESOLVING_CHALLENGE") next.rankIndex = 0;
    next.phase = "TURN";
  }
  return next;
}

export function playerView(state: BullshitState, playerId: string, now = Date.now()): BullshitView {
  const play = state.lastPlay;
  return {
    roundId: state.roundId, selfId: playerId,
    myHand: structuredClone(state.hands[playerId] ?? []),
    players: state.players.map(id => ({ id, cardCount: state.hands[id].length })),
    pileCount: state.pile.length,
    turn: state.phase === "GAME_OVER" ? null : state.players[state.turnIndex],
    claimedRank: CLAIM_RANKS[state.rankIndex],
    allowedClaimRanks: getAllowedClaimRanks(CLAIM_RANKS[state.rankIndex]),
    minimumPlayCount: getMinimumPlayCount(state), phase: state.phase, version: state.version,
    deadline: state.deadline, serverNow: now,
    lastPlay: play ? { id: play.id, playerId: play.playerId, rank: play.rank, count: play.cards.length } : null,
    // Only the last challenged set is public, never the rest of the pile.
    reveal: state.reveal ? structuredClone(state.reveal) : null, winner: state.winner,
  };
}

export default {
  init: createGame,
  validateMove,
  applyMove,
  result: (state) => ({ over: state.phase === "GAME_OVER", winner: state.winner ?? undefined }),
  playerView,
  advance,
  nextUpdateIn: state => state.deadline === null ? null : Math.max(0, state.deadline - Date.now()),
} satisfies Game<BullshitState, BullshitMove>;
