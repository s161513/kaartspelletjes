// The world map of "67 Beschaving": terrain from a fixed seed (the same for
// everyone, forever), resource spots that appear per era, and where new
// buildings may go. Pure and deterministic, shared by server and browser.

import {
  DEPOSIT_CLICKS,
  DEPOSIT_REGROW_MS,
  PATCH_CLICKS,
  PATCH_MAX_TILES,
  REGROW_MS,
  SOURCE_RANGE,
  STREET_RANGE,
  VILLAGE_RANGE,
  buildingType,
  type ResourceId,
} from "./idleContent.js";

export const MAP_SIZE = 80;
export const CENTER: { readonly x: number; readonly y: number } = { x: 42, y: 42 };

export type Terrain = "grass" | "water" | "bridge" | "forest" | "rock" | "mountain" | "sand" | "bush" | "deposit";

export interface Deposit {
  resource: ResourceId;
  name: string;
  era: number;
  x: number;
  y: number;
}

/** Special resource spots; each shows up when its era unlocks. */
export const DEPOSITS: readonly Deposit[] = [
  { resource: "bronze", name: "Koperader", era: 1, x: 34, y: 20 },
  { resource: "iron", name: "IJzererts", era: 2, x: 47, y: 21 },
  { resource: "gold", name: "Goudader", era: 3, x: 68, y: 18 },
  { resource: "wool", name: "Schapenweide", era: 4, x: 24, y: 54 },
  { resource: "knowledge", name: "Orakelsteen", era: 5, x: 30, y: 34 },
  { resource: "coal", name: "Kolenlaag", era: 6, x: 26, y: 16 },
  { resource: "oil", name: "Olieveld", era: 7, x: 68, y: 66 },
  { resource: "data", name: "Glasvezelknoop", era: 8, x: 44, y: 64 },
  { resource: "titanium", name: "Meteorietkrater", era: 9, x: 14, y: 24 },
  { resource: "antimatter", name: "Wormgat", era: 10, x: 70, y: 42 },
];

// ---------- noise ----------

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
function noise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const sx = (fx - x0) ** 2 * (3 - 2 * (fx - x0));
  const sy = (fy - y0) ** 2 * (3 - 2 * (fy - y0));
  const a = hash(x0, y0, seed);
  const b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed);
  const d = hash(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** x of the river's west bank at row y. */
export function riverX(y: number): number {
  return 54 + Math.round(4 * Math.sin(y / 9) + 2 * Math.sin(y / 4.3 + 1));
}

function generate(x: number, y: number): Terrain {
  if (x < 2 || y < 2 || x >= MAP_SIZE - 2 || y >= MAP_SIZE - 2) return "water";
  const deposit = DEPOSITS.find((d) => d.x === x && d.y === y);
  if (deposit) return "deposit";
  const nearDeposit = DEPOSITS.some((d) => Math.abs(d.x - x) <= 1 && Math.abs(d.y - y) <= 1);

  const rx = riverX(y);
  if (x === rx || x === rx + 1) return y % 12 === 4 ? "bridge" : "water";
  if (Math.hypot(x - CENTER.x, y - CENTER.y) < 7) return "grass";

  const n = noise(x, y, 6, 1);
  const mountainDist = Math.hypot(x - 40, y - 6);
  if (!nearDeposit && mountainDist < 9 + n * 4) return "mountain";
  if (mountainDist < 13 + n * 4 || noise(x, y, 3, 2) > 0.86) return "rock";
  if (nearDeposit) return "grass";
  const f = noise(x, y, 5, 3);
  if ((x < 30 + n * 6 && f > 0.35) || f > 0.8) return "forest";
  if (x > 60 && y > 56 + n * 6) return "sand";
  return hash(x, y, 4) > 0.93 ? "bush" : "grass";
}

let cache: Terrain[] | null = null;

export function terrainAt(x: number, y: number): Terrain {
  if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return "water";
  cache ??= Array.from({ length: MAP_SIZE * MAP_SIZE }, (_, i) => generate(i % MAP_SIZE, Math.floor(i / MAP_SIZE)));
  return cache[y * MAP_SIZE + x];
}

export const depositAt = (x: number, y: number): Deposit | undefined => DEPOSITS.find((d) => d.x === x && d.y === y);

/**
 * What clicking this tile gathers, if anything: a deposit only once its era is
 * unlocked, nothing where the patch's `used` clicks have used this tile up.
 */
export function natureAt(x: number, y: number, era: number, used: Readonly<Record<string, number>> = {}): ResourceId | null {
  if (isUsedUp(x, y, used)) return null;
  switch (terrainAt(x, y)) {
    case "forest":
      return "wood";
    case "rock":
      return "stone";
    case "bush":
      return "food";
    case "deposit": {
      const d = depositAt(x, y)!;
      return d.era <= era ? d.resource : null;
    }
    default:
      return null;
  }
}

// ---------- nature patches ----------

/** A group of the same nature (forest, rocks, a bush, a vein) sharing one supply. */
export interface Patch {
  id: number;
  resource: ResourceId;
  /** Edge first: the order in which tiles disappear as the patch is used up. */
  tiles: readonly { x: number; y: number }[];
  /** Clicks it holds when full. */
  capacity: number;
  /** Clicks it regrows per ms. */
  regrow: number;
}

const NATURE_RESOURCE: Partial<Record<Terrain, ResourceId>> = { forest: "wood", rock: "stone", bush: "food" };

let patchList: Patch[] | null = null;
let patchByTile: Int32Array | null = null;

/** Split the map into patches once: flood fill, row by row, at most PATCH_MAX_TILES each. */
function buildPatches(): void {
  patchList = [];
  patchByTile = new Int32Array(MAP_SIZE * MAP_SIZE).fill(-1);
  // Tiles cut off by the size limit may lie in rows already scanned: scan again until all are in a patch.
  for (let found = true; found; ) {
    found = false;
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        const kind = terrainAt(x, y);
        if (patchByTile[y * MAP_SIZE + x] >= 0 || (!NATURE_RESOURCE[kind] && kind !== "deposit")) continue;
        found = true;
        const id = patchList.length;
        const tiles: { x: number; y: number }[] = [];
        const queue = [{ x, y }];
        patchByTile[y * MAP_SIZE + x] = id;
        while (queue.length && tiles.length < (kind === "deposit" ? 1 : PATCH_MAX_TILES)) {
          const t = queue.shift()!;
          tiles.push(t);
          for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
            const nx = t.x + dx;
            const ny = t.y + dy;
            if (nx < 0 || ny < 0 || nx >= MAP_SIZE || ny >= MAP_SIZE || patchByTile[ny * MAP_SIZE + nx] >= 0) continue;
            if (terrainAt(nx, ny) !== kind || kind === "deposit") continue;
            patchByTile[ny * MAP_SIZE + nx] = id;
            queue.push({ x: nx, y: ny });
          }
        }
        // Tiles queued but past the size limit start a patch of their own later.
        for (const t of queue) patchByTile[t.y * MAP_SIZE + t.x] = -1;
        const cx = tiles.reduce((a, t) => a + t.x, 0) / tiles.length;
        const cy = tiles.reduce((a, t) => a + t.y, 0) / tiles.length;
        tiles.sort((a, b) => Math.hypot(b.x - cx, b.y - cy) - Math.hypot(a.x - cx, a.y - cy) || a.y - b.y || a.x - b.x);
        const deposit = kind === "deposit" ? depositAt(x, y)! : null;
        const resource = deposit ? deposit.resource : NATURE_RESOURCE[kind]!;
        const capacity = deposit ? DEPOSIT_CLICKS : PATCH_CLICKS[resource] * tiles.length;
        patchList.push({ id, resource, tiles, capacity, regrow: capacity / (deposit ? DEPOSIT_REGROW_MS : REGROW_MS[resource]) });
      }
    }
  }
}

