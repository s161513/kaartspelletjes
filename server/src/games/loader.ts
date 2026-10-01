import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Game, GameMeta } from "@app/shared";

export interface GameEntry {
  meta: GameMeta;
  logic: Game;
}

/** All discovered games, keyed by id. Filled by `loadGames()` at startup. */
export const games = new Map<string, GameEntry>();

// In dev (tsx) we load the .ts sources; in production the compiled games/dist.
const isDev = import.meta.url.endsWith(".ts");
const here = path.dirname(fileURLToPath(import.meta.url));
const gamesDir = path.resolve(here, "../../../games", isDev ? "" : "dist");
const ext = isDev ? ".ts" : ".js";

/**
 * Discover every game folder under games/ (skipping `_template` and other
 * `_`-prefixed folders) and import its meta + logic. Adding a game therefore
 * needs no registration anywhere — just a new folder.
 */
export async function loadGames(): Promise<void> {
  for (const dir of await readdir(gamesDir, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith("_")) continue;
    if (dir.name === "dist" || dir.name === "node_modules") continue;

    const load = (file: string) =>
      import(pathToFileURL(path.join(gamesDir, dir.name, file + ext)).href);
    const meta: GameMeta = (await load("meta")).default;
    const logic: Game = (await load("logic")).default;

    if (meta.id !== dir.name) {
      throw new Error(`games/${dir.name}: meta.id "${meta.id}" must equal the folder name`);
    }
    games.set(meta.id, { meta, logic });
  }
  console.log(`Loaded games: ${[...games.keys()].join(", ") || "(none)"}`);
}
