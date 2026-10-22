import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import {
  BOOST_MS,
  CENTER,
  DEPOSITS,
  ERAS,
  MAP_SIZE,
  MAX_BOOST_MS,
  MAX_OFFLINE_MS,
  MAX_PATH_TILES,
  MAX_QUEUE,
  MARKET_HALF_LIFE_MS,
  SHOP_ITEMS,
  VOTE_MS,
  actionError,
  actionLabel,
  advance,
  anchorOf,
  applyAction,
  applyBoost,
  assignWorkers,
  buildCost,
  buyItem,
  capOf,
  classicStreets,
  eraFor,
  gather,
  isLand,
  isRiver,
  isRoad,
  isRoadTile,
  isUsedUp,
  itemCost,
  itemError,
  multiplierAt,
  natureAt,
  newIdleState,
  patchAt,
  patches,
  pathCost,
  pathError,
  placeBuilding,
  placeError,
  ratesOf,
  refundOf,
  roadCost,
  sourceLeft,
  sourcePatches,
  terrainAt,
  tileIndex,
  tileOf,
  trade,
  tradeQuote,
  tradeRate,
  unlockEra,
  upgradeCost,
  voteOutcome,
  votesNeeded,
  type IdleProposal,
  type IdleState,
  type IdleStateMsg,
  type PlacedBuilding,
} from "@app/shared/idle";
import { createCounterServer } from "../server/src/counter.ts";
import { createIdleGame } from "../server/src/idle.ts";

const T0 = 1_000_000;
const TOOLS_WOOD = SHOP_ITEMS.find((i) => i.id === "tools_wood")!;
const rich = (s: IdleState, n = 1e9): IdleState => ({
  ...s,
  resources: Object.fromEntries(["food", "wood", "stone", "bronze", "iron", "gold"].map((r) => [r, n])),
});
/** Build on the tile the starting-town placer would pick (always a valid spot). */
const at = (s: IdleState, type: string) => ({ kind: "build" as const, type, ...placeBuilding(s.buildings, type)! });
const build = (s: IdleState, type: string) => applyAction(s, at(s, type)).state;

// ---------- map ----------

test("map: same terrain every time, town center on grass, every deposit reachable", () => {
  assert.equal(terrainAt(CENTER.x, CENTER.y), "grass");
  assert.equal(terrainAt(-1, 5), "water");
  assert.equal(terrainAt(0, 0), "water");
  for (const d of DEPOSITS) {
    assert.equal(terrainAt(d.x, d.y), "deposit");
    assert.equal(natureAt(d.x, d.y, d.era - 1), null, `${d.name} hidden before its era`);
    assert.equal(natureAt(d.x, d.y, d.era), d.resource);
  }
  const counts: Record<string, number> = {};
  for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) counts[terrainAt(x, y)] = (counts[terrainAt(x, y)] ?? 0) + 1;
  for (const t of ["forest", "rock", "bush", "mountain", "sand", "bridge"]) assert.ok(counts[t] > 0, `has ${t}`);
});

test("placeBuilding: deterministic, no overlap, never on water or streets, work near its resource", () => {
  let s = newIdleState(T0);
  assert.deepEqual(newIdleState(T0).buildings, s.buildings);
  s = rich(unlockEra(s, 3));
  s = build(s, "shop_sculptor");
  for (let i = 0; i < 40; i++) {
    const type = ["house", "house", "storage", "food", "wood", "stone", "mine_bronze", "decor_statue67"][i % 8];
    s = build(s, type);
  }
  const tiles = new Set(s.buildings.map((b) => `${b.x},${b.y}`));
  assert.equal(tiles.size, s.buildings.length, "one building per tile");
  for (const b of s.buildings.filter((b) => b.type !== "center")) {
    assert.ok(["grass", "sand"].includes(terrainAt(b.x, b.y)), `${b.type} on buildable land`);
    assert.ok(!isRoadTile(b.x, b.y), `${b.type} not on a street`);
  }
  const mine = s.buildings.find((b) => b.type === "mine_bronze")!;
  const ore = anchorOf("mine_bronze");
  assert.ok(Math.hypot(mine.x - ore.x, mine.y - ore.y) < 3, "mine next to the copper vein");
  assert.deepEqual(placeBuilding(s.buildings, "center"), CENTER);
});

// ---------- rules ----------

test("eraFor: a new era every 67, capped at the last", () => {
  assert.equal(eraFor(66), 0);
  assert.equal(eraFor(67), 1);
  assert.equal(eraFor(134), 2);
  assert.equal(eraFor(100_000), ERAS.length - 1);
});

test("workers: round robin over work buildings, leftovers idle, production follows staff", () => {
  const s = newIdleState(T0); // 2 huts × 3 = 6 villagers, 2 jobs × 2 slots
  const w = assignWorkers(s);
  assert.equal(w.population, 6);
  assert.equal(w.idle, 2);
  assert.deepEqual(Object.values(w.workers), [2, 2]);
  assert.deepEqual(ratesOf(s), { food: 1, wood: 1 });

  // One hut: 3 villagers over 2 jobs → 2 + 1.
  const fewer = { ...s, buildings: s.buildings.filter((b) => b.id !== 2) };
  assert.deepEqual(Object.values(assignWorkers(fewer).workers).sort(), [1, 2]);
  const r = ratesOf(fewer);
  assert.equal(r.food + r.wood, 1.5);
});