export function patches(): readonly Patch[] {
  if (!patchList) buildPatches();
  return patchList!;
}

export function patchAt(x: number, y: number): Patch | undefined {
  if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return undefined;
  if (!patchByTile) buildPatches();
  const id = patchByTile![y * MAP_SIZE + x];
  return id >= 0 ? patchList![id] : undefined;
}

/** How many of a patch's tiles are gone, given the clicks used. */
export const goneTiles = (p: Patch, used: number): number => Math.min(p.tiles.length, Math.floor((used / p.capacity) * p.tiles.length));

/** True if this tile's nature has been used up (a stump, rubble, an empty bush). */
export function isUsedUp(x: number, y: number, used: Readonly<Record<string, number>>): boolean {
  const p = patchAt(x, y);
  if (!p) return false;
  const gone = goneTiles(p, used[p.id] ?? 0);
  for (let i = 0; i < gone; i++) if (p.tiles[i].x === x && p.tiles[i].y === y) return true;
  return false;
}

export const isWalkable =(t: Terrain): boolean => t !== "water" && t !== "mountain";
export const isRoadTile = (x: number, y: number): boolean => x % 4 === 0 || y % 4 === 0;

function buildable(x: number, y: number): boolean {
  const t = terrainAt(x, y);
  return (t === "grass" || t === "sand") && !isRoadTile(x, y);
}

/** Nearest tile of a kind to the center, so work buildings start close to town. */
function nearestTerrain(kind: Terrain): { x: number; y: number } {
  let best = { x: CENTER.x, y: CENTER.y };
  let bestD = Infinity;
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      if (terrainAt(x, y) !== kind) continue;
      const d = Math.hypot(x - CENTER.x, y - CENTER.y);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

let anchors: Record<string, { x: number; y: number }> | null = null;

/** Where a type of building likes to stand. */
export function anchorOf(typeId: string): { x: number; y: number } {
  anchors ??= {
    food: { x: CENTER.x + 5, y: CENTER.y + 5 },
    wood: nearestTerrain("forest"),
    stone: nearestTerrain("rock"),
  };
  if (anchors[typeId]) return anchors[typeId];
  const produces = buildingType(typeId)?.produces;
  const deposit = typeId.startsWith("mine_") ? DEPOSITS.find((d) => d.resource === produces) : undefined;
  return deposit ? { x: deposit.x, y: deposit.y } : CENTER;
}

const near = (x: number, y: number, r: number, ok: (x: number, y: number) => boolean): boolean => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (ok(x + dx, y + dy)) return true;
  return false;
};

