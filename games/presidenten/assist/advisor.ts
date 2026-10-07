// Move advisor: which cards should you play? A small, explainable heuristic
// player. It only uses what the player can see themselves (own hand + the
// table), so it can run in the browser without leaking anything.
//
// 1. Generate every *sensible* legal play: for each rank that meets the table,
//    every group size from the minimum up to "all of them", natural cards
//    first and wild 2s only as fillers.
// 2. Give each play a cost (lower = better) from a few rules of thumb:
//      - play your lowest cards first          (cost grows with the rank)
//      - keep pairs/triples together           (penalty for breaking a group)
//      - save wild 2s for the end              (penalty per 2 used)
//      - don't overpay when following          (penalty per extra card)
//      - get out when you can                  (big bonus for emptying the hand)
// 3. Passing (when following) has a high fixed cost: in this variant a pass
//    keeps you out of the whole trick, so it only wins when every play would
//    waste several strong cards.
// The cheapest option is the advice; the rule that dominated its cost becomes
// the explanation shown at help level 2.

import { RANK_VALUES, type Card, type Rank } from "@app/shared";
import { orderValue, REQUEST_RANKS } from "../rules.js";

export const OPENER_ID = "clubs-3#0";

/** What the advisor needs to know: exactly what the player can see. */
export interface AdvisorInput {
  hand: readonly Card[];
  currentCount: number | null; // null = you lead a fresh trick
  currentRankValue: number | null; // rank value to meet or beat (RANK_VALUES)
}

export type Advice =
  | { kind: "play"; cardIds: string[]; cost: number; reason: string }
  | { kind: "pass"; cost: number; reason: string };

// Tuning knobs. Costs are in "rank steps": playing a 4 instead of a 3 costs 1.
export interface AdvisorWeights {
  perTwo: number; // a wild 2 is worth about this many ranks
  breakGroup: number; // splitting a pair/triple
  extraCard: number; // each card beyond what the table requires
  pass: number; // passing is fine unless beating the table is cheap
  passAlmostOut: number; // …but not when you could get out soon
  goOut: number; // bonus: playing your last cards finishes the round for you
}
// Tuned with the simulation (4 players, 500–1000 hands per setting). The big
// lesson: passing is expensive in this variant — a pass keeps you out of the
// whole trick — so the advisor almost always prefers to shed a card. With the
// first guess (pass = 7) it won *less* often than a random player (14% vs 23%);
// with these weights it wins ~90% against random players and ~26% against
// copies of itself (25% is par at a table of four).
export const DEFAULT_WEIGHTS: AdvisorWeights = {
  perTwo: 2, breakGroup: 3, extraCard: 1, pass: 24, passAlmostOut: 30, goOut: 30,
};
const ALMOST_OUT = 3; // hand size at which we stop saving cards

/** The ♣3 holder must open the hand with a group that includes the ♣3. */
export const mustOpen = (input: AdvisorInput): boolean =>
  input.currentCount === null && input.hand.some((c) => c.id === OPENER_ID);

const rankName = (rank: Rank): string => (rank === "A" ? "aces" : `${rank}s`);