test("advance: produces over time, boost doubles, offline is capped, storage limit holds", () => {
  const s = { ...newIdleState(T0), resources: {} };
  assert.equal(advance(s, T0 + 10_000).resources.food, 10);
  assert.equal(advance({ ...s, boostUntil: T0 + 5_000 }, T0 + 10_000).resources.food, 15);
  const cap = capOf(s);
  assert.equal(advance(s, T0 + MAX_OFFLINE_MS * 3).resources.food, cap);
  assert.equal(cap, 400); // base 200 + campfire 200
  const withBarn = { ...s, buildings: [...s.buildings, { id: 99, type: "storage", level: 0, x: 1, y: 1 }] };
  assert.equal(capOf(withBarn), 800);
  assert.deepEqual(s.resources, {}, "pure");
});

test("gather: by tile, unlocked resources only, scaled by era, capped", () => {
  const s = newIdleState(T0);
  const tree = findTile((x, y) => terrainAt(x, y) === "forest");
  const vein = DEPOSITS.find((d) => d.resource === "bronze")!;
  const done = gather(s, tree.x, tree.y)!;
  assert.equal(done.resource, "wood");
  assert.equal(done.state.resources.wood, 61);
  assert.equal(done.state.nature[patchAt(tree.x, tree.y)!.id], 1, "one click used");
  assert.equal(gather(s, CENTER.x, CENTER.y), null, "nothing on grass");
  assert.equal(gather(s, vein.x, vein.y), null, "not unlocked");
  assert.equal(gather(unlockEra(s, 1), vein.x, vein.y)!.state.resources.bronze, 4);
  const full = gather({ ...s, resources: { wood: 400 } }, tree.x, tree.y)!;
  assert.equal(full.state.resources.wood, 400);
  assert.deepEqual(full.state.nature, {}, "a full storage doesn't waste nature");
});

test("nature: patches are fixed groups, valuable ones last longer, clicks use them up edge first", () => {
  const all = patches();
  assert.equal(patches(), all, "computed once");
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const t = terrainAt(x, y);
      const p = patchAt(x, y);
      if (["forest", "rock", "bush", "deposit"].includes(t)) assert.ok(p?.tiles.some((q) => q.x === x && q.y === y), `${t} ${x},${y} in a patch`);
      else assert.equal(p, undefined);
    }
  }
  for (const p of all) assert.ok(p.tiles.length >= 1 && p.tiles.length <= 12);
  const perTile = (res: string) => Math.max(...all.filter((p) => p.resource === res).map((p) => p.capacity / p.tiles.length));
  assert.ok(perTile("food") < perTile("wood") && perTile("wood") < perTile("stone") && perTile("stone") < perTile("bronze"));

  // Click a forest patch empty: tiles go one by one, then nothing is left to click.
  const forest = all.find((p) => p.resource === "wood" && p.tiles.length >= 4)!;
  let s = { ...newIdleState(T0), resources: {} };
  const center = forest.tiles[forest.tiles.length - 1];
  for (let i = 0; i < forest.capacity; i++) {
    const done = gather({ ...s, resources: {} }, center.x, center.y);
    assert.ok(done, `click ${i}`);
    s = done.state;
    if (i === Math.floor(forest.capacity / 2)) assert.ok(isUsedUp(forest.tiles[0].x, forest.tiles[0].y, s.nature), "the edge goes first");
  }
  assert.equal(gather(s, center.x, center.y), null, "used up");
  assert.equal(natureAt(center.x, center.y, 0, s.nature), null);
  // It all grows back (wood: half an hour).
  const later = advance(s, T0 + 31 * 60_000);
  assert.equal(later.nature[forest.id], undefined);
  assert.ok(gather(later, center.x, center.y));
});

test("nature: work buildings use up what's around them and stop when it's gone", () => {
  const s = newIdleState(T0);
  const cutter = s.buildings.find((b) => b.type === "wood")!;
  const src = sourcePatches(cutter)!;
  assert.ok(src.length > 0 && src.every((p) => p.resource === "wood"));
  assert.equal(sourcePatches(s.buildings.find((b) => b.type === "food")!), null, "farms need no forest");

  const after = advance({ ...s, resources: {} }, T0 + 100_000);
  assert.ok(Math.abs(after.resources.wood - 100) < 1e-9, "100 s of 1 wood/s");
  const used = Object.values(after.nature).reduce((a, n) => a + n, 0);
  assert.ok(Math.abs(used - 25) < 0.5, "a quarter click per wood");

  // Everything around it used up: no more wood from it, the farm goes on.
  const bare = { ...s, resources: {}, nature: Object.fromEntries(src.map((p) => [p.id, p.capacity])) };
  assert.equal(ratesOf(bare).wood, undefined);
  assert.equal(sourceLeft(bare, cutter)!.left, 0);
  const tick = advance(bare, T0 + 1000);
  // Only what grew back in that second (a quarter click per wood), not the full 1 wood/s.
  const regrown = src.reduce((a, p) => a + p.regrow * 1000, 0);
  assert.ok(Math.abs(tick.resources.wood - regrown / 0.25) < 1e-9 && tick.resources.wood < 1);
  assert.ok(tick.resources.food > 0);
});

test("boost stacks by 67 s, up to an hour ahead", () => {
  let s = applyBoost(newIdleState(T0), T0);
  assert.equal(s.boostUntil, T0 + BOOST_MS);
  for (let i = 0; i < 200; i++) s = applyBoost(s, T0);
  assert.equal(s.boostUntil, T0 + MAX_BOOST_MS);
});

