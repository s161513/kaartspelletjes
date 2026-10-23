// The villagers' pathfinding (client/src/world/path.ts): around buildings, over the streets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAP_SIZE, isWalkable, terrainAt } from "@app/shared/idle";
import { findPath, nearestOpen, setTown } from "../client/src/world/path.ts";

/** Top-left of a 9×9 block where everything is walkable, so only our buildings and roads matter. */
function openBlock(): { x: number; y: number } {
  for (let y = 1; y < MAP_SIZE - 10; y++) {
    for (let x = 1; x < MAP_SIZE - 10; x++) {
      let ok = true;
      for (let dy = 0; dy < 9 && ok; dy++) for (let dx = 0; dx < 9 && ok; dx++) ok = isWalkable(terrainAt(x + dx, y + dy));
      if (ok) return { x, y };
    }
  }
  throw new Error("no open block on the map");
}

const tile = (x: number, y: number) => y * MAP_SIZE + x;
const has = (path: { x: number; y: number }[], x: number, y: number) => path.some((p) => p.x === x && p.y === y);

test("villagers walk around buildings, but can walk into the one they're going to", () => {
  const o = openBlock();
  // A wall of buildings across the middle of the block, with a gap at the end.
  const wall = [0, 1, 2, 3, 4, 5, 6, 7].map((dx) => ({ x: o.x + dx, y: o.y + 4 }));
  setTown(wall, []);
  const path = findPath({ x: o.x + 2, y: o.y + 1 }, { x: o.x + 2, y: o.y + 7 });
  assert.ok(path);
  for (const b of wall) assert.ok(!has(path, b.x, b.y), `walked through the building at ${b.x},${b.y}`);
  assert.ok(has(path, o.x + 8, o.y + 4), "went through the gap");

  const into = findPath({ x: o.x + 2, y: o.y + 1 }, wall[2]);
  assert.ok(into);
  assert.deepEqual(into.at(-1), wall[2]);
  assert.ok(!has(into.slice(0, -1), wall[1].x, wall[1].y) && !has(into.slice(0, -1), wall[3].x, wall[3].y));

  // Somewhere to hang out is never a building.
  assert.notDeepEqual(nearestOpen(wall[0].x, wall[0].y), wall[0]);
});

test("villagers prefer the street, even if it's a bit longer", () => {
  const o = openBlock();
  const from = { x: o.x, y: o.y + 4 };
  const to = { x: o.x + 8, y: o.y + 4 };
  setTown([], []);
  const straight = findPath(from, to)!;
  assert.ok(straight.every((p) => p.y === o.y + 4), "straight line without streets");

  // A street that bends around: two rows up, along, and back down.
  const street: number[] = [];
  for (let dx = 0; dx <= 8; dx++) street.push(tile(o.x + dx, o.y + 2));
  for (const dy of [3, 4]) street.push(tile(o.x, o.y + dy), tile(o.x + 8, o.y + dy));
  setTown([], street.sort((a, b) => a - b));
  const path = findPath(from, to)!;
  assert.ok(has(path, o.x + 4, o.y + 2), "took the street");
  setTown([], []);
});
