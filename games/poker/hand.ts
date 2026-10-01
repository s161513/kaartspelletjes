import { RANK_VALUES, type Card } from "@app/shared";

// Poker hand evaluation: find the best 5-card hand out of 5–7 cards and
// compare hands. Pure functions, covered by poker.test.ts.

export interface HandValue {
  /** 0 = high card … 8 = straight flush. */
  category: number;
  /** Tie-breakers, most significant first (rank values, ace = 14). */
  ranks: number[];
  name: string;
}

const NAMES = [
  "High Card",
  "One Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
];

function hand(category: number, ranks: number[]): HandValue {
  const name = category === 8 && ranks[0] === 14 ? "Royal Flush" : NAMES[category];
  return { category, ranks, name };
}

/** Value of exactly five cards. */
export function evaluate5(cards: readonly Card[]): HandValue {
  const values = cards.map((c) => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);

  let straightHigh = 0;
  if (new Set(values).size === 5) {
    if (values[0] - values[4] === 4) straightHigh = values[0];
    else if (values[0] === 14 && values[1] === 5) straightHigh = 5; // A-2-3-4-5
  }

  // Group equal ranks: biggest group first, then highest rank.
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const byGroup = groups.map(([rank]) => rank);
  const [first, second] = groups.map(([, count]) => count);

  if (straightHigh && flush) return hand(8, [straightHigh]);
  if (first === 4) return hand(7, byGroup);
  if (first === 3 && second === 2) return hand(6, byGroup);
  if (flush) return hand(5, values);
  if (straightHigh) return hand(4, [straightHigh]);
  if (first === 3) return hand(3, byGroup);
  if (first === 2 && second === 2) return hand(2, byGroup);
  if (first === 2) return hand(1, byGroup);
  return hand(0, values);
}

/** Positive if `a` beats `b`, negative if `b` wins, 0 for a tie. */
export function compareHands(a: HandValue, b: HandValue): number {
  if (a.category !== b.category) return a.category - b.category;
  for (let i = 0; i < Math.max(a.ranks.length, b.ranks.length); i++) {
    const d = (a.ranks[i] ?? 0) - (b.ranks[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Best five-card hand out of 5–7 cards (e.g. two hole cards + the board). */
export function bestHand(cards: readonly Card[]): HandValue {
  let best: HandValue | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const value = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (!best || compareHands(value, best) > 0) best = value;
          }
  if (!best) throw new Error(`bestHand needs at least 5 cards, got ${n}`);
  return best;
}