test("build: at the current era, unlocked types only, cost grows per copy, pays", () => {
  let s = newIdleState(T0);
  const spot = { x: 40, y: 38 };
  assert.equal(actionError(s, { kind: "build", type: "center", ...spot }), "bestaat al");
  assert.equal(actionError(s, { kind: "build", type: "mine_bronze", ...spot }), "nog niet ontgrendeld");
  assert.equal(actionError(s, { kind: "build", type: "nope", ...spot }), "onbekend");
  assert.equal(actionError({ ...s, resources: {} }, at(s, "house")), "te duur");

  const first = buildCost(s, "house")!;
  assert.deepEqual(first, { wood: Math.ceil(30 * 1.5 * 1.2 ** 2), stone: Math.ceil(10 * 1.5 * 1.2 ** 2) }, "×1.5, ×1.2 per hut already there");
  s = { ...s, resources: { wood: 1000, stone: 1000 } };
  const action = at(s, "house");
  const { state, building } = applyAction(s, action);
  assert.equal(building!.level, 0);
  assert.deepEqual([building!.x, building!.y], [action.x, action.y], "exactly where it was proposed");
  assert.equal(state.resources.wood, 1000 - first.wood);
  assert.ok(buildCost(state, "house")!.wood > first.wood);

  // In the Bronze Age a new house is a level-1 house and costs bronze.
  const bronzeAge = rich(unlockEra(newIdleState(T0), 1));
  assert.ok(buildCost(bronzeAge, "house")!.bronze > 0);
  assert.equal(applyAction(bronzeAge, at(bronzeAge, "house")).building!.level, 1);
  // A copper mine never costs copper.
  assert.equal(buildCost(bronzeAge, "mine_bronze")!.bronze, undefined);
});

test("upgrade: old buildings go straight to the current era, decorations never", () => {
  let s = rich(newIdleState(T0));
  assert.equal(actionError(s, at(s, "decor_statue67")), "eerst een Beeldhouwer bouwen");
  s = build(build(s, "shop_sculptor"), "decor_statue67");
  assert.equal(actionError(s, at(s, "shop_sculptor")), "bestaat al", "one shop of each");
  const hut = s.buildings.find((b) => b.type === "house")!;
  assert.equal(actionError(s, { kind: "upgrade", building: hut.id }), "al up-to-date");

  s = unlockEra(s, 2);
  const cost = upgradeCost(s, hut);
  assert.ok(cost.iron > 0, "Iron Age upgrade needs iron");
  const { state, building } = applyAction(s, { kind: "upgrade", building: hut.id });
  assert.equal(building!.level, 2);
  assert.equal(state.buildings.find((b) => b.id === hut.id)!.level, 2);
  assert.ok(assignWorkers(state).population > assignWorkers(s).population, "bigger house");

  const statue = s.buildings.find((b) => b.type === "decor_statue67")!;
  assert.equal(actionError(s, { kind: "upgrade", building: statue.id }), "kan niet upgraden");
  assert.equal(actionError(s, { kind: "upgrade", building: 12345 }), "onbekend gebouw");
});

test("demolish: anything but the center, for a share of its cost back, up to the storage limit", () => {
  const s = rich(newIdleState(T0), 0);
  const center = s.buildings.find((b) => b.type === "center")!;
  assert.equal(actionError(s, { kind: "demolish", building: center.id }), "het centrum blijft staan");
  assert.equal(actionError(s, { kind: "demolish", building: 12345 }), "onbekend gebouw");
  const hut = s.buildings.find((b) => b.type === "house")!;
  const action = { kind: "demolish" as const, building: hut.id };
  assert.equal(actionError(s, action), null, "free: nothing to pay");
  assert.equal(actionLabel(s, action), "🧨 Hut afbreken");
  assert.deepEqual(refundOf(s, action), { wood: 11, stone: 3 }, "25% of 1.5 × the base cost");
  const { state } = applyAction(s, action);
  assert.ok(!state.buildings.some((b) => b.id === hut.id));
  assert.equal(assignWorkers(state).population, assignWorkers(s).population - 3);
  assert.deepEqual([state.resources.wood, state.resources.stone], [11, 3]);
  const full = { ...s, resources: { wood: capOf(s) } };
  assert.equal(applyAction(full, action).state.resources.wood, capOf(s), "storage limit holds");
  // A building from an earlier era gives back what it cost then.
  const old = unlockEra(s, 2);
  assert.deepEqual(refundOf(old, action), refundOf(s, action));
});

test("voteOutcome: at least two yes and more than a third of online passes, as many no fails, deadline decides the rest", () => {
  const p = (votes: boolean[]): IdleProposal => ({
    id: 1, action: { kind: "upgrade", building: 1 }, by: "x", deadline: T0 + VOTE_MS,
    votes: Object.fromEntries(votes.map((v, i) => [String(i), v])),
  });
  assert.deepEqual([1, 2, 3, 5, 6, 9].map(votesNeeded), [2, 2, 2, 2, 3, 4]);
  assert.equal(voteOutcome(p([true]), 1, T0), "pending", "alone you can't build anything right away");
  assert.equal(voteOutcome(p([true]), 1, T0 + VOTE_MS), "fail", "…nor at the deadline");
  assert.equal(voteOutcome(p([true, true]), 2, T0), "pass");
  assert.equal(voteOutcome(p([true]), 3, T0), "pending");
  assert.equal(voteOutcome(p([true, true]), 3, T0), "pass");
  assert.equal(voteOutcome(p([true, true]), 6, T0), "pending");
  assert.equal(voteOutcome(p([true, true, true]), 6, T0), "pass");
  assert.equal(voteOutcome(p([true, true, false, false]), 6, T0), "pending", "a tie isn't a pass");
  assert.equal(voteOutcome(p([true, false, false]), 3, T0), "fail");
  assert.equal(voteOutcome(p([true, false, false, false]), 4, T0), "fail", "nobody left to make it pass");
  assert.equal(voteOutcome(p([true]), 4, T0 + VOTE_MS), "fail", "one yes is never enough");
  assert.equal(voteOutcome(p([true, true, false]), 9, T0 + VOTE_MS), "pass");
  assert.equal(voteOutcome(p([true, false]), 4, T0 + VOTE_MS), "fail");
});

