import { randomInt } from 'node:crypto';
import type { DobbleCard as Card } from "./types.js";

/** Lines of PG(2,7): 49 affine points, 7 slope points, one vertical point. */
export function generateDeck(): Card[] {
  const q = 7;
  const cards: Card[] = [];
  for (let slope = 0; slope < q; slope++) {
    for (let intercept = 0; intercept < q; intercept++) {
      cards.push([...Array.from({ length: q }, (_, x) => x * q + (slope * x + intercept) % q), 49 + slope]);
    }
  }
  for (let x = 0; x < q; x++) cards.push([...Array.from({ length: q }, (_, y) => x * q + y), 56]);
  cards.push(Array.from({ length: 8 }, (_, i) => 49 + i));
  return cards;
}
export const DECK = generateDeck();
export function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

