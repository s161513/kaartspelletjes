import { SYMBOLS } from "./symbols.js";

// Same deterministic layout as the standalone React Card, adapted to DOM.
function noise(seed: string): number {
  let n = 2166136261;
  for (const char of seed) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return (n >>> 0) / 4294967296;
}
export function renderCard(symbols: number[], seed: string, select?: (id: number) => void): HTMLDivElement {
  const card = document.createElement("div");
  card.className = `dobble-card${select ? " personal" : ""}`;
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", select ? "Jouw kaart" : "Centrale kaart");
  const offset = noise(seed) * Math.PI * 2;
  for (const [i, id] of symbols.entries()) {
    const angle = offset + (i - 1) * Math.PI * 2 / 7;
    const radius = 31.5 + noise(seed + i) * 1.5;
    const symbol = document.createElement(select ? "button" : "span");
    symbol.className = "symbol";
    symbol.dataset.symbolId = String(id);
    symbol.style.left = `${i === 0 ? 50 : 50 + Math.cos(angle) * radius}%`;
    symbol.style.top = `${i === 0 ? 50 : 50 + Math.sin(angle) * radius}%`;
    symbol.style.setProperty("--rotation", `${(noise(seed + id + "r") - .5) * 48}deg`);
    symbol.style.setProperty("--size", `${10.5 + noise(seed + id + "s") * 4}cqw`);
    symbol.setAttribute("aria-label", SYMBOLS[id][1]);
    symbol.textContent = SYMBOLS[id][0];
    if (symbol instanceof HTMLButtonElement) {
      symbol.type = "button";
      symbol.addEventListener("click", () => select?.(id));
    } else symbol.setAttribute("role", "img");
    card.appendChild(symbol);
  }
  return card;
}
