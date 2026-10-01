import { createDeck, shuffle, type Card, type Game } from "@app/shared";
import { bestHand, compareHands } from "./hand.js";
import { buildPots } from "./pots.js";
import type { HandResult, PokerMove, PokerState, Seat } from "./types.js";

// Texas Hold'em No-Limit. One game = a whole session of hands; it ends when a
// single player holds all the chips.

export const STARTING_CHIPS = 1000;
export const SMALL_BLIND = 10;
export const BIG_BLIND = 20;
/** Blinds double every this many hands. */
export const HANDS_PER_LEVEL = 10;
const MAX_LOG = 40;

// ---------------------------------------------------------------------------
// Seat helpers
// ---------------------------------------------------------------------------

/** Still in the current hand (not busted, not folded). */
const inHand = (s: Seat) => !s.out && !s.folded;
/** Can still make betting decisions this hand. */
const canAct = (s: Seat) => inHand(s) && !s.allIn;

/** First seat index after `from` (wrapping) that matches `pred`, or null. */
function nextSeat(
  state: PokerState,
  from: number,
  pred: (s: Seat) => boolean,
): number | null {
  const n = state.seats.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + k) % n) + n) % n;
    if (pred(state.seats[i])) return i;
  }
  return null;
}

function log(state: PokerState, who: string | null, text: string): void {
  state.log.push({ who, text });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

/** Move up to `amount` chips from a seat into its bet; returns what was paid. */
function pay(seat: Seat, amount: number): number {
  const paid = Math.min(amount, seat.chips);
  seat.chips -= paid;
  seat.bet += paid;
  seat.totalBet += paid;
  if (seat.chips === 0) seat.allIn = true;
  return paid;
}

function deal(state: PokerState, count: number): Card[] {
  return state.deck.splice(state.deck.length - count, count);
}

// ---------------------------------------------------------------------------
// Hand flow
// ---------------------------------------------------------------------------

function startHand(state: PokerState): void {
  for (const seat of state.seats) {
    if (seat.chips === 0) seat.out = true;
    Object.assign(seat, { hole: [], bet: 0, totalBet: 0, folded: false, allIn: false, acted: false });
  }

  state.handNumber += 1;
  const level = Math.floor((state.handNumber - 1) / HANDS_PER_LEVEL);
  state.blinds = { small: SMALL_BLIND * 2 ** level, big: BIG_BLIND * 2 ** level };

  const playing = (s: Seat) => !s.out;
  state.dealer = nextSeat(state, state.dealer, playing)!;
  const headsUp = state.seats.filter(playing).length === 2;
  // Heads-up the dealer posts the small blind and acts first preflop.
  state.smallBlind = headsUp ? state.dealer : nextSeat(state, state.dealer, playing)!;
  state.bigBlind = nextSeat(state, state.smallBlind, playing)!;

  state.deck = shuffle(createDeck());
  state.board = [];
  state.phase = "preflop";
  state.lastResult = null;
  for (const seat of state.seats) if (playing(seat)) seat.hole = deal(state, 2);

  log(state, null, `Hand #${state.handNumber} · blinds ${state.blinds.small}/${state.blinds.big}`);
  const sb = state.seats[state.smallBlind];
  const bb = state.seats[state.bigBlind];
  log(state, sb.id, `posts small blind ${pay(sb, state.blinds.small)}`);
  log(state, bb.id, `posts big blind ${pay(bb, state.blinds.big)}`);

  state.currentBet = state.blinds.big;
  state.minRaise = state.blinds.big;
  advance(state, state.bigBlind);
}

/**
 * After an action by seat `from`: end the hand if everyone else folded, start
 * the next street if the betting round is complete, otherwise pass the turn.
 */
function advance(state: PokerState, from: number): void {
  if (state.seats.filter(inHand).length === 1) return winUncontested(state);

  const needsToAct = (s: Seat) => canAct(s) && (!s.acted || s.bet < state.currentBet);
  const actors = state.seats.filter(canAct);
  const lastActorCovered = actors.length === 1 && actors[0].bet >= state.currentBet;

  const next = nextSeat(state, from, needsToAct);
  if (next === null || lastActorCovered) return nextStreet(state);
  state.toAct = next;
}

function nextStreet(state: PokerState): void {
  for (const seat of state.seats) {
    seat.bet = 0;
    seat.acted = false;
  }
  state.currentBet = 0;
  state.minRaise = state.blinds.big;

  // Deal the next street; keep dealing while fewer than two players can bet
  // (everyone else is all-in), which runs out the board to showdown.
  for (;;) {
    if (state.phase === "river") return showdown(state);
    if (state.phase === "preflop") {
      state.phase = "flop";
      state.board.push(...deal(state, 3));
    } else {
      state.phase = state.phase === "flop" ? "turn" : "river";
      state.board.push(...deal(state, 1));
    }
    if (state.seats.filter(canAct).length >= 2) {
      state.toAct = nextSeat(state, state.dealer, canAct);
      return;
    }
  }
}

function finishHand(state: PokerState, result: HandResult): void {
  state.phase = "showdown";
  state.toAct = null;
  state.lastResult = result;
  for (const seat of state.seats) {
    seat.bet = 0;
    seat.acted = false;
  }
  state.currentBet = 0;
}

function winUncontested(state: PokerState): void {
  const winner = state.seats.find(inHand)!;
  const amount = state.seats.reduce((sum, s) => sum + s.totalBet, 0);
  winner.chips += amount;
  log(state, winner.id, `wins ${amount}`);
  finishHand(state, {
    pots: [{ amount, winners: [winner.id], handName: null }],
    shown: {},
    uncontested: true,
  });
}

function showdown(state: PokerState): void {
  const hands = new Map(
    state.seats
      .filter(inHand)
      .map((s) => [s.id, bestHand([...(s.hole as Card[]), ...state.board])]),
  );
  const pots = buildPots(
    state.seats.map((s) => ({ id: s.id, amount: s.totalBet, folded: !inHand(s) })),
  );

  // Odd chips go to the first winner left of the button.
  const order = (id: string) => {
    const i = state.seats.findIndex((s) => s.id === id);
    const n = state.seats.length;
    return (i - state.dealer - 1 + n) % n;
  };

  const results = pots.map((pot) => {
    let winners: string[] = [];
    for (const id of pot.eligible) {
      const cmp = winners.length ? compareHands(hands.get(id)!, hands.get(winners[0])!) : 1;
      if (cmp > 0) winners = [id];
      else if (cmp === 0) winners.push(id);
    }
    winners.sort((a, b) => order(a) - order(b));

    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const id of winners) {
      const seat = state.seats.find((s) => s.id === id)!;
      seat.chips += share + (odd > 0 ? 1 : 0);
      odd -= 1;
    }
    // A pot only one player could win is just their uncalled bet coming back.
    const contested = pot.eligible.length > 1;
    const handName = contested ? hands.get(winners[0])!.name : null;
    if (contested) {
      log(state, winners[0], winners.length > 1
        ? `splits ${pot.amount} with ${winners.length - 1} other(s) · ${handName}`
        : `wins ${pot.amount} with ${handName}`);
    }
    return { amount: pot.amount, winners, handName };
  });

  const shown = Object.fromEntries([...hands].map(([id, h]) => [id, h.name]));
  finishHand(state, { pots: results, shown, uncontested: false });
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

/** Lowest legal raise-to amount and the all-in amount for a seat. */
export function raiseBounds(state: PokerState, seat: Seat): { min: number; max: number } {
  const max = seat.bet + seat.chips;
  return { min: Math.min(state.currentBet + state.minRaise, max), max };
}

const poker: Game<PokerState, PokerMove> = {
  init(playerIds) {
    const state: PokerState = {
      seats: playerIds.map((id) => ({
        id,
        chips: STARTING_CHIPS,
        hole: [],
        bet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
        out: false,
        acted: false,
      })),
      deck: [],
      board: [],
      phase: "preflop",
      dealer: playerIds.length - 1, // startHand moves the button to seat 0
      smallBlind: 0,
      bigBlind: 0,
      toAct: null,
      currentBet: 0,
      minRaise: BIG_BLIND,
      handNumber: 0,
      blinds: { small: SMALL_BLIND, big: BIG_BLIND },
      lastResult: null,
      log: [],
    };
    startHand(state);
    return state;
  },

  validateMove(state, playerId, raw) {
    const move = raw as Partial<PokerMove> | null;
    const type = move?.type;
    const seatIndex = state.seats.findIndex((s) => s.id === playerId);
    if (seatIndex < 0) return { ok: false, error: "You are not at this table" };

    if (type === "nextHand") {
      if (state.phase !== "showdown") return { ok: false, error: "The hand is still running" };
      return { ok: true, move: { type } };
    }

    if (state.toAct !== seatIndex) return { ok: false, error: "Not your turn" };
    const seat = state.seats[seatIndex];
    const toCall = state.currentBet - seat.bet;

    switch (type) {
      case "fold":
        return { ok: true, move: { type } };
      case "check":
        if (toCall > 0) return { ok: false, error: `You need to call ${toCall} or fold` };
        return { ok: true, move: { type } };
      case "call":
        if (toCall <= 0) return { ok: false, error: "Nothing to call — check instead" };
        return { ok: true, move: { type } };
      case "raise": {
        const to = (move as { to?: unknown }).to;
        if (typeof to !== "number" || !Number.isInteger(to)) {
          return { ok: false, error: "Invalid amount" };
        }
        // Having acted already means only a short all-in raised since: no re-raise.
        if (seat.acted) return { ok: false, error: "You can only call or fold" };
        const { min, max } = raiseBounds(state, seat);
        if (max <= state.currentBet) return { ok: false, error: "Not enough chips to raise" };
        if (to > max) return { ok: false, error: `You only have ${max}` };
        if (to < min) return { ok: false, error: `Minimum is ${min}` };
        return { ok: true, move: { type, to } };
      }
      default:
        return { ok: false, error: "Malformed move" };
    }
  },

  applyMove(prev, playerId, move) {
    const state = structuredClone(prev);
    if (move.type === "nextHand") {
      startHand(state);
      return state;
    }

    const i = state.toAct!;
    const seat = state.seats[i];
    switch (move.type) {
      case "fold":
        seat.folded = true;
        log(state, playerId, "folds");
        break;
      case "check":
        log(state, playerId, "checks");
        break;
      case "call": {
        const paid = pay(seat, state.currentBet - seat.bet);
        log(state, playerId, seat.allIn ? `calls ${paid} · all-in` : `calls ${paid}`);
        break;
      }
      case "raise": {
        const raiseBy = move.to - state.currentBet;
        const opening = state.currentBet === 0;
        pay(seat, move.to - seat.bet);
        if (raiseBy >= state.minRaise) {
          // A full raise reopens the betting for everyone else.
          state.minRaise = raiseBy;
          for (const other of state.seats) other.acted = false;
        }
        state.currentBet = move.to;
        const verb = opening ? "bets" : "raises to";
        log(state, playerId, `${verb} ${move.to}${seat.allIn ? " · all-in" : ""}`);
        break;
      }
    }
    seat.acted = true;
    advance(state, i);
    return state;
  },

  result(state) {
    if (state.phase !== "showdown") return { over: false };
    const left = state.seats.filter((s) => s.chips > 0);
    return left.length === 1 ? { over: true, winner: left[0].id } : { over: false };
  },

  playerView(state, playerId) {
    const reveal = (s: Seat) =>
      s.id === playerId ||
      (state.phase === "showdown" && !!state.lastResult && s.id in state.lastResult.shown);
    return {
      ...state,
      deck: [],
      seats: state.seats.map((s) => (reveal(s) ? s : { ...s, hole: s.hole.map(() => null) })),
    } satisfies PokerState;
  },
};

export default poker;