// ---------- placing, shops, market ----------

/** First tile (row by row) matching `ok`. */
function findTile(ok: (x: number, y: number) => boolean): { x: number; y: number } {
  for (let y = 0; y < MAP_SIZE; y++) for (let x = 0; x < MAP_SIZE; x++) if (ok(x, y)) return { x, y };
  throw Error("no such tile");
}
/** Land off the street grid: buildable wherever streets go later. */
const isBuildableTile = (x: number, y: number) => isLand(x, y) && !isRoadTile(x, y);
const nearTerrain = (x: number, y: number, r: number, kinds: string[]) => {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (kinds.includes(terrainAt(x + dx, y + dy))) return true;
  return false;
};

test("placeError: land only, off streets, free, work by its source, the rest in the village", () => {
  const { buildings, roads } = newIdleState(T0);
  const home = placeBuilding(buildings, "house")!;
  assert.equal(placeError(buildings, roads, "house", home.x, home.y), null);
  assert.equal(placeError(buildings, roads, "house", buildings[1].x, buildings[1].y), "daar staat al iets");
  assert.equal(placeError(buildings, roads, "house", 0, 0), "hier kan je niet bouwen");
  assert.equal(placeError(buildings, roads, "house", -1, 3), "buiten de kaart");
  const street = tileOf(roads[0]);
  assert.equal(placeError(buildings, roads, "house", street.x, street.y), "daar ligt een pad");
  assert.equal(placeError(buildings, [], "house", street.x, street.y), null, "without the path it's free land");

  const villageDist = (x: number, y: number) => Math.min(...buildings.map((b) => Math.max(Math.abs(b.x - x), Math.abs(b.y - y))));
  const far = findTile((x, y) => isBuildableTile(x, y) && villageDist(x, y) > 10 && !nearTerrain(x, y, 2, ["deposit"]));
  assert.equal(placeError(buildings, roads, "house", far.x, far.y), "te ver van het dorp");
  const roomy = findTile((x, y) => isBuildableTile(x, y) && villageDist(x, y) === 9);
  assert.equal(placeError(buildings, roads, "house", roomy.x, roomy.y), null, "the village grows loosely");

  // A woodcutter goes by the forest, wherever that is; not in the middle of the fields.
  const field = findTile((x, y) => isBuildableTile(x, y) && villageDist(x, y) <= 10 && !nearTerrain(x, y, 2, ["forest"]));
  assert.equal(placeError(buildings, roads, "wood", field.x, field.y), "moet vlak bij het bos staan");
  const woods = findTile((x, y) => isBuildableTile(x, y) && villageDist(x, y) > 10 && nearTerrain(x, y, 1, ["forest"]));
  assert.equal(placeError(buildings, roads, "wood", woods.x, woods.y), null);

  for (const d of DEPOSITS) {
    const type = `mine_${d.resource}`;
    assert.doesNotThrow(() => findTile((x, y) => !placeError([], [], type, x, y)), `${d.name} has room for a mine`);
    assert.equal(placeError([], [], type, far.x, far.y), `moet bij de ${d.name} staan`);
  }
});

