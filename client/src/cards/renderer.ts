import type { Card } from "@app/shared";
import "./style.css";

export interface CardRenderOptions { card?: Card; hidden?: boolean; selected?: boolean }
const symbols = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" };

/** Shared presentation only. Hidden cards need no card data at all. */
export function renderCard({ card, hidden = false, selected = false }: CardRenderOptions): HTMLElement {
  const element = document.createElement("span");
  element.className = "playing-card";
  if (hidden || !card) {
    element.classList.add("face-down");
    element.textContent = "♠";
    element.setAttribute("aria-label", "Face-down card");
    return element;
  }
  element.classList.toggle("selected", selected);
  element.classList.toggle("red-suit", card.suit === "hearts" || card.suit === "diamonds");
  const top = document.createElement("span");
  top.className = "card-corner";
  top.textContent = card.rank + symbols[card.suit];
  const center = document.createElement("span");
  center.className = "card-symbol";
  center.textContent = symbols[card.suit];
  const bottom = top.cloneNode(true) as HTMLElement;
  bottom.classList.add("bottom");
  element.append(top, center, bottom);
  return element;
}
