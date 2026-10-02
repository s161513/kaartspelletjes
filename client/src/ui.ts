import type { GameMeta } from "@app/shared";
import { iconBadge } from "./icons.js";

// Small DOM helpers shared by the landing page, lobby and chat.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A small padlock icon for password-protected rooms (emoji fonts vary too much). */
export function lockIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "lock-icon");
  svg.setAttribute("aria-label", "Password protected");
  svg.innerHTML =
    '<rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/>' +
    '<path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.6"/>';
  return svg;
}

/** A stable hue (0–359) per name, so a player keeps the same colour everywhere. */
export function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

/** "2 players", "3–6 players" or "2+ players" for very large ranges. */
export function playerRange(meta: GameMeta): string {
  if (meta.minPlayers === meta.maxPlayers) return `${meta.minPlayers} players`;
  if (meta.maxPlayers >= 20) return `${meta.minPlayers}+ players`;
  return `${meta.minPlayers}–${meta.maxPlayers} players`;
}

/** A game tile: title, player range and description. The lobby adds a Start button. */
export function gameTile(meta: GameMeta): HTMLElement {
  const tile = el("article", "game-tile");
  const head = el("div", "game-tile-head");
  const titles = el("div", "game-tile-titles");
  titles.append(el("span", "game-tile-title", meta.title), el("span", "chip", playerRange(meta)));
  head.append(iconBadge(meta), titles);
  tile.append(head);
  if (meta.description) tile.append(el("p", "game-tile-desc", meta.description));
  return tile;
}
