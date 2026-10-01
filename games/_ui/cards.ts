import type { Card } from "@app/shared";
import "./cards.css";

// Shared playing-card rendering for game views (browser only). The card data
// (Card, createDeck, shuffle, …) lives in @app/shared; this is how a card looks.
// games/_ui is not a game: folders starting with `_` are skipped by the loader.

export const SUIT_SYMBOL: Record<Card["suit"], string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

export const isRed = (card: Card) => card.suit === "hearts" || card.suit === "diamonds";

export interface CardOptions {
  /** Play the deal-in animation. */
  isNew?: boolean;
  /** Extra classes, e.g. "is-playable". */
  className?: string;
}

function span(className: string, text: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  return node;
}

/** A face-up card, or its back when `card` is null. */
export function renderCard(card: Card | null, opts: CardOptions = {}): HTMLDivElement {
  const node = document.createElement("div");
  node.className = "ui-card";
  if (opts.className) node.className += ` ${opts.className}`;
  if (opts.isNew) node.classList.add("is-new");
  if (!card) {
    node.classList.add("is-back");
    return node;
  }
  const symbol = SUIT_SYMBOL[card.suit];
  if (isRed(card)) node.classList.add("is-red");
  node.dataset.cardId = card.id;
  node.setAttribute("aria-label", `${card.rank} of ${card.suit}`);
  const corner = span("ui-card-corner", "");
  corner.append(span("ui-card-rank", card.rank), span("ui-card-suit", symbol));
  node.append(corner, span("ui-card-pip", symbol));
  return node;
}

/** An empty dashed placeholder where a card will go. */
export function renderSlot(): HTMLDivElement {
  const node = document.createElement("div");
  node.className = "ui-card is-slot";
  return node;
}
