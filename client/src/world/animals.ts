// Game in the forests around the town: deer and boars, only for the eye and
// simulated in each browser. Where the forest is cut down there are fewer, as
// hunters there also catch less (sourceShare in shared/idle.ts).

import { CENTER, isRoad, isUsedUp, patches, type IdleWorld } from "@app/shared/idle";
import { rand2, type AnimalLook } from "./draw";
import type { Point } from "./iso";

/** Forests with a tile this close to the center have game. */
const RANGE = 24;
/** One animal per this many standing trees, at most MAX_PER_PATCH per forest. */
const TREES_EACH = 4;
const MAX_PER_PATCH = 3;
const SPEED = 0.6; // tiles per second

export interface Animal {
  id: string;
  kind: "deer" | "boar";
  /** Tile-space position; drawn a little to the front of the tile, out from under its tree. */
  x: number;
  y: number;
  ox: number;
  oy: number;
  dir: 1 | -1;
  /** Offset of its animation clock, so they don't all graze in step. */
  seed: number;
  target: Point | null;
  /** Grazing until then. */
  until: number;
  /** The standing trees of its forest, where it can go. */
  home: Point[];
}

let near: ReturnType<typeof patches> | null = null;

export class Wildlife {
  readonly animals = new Map<string, Animal>();

  /** As many animals per forest as it still has trees for. */
  sync(world: IdleWorld, now: number): void {
    near ??= patches().filter(
      (p) => p.resource === "wood" && p.tiles.some((t) => Math.hypot(t.x - CENTER.x, t.y - CENTER.y) <= RANGE),
    );
    const keep = new Set<string>();
    for (const p of near) {
      const standing = p.tiles.filter((t) => !isUsedUp(t.x, t.y, world.nature) && !isRoad(world.roads, t.x, t.y));
      const n = Math.min(MAX_PER_PATCH, Math.floor(standing.length / TREES_EACH));
      for (let i = 0; i < n; i++) {
        const id = `${p.id}-${i}`;
        keep.add(id);
        let a = this.animals.get(id);
        if (!a) {
          const r = (k: number) => rand2(p.id, i, k);
          const start = standing[Math.floor(r(1) * standing.length)];
          a = {
            id, kind: r(2) < 0.35 ? "boar" : "deer", x: start.x, y: start.y, ox: 0.1 + r(3) * 0.3, oy: 0.1 + r(4) * 0.3,
            dir: r(5) < 0.5 ? 1 : -1, seed: r(7) * 5000, target: null, until: now + r(6) * 5000, home: standing,
          };
          this.animals.set(id, a);
        }
        a.home = standing;
      }
    }
    for (const id of [...this.animals.keys()]) if (!keep.has(id)) this.animals.delete(id);
  }

  update(dt: number, now: number): void {
    for (const a of this.animals.values()) {
      if (!a.target) {
        if (now < a.until || !a.home.length) continue;
        // Off to another tree of the same forest, not too far.
        const options = a.home.filter((t) => Math.abs(t.x - a.x) <= 3 && Math.abs(t.y - a.y) <= 3);
        a.target = (options.length ? options : a.home)[Math.floor(Math.random() * (options.length || a.home.length))];
        continue;
      }
      const dx = a.target.x - a.x;
      const dy = a.target.y - a.y;
      const d = Math.hypot(dx, dy);
      const step = SPEED * dt;
      // Screen x grows with tile x and shrinks with tile y.
      if (Math.abs(dx - dy) > 0.01) a.dir = dx - dy > 0 ? 1 : -1;
      if (d <= step) {
        a.x = a.target.x;
        a.y = a.target.y;
        a.target = null;
        a.until = now + 3000 + Math.random() * 8000;
      } else {
        a.x += (dx / d) * step;
        a.y += (dy / d) * step;
      }
    }
  }

  look(a: Animal, now: number): AnimalLook {
    return { kind: a.kind, dir: a.dir, phase: now + a.seed, walking: a.target !== null };
  }
}
