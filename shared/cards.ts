// Central card library: build decks, shuffle, and deal cards evenly across
// players. Pure functions (no I/O, no globals) so the server can deal
// authoritatively and the client can render from the same types.

export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank =
  | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10"
  | "J" | "Q" | "K" | "A";

export const SUITS: readonly Suit[] = ["clubs", "diamonds", "hearts", "spades"];
export const RANKS: readonly Rank[] = [
  "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A",
];

/**
 * Comparable value per rank (2 = 2 … Ace = 14, ace-high). Games with different
 * orderings (e.g. Presidenten where 2 is often highest) can remap as needed.
 */
export const RANK_VALUES: Record<Rank, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
  J: 11, Q: 12, K: 13, A: 14,
};

export interface Card {
  suit: Suit;
  rank: Rank;
  /** Which deck copy this card came from (0-based). */
  deck: number;
  /** Stable unique id — distinguishes identical cards from combined decks. */
  id: string;
}

const cardId = (suit: Suit, rank: Rank, deck: number): string =>
  `${suit}-${rank}#${deck}`;

/** The 52 cards of a single deck copy (identified by `deck`). */
export function createDeck(deck = 0): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ suit, rank, deck, id: cardId(suit, rank, deck) });
    }
  }
  return cards;
}

/** `n` standard decks combined, each with a distinct `deck` index (unique ids). */
export function createDecks(n: number): Card[] {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`createDecks: n must be a positive integer, got ${n}`);
  }
  const cards: Card[] = [];
  for (let d = 0; d < n; d++) cards.push(...createDeck(d));
  return cards;
}

/** Pure Fisher–Yates shuffle returning a new array. `rng` is injectable. */
export function shuffle<T>(arr: readonly T[], rng: () => number = Math.random): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface DealOptions {
  /** Force a specific number of decks (overrides auto scaling). */
  decks?: number;
  /** Auto-pick enough decks so every player gets at least this many. Default 1. */
  minCardsPerPlayer?: number;
  /** Injectable RNG for deterministic shuffling. */
  rng?: () => number;
}

export interface DealResult {
  /** `hands[i]` is player i's cards. */
  hands: Card[][];
  /** How many decks were combined. */
  deckCount: number;
  /** Total cards dealt (deckCount * 52). */
  totalCards: number;
}

/**
 * Shuffle and deal ALL cards evenly across `playerCount` players (round-robin,
 * so hands differ by at most one card). Auto-scales the number of decks:
 *
 *   deckCount = opts.decks ?? max(1, ceil(playerCount * minCardsPerPlayer / 52))
 *
 * e.g. deal(4) → 1 deck, 13 each. deal(52) → 1 deck, 1 each.
 *      deal(52, { minCardsPerPlayer: 5 }) → 5 decks, 5 each.
 */
export function deal(playerCount: number, opts: DealOptions = {}): DealResult {
  if (!Number.isInteger(playerCount) || playerCount < 1) {
    throw new Error(`deal: playerCount must be a positive integer, got ${playerCount}`);
  }
  const minPer = opts.minCardsPerPlayer ?? 1;
  const deckCount =
    opts.decks ?? Math.max(1, Math.ceil((playerCount * minPer) / 52));
  if (!Number.isInteger(deckCount) || deckCount < 1) {
    throw new Error(`deal: deckCount must be a positive integer, got ${deckCount}`);
  }

  const pile = shuffle(createDecks(deckCount), opts.rng);
  const hands: Card[][] = Array.from({ length: playerCount }, () => []);
  pile.forEach((card, i) => hands[i % playerCount].push(card));

  return { hands, deckCount, totalCards: pile.length };
}

/** Sort a hand by suit then rank value — handy for tidy rendering. */
export function sortHand(cards: readonly Card[]): Card[] {
  const suitOrder = (s: Suit) => SUITS.indexOf(s);
  return cards.slice().sort((a, b) => {
    const s = suitOrder(a.suit) - suitOrder(b.suit);
    if (s !== 0) return s;
    const r = RANK_VALUES[a.rank] - RANK_VALUES[b.rank];
    if (r !== 0) return r;
    return a.deck - b.deck;
  });
}
