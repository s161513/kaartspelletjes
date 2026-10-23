// A* over the tile grid so villagers walk around water and mountains (and over
// the bridges). Paths are cached until the town builds or removes a bridge.

import { MAP_SIZE, isWalkable, terrainAt } from "@app/shared/idle";
import type { Point } from "./iso";

const MAX_CACHE = 600;
const cache = new Map<string, Point[] | null>();

let walkable: Uint8Array | null = null;
/** Paths over the river (bridges the town built), as tile numbers. */
let bridges: readonly number[] = [];

function canWalk(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE) return false;
  if (!walkable) {
    walkable = Uint8Array.from({ length: MAP_SIZE * MAP_SIZE }, (_, i) =>
      isWalkable(terrainAt(i % MAP_SIZE, Math.floor(i / MAP_SIZE))) ? 1 : 0,
    );
    for (const i of bridges) walkable[i] = 1;
  }
  return walkable[y * MAP_SIZE + x] === 1;
}

/** The town's streets changed: bridges make the river crossable there. */
export function setRoads(roads: readonly number[]): void {
  const next = roads.filter((i) => terrainAt(i % MAP_SIZE, Math.floor(i / MAP_SIZE)) === "water");
  if (next.length === bridges.length && next.every((i, k) => i === bridges[k])) return;
  bridges = next;
  walkable = null;
  cache.clear();
}

/** The nearest walkable tile (deposits next to water, villagers spawned oddly). */
export function nearestWalkable(x: number, y: number): Point {
  if (canWalk(x, y)) return { x, y };
  for (let r = 1; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (canWalk(x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return { x, y };
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
] as const;

/** Tiles from `from` to `to` (both included), or null if unreachable. */
export function findPath(from: Point, to: Point): Point[] | null {
  const a = nearestWalkable(from.x, from.y);
  const b = nearestWalkable(to.x, to.y);
  const key = `${a.x},${a.y}>${b.x},${b.y}`;
  if (cache.has(key)) return cache.get(key)!;

  const N = MAP_SIZE * MAP_SIZE;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = a.y * MAP_SIZE + a.x;
  const goal = b.y * MAP_SIZE + b.x;
  const h = (i: number) => Math.hypot((i % MAP_SIZE) - b.x, Math.floor(i / MAP_SIZE) - b.y);
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
      if (!canWalk(nx, ny)) continue;
      // No cutting corners past water or rock walls.
      if (dx && dy && (!canWalk(cx + dx, cy) || !canWalk(cx, cy + dy))) continue;
      const n = ny * MAP_SIZE + nx;
      const ng = g[cur] + cost;
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