test("streets: a new town starts on a grid, more is laid and removed by vote, upgraded all at once", () => {
  let s = rich(newIdleState(T0));
  assert.ok(s.roads.length > 0);
  assert.deepEqual(s.roads, classicStreets(s.buildings));
  for (const i of s.roads) assert.ok(isRoadTile(tileOf(i).x, tileOf(i).y) && isLand(tileOf(i).x, tileOf(i).y));
  // Streets don't grow by themselves anymore.
  const before = s.roads;
  s = build(s, "house");
  assert.equal(s.roads, before);

  // Lay a path: anywhere on free land in the village, paid per tile.
  const free = (x: number, y: number) => !pathError(s.buildings, s.roads, x, y);
  const a = findTile((x, y) => [0, 1, 2].every((dx) => isLand(x + dx, y) && free(x + dx, y)));
  const tiles = [0, 1, 2].map((dx) => tileIndex(a.x + dx, a.y));
  const lay = { kind: "paths" as const, tiles };
  assert.equal(actionError(s, lay), null);
  assert.deepEqual(pathCost(s, tiles), { stone: 9, wood: 3 });
  assert.equal(actionLabel(s, lay), "🛤️ 3 tegels pad leggen");
  const laid = applyAction(s, lay).state;
  assert.ok(tiles.every((i) => isRoad(laid.roads, tileOf(i).x, tileOf(i).y)));
  assert.equal(laid.resources.stone, s.resources.stone - 9);
  assert.deepEqual(laid.roads, [...laid.roads].sort((x, y) => x - y), "kept sorted");
  assert.match(actionError(laid, lay)!, /daar ligt al een pad/);
  assert.equal(actionError({ ...s, resources: {} }, lay), "te duur");
  assert.equal(actionError(s, { kind: "paths", tiles: [] }), "geen tegels gekozen");
  assert.equal(actionError(s, { kind: "paths", tiles: [tiles[0], tiles[0]] }), "ongeldige tegels");
  assert.match(actionError(s, { kind: "paths", tiles: Array.from({ length: MAX_PATH_TILES + 1 }, (_, i) => i) })!, /te veel tegels/);
  assert.match(actionError(s, { kind: "paths", tiles: [tileIndex(0, 0)] })!, /hier kan geen pad/);
  const house = s.buildings.find((b) => b.type === "house")!;
  assert.match(actionError(s, { kind: "paths", tiles: [tileIndex(house.x, house.y)] })!, /daar staat al iets/);
  // Through nature: the tile is cleared, nothing to gather there anymore; not through mountains or the sea.
  const woods = findTile((x, y) => terrainAt(x, y) === "forest" && free(x, y));
  const cleared = applyAction(s, { kind: "paths", tiles: [tileIndex(woods.x, woods.y)] }).state;
  assert.equal(gather(s, woods.x, woods.y)?.resource, "wood");
  assert.equal(gather(cleared, woods.x, woods.y), null);
  const peak = findTile((x, y) => terrainAt(x, y) === "mountain");
  assert.equal(pathError(s.buildings, s.roads, peak.x, peak.y), "hier kan geen pad");
  assert.equal(pathError(s.buildings, s.roads, 0, 40), "hier kan geen pad", "the sea");

  // Over the river: a bridge, pricier; villagers can cross there afterwards.
  const river = findTile((x, y) => isRiver(x, y) && free(x, y));
  const bridge = [tileIndex(river.x, river.y), tileIndex(river.x + 1, river.y)];
  assert.ok(isRiver(river.x + 1, river.y));
  assert.equal(actionError(s, { kind: "paths", tiles: bridge }), null);
  assert.deepEqual(pathCost(s, [...bridge, tiles[0]]), { wood: 25, stone: 15 });
  assert.deepEqual(refundOf(s, { kind: "unpave", tiles: bridge }), { wood: 6, stone: 3 });
  assert.equal(placeError(s.buildings, s.roads, "house", river.x, river.y), "hier kan je niet bouwen", "a bridge is no building plot");

  // A path blocks building there, until it's gone again.
  assert.equal(placeError(laid.buildings, laid.roads, "house", a.x, a.y), "daar ligt een pad");

  // Remove it again for a bit back (a share of the cost, rounded down).
  const unpave = { kind: "unpave" as const, tiles };
  assert.equal(actionError(s, unpave), "daar ligt geen pad");
  assert.equal(actionError(laid, unpave), null);
  assert.deepEqual(refundOf(laid, unpave), { stone: 2 });
  assert.equal(actionLabel(laid, unpave), "⛏️ 3 tegels pad weghalen");
  const gone = applyAction({ ...laid, resources: {} }, unpave).state;
  assert.deepEqual(gone.roads, s.roads);
  assert.deepEqual(gone.resources, { stone: 2 });

  assert.equal(actionError(s, { kind: "roads" }), "al up-to-date");
  s = unlockEra(s, 2);
  assert.ok(roadCost(s).iron > 0, "Iron Age streets need iron");
  assert.equal(actionLabel(s, { kind: "roads" }), "🛣️ Zandpaden → Aangestampte wegen");
  const done = applyAction(s, { kind: "roads" }).state;
  assert.equal(done.roadLevel, 2);
  assert.ok(done.resources.stone < s.resources.stone, "paid");
  assert.equal(actionError({ ...s, resources: {} }, { kind: "roads" }), "te duur");
});

test("shops: items need their shop, boosts add up and run out, perks stack to a max", () => {
  let s = rich(newIdleState(T0));
  assert.equal(itemError(s, "feast_wood"), "eerst een Mede-hut bouwen");
  s = build(s, "shop_tavern");
  assert.equal(itemError(s, "feast_wood"), null);
  assert.equal(itemError({ ...s, resources: {} }, "feast_wood"), "te duur");

  const base = ratesOf(s).wood;
  s = buyItem(s, "feast_wood");
  assert.equal(multiplierAt(s, "wood", T0), 1.5);
  assert.equal(multiplierAt(s, "food", T0), 1);
  assert.equal(multiplierAt({ ...s, boostUntil: T0 + 1000 }, "wood", T0), 2.5, "adds to the counter boost");
  const empty = { ...s, resources: {} };
  assert.ok(Math.abs(advance(empty, T0 + 10_000).resources.wood - base * 15) < 1e-9);
  // 2 boosted minutes out of 3: 180 s + 120 s x 0.5.
  const later = advance(empty, T0 + 3 * 60_000);
  assert.ok(Math.abs(later.resources.wood - base * 240) < 1e-9);
  assert.deepEqual(later.boosts, [], "a finished boost is gone");
  assert.equal(buyItem(s, "feast_wood").boosts[0].until, T0 + 4 * 60_000, "buying again extends it");

  s = build(unlockEra(s, 1), "shop_smith");
  const r0 = ratesOf(s).wood;
  const c0 = itemCost(s, TOOLS_WOOD);
  for (let i = 0; i < 5; i++) {
    assert.equal(itemError(s, "tools_wood"), null);
    s = buyItem(s, "tools_wood");
  }
  assert.equal(itemError(s, "tools_wood"), "maximaal niveau");
  assert.ok(Math.abs(ratesOf(s).wood - r0 * 1.5) < 1e-9);
  assert.ok(itemCost(s, TOOLS_WOOD).food > c0.food, "each level costs more");
});

