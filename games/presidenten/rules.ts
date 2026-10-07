import { RANK_VALUES, type Card, type Rank } from "@app/shared";
import type { ExchangePair, Role } from "./types.js";

// Four of the same effective rank — laid at once or accumulated across
// consecutive plays — burns the pile.
export const BURN_THRESHOLD = 4;

// How long each player has to act before the server auto-resolves their turn.
export const TURN_MS = 30_000;

// Deal enough decks that every player gets at least this many cards, so the
// game stays playable from 3 up to arbitrarily many players.
export const MIN_CARDS_PER_PLAYER = 5;

// The ranks a President may ask for, in Presidenten order (3 … A, then 2).
export const REQUEST_RANKS: readonly Rank[] = [
  "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2",
];

// Human labels for the standings carried between hands.
export const ROLE_LABEL: Record<Role, string> = {
  "president": "President",
  "vice-president": "Vice-President",
  "winner": "Winner",
  "citizen": "Citizen",
  "loser": "Loser",
  "vice-scum": "Vice-Scum",
  "scum": "Scum",
};

/**
 * How many winners (and as many losers) a field of `n` has: roughly a third,
 * but from 5 players on at least two, so there is always a Vice-President and
 * Vice-Scum (5 players: P VP · C · VS S).
 */
export function tierSize(n: number): number {
  const third = Math.floor(n / 3);
  return n >= 5 ? Math.max(2, third) : third;
}

/**
 * Assign standings from a full finishing order (index 0 = first out = President).
 * The top `tierSize(n)` are winners, the bottom `tierSize(n)` are losers,
 * everyone between is a citizen. The two extremes get the President/Scum
 * (and Vice-) titles.
 */
export function assignRoles(finished: readonly string[]): Record<string, Role> {
  const n = finished.length;
  const tier = tierSize(n);
  const roles: Record<string, Role> = {};
  finished.forEach((id, i) => {
    const fromBottom = n - i; // 1 = last place
    if (i < tier) {
      roles[id] = i === 0 ? "president" : i === 1 ? "vice-president" : "winner";
    } else if (fromBottom <= tier) {
      roles[id] = fromBottom === 1 ? "scum" : fromBottom === 2 ? "vice-scum" : "loser";
    } else {
      roles[id] = "citizen";
    }
  });
  return roles;
}

/**
 * Pair the i-th best winner with the i-th worst loser (President↔Scum first),
 * for `tierSize(n)` pairs. Citizens in the middle do not exchange.
 */
export function exchangePairs(finished: readonly string[]): ExchangePair[] {
  const n = finished.length;
  const tier = tierSize(n);
  const pairs: ExchangePair[] = [];
  for (let i = 0; i < tier; i++) {
    pairs.push({ winner: finished[i], loser: finished[n - 1 - i] });
  }
  return pairs;
}

// Reverse of RANK_VALUES, for labelling the rank-to-beat in the player view.
const VALUE_TO_RANK = new Map<number, Rank>(
  (Object.keys(RANK_VALUES) as Rank[]).map((rank) => [RANK_VALUES[rank], rank]),
);

export const rankLabel = (value: number): string => VALUE_TO_RANK.get(value) ?? "?";

/** Presidenten ordering: 3 (low) … A, then the wild 2 highest of all. */
export const orderValue = (rank: Rank): number => (rank === "2" ? 15 : RANK_VALUES[rank]);

/** Sort a hand for display in Presidenten order (3 … A, 2 last), then by suit. */
export function sortForDisplay(cards: readonly Card[]): Card[] {
  return cards
    .slice()
    .sort(
      (a, b) =>
        orderValue(a.rank) - orderValue(b.rank) ||
        a.suit.localeCompare(b.suit) ||
        a.deck - b.deck,
    );
}

export interface GroupRank {
  rank: Rank; // the base (copied) rank, 3..A — never "2"
  value: number; // RANK_VALUES[rank]
}

/**
 * The effective rank of a played group. A 2 is a wild joker: it must be played
 * grouped with at least one non-2 card and copies that card's rank. All non-2
 * cards must share a single rank; a group made of only 2s is illegal.
 */
export function effectiveRank(
  cards: readonly Card[],
): { ok: true; group: GroupRank } | { ok: false; error: string } {
  if (cards.length === 0) return { ok: false, error: "Select at least one card" };
  const base = cards.filter((c) => c.rank !== "2");
  if (base.length === 0) {
    return { ok: false, error: "A 2 is wild — play it together with another card" };
  }
  const rank = base[0].rank;
  if (!base.every((c) => c.rank === rank)) {
    return { ok: false, error: "All non-2 cards must be the same rank" };
  }
  return { ok: true, group: { rank, value: RANK_VALUES[rank] } };
}

/**
 * Fold a freshly played group into the running same-rank tally used for the
 * burn rule. `playCount` is the number of **natural (non-2)** cards of the rank
 * in this play — wild 2s copy the rank but never count toward a burn. The run
 * continues while the effective rank stays equal and resets when a higher rank
 * is played; `burned` is true once it reaches the threshold.
 */
export function advanceRun(
  prevValue: number | null,
  prevCount: number,
  playValue: number,
  playCount: number,
): { runValue: number; runCount: number; burned: boolean } {
  const runCount = prevValue === playValue ? prevCount + playCount : playCount;
  return { runValue: playValue, runCount, burned: runCount >= BURN_THRESHOLD };
}

/**
 * Can `hand` legally follow the table at effective rank value `minValue` or
 * higher, playing **at least** `minCount` cards (more is allowed, never fewer)?
 * A group may use 2s as wild fillers but needs at least one non-2 to set the
 * rank. Used to auto-skip a stuck follower and to warn in the UI.
 */
export function hasLegalFollow(
  hand: readonly Card[],
  minCount: number,
  minValue: number,
): boolean {
  const twos = hand.filter((c) => c.rank === "2").length;
  const byValue = new Map<number, number>();
  for (const c of hand) {
    if (c.rank === "2") continue;
    const value = RANK_VALUES[c.rank];
    byValue.set(value, (byValue.get(value) ?? 0) + 1);
  }
  for (const [value, n] of byValue) {
    if (value < minValue) continue; // must meet or beat the rank
    if (n + twos < minCount) continue; // not enough cards to reach the minimum
    return true;
  }
  return false;
}