/** Every sensible legal play, cheapest first, plus "pass" when that is allowed. */
export function advise(input: AdvisorInput, w: AdvisorWeights = DEFAULT_WEIGHTS): Advice[] {
  const { hand, currentCount, currentRankValue } = input;
  const leading = currentCount === null;
  const minCount = currentCount ?? 1;
  const minValue = currentRankValue ?? 0;
  const opening = mustOpen(input);
  const almostOut = hand.length <= ALMOST_OUT;

  const twos = hand.filter((c) => c.rank === "2");
  const byRank = new Map<Rank, Card[]>();
  for (const c of hand) {
    if (c.rank === "2") continue;
    (byRank.get(c.rank) ?? byRank.set(c.rank, []).get(c.rank)!).push(c);
  }

  const options: Advice[] = [];
  for (const [rank, cards] of byRank) {
    const value = RANK_VALUES[rank];
    if (value < minValue) continue; // too low for the table
    if (opening && rank !== "3") continue; // must open with the ♣3 group
    // Put the ♣3 first so a 1-card opening uses it.
    const naturals = [...cards].sort((a, b) => Number(b.id === OPENER_ID) - Number(a.id === OPENER_ID));

    for (let size = minCount; size <= naturals.length + twos.length; size++) {
      const useNaturals = Math.min(size, naturals.length);
      const useTwos = size - useNaturals;
      const picked = [...naturals.slice(0, useNaturals), ...twos.slice(0, useTwos)];
      const leftAfter = hand.length - size;
      const brokeGroup = useNaturals < naturals.length;
      const extra = leading ? 0 : size - minCount;

      // Each rule adds a cost; we remember which one weighed most for the reason.
      const parts: { cost: number; reason: string }[] = [
        { cost: orderValue(rank) - 3, reason: leading
          ? `Lead with your lowest ${size > 1 ? "set" : "card"} — get rid of weak cards first`
          : "The cheapest cards that beat the table" },
        { cost: almostOut ? 0 : useTwos * w.perTwo,
          reason: "Uses a wild 2 — only worth it to get out" },
        { cost: brokeGroup && !almostOut ? w.breakGroup : 0,
          reason: `Splits your ${rankName(rank)}` },
        { cost: extra * w.extraCard, reason: "Plays more cards than needed" },
      ];
      let cost = parts.reduce((sum, p) => sum + p.cost, 0);
      let reason = parts[0].reason;
      if (!leading && !brokeGroup && naturals.length > 1 && useTwos === 0) {
        reason = `Beats the table and keeps your ${rankName(rank)} together`;
      }
      if (useTwos > 0 && !almostOut) reason = parts[1].reason;
      if (leftAfter === 0) {
        cost -= w.goOut;
        reason = "Play out your last cards and finish";
      } else if (almostOut && leftAfter <= 1) {
        reason = "Almost out — keep the pressure on";
      }
      options.push({ kind: "play", cardIds: picked.map((c) => c.id), cost, reason });
    }
  }

  if (leading && options.length === 0) {
    // Only wild 2s left: they can't be led on their own, so the lead passes on.
    options.push({ kind: "pass", cost: 0, reason: "Only wild 2s left — you can't lead them, pass" });
  } else if (!leading) {
    options.push({
      kind: "pass",
      cost: almostOut ? w.passAlmostOut : w.pass,
      reason: options.length
        ? "Pass — beating this would cost your strong cards"
        : "You cannot beat this — pass",
    });
  }

  // Stable sort: cheapest first; on ties, fewer cards first.
  return options.sort((a, b) =>
    a.cost - b.cost
    || (a.kind === "play" ? a.cardIds.length : 0) - (b.kind === "play" ? b.cardIds.length : 0));
}

/** Exchange: as a winner, ask for the strongest rank you don't hold yet. */
export function adviseRequest(hand: readonly Card[], missed: readonly Rank[]): Rank {
  const held = new Set(hand.map((c) => c.rank));
  const strongestFirst = [...REQUEST_RANKS].reverse();
  return strongestFirst.find((r) => !held.has(r) && !missed.includes(r))
    ?? strongestFirst.find((r) => !missed.includes(r))
    ?? "2";
}

/** Exchange: give back your weakest card, preferring one that isn't part of a pair. */
export function adviseGiveBack(hand: readonly Card[]): string | null {
  const counts = new Map<Rank, number>();
  for (const c of hand) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const weakestFirst = [...hand]
    .filter((c) => c.rank !== "2")
    .sort((a, b) => orderValue(a.rank) - orderValue(b.rank));
  const single = weakestFirst.find((c) => counts.get(c.rank) === 1);
  return (single ?? weakestFirst[0] ?? hand[0])?.id ?? null;
}

// Card ids look like "hearts-7#0"; the rank sits between the dash and the hash.
const rankOfId = (id: string): string => id.slice(id.indexOf("-") + 1, id.lastIndexOf("#"));
const rankKey = (ids: readonly string[]): string => ids.map(rankOfId).sort().join();

/**
 * Did the player make the advised move? Suits don't matter: playing the 7♥
 * instead of the advised 7♠ still counts as following the hint.
 */
export function followsAdvice(best: Advice, move: { type: string; cardIds?: string[] }): boolean {
  if (best.kind === "pass") return move.type === "pass";
  if (move.type !== "play" || !move.cardIds) return false;
  return rankKey(best.cardIds) === rankKey(move.cardIds);
}

/** What the UI should show for a given help level. */
export interface Hint {
  best: Advice; // the move to highlight
  reason: string | null; // one-line explanation, level 2 only
}

/**
 * Level 1 highlights the best move, level 2 adds the explanation.
 * Level 0 (or no options) → no hint.
 */
export function hintFor(level: number, options: readonly Advice[]): Hint | null {
  if (level <= 0 || options.length === 0) return null;
  return { best: options[0], reason: level >= 2 ? options[0].reason : null };
}