test("market: trades at worth x fee, buying pushes the price up for a while, storage limits it", () => {
  const plain = newIdleState(T0);
  assert.equal(tradeQuote({ ...plain, resources: { wood: 200 } }, "wood", "stone", 100), "eerst een Ruilplaats bouwen");
  const s = { ...build(rich(plain), "shop_market"), resources: { wood: 200 } };
  const r = tradeRate(s, "wood", "stone");
  assert.ok(Math.abs(r - 0.4) < 1e-9, "1 wood is worth 0.8 stone, half of that");
  const done = trade(s, "wood", "stone", 100);
  assert.ok(typeof done !== "string");
  assert.equal(done.state.resources.wood, 100);
  assert.ok(Math.abs(done.state.resources.stone - 40) < 1e-9);
  assert.ok(tradeRate(done.state, "wood", "stone") < r, "stone got pricier");
  assert.equal(tradeRate(done.state, "stone", "wood"), tradeRate(s, "stone", "wood"), "wood did not");
  const calm = advance(done.state, T0 + 10 * MARKET_HALF_LIFE_MS);
  assert.ok(Math.abs(tradeRate(calm, "wood", "stone") - r) < 1e-3, "and it wears off");

  const nearlyFull = { ...s, resources: { wood: 1000, stone: capOf(s) - 10 } };
  const q = tradeQuote(nearlyFull, "wood", "stone", 1000);
  assert.ok(typeof q !== "string" && Math.abs(q.get - 10) < 1e-9 && Math.abs(q.give - 25) < 1e-9);
  assert.equal(tradeQuote({ ...s, resources: { wood: 10, stone: capOf(s) } }, "wood", "stone", 10), "opslag vol");
  assert.equal(tradeQuote(s, "wood", "wood", 10), "onbekende ruil");
  assert.equal(tradeQuote(s, "wood", "bronze", 10), "onbekende ruil");
  assert.equal(tradeQuote(s, "food", "wood", 10), "niets om te ruilen");
});

// ---------- server ----------

