import type { Rank } from "@app/shared";
import { CLAIM_RANKS, type BullshitState } from "./types.js";

/** Previous, same, next in the game's cyclic A … K ordering. */
export function getAllowedClaimRanks(previousRank: Rank): Rank[] {
  const index = CLAIM_RANKS.indexOf(previousRank);
  if (index < 0) throw new Error("Unknown previous rank");
  return [-1, 0, 1].map(offset => CLAIM_RANKS[(index + offset + CLAIM_RANKS.length) % CLAIM_RANKS.length]);
}

/** A cleared pile starts a new trick; historical reveal data does not constrain it. */
export function getMinimumPlayCount(state: Pick<BullshitState, "pile" | "lastPlay">): number {
  return state.pile.length && state.lastPlay ? state.lastPlay.cards.length : 1;
}
