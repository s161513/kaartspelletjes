import type { GameMeta } from "@app/shared";

// Game icons for the lobby, room list and game header. A game can set its own
// `icon` in meta.ts (inline SVG or an emoji); otherwise the framework's built-in
// icon for that id is used, and finally a generic playing card. Icons draw in
// `currentColor` plus `--ic-accent`, so the badge decides the colours.

interface BuiltIn {
  svg: string;
  /** Badge colour (any CSS colour). */
  color: string;
}

const svg = (body: string) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const BUILT_IN: Record<string, BuiltIn> = {
  presidenten: {
    color: "#c9962e",
    svg: svg(
      `<path d="M9 34 7 15l9.5 8L24 10l7.5 13L41 15l-2 19Z" fill="var(--ic-accent)"/>` +
      `<path d="M9 39h30"/><circle cx="24" cy="26" r="2.6" fill="currentColor" stroke="none"/>`,
    ),
  },
  poker: {
    color: "#b8372a",
    svg: svg(
      `<circle cx="24" cy="24" r="16" fill="var(--ic-accent)"/><circle cx="24" cy="24" r="9"/>` +
      `<path d="M24 8v6M24 34v6M8 24h6M34 24h6M12.7 12.7l4.2 4.2M31.1 31.1l4.2 4.2M35.3 12.7l-4.2 4.2M16.9 31.1l-4.2 4.2"/>`,
    ),
  },
  hartenjagen: {
    color: "#c2412d",
    svg: svg(
      `<path d="M24 39C11 30.5 7.5 23.5 10.5 17c3-6.3 10.3-6.6 13.5-.8 3.2-5.8 10.5-5.5 13.5.8C40.5 23.5 37 30.5 24 39Z" fill="var(--ic-accent)"/>` +
      `<path d="M8 40 40 8M34 8h6v6"/>`,
    ),
  },
  bullshit: {
    color: "#7a4fb3",
    svg: svg(
      `<rect x="8" y="12" width="20" height="28" rx="3" transform="rotate(-12 18 26)" fill="var(--ic-accent)"/>` +
      `<rect x="20" y="8" width="20" height="28" rx="3" transform="rotate(8 30 22)" fill="#fff"/>` +
      `<path d="M27 18.5a3.5 3.5 0 1 1 4.6 3.3c-1 .4-1.6 1.3-1.6 2.4v.8"/><circle cx="29.6" cy="29.5" r="1.3" fill="currentColor" stroke="none"/>`,
    ),
  },
  dobble: {
    color: "#e0792b",
    svg: svg(
      `<circle cx="24" cy="24" r="17" fill="var(--ic-accent)"/>` +
      `<path d="m17 12.5 1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5Z" fill="currentColor" stroke="none"/>` +
      `<circle cx="31" cy="17" r="3.2"/><path d="m26 34 4-7 4 7Z"/><path d="M14 28.5c2-2.5 5-2.5 7 0"/>`,
    ),
  },
  liegen: {
    color: "#2f7d8c",
    svg: svg(
      `<rect x="6" y="16" width="20" height="20" rx="4" transform="rotate(-10 16 26)" fill="var(--ic-accent)"/>` +
      `<rect x="23" y="10" width="19" height="19" rx="4" transform="rotate(12 32.5 19.5)" fill="#fff"/>` +
      `<g fill="currentColor" stroke="none"><circle cx="11.5" cy="22" r="1.7"/><circle cx="16" cy="26" r="1.7"/><circle cx="20.5" cy="30" r="1.7"/>` +
      `<circle cx="29" cy="16" r="1.6"/><circle cx="36" cy="23" r="1.6"/></g>`,
    ),
  },
  tictactoe: {
    color: "#3b6fb6",
    svg: svg(
      `<path d="M18 8v32M30 8v32M8 18h32M8 30h32" stroke-width="2"/>` +
      `<path d="m10.5 10.5 5 5M15.5 10.5l-5 5M32.5 32.5l5 5M37.5 32.5l-5 5" stroke-width="2.6"/>` +
      `<circle cx="24" cy="24" r="3.2" stroke-width="2.6"/>`,
    ),
  },
};

/** A face-down card: the fallback for games without an icon. */
const FALLBACK: BuiltIn = {
  color: "#1f6b45",
  svg: svg(
    `<rect x="12" y="7" width="24" height="34" rx="3.5" fill="var(--ic-accent)"/>` +
    `<rect x="16" y="11" width="16" height="26" rx="2"/><path d="m24 17 4 7-4 7-4-7Z" fill="currentColor" stroke="none"/>`,
  ),
};

/** An empty table: shown for rooms that are still waiting in their lobby. */
export const WAITING_ICON: BuiltIn = {
  color: "#8a8173",
  svg: svg(
    `<ellipse cx="24" cy="25" rx="17" ry="11" fill="var(--ic-accent)"/>` +
    `<circle cx="24" cy="9" r="2.5" fill="currentColor" stroke="none"/><circle cx="5" cy="25" r="2.5" fill="currentColor" stroke="none"/>` +
    `<circle cx="43" cy="25" r="2.5" fill="currentColor" stroke="none"/><circle cx="24" cy="41" r="2.5" fill="currentColor" stroke="none"/>`,
  ),
};

/** A coloured badge holding the game's icon. `size` is the badge edge in px. */
export function iconBadge(meta: Pick<GameMeta, "id" | "icon"> | null, size = 44): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "game-icon";
  badge.style.setProperty("--size", `${size}px`);
  const custom = meta?.icon?.trim();
  if (custom && !custom.startsWith("<")) {
    // An emoji or short text icon.
    badge.classList.add("is-emoji");
    badge.textContent = custom;
    badge.style.setProperty("--ic-color", BUILT_IN[meta!.id]?.color ?? FALLBACK.color);
    return badge;
  }
  const builtIn = meta ? BUILT_IN[meta.id] ?? FALLBACK : WAITING_ICON;
  badge.style.setProperty("--ic-color", builtIn.color);
  badge.innerHTML = custom ?? builtIn.svg;
  return badge;
}
