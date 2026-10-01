import type { GameMeta, GamePage } from "@app/shared";

// Vite expands these globs at build time into every matching file, so a new
// games/<id>/ folder shows up without registering it anywhere. Folders starting
// with `_` (like _template) are skipped.
const metas = import.meta.glob<{ default: GameMeta }>(
  ["../../games/*/meta.ts", "!../../games/_*/meta.ts"],
  { eager: true },
);
const views = import.meta.glob<{ default: GamePage }>([
  "../../games/*/view.ts",
  "!../../games/_*/view.ts",
]);

export const GAME_LIST: GameMeta[] = Object.values(metas).map((m) => m.default);

export function getMeta(id: string): GameMeta | undefined {
  return metas[`../../games/${id}/meta.ts`]?.default;
}

/** Lazily load a game's view module (code-split per game). */
export function loadView(id: string): Promise<{ default: GamePage }> | undefined {
  return views[`../../games/${id}/view.ts`]?.();
}