/** What a work building must stand next to, if anything, and how to say so. */
function sourceOf(typeId: string): { ok: (x: number, y: number) => boolean; hint: string } | null {
  if (typeId === "wood") return { ok: (x, y) => terrainAt(x, y) === "forest", hint: "moet vlak bij het bos staan" };
  if (typeId === "stone") {
    return { ok: (x, y) => ["rock", "mountain"].includes(terrainAt(x, y)), hint: "moet vlak bij rotsen staan" };
  }
  if (typeId.startsWith("mine_")) {
    const d = DEPOSITS.find((p) => p.resource === buildingType(typeId)?.produces);
    if (d) return { ok: (x, y) => x === d.x && y === d.y, hint: `moet bij de ${d.name} staan` };
  }
  return null;
}

type Spot = { type: string; x: number; y: number };

/** Grass or sand: land something could stand on (streets aside). */
export const isLand = (x: number, y: number): boolean => ["grass", "sand"].includes(terrainAt(x, y));

const nearBuilding = (buildings: readonly Spot[], x: number, y: number, r: number) =>
  buildings.some((b) => buildingType(b.type)?.category !== "decor" && Math.max(Math.abs(b.x - x), Math.abs(b.y - y)) <= r);

// ---------- streets ----------
// Streets are tiles the town laid down itself, kept as tile numbers (y × MAP_SIZE + x).

export const tileIndex = (x: number, y: number): number => y * MAP_SIZE + x;
export const tileOf = (i: number): { x: number; y: number } => ({ x: i % MAP_SIZE, y: Math.floor(i / MAP_SIZE) });
const onMap = (x: number, y: number) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE;

export const isRoad = (roads: readonly number[], x: number, y: number): boolean => onMap(x, y) && roads.includes(tileIndex(x, y));

/**
 * The streets a new town starts with: free land on every 4th row and column
 * near a building. (Also how towns from before hand-laid paths get theirs.)
 */
export function classicStreets(buildings: readonly Spot[]): number[] {
  const out = new Set<number>();
  for (const b of buildings) {
    if (buildingType(b.type)?.category === "decor") continue;
    for (let dy = -STREET_RANGE; dy <= STREET_RANGE; dy++) {
      for (let dx = -STREET_RANGE; dx <= STREET_RANGE; dx++) {
        const x = b.x + dx;
        const y = b.y + dy;
        if (onMap(x, y) && isRoadTile(x, y) && isLand(x, y) && !buildings.some((o) => o.x === x && o.y === y)) out.add(tileIndex(x, y));
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** Why no path can be laid on this tile, or null if it can. */
export function pathError(buildings: readonly Spot[], roads: readonly number[], x: number, y: number): string | null {
  if (!onMap(x, y)) return "buiten de kaart";
  if (!isLand(x, y)) return "hier kan geen pad";
  if (buildings.some((b) => b.x === x && b.y === y)) return "daar staat al iets";
  if (isRoad(roads, x, y)) return "daar ligt al een pad";
  return nearBuilding(buildings, x, y, VILLAGE_RANGE) ? null : "te ver van het dorp";
}

/** Why this type can't go on this tile, or null if it can. */
export function placeError(buildings: readonly Spot[], roads: readonly number[], typeId: string, x: number, y: number): string | null {
  if (!onMap(x, y)) return "buiten de kaart";
  if (!isLand(x, y)) return "hier kan je niet bouwen";
  if (buildings.some((b) => b.x === x && b.y === y)) return "daar staat al iets";
  if (isRoad(roads, x, y)) return "daar ligt een pad";
  const source = sourceOf(typeId);
  if (source) return near(x, y, SOURCE_RANGE, source.ok) ? null : source.hint;
  return nearBuilding(buildings, x, y, VILLAGE_RANGE) ? null : "te ver van het dorp";
}

/**
 * The free tile closest to where this type likes to stand: homes, storage and
 * decorations around the center, work buildings by their resource. Every 4th
 * row and column stays free for the first streets. Null if the map is full.
 * Only for the starting town; later buildings go where people click.
 */
export function placeBuilding(buildings: readonly { x: number; y: number }[], typeId: string): { x: number; y: number } | null {
  if (typeId === "center") return { ...CENTER };
  const taken = new Set(buildings.map((b) => `${b.x},${b.y}`));
  const anchor = anchorOf(typeId);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      if (!buildable(x, y) || taken.has(`${x},${y}`)) continue;
      const d = Math.hypot(x - anchor.x, y - anchor.y);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}
