import { createDeck, shuffle, RANK_VALUES, type Card } from "@app/shared";
import type { PassDirection, Play } from "./types.js";

// Pure rule helpers for Hartenjagen (Hearts), covered by hartenjagen.test.ts.

export const GAME_END_SCORE = 100;
export const PASS_COUNT = 3;
export const MOON_POINTS = 26;
export const TWO_OF_CLUBS = "clubs-2#0";

/**
 * Cards taken out so everyone gets the same number. ♣2, the hearts and ♠Q
 * always stay in, so every round still starts with ♣2 and is worth 26 points.
 */
const REMOVED: Record<number, string[]> = {
  3: ["diamonds-2#0"],
  4: [],
  5: ["diamonds-2#0", "spades-2#0"],
  6: ["diamonds-2#0", "spades-2#0", "diamonds-3#0", "spades-3#0"],
};

export function deckFor(playerCount: number): Card[] {
  const removed = REMOVED[playerCount];
  if (!removed) throw new Error(`Hartenjagen needs 3–6 players, got ${playerCount}`);
  return createDeck().filter((c) => !removed.includes(c.id));
}

/** Shuffle and deal the whole deck evenly, one card at a time. */
export function dealHands(players: readonly string[], rng?: () => number): Record<string, Card[]> {
  const hands: Record<string, Card[]> = Object.fromEntries(players.map((id) => [id, []]));
  shuffle(deckFor(players.length), rng).forEach((card, i) => {
    hands[players[i % players.length]].push(card);
  });
  return hands;
}

/** Left → right → across → none (even tables) or left → right → none (odd). */
export function passDirection(round: number, playerCount: number): PassDirection {
  const cycle: PassDirection[] =
    playerCount % 2 === 0 ? ["left", "right", "across", "none"] : ["left", "right", "none"];
  return cycle[(round - 1) % cycle.length];
}

/** Seat index that seat `from` passes to. */
export function passTarget(from: number, direction: PassDirection, playerCount: number): number {
  const offset =
    direction === "left" ? 1 : direction === "right" ? -1 : direction === "across" ? playerCount / 2 : 0;
  return (((from + offset) % playerCount) + playerCount) % playerCount;
}

export const isHeart = (c: Card) => c.suit === "hearts";
export const isQueenOfSpades = (c: Card) => c.suit === "spades" && c.rank === "Q";
export const points = (c: Card) => (isHeart(c) ? 1 : isQueenOfSpades(c) ? 13 : 0);

/**
 * Cards from `hand` that may be played now.
 * - First trick: lead ♣2; no hearts or ♠Q when discarding, unless that's all you have.
 * - Follow the led suit if you can.
 * - Hearts may only be led once broken, unless you hold nothing else.
 */
export function legalPlays(
  hand: readonly Card[],
  trick: readonly Play[],
  firstTrick: boolean,
  heartsBroken: boolean,
): Card[] {
  if (trick.length === 0) {
    if (firstTrick) {
      const two = hand.find((c) => c.id === TWO_OF_CLUBS);
      return two ? [two] : [...hand];
    }
    if (heartsBroken) return [...hand];
    const nonHearts = hand.filter((c) => !isHeart(c));
    return nonHearts.length ? nonHearts : [...hand];
  }

  const lead = trick[0].card.suit;
  const following = hand.filter((c) => c.suit === lead);
  if (following.length) return following;
  if (firstTrick) {
    const safe = hand.filter((c) => points(c) === 0);
    if (safe.length) return safe;
  }
  return [...hand];
}

/** Highest card of the led suit wins the trick. */
export function trickWinner(trick: readonly Play[]): string {
  const lead = trick[0].card.suit;
  return trick
    .filter((p) => p.card.suit === lead)
    .reduce((best, p) => (RANK_VALUES[p.card.rank] > RANK_VALUES[best.card.rank] ? p : best))
    .playerId;
}

/** Round points; whoever took all 26 shoots the moon: 0 for them, +26 for everyone else. */
export function scoreRound(taken: Record<string, number>): {
  points: Record<string, number>;
  moon: string | null;
} {
  const moon = Object.keys(taken).find((id) => taken[id] === MOON_POINTS) ?? null;
  if (!moon) return { points: { ...taken }, moon: null };
  return {
    points: Object.fromEntries(Object.keys(taken).map((id) => [id, id === moon ? 0 : MOON_POINTS])),
    moon,
  };
}