test("idle game: propose + vote builds and places, state survives a reload, v1 files start fresh", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const file = path.join(dir, "idle.json");
    const game = createIdleGame(file, T0);
    // A fresh town needs a few seconds of production for its first hut.
    const later = T0 + 10_000;
    const action = at(newIdleState(T0), "house");
    const { error, events } = game.propose("a", "  Ann  ", action, 3, later);
    assert.equal(error, undefined);
    assert.deepEqual(events, [{ kind: "proposed", label: "🛖 Hut bouwen", by: "Ann" }]);
    // While a vote runs, the next one waits in line.
    assert.deepEqual(game.propose("b", "Bob", action, 3, later).events, [{ kind: "proposed", label: "🛖 Hut bouwen", by: "Bob", queued: 1 }]);
    assert.deepEqual(game.message("a", 0, 0, 3, later).queue, [{ label: "🛖 Hut bouwen", by: "Bob" }]);

    // Two of three online is more than a third: it passes, and Bob's turn starts.
    const done = game.vote("b", 1, true, 3, later);
    assert.deepEqual(done.map((e) => e.kind), ["bought", "proposed"]);
    const bought = done[0] as { kind: string; building: PlacedBuilding };
    assert.equal(bought.kind, "bought");
    assert.equal(bought.building.type, "house");
    assert.deepEqual([bought.building.x, bought.building.y], [action.x, action.y]);
    const running = game.message("a", 0, 0, 3, later);
    assert.equal(running.proposal!.by, "Bob");
    assert.equal(running.proposal!.deadline, later + VOTE_MS, "its 30 s start when it's up");
    assert.deepEqual(running.queue, []);
    // Checked again when it passes: that spot is taken now.
    assert.deepEqual(game.vote("a", 2, true, 3, later), [{ kind: "rejected", label: "🛖 Hut bouwen", by: "Bob", reason: "daar staat al iets" }]);
    const msg = game.message("a", 0, 0, 3, later);
    assert.ok(msg.state.buildings.some((b) => b.id === bought.building.id));
    assert.equal(msg.proposal, null);

    const vein = DEPOSITS.find((d) => d.resource === "bronze")!;
    assert.equal(game.gather(vein.x, vein.y, T0), null, "not unlocked");
    const tree = findTile((x, y) => terrainAt(x, y) === "forest");
    assert.deepEqual(game.gather(tree.x, tree.y, T0), { kind: "click", resource: "wood", amount: 1, ...tree });

    game.flush();
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.v, 4);
    assert.deepEqual(saved.roads, msg.state.roads);
    const reloaded = createIdleGame(file, T0 + 1000);
    assert.equal(reloaded.message("a", 0, 0, 1, T0 + 1000).state.buildings.length, msg.state.buildings.length);

    // A v1 file (never released) quietly becomes a fresh town, no backup.
    writeFileSync(file, JSON.stringify({ resources: { flint: 5 }, buildings: { cave: 1 }, inventions: [] }));
    assert.equal(createIdleGame(file, T0).message("a", 0, 0, 1, T0).state.buildings.length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("idle game: at most MAX_QUEUE proposals wait in line", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const game = createIdleGame(path.join(dir, "idle.json"), T0);
    const later = T0 + 10_000;
    const action = at(newIdleState(T0), "house");
    // Nine online: one yes is not enough, so everything keeps waiting.
    for (let i = 0; i <= MAX_QUEUE; i++) assert.equal(game.propose(`c${i}`, "x", action, 9, later).error, undefined);
    assert.equal(game.message("c0", 0, 0, 9, later).queue.length, MAX_QUEUE);
    assert.equal(game.propose("late", "x", action, 9, later).error, "de wachtrij is vol");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("idle game: a v2 file keeps its town; trades and small buys are instant, big ones go to a vote", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const file = path.join(dir, "idle.json");
    const { boosts: _b, perks: _p, market: _m, ...town } = build(build(rich(newIdleState(T0)), "shop_market"), "shop_tavern");
    writeFileSync(file, JSON.stringify({ ...town, v: 2, resources: { food: 300, wood: 300, stone: 300 } }));
    const game = createIdleGame(file, T0);
    const first = game.message("a", 0, 0, 1, T0).state;
    assert.equal(first.buildings.length, town.buildings.length);
    assert.deepEqual(first.roads, classicStreets(town.buildings), "old towns get their grid streets as paths");
    assert.deepEqual([first.boosts, first.perks, first.market], [[], {}, {}]);

    assert.deepEqual(game.trade("a", "  Ann ", "wood", "stone", 100, T0).events, [{ kind: "deal", label: "100 🪵 → 40 🪨", by: "Ann" }]);
    assert.equal(game.trade("a", "Ann", "wood", "wood", 1, T0).error, "onbekende ruil");
    assert.equal(game.trade("a", "Ann", "wood", "stone", "lots", T0).error, "onbekende ruil");
    assert.equal(game.buy("a", "Ann", "feast_food", T0).events[0].kind, "deal");
    assert.equal(game.message("a", 0, 0, 1, T0).state.boosts.length, 1);
    assert.equal(game.buy("a", "Ann", "party", T0).error, "hiervoor is een stemming nodig");
    assert.equal(game.propose("a", "Ann", { kind: "buy", item: "feast_food" }, 1, T0).error, "dat kan je meteen kopen");
    assert.equal(game.propose("a", "Ann", { kind: "build", type: "house", x: 0, y: 0 }, 1, T0).error, "hier kan je niet bouwen");
    assert.equal(game.propose("a", "Ann", { kind: "build", type: "house" }, 1, T0).error, "onbekend voorstel", "a build needs a tile");
    // Alone online, nothing passes: it needs a second yes.
    assert.deepEqual(game.propose("a", "Ann", { kind: "buy", item: "party" }, 1, T0).events.map((e) => e.kind), ["proposed"]);
    assert.deepEqual(game.tick(1, T0 + VOTE_MS), [{ kind: "rejected", label: "🎉 Groot dorpsfeest kopen", by: "Ann", reason: "minstens 2 keer ja nodig" }]);
    game.propose("a", "Ann", { kind: "buy", item: "party" }, 2, T0 + VOTE_MS);
    assert.deepEqual(game.vote("b", 2, true, 2, T0 + VOTE_MS).map((e) => e.kind), ["bought"]);
    assert.ok(game.message("a", 0, 0, 2, T0 + VOTE_MS).state.boosts.some((b) => b.item === "party"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("players: a key becomes a hidden id, looks and names stick, outfits are bought from the town", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  const KEY = "0123456789abcdef-secret";
  try {
    const file = path.join(dir, "idle.json");
    writeFileSync(file, JSON.stringify(build(rich(newIdleState(T0)), "shop_tailor")));
    const game = createIdleGame(file, T0);
    assert.equal(game.message("a", 0, 0, 1, T0).me, null);
    assert.equal(game.hello("a", "short", "Ann", T0).error, "ongeldige sleutel");
    assert.deepEqual(game.hello("a", KEY, "  Ann  ", T0), {});
    const msg = game.message("a", 0, 0, 1, T0);
    assert.equal(msg.me!.name, "Ann");
    assert.match(msg.me!.id, /^[0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(msg).includes(KEY), "the secret key is never sent");
    assert.deepEqual(msg.people.map((p) => p.name), ["Ann"]);
    assert.equal(game.message("b", 0, 0, 1, T0).me, null, "only your own `me`");

    // Free things are worn right away; bought ones only after buying.
    assert.deepEqual(game.look("a", "Annie", { skin: 2, clothes: 3, hat: "cap", pattern: "stripes" }), {});
    assert.equal(game.look("a", "Annie", { skin: 2, clothes: 3, hat: "straw", pattern: "plain" }).error, "nog niet gekocht");
    assert.equal(game.look("a", "x", { skin: 99, clothes: 0, hat: "none", pattern: "plain" }).error, "onbekende huidskleur");
    assert.equal(game.look("b", "x", { skin: 0, clothes: 0, hat: "none", pattern: "plain" }).error, "eerst inloggen");
    const before = game.message("a", 0, 0, 1, T0).state.resources.food;
    assert.deepEqual(game.outfit("a", "straw", T0).events, [{ kind: "deal", label: "👒 Strohoed", by: "Annie" }]);
    assert.ok(game.message("a", 0, 0, 1, T0).state.resources.food < before, "the town paid");
    assert.equal(game.outfit("a", "straw", T0).error, "heb je al");
    assert.equal(game.outfit("a", "crown", T0).error, "nog niet ontgrendeld");
    assert.deepEqual(game.look("a", "Annie", { skin: 2, clothes: 3, hat: "straw", pattern: "stripes" }), {});
    // Proposals carry the player's own name, whatever the message says.
    assert.equal((game.propose("a", "Mallory", { kind: "upgrade", building: 1 }, 2, T0).error), "al up-to-date");
    assert.equal(game.trade("a", "Mallory", "wood", "stone", 10, T0).error, "eerst een Ruilplaats bouwen");

    // Leaving takes the NPC away; it all survives a restart.
    game.leave("a", T0 + 5);
    assert.deepEqual(game.message("b", 0, 0, 1, T0).people, []);
    game.flush();
    const again = createIdleGame(file, T0 + 1000);
    again.hello("c", KEY, "ignored", T0 + 1000);
    const me = again.message("c", 0, 0, 1, T0 + 1000).me!;
    assert.equal(me.name, "Annie");
    assert.deepEqual(me.look, { skin: 2, clothes: 3, hat: "straw", pattern: "stripes" });
    assert.deepEqual(me.owned, ["straw"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

class Peer {
  socket: WebSocket;
  queue: any[] = [];
  pending = new Set<() => void>();
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("message", (raw) => {
      this.queue.push(JSON.parse(raw.toString()));
      for (const check of [...this.pending]) check();
    });
  }
  async open() {
    await new Promise<void>((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    return this;
  }
  send(msg: object) {
    this.socket.send(JSON.stringify(msg));
  }
  wait<T = any>(predicate: (m: any) => boolean, timeoutMs = 7000): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const i = this.queue.findIndex(predicate);
        if (i >= 0) {
          const msg = this.queue.splice(i, 1)[0];
          clearTimeout(timer);
          this.pending.delete(check);
          resolve(msg);
        }
      };
      const timer = setTimeout(() => {
        this.pending.delete(check);
        reject(Error("Timed out waiting for message; last: " + JSON.stringify(this.queue.slice(-2)).slice(0, 400)));
      }, timeoutMs);
      this.pending.add(check);
      check();
    });
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.socket.once("close", resolve);
      this.socket.close();
    });
  }
}

const event = (kind: string) => (m: any) => m.type === "idleEvent" && m.event.kind === kind;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("counter socket: 67 unlocks an era, clicks reach the others, vote builds, upgrade works", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "counter-"));
  const file = path.join(dir, "counter.json");
  writeFileSync(file, JSON.stringify({ count: 60 })); // format from before `peak`
  // A rich town, so the test doesn't have to click for minutes.
  const rich = { ...newIdleState(Date.now()), resources: { food: 300, wood: 300, stone: 300 } };
  writeFileSync(path.join(dir, "idle.json"), JSON.stringify(rich));
  const wss = createCounterServer({ file });
  const http = createServer();
  http.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/`;
  const peers: Peer[] = [];
  try {
    const a = await new Peer(url).open();
    peers.push(a);
    const first = await a.wait<IdleStateMsg>((m) => m.type === "idle");
    assert.equal(first.peak, 60);
    assert.equal(first.state.era, 0);
    const b = await new Peer(url).open();
    peers.push(b);
    await b.wait((m) => m.type === "idle");
    // A third viewer, so one yes isn't enough.
    const c = await new Peer(url).open();
    peers.push(c);
    await c.wait((m) => m.type === "idle");

    // Saying hello puts your NPC in everyone's town.
    a.send({ type: "hello", key: "a-very-secret-key-1234", name: "Ann" });
    const seen = await b.wait<IdleStateMsg>((m) => m.type === "idle" && m.people.length === 1);
    assert.equal(seen.people[0].name, "Ann");
    assert.equal(seen.me, null);

    // A click by a is shown to b, not echoed to a.
    const tree = findTile((x, y) => terrainAt(x, y) === "forest");
    a.send({ type: "gather", ...tree });
    assert.deepEqual((await b.wait(event("click"))).event, { kind: "click", resource: "wood", amount: 1, ...tree });

    // Propose a house; b votes yes; it appears with a position.
    a.send({ type: "propose", action: at(rich, "house"), name: "Ann" });
    await b.wait(event("proposed"));
    const pending = await b.wait<IdleStateMsg>((m) => m.type === "idle" && m.proposal !== null);
    assert.equal(pending.proposal!.label, "🛖 Hut bouwen");
    assert.equal(pending.proposal!.needed, 2);
    b.send({ type: "vote", id: pending.proposal!.id, yes: true });
    const bought = await a.wait(event("bought"));
    assert.equal(bought.event.building.type, "house");
    assert.ok(Number.isInteger(bought.event.building.x));
    await a.wait<IdleStateMsg>((m) => m.type === "idle" && m.state.buildings.some((x) => x.id === bought.event.building.id));

    // 7 × +1: era 1 for everyone; a − doesn't take it back.
    await sleep(1100); // fresh rate-limit window
    for (let i = 0; i < 7; i++) a.send({ type: "inc" });
    assert.equal((await a.wait(event("era"))).event.era, 1);
    assert.equal((await b.wait(event("era"))).event.era, 1);
    b.send({ type: "dec" });
    const afterDec = await b.wait((m) => m.type === "count" && m.delta === -1);
    assert.equal(afterDec.peak, 67);
    const bronze = await b.wait<IdleStateMsg>((m) => m.type === "idle" && m.state.era === 1);
    assert.equal(bronze.state.era, 1);

    // Upgrading the hut needs bronze, which nobody has yet.
    await sleep(1100);
    a.send({ type: "propose", action: { kind: "upgrade", building: bought.event.building.id } });
    assert.equal((await a.wait(event("error"))).event.message, "te duur");
    a.send({ type: "propose", action: at(rich, "decor_menhir") });
    assert.equal((await a.wait(event("error"))).event.message, "eerst een Beeldhouwer bouwen");
    // Shop messages reach the game too.
    a.send({ type: "trade", from: "wood", to: "stone", amount: 10 });
    assert.equal((await a.wait(event("error"))).event.message, "eerst een Marktkraam bouwen");
    a.send({ type: "buy", item: "party" });
    assert.equal((await a.wait(event("error"))).event.message, "hiervoor is een stemming nodig");
    // A path proposal of the biggest size fits through the socket (here: all water, at the map's edge).
    const tiles = Array.from({ length: MAX_PATH_TILES }, (_, i) => MAP_SIZE * MAP_SIZE - 1 - i);
    a.send({ type: "propose", action: { kind: "paths", tiles }, name: "Ann Annabella Anders" });
    assert.equal((await a.wait(event("error"))).event.message, "(79, 79): hier kan geen pad");
  } finally {
    for (const p of peers) await p.close();
    wss.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await sleep(600); // let the debounced saves land
    rmSync(dir, { recursive: true, force: true });
  }
});
