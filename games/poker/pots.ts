// Split everything bet in a hand into a main pot and side pots.

export interface Contribution {
  id: string;
  /** Total chips this player put in during the hand. */
  amount: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Players who can win this pot (did not fold and put in enough). */
  eligible: string[];
}

/**
 * Layer the pot by contribution level. Every distinct amount a player put in
 * starts a new layer; a player is eligible for a layer only if they did not
 * fold and reached that level. Folded chips stay in the pot. A layer only one
 * player reached (an uncalled bet) becomes a pot they win back.
 */
export function buildPots(contributions: readonly Contribution[]): Pot[] {
  const levels = [...new Set(contributions.map((c) => c.amount))]
    .filter((a) => a > 0)
    .sort((a, b) => a - b);

  const pots: Pot[] = [];
  let previous = 0;
  let carry = 0; // chips from a bottom layer nobody is eligible for
  for (const level of levels) {
    let amount = carry;
    carry = 0;
    for (const c of contributions) {
      amount += Math.max(0, Math.min(c.amount, level) - previous);
    }
    const eligible = contributions
      .filter((c) => !c.folded && c.amount >= level)
      .map((c) => c.id);
    previous = level;

    const last = pots[pots.length - 1];
    if (last && (eligible.length === 0 || sameIds(last.eligible, eligible))) {
      last.amount += amount; // same players (or nobody new): merge layers
    } else if (eligible.length === 0) {
      carry = amount;
    } else {
      pots.push({ amount, eligible });
    }
  }
  return pots.filter((p) => p.amount > 0);
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
