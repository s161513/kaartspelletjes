// A* over the tile grid so villagers walk around water, mountains and
// buildings (and over the bridges), and prefer the streets: a step on a road
// costs half a step on the grass. Walls are closed: villagers go through the
// gates. Only if there is no way round do they climb over, as raiders do (slowly).
// Paths are cached until the town changes.

import { MAP_SIZE, isWalkable, terrainAt } from "@app/shared/idle";
import type { Point } from "./iso";

const MAX_CACHE = 600;
/** What a step on a road or bridge costs, against 1 elsewhere. */
const ROAD_COST = 0.5;
const cache = new Map<string, Point[] | null>();

let walkable: Uint8Array | null = null;
/** The town's streets and bridges, as tile numbers. */
let roads: readonly number[] = [];
/** Tiles with a building: only the start or the end of a walk. */
let blocked = new Set<number>();
let onRoad = new Set<number>();
/** Wall tiles that aren't a gate. */
let walled = new Set<number>();

function canWalk(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return false;
  if (!walkable) {
    walkable = Uint8Array.from({ length: MAP_SIZE * MAP_SIZE }, (_, i) =>
      isWalkable(terrainAt(i % MAP_SIZE, Math.floor(i / MAP_SIZE))) ? 1 : 0,
    );
    for (const i of roads) walkable[i] = 1;
  }
  return walkable[y * MAP_SIZE + x] === 1;
}

/** Walkable and no building in the way (nor a wall, unless climbing). */
const isOpen = (x: number, y: number, climb = 0): boolean =>
  canWalk(x, y) && !blocked.has(y * MAP_SIZE + x) && (climb > 0 || !walled.has(y * MAP_SIZE + x));

const sameSet = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((i) => b.has(i));

/** The town changed: streets are quicker, bridges cross the river, buildings and walls are in the way. */
export function setTown(buildings: readonly Point[], streets: readonly number[], walls: readonly number[] = [], gates: readonly number[] = []): void {
  const next = new Set(buildings.map((b) => b.y * MAP_SIZE + b.x));
  const shut = new Set(walls.filter((i) => !gates.includes(i)));
  if (sameSet(next, blocked) && sameSet(shut, walled) && streets.length === roads.length && streets.every((i, k) => i === roads[k])) return;
  blocked = next;
  walled = shut;
  roads = [...streets];
  onRoad = new Set(streets);
  walkable = null;
  cache.clear();
}

/** The nearest walkable tile (deposits next to water, villagers spawned oddly). */
export function nearestWalkable(x: number, y: number): Point {
  return nearest(x, y, canWalk);
}

/** The nearest tile to stand on that isn't a building: for hanging out somewhere. */
export function nearestOpen(x: number, y: number): Point {
  return nearest(x, y, isOpen);
}

function nearest(x: number, y: number, ok: (x: number, y: number) => boolean): Point {
  if (ok(x, y)) return { x, y };
  for (let r = 1; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (ok(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return { x, y };
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
] as const;

/**
 * Tiles from `from` to `to` (both included), or null if unreachable. With
 * `climb` a wall can be climbed over, a step on it costing that much.
 */
export function findPath(from: Point, to: Point, climb = 0): Point[] | null {
  const a = nearestWalkable(from.x, from.y);
  const b = nearestWalkable(to.x, to.y);
  const key = `${a.x},${a.y}>${b.x},${b.y}|${climb}`;
  if (cache.has(key)) return cache.get(key)!;

  const N = MAP_SIZE * MAP_SIZE;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = a.y * MAP_SIZE + a.x;
  const goal = b.y * MAP_SIZE + b.x;
  // Never more than the cheapest way there, all over roads.
  const h = (i: number) => Math.hypot((i % MAP_SIZE) - b.x, Math.floor(i / MAP_SIZE) - b.y) * ROAD_COST;
  // Small binary heap of [f, index].
  const heap: [number, number][] = [[h(start), start]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  g[start] = 0;
  let found = false;
  while (heap.length) {
    const [, cur] = pop();
    if (closed[cur]) continue;
    if (cur === goal) {
      found = true;
      break;
    }
    closed[cur] = 1;
    const cx = cur % MAP_SIZE;
    const cy = Math.floor(cur / MAP_SIZE);
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const n = ny * MAP_SIZE + nx;
      // Into a building only if that's where you're going; over a wall only when climbing.
      if (!canWalk(nx, ny) || (n !== goal && blocked.has(n)) || (!climb && walled.has(n))) continue;
      // No cutting corners past water, rock walls, buildings or the town wall.
      if (dx && dy && (!isOpen(cx + dx, cy) || !isOpen(cx, cy + dy))) continue;
      const ng = g[cur] + cost * (walled.has(n) ? climb : onRoad.has(n) ? ROAD_COST : 1);
      if (ng < g[n]) {
        g[n] = ng;
        came[n] = cur;
        push([ng + h(n), n]);
      }
    }
  }

  let path: Point[] | null = null;
  if (found) {
    path = [];
    for (let i = goal; i !== -1; i = came[i]) path.push({ x: i % MAP_SIZE, y: Math.floor(i / MAP_SIZE) });
    path.reverse();
  }
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(key, path);
  return path;
}
