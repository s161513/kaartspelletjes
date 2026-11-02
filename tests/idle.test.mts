import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import WebSocket from "ws";
import {
  BOOST_MS,
  BUILD_COST_MULT,
  CENTER,
  COST_GROWTH,
  DEPOSITS,
  ERAS,
  GATHER_RATE,
  MAP_SIZE,
  MAX_BOOST_MS,
  MAX_OFFLINE_MS,
  MAX_PATH_TILES,
  MAX_PROPOSALS,
  PRICE_MULT,
  SHOP_ITEMS,
  VOTE_MS,
  WONDER_BUILD_MS,
  WONDER_PHASES,
  actionError,
  actionLabel,
  addDrop,
  advance,
  anchorOf,
  applyAction,
  applyBoost,
  assignGatherer,
  assignWorkers,
  bedsOf,
  buildCost,
  buildTypeError,
  buyItem,
  capOf,
  capPartsOf,
  freeBedsOf,
  newcomerProfile,
  stepBirth,
  stepNewcomer,
  BIRTH_MS,
  fullOf,
  storeTypeOf,
  RESOURCES,
  buildingName,
  buildingType,
  currentWonder,
  dropContents,
  defenseOf,
  dutchHour,
  gateCost,
  isNight,
  nextDayAt,
  nextNightAt,
  workMs,
  DAY_MS,
  NIGHT_MS,
  nextRaidAt,
  raidStrength,
  repairCost,
  stepRaid,
  wallCost,
  RAID_WARNING_MS,
  fullRateOf,
  eraGoals,
  classicStreets,
  foodKindsOf,
  missingFoodOf,
  gatherable,
  gatherPatches,
  gatheringOf,
  happinessOf,
  isLand,
  isRiver,
  isRoad,
  isRoadTile,
  makeRoomForSenate,
  slotsOf,
  meet,
  pairKey,
  relationLevel,
  relationPoints,
  SOCIAL,
  taskError,
  TOGETHER_MS,
  COUNCIL_ITEMS,
  IDEAS_DONE_UNTIL,
  councilText,
  addTool,
  forgeError,
  forgeTool,
  NO_TOOL_MULT,
  RARITIES,
  stepForge,
  TOOL_COST,
  TOOL_CRAFT_MS,
  TOOL_LIFE_MS,
  TOOLS_FROM_ERA,
  toolUseOf,
  workMs,
  doForFree,
  fillStorage,
  finishPhases,
  withPlenty,
  isUsedUp,
  itemCost,
  itemError,
  multiplierAt,
  natureAt,
  newIdleState,
  HAPPY_STEP_MS,
  MOVE_MS,
  oresOf,
  producesOf,
  openDrop,
  patchAt,
  patches,
  pathCost,
  pathError,
  placeBuilding,
  placeError,
  buildingOn,
  middleOf,
  tilesOf,
  populationTarget,
  ratesOf,
  refundOf,
  rollLucky,
  wonderCost,
  roadCost,
  sourceLeft,
  sourcePatches,
  sourceShareOf,
  terrainAt,
  tileIndex,
  tileOf,
  unlockEra,
  upgradeCost,
  voteOutcome,
  votesNeeded,
  type IdleProposal,
  type IdleState,
  type IdleStateMsg,
  type PlacedBuilding,
} from "@app/shared/idle";
import { createCounterServer, isLocal } from "../server/src/counter.ts";
import { createIdleGame } from "../server/src/idle.ts";

const T0 = 1_000_000;
/**
 * Most tests start from the town as it used to begin before update 12: a
 * campfire, two huts, a hunters' camp and a woodcutter, with 6 villagers. A
 * real new town is smaller (see "newIdleState"). It has no happiness meter
 * yet, so its happiness sits right at what the town is worth.
 */
function town(now: number): IdleState {
  const s = newIdleState(now);
  const buildings: PlacedBuilding[] = [];
  for (const type of ["center", "house", "house", "hunter", "wood"]) buildings.push({ id: buildings.length + 1, type, level: 0, ...placeBuilding(buildings, type)! });
  const old = { ...s, buildings, nextBuildingId: buildings.length + 1, roads: classicStreets(buildings), population: 6, resources: { food: 50, wood: 60, stone: 40 } };
  delete (old as Partial<IdleState>).happiness;
  return old;
}
const TOOLS_WOOD = SHOP_ITEMS.find((i) => i.id === "tools_wood")!;
const rich = (s: IdleState, n = 1e9): IdleState => ({
  ...s,
  resources: Object.fromEntries(["food", "wood", "stone", "bronze", "iron", "gold"].map((r) => [r, n])),
});
/** Build on the tile the starting-town placer would pick (always a valid spot). */
const at = (s: IdleState, type: string) => ({ kind: "build" as const, type, ...placeBuilding(s.buildings, type)! });
const build = (s: IdleState, type: string) => applyAction(s, at(s, type)).state;
/** A farm takes the two villagers without a job, so nobody gathers. */
const noGatherers = (s: IdleState): IdleState => ({ ...s, buildings: [...s.buildings, { id: 99, type: "farm", level: 0, x: 1, y: 1 }] });
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

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
  let s = town(T0);
  assert.deepEqual(town(T0).buildings, s.buildings);
  s = rich(unlockEra(s, 3));
  s = build(s, "shop_sculptor");
  for (let i = 0; i < 40; i++) {
    const type = ["house", "house", "storage", "farm", "wood", "stone", "mine_bronze", "decor_statue67"][i % 8];
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

test("workers: round robin over work buildings, leftovers idle, production follows staff", () => {
  const s = town(T0); // 2 huts × 3 = 6 villagers, 2 jobs × 2 slots
  const w = assignWorkers(s);
  assert.equal(w.population, 6);
  assert.equal(w.idle, 2);
  assert.deepEqual(Object.values(w.workers), [2, 2]);
  // The two without a job gather: one food, one wood.
  const rates = ratesOf(s);
  assert.deepEqual(Object.keys(rates), ["food", "wood"]);
  assert.ok(near(rates.food, 0.5 + GATHER_RATE) && near(rates.wood, 0.5 + GATHER_RATE));
  assert.deepEqual(ratesOf(noGatherers(s)).wood, 0.5);

  // 3 villagers over 2 jobs → 2 + 1.
  const fewer = { ...s, population: 3 };
  assert.deepEqual(Object.values(assignWorkers(fewer).workers).sort(), [1, 2]);
  const r = ratesOf(fewer);
  assert.ok(near(r.food + r.wood, 0.75 * 0.8), "nobody on berries: only meat, a bit less happy");
});

test("advance: produces over time, boost doubles, offline is capped, storage limit holds", () => {
  const s = { ...noGatherers(town(T0)), resources: {} };
  assert.equal(advance(s, T0 + 10_000).resources.food, 10);
  assert.equal(advance({ ...s, boostUntil: T0 + 5_000 }, T0 + 10_000).resources.food, 15);
  const cap = capOf(s, "food");
  assert.equal(advance(s, T0 + MAX_OFFLINE_MS * 3).resources.food, cap);
  assert.equal(cap, 800); // base 400 + campfire 400
  const withBarn = { ...s, buildings: [...s.buildings, { id: 98, type: "storage", level: 0, x: 1, y: 2 }] };
  assert.equal(capOf(withBarn, "wood"), 1600, "the Schuur holds wood");
  assert.equal(capOf(withBarn, "food"), 800, "…and nothing else");
  const withPit = { ...withBarn, buildings: [...withBarn.buildings, { id: 97, type: "storage_food", level: 0, x: 2, y: 2 }] };
  assert.equal(capOf(withPit, "food"), 1600);
  assert.equal(advance(withPit, T0 + MAX_OFFLINE_MS * 3).resources.food, 1600);
  assert.deepEqual(s.resources, {}, "pure");
});

test("storage: one kind per resource, a full one sends the gatherers elsewhere", () => {
  for (const r of RESOURCES) assert.equal(buildingType(storeTypeOf(r.id)!)?.minEra, r.era, `${r.id} has its own storage from its era`);
  assert.equal(buildingName("storage", 0), "Schuur");
  const s = town(T0); // 2 without a job: on food and wood
  assert.deepEqual(gatheringOf(s).auto, { food: 1, wood: 1 });
  const fullWood = { ...s, resources: { ...s.resources, wood: capOf(s, "wood") } };
  assert.deepEqual([...fullOf(fullWood)], ["wood"]);
  assert.deepEqual(gatheringOf(fullWood).auto, { food: 1, stone: 1 }, "nobody gathers wood while it's full");
  const allFull = { ...s, resources: { food: 1e9, wood: 1e9, stone: 1e9 } };
  assert.deepEqual(gatheringOf(allFull).auto, { food: 1, wood: 1 }, "all full: as they were");
  const fullFood = { ...s, resources: { ...s.resources, food: 1e9 } };
  assert.deepEqual(Object.keys(foodKindsOf(fullFood)).sort(), Object.keys(foodKindsOf(s)).sort(), "a full storage doesn't change the menu");
  const parts = capPartsOf({ ...s, perks: { vault: 1 } }, "food");
  assert.deepEqual(parts.map((p) => p.amount), [400, 400, 200]);
});

test("gatherers: the jobless gather near the town, spread over the basics unless the players choose", () => {
  const s = town(T0); // 2 without a job
  assert.deepEqual(gatherable(0), ["food", "wood", "stone"]);
  assert.ok(!gatherable(1).includes("bronze") || gatherPatches("bronze").length > 0, "only what grows near the town");
  for (const p of gatherPatches("wood")) assert.equal(p.resource, "wood");
  assert.deepEqual(gatheringOf(s), { chosen: {}, auto: { food: 1, wood: 1 } });

  // Put one on stone: the other one is still left to themselves.
  const one = assignGatherer(s, null, "stone") as IdleState;
  assert.deepEqual(one.gatherers, { stone: 1 });
  assert.deepEqual(gatheringOf(one), { chosen: { stone: 1 }, auto: { food: 1 } });
  const two = assignGatherer(one, null, "stone") as IdleState;
  assert.deepEqual(gatheringOf(two), { chosen: { stone: 2 }, auto: {} });
  assert.equal(assignGatherer(two, null, "wood"), "iedereen zonder werk heeft al een taak");
  // Move one from stone to wood, and let one choose again.
  const moved = assignGatherer(two, "stone", "wood") as IdleState;
  assert.deepEqual(moved.gatherers, { stone: 1, wood: 1 });
  assert.deepEqual((assignGatherer(moved, "wood", null) as IdleState).gatherers, { stone: 1 });
  assert.equal(assignGatherer(s, "wood", null), "die verzamelt dat niet");
  assert.equal(assignGatherer(s, null, "bronze"), "dat groeit hier niet");
  assert.equal(assignGatherer(s, null, "nope"), "dat groeit hier niet");

  // Choices only count as far as there are people without a job.
  assert.deepEqual(gatheringOf(noGatherers(two)), { chosen: {}, auto: {} });
  // Production: a click's worth per GATHER_RATE per second each, taken from nature near the town.
  // (Without anyone on berries there's only meat on the menu: a bit less happy, ×0.8.)
  const empty = { ...two, resources: {} };
  assert.equal(happinessOf(empty, T0).mult, 0.8);
  const after = advance(empty, T0 + 10_000);
  assert.ok(near(after.resources.stone, 0.8 * 2 * GATHER_RATE * 10));
  const used = gatherPatches("stone").reduce((a, p) => a + (after.nature[p.id] ?? 0), 0);
  assert.ok(near(used, 0.8 * 2 * GATHER_RATE * 10), "a click used per click's worth");
  // All stone near the town gone: nothing more from it.
  const bare = { ...empty, nature: Object.fromEntries(gatherPatches("stone").map((p) => [p.id, p.capacity])) };
  assert.equal(ratesOf(bare).stone, undefined);
  assert.deepEqual(s.gatherers, {}, "pure");
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

  // Use a forest patch (far from the town) up: tiles go one by one, edge first, then nothing is left.
  const forest = all.find((p) => p.resource === "wood" && p.tiles.length >= 4 && !gatherPatches("wood").includes(p))!;
  const center = forest.tiles[forest.tiles.length - 1];
  const edge = forest.tiles[0];
  const half = { [forest.id]: Math.ceil(forest.capacity / 2) };
  assert.ok(isUsedUp(edge.x, edge.y, half) && !isUsedUp(center.x, center.y, half), "the edge goes first");
  const s = { ...town(T0), resources: {}, nature: { [forest.id]: forest.capacity } };
  assert.equal(natureAt(center.x, center.y, 0, s.nature), null, "used up");
  // It all grows back (wood: half an hour).
  const later = advance(s, T0 + 31 * 60_000);
  assert.equal(later.nature[forest.id], undefined);
  assert.equal(natureAt(center.x, center.y, 0, later.nature), "wood");
});

test("nature: work buildings use up what's around them and stop when it's gone", () => {
  const s = noGatherers(town(T0));
  const cutter = s.buildings.find((b) => b.type === "wood")!;
  const src = sourcePatches(cutter)!;
  assert.ok(src.length > 0 && src.every((p) => p.resource === "wood"));
  assert.equal(sourcePatches(s.buildings.find((b) => b.type === "farm") ?? { id: 0, type: "farm", level: 0, x: 0, y: 0 }), null, "farms need no forest");

  const after = advance({ ...s, resources: {} }, T0 + 100_000);
  assert.ok(Math.abs(after.resources.wood - 50) < 1e-9, "100 s of 0.5 wood/s");
  const used = Object.values(after.nature).reduce((a, n) => a + n, 0);
  assert.ok(Math.abs(used - 12.5) < 0.5, "a quarter click per wood");

  // Everything around it used up: no more wood from it, the farm goes on.
  const bare = { ...s, resources: {}, nature: Object.fromEntries(src.map((p) => [p.id, p.capacity])) };
  assert.equal(ratesOf(bare).wood, undefined);
  assert.equal(sourceLeft(bare, cutter)!.left, 0);
  const tick = advance(bare, T0 + 1000);
  // Only what grew back in that second (a quarter click per wood), at most its full 0.5 wood/s.
  const regrown = src.reduce((a, p) => a + p.regrow * 1000, 0);
  assert.ok(near(tick.resources.wood, Math.min(0.5, regrown / 0.25)));
  assert.ok(tick.resources.food > 0);
});

test("food: hunters, farms, fishers and ranches make kinds of food; hunters catch less where the forest is cut", () => {
  const s = noGatherers(town(T0)); // hunters, woodcutter and a farm, 2 each
  const hunter = s.buildings.find((b) => b.type === "hunter")!;
  const forest = sourcePatches(hunter)!;
  assert.ok(forest.length > 0 && forest.every((p) => p.resource === "wood"), "hunters look at the forest");
  assert.deepEqual(foodKindsOf(s), { meat: 0.5, grain: 0.5 });
  assert.equal(ratesOf(s).food, 1, "all of it is one food in storage");
  // The jobless gather berries.
  assert.ok(near(foodKindsOf(town(T0)).berries!, GATHER_RATE));

  // Half the forest around them cut: half the meat. All of it: none, the farm goes on.
  const half = { ...s, nature: Object.fromEntries(forest.map((p) => [p.id, p.capacity / 2])) };
  assert.ok(near(foodKindsOf(half).meat!, 0.25));
  assert.ok(near(sourceShareOf(half, hunter), 0.5));
  const bare = { ...s, nature: Object.fromEntries(forest.map((p) => [p.id, p.capacity])) };
  assert.deepEqual(foodKindsOf(bare), { grain: 0.5 });
  assert.equal(sourceLeft(bare, hunter)!.left, 0);

  // Hunting doesn't cut the forest: with a farm instead of the woodcutter it stays as it is.
  const farmed = s.buildings.map((b) => (b.type === "wood" ? { ...b, type: "farm" } : b));
  const after = advance({ ...s, resources: {}, buildings: farmed }, T0 + 100_000);
  assert.ok(near(after.resources.food, 150));
  for (const p of forest) assert.equal(after.nature[p.id], undefined);

  // Ranches from the Bronze Age, fishers by the river.
  assert.notEqual(buildTypeError(s, "ranch"), null);
  assert.equal(buildTypeError(unlockEra(s, 1), "ranch"), null);
  const spot = placeBuilding(s.buildings, "fishery")!;
  assert.equal(placeError(s.buildings, s.roads, "fishery", spot.x, spot.y), null);
  assert.equal(placeError(s.buildings, [], "fishery", CENTER.x + 1, CENTER.y + 1), "moet aan de rivier staan");

  // All food buildings share the price growth per copy, so splitting them makes food no cheaper.
  assert.equal(buildCost(s, "fishery")!.wood, Math.ceil(30 * BUILD_COST_MULT * COST_GROWTH ** 2 * PRICE_MULT));
});

test("food: the goal says which kinds count and why one is missing (bug, Nathan 2026-10-29)", () => {
  // Hunters and jobless pickers: meat and berries; grain and fish need their buildings.
  const s = town(T0);
  assert.deepEqual(missingFoodOf(s), [
    { kind: "grain", why: "bouw een Akker" },
    { kind: "fish", why: "bouw een Visstek" },
  ]);
  const goal = eraGoals(s).find((g) => g.goal.kind === "foodKinds")!;
  assert.equal(goal.note, "nu: 🥩 vlees, 🫐 bessen · 🌾 graan: bouw een Akker · 🐟 vis: bouw een Visstek");

  // A new work building takes the last pickers: the berries are gone.
  assert.equal(missingFoodOf(noGatherers(s)).find((m) => m.kind === "berries")?.why, "die plukken alleen inwoners zonder baan, en iedereen heeft er nu een");
  // The pickers put on wood by the players.
  assert.equal(missingFoodOf({ ...s, gatherers: { wood: 2 } }).find((m) => m.kind === "berries")?.why, "de inwoners zonder baan zijn allemaal op iets anders gezet, zet er een op 🍖");
  // The forest round the hunters cut, or their camp on fire.
  const hunter = s.buildings.find((b) => b.type === "hunter")!;
  const bare = { ...s, nature: Object.fromEntries(sourcePatches(hunter)!.map((p) => [p.id, p.capacity])) };
  assert.equal(missingFoodOf(bare).find((m) => m.kind === "meat")?.why, "het bos rond Jagerskamp is gekapt, dus geen wild");
  const burning = { ...s, buildings: s.buildings.map((b) => (b.type === "hunter" ? { ...b, damaged: true } : b)) };
  assert.equal(missingFoodOf(burning).find((m) => m.kind === "meat")?.why, "Jagerskamp staat in brand");
  // Once the goal is met it only says what the town eats.
  assert.equal(eraGoals(readyTown()).find((g) => g.goal.kind === "foodKinds")!.note?.startsWith("nu: "), true);
  assert.equal(eraGoals(readyTown()).find((g) => g.goal.kind === "foodKinds")!.note?.includes("·"), false);
});

test("mines: by the mountain, never run out, dig the ore the players vote for", () => {
  const s = noGatherers(rich(unlockEra(town(T0), 2)));
  const spot = placeBuilding(s.buildings, "mine")!;
  assert.equal(placeError(s.buildings, s.roads, "mine", spot.x, spot.y), null);
  assert.equal(placeError(s.buildings, [], "mine", CENTER.x + 1, CENTER.y + 1), "moet vlak bij de berg staan");
  assert.equal(terrainAt(spot.x, spot.y), "grass");

  const { state: built, building: mine } = applyAction(s, at(s, "mine"));
  assert.equal(producesOf(mine!), "stone", "stone until the players pick an ore");
  assert.equal(sourcePatches(mine!), null, "the mountain never runs out");
  assert.deepEqual(oresOf(built, "mine"), ["stone", "bronze", "iron", "coal"]);
  assert.deepEqual(oresOf(town(T0), "mine"), ["stone"]);

  // Switching ore is a vote, free; locked ores and the current one can't be picked.
  const toIron = { kind: "ore" as const, building: mine!.id, ore: "iron" };
  assert.equal(actionError(built, toIron), null);
  assert.equal(actionLabel(built, toIron), "🏔️ Mijngang: ⛓️ ijzer delven");
  assert.equal(actionError(built, { ...toIron, ore: "gold" }), "dat erts kan hier nog niet");
  assert.equal(actionError(built, { ...toIron, ore: "stone" }), "die delft dat al");
  const iron = applyAction(built, toIron);
  assert.equal(iron.building!.ore, "iron");
  assert.deepEqual(iron.state.resources, built.resources, "costs nothing");
  // Half of what a mine at the vein makes, and it keeps going: no nature used.
  const vein = { id: 0, type: "mine_iron", level: 2, x: 0, y: 0 };
  assert.ok(near(fullRateOf(iron.building!), fullRateOf(vein) / 2));
  assert.ok(advance({ ...iron.state, resources: {} }, T0 + 100_000).resources.iron > 0);
  // Back to stone drops the field again.
  assert.equal(applyAction(iron.state, { ...toIron, ore: "stone" }).building!.ore, undefined);
});

test("coal and smiths: coal from the Iron Age; smiths turn iron and coal into weapons and armor", () => {
  assert.equal(DEPOSITS.find((d) => d.resource === "coal")!.era, 2);
  assert.equal(natureAt(DEPOSITS.find((d) => d.resource === "coal")!.x, DEPOSITS.find((d) => d.resource === "coal")!.y, 2), "coal");
  const s0 = unlockEra(town(T0), 2);
  assert.equal(buildTypeError(s0, "mine_coal"), null);
  assert.equal(buildTypeError(unlockEra(town(T0), 1), "weaponsmith"), "nog niet ontgrendeld");

  // Only smiths work here (both full), with 100 iron and 100 coal in storage.
  const smiths = [
    { id: 1, type: "center", level: 2, x: CENTER.x, y: CENTER.y },
    { id: 2, type: "weaponsmith", level: 2, x: CENTER.x + 2, y: CENTER.y },
    { id: 3, type: "armorsmith", level: 2, x: CENTER.x - 2, y: CENTER.y },
  ];
  const s = { ...s0, buildings: smiths, population: 4, resources: { iron: 100, coal: 100 } };
  const per = fullRateOf(smiths[1]) * happinessOf(s, T0).mult;
  const rates = ratesOf(s);
  assert.ok(near(rates.weapons, per) && near(rates.armor, per));
  assert.ok(near(rates.iron, -2 * per) && near(rates.coal, -2 * per), "the HUD shows what's used");
  const t = 10_000;
  const after = advance(s, T0 + t);
  assert.ok(near(after.resources.weapons, (per * t) / 1000));
  assert.ok(near(after.resources.iron, 100 - (2 * per * t) / 1000));
  // They stop when the iron runs out, and make only as much as there was.
  const long = advance(s, T0 + 3_600_000);
  assert.ok(near(long.resources.weapons + (long.resources.armor ?? 0), 100));
  assert.ok(near(long.resources.iron, 0) && near(long.resources.coal, 0));
  assert.equal(ratesOf({ ...s, resources: {} }).weapons, undefined, "nothing in stock, nothing coming in");
});

test("tools: from the Iron Age every job needs its own tool; without one ×0.75, rare and epic ones better; they wear out", () => {
  // Two woodcutters' camps (4 workers), nobody else working or gathering.
  const camps = [
    { id: 1, type: "center", level: 2, x: CENTER.x, y: CENTER.y },
    { id: 2, type: "wood", level: 2, x: CENTER.x + 2, y: CENTER.y },
    { id: 3, type: "wood", level: 2, x: CENTER.x - 2, y: CENTER.y },
  ];
  const base = { ...unlockEra(town(T0), 2), buildings: camps, population: 4, resources: {} };
  assert.deepEqual(toolUseOf({ ...base, era: TOOLS_FROM_ERA - 1 }), {}, "stone tools before the Iron Age");
  const bare = toolUseOf(base);
  assert.deepEqual(bare, { axe: { need: 4, have: [0, 0, 0], mult: NO_TOOL_MULT } });
  const full = ratesOf({ ...base, tools: { axe: [4, 0, 0] } }).wood;
  assert.ok(near(ratesOf(base).wood, full * NO_TOOL_MULT), "a quarter slower without");
  // The best tools go first: one epic, one rare, one common, one worker without.
  const mixed = toolUseOf({ ...base, tools: { axe: [1, 1, 1] } }).axe!;
  assert.deepEqual(mixed.have, [1, 1, 1]);
  assert.ok(near(mixed.mult, (1.5 + 1.25 + 1 + NO_TOOL_MULT) / 4));

  // A tool lasts TOOL_LIFE_MS of work, an epic one half again as long.
  const s = { ...base, tools: { axe: [10, 0, 2] } };
  const later = advance(s, T0 + 3_600_000);
  const worked = workMs(T0, T0 + 3_600_000);
  assert.ok(near(later.tools.axe![0], 10 - (2 * worked) / TOOL_LIFE_MS));
  assert.ok(near(later.tools.axe![2], 2 - (2 * worked) / (TOOL_LIFE_MS * RARITIES[2].life)));
});

test("tools: a smith can make tools instead (vote), from iron and coal; the server hands them out where they're needed most", () => {
  const town2 = {
    ...unlockEra(town(T0), 2),
    buildings: [
      { id: 1, type: "center", level: 2, x: CENTER.x, y: CENTER.y },
      { id: 2, type: "weaponsmith", level: 2, x: CENTER.x + 2, y: CENTER.y },
      { id: 3, type: "fishery", level: 2, x: CENTER.x - 2, y: CENTER.y },
    ],
    population: 4,
    resources: { iron: 100, coal: 100 },
  };
  const on = { kind: "tools" as const, building: 2, on: true };
  assert.equal(actionError(town2, { ...on, building: 3 }), "dat is geen smidse");
  assert.equal(actionError(town2, { ...on, on: false }), "die maakt al wapens");
  assert.equal(actionLabel(town2, on), "⚔️ Wapensmid: 🔨 gereedschap maken");
  const s = applyAction(town2, on).state;
  assert.equal(s.buildings.find((b) => b.id === 2)!.tools, true);
  assert.equal(actionError(s, on), "die maakt al gereedschap");
  assert.equal(ratesOf(s).weapons, undefined, "no weapons meanwhile");
  assert.ok(ratesOf(s).iron! < 0, "iron goes to the tools");

  // In TOOL_CRAFT_MS of daytime work the full smith makes one tool (as happy as the town is).
  const day = T0 - (T0 % 2_400_000) + 60_000; // just after daybreak
  const made = advance({ ...s, lastTick: day }, day + TOOL_CRAFT_MS);
  const mult = happinessOf(s, day).mult;
  assert.ok(near(made.forged, mult));
  assert.ok(near(made.resources.iron, 100 - mult * TOOL_COST.iron));
  // The server makes a whole one into a tool for the fishers, who have none.
  const ready = { ...made, forged: 1.2 };
  const handed = stepForge(ready, () => 0.9)!;
  assert.ok(near(handed.state.forged, 0.2));
  assert.deepEqual(handed.state.tools.rod, [1, 0, 0]);
  assert.equal(handed.label, undefined, "a common one is no news");
  assert.equal(stepForge(ready, () => 0.01)!.label, "🔨 De smeden maakten 🎣 een epische hengel!");
  assert.equal(stepForge({ ...ready, forged: 0.5 }, () => 0), null);

  // Smithing one yourself: costs the same; a good game makes rare and epic likelier.
  assert.equal(forgeError(s, 2), null);
  assert.equal(forgeError(s, 3), "dat is geen smidse");
  assert.equal(forgeError({ ...s, resources: {} }, 2), "te duur");
  assert.equal(forgeError(unlockEra(town(T0), 1), 2), "gereedschap komt pas in de IJzertijd");
  const roll = 0.5;
  assert.equal(forgeTool(s, 0, roll).rarity, 0);
  assert.equal(forgeTool(s, 1, roll).rarity, 1);
  assert.equal(forgeTool(s, 0, roll).state.resources.iron, 100 - TOOL_COST.iron);
  assert.equal(addTool(s, 0.2, 1).rarity, 2);
});

/** A Bronze Age town with 30 people and a few buildings, as of T0. */
function raidTown(): IdleState {
  let s = rich(unlockEra(town(T0), 1), 0);
  for (const t of ["house", "house", "storage", "farm"]) s = build(s, t);
  return { ...s, population: 30, resources: { food: 1000, wood: 1000, stone: 1000 } };
}
/** rand() that gives these numbers in turn (the last one after that). */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[Math.min(i++, xs.length - 1)];
};

test("raids: from the Bronze Age, a few hours apart, at night while people are up, seen coming an hour before", () => {
  assert.equal(stepRaid(town(T0), Math.random), null, "no raids in the Stone Age");
  const s = raidTown();
  const planned = stepRaid(s, () => 0)!;
  assert.equal(planned.news, undefined);
  const at = planned.state.nextRaid;
  assert.ok(at >= T0 + 4 * 3_600_000 && at < T0 + 24 * 3_600_000);
  assert.ok(isNight(at));
  for (let i = 0; i < 50; i++) {
    const from = T0 + i * 3_917_000;
    const next = nextRaidAt(from, Math.random);
    const h = dutchHour(next);
    assert.ok(h >= 10 && h < 22, `hour ${h}`);
    assert.ok(isNight(next), "at night");
    assert.ok(next >= from + 4 * 3_600_000);
  }
  // Nothing until an hour before; then they're seen coming, with the strength fixed.
  const quiet = { ...planned.state, lastTick: at - RAID_WARNING_MS - 1 };
  assert.equal(stepRaid(quiet, Math.random), null);
  const seen = stepRaid({ ...quiet, lastTick: at - RAID_WARNING_MS }, seq(0.5, 0))!;
  assert.equal(seen.news!.stage, "coming");
  assert.equal(seen.state.raid!.at, at);
  assert.equal(seen.state.raid!.strength, raidStrength(s, 0.5));
  assert.equal(raidStrength(s, 0.5), 15 + 15 + 12);
  assert.match(seen.news!.label, /^⚔️ Vijanden in aantocht! Over 1 u 00 vallen ze aan: ⚔️ 42 tegen onze 🛡️ \d+$/);
  // After a long time nobody was around, there's still an hour's warning, and they still come at night.
  const lastTick = at + 5 * 3_600_000;
  const late = stepRaid({ ...planned.state, lastTick }, seq(0.5, 0))!;
  assert.ok(late.state.raid!.at >= lastTick + RAID_WARNING_MS && late.state.raid!.at <= lastTick + RAID_WARNING_MS + DAY_MS + 2 * 60_000);
  assert.ok(isNight(late.state.raid!.at));
});

test("day and night: 20 minutes each by the clock, at night everything is made at half speed", () => {
  const night = nextNightAt(T0);
  assert.ok(!isNight(night - 1) && isNight(night) && isNight(night + NIGHT_MS - 1) && !isNight(night + NIGHT_MS));
  assert.equal(nextNightAt(night), night);
  assert.equal(nextDayAt(night + 1000), night + NIGHT_MS);
  assert.equal(nextDayAt(night - 1000), night - 1000);
  assert.equal(DAY_MS, 20 * 60_000);
  assert.equal(workMs(night - 60_000, night), 60_000);
  assert.equal(workMs(night, night + 60_000), 30_000);
  assert.equal(workMs(night - DAY_MS, night + NIGHT_MS), DAY_MS + NIGHT_MS / 2);
  // A day and a night of work in two hours: the same however it's cut up.
  assert.equal(workMs(T0, T0 + 7_200_000), workMs(T0, T0 + 1_234_567) + workMs(T0 + 1_234_567, T0 + 7_200_000));
  // The town makes half as much in a minute of night as in a minute of day, and shows half the rate.
  const s = { ...town(T0), resources: {} };
  const day = advance({ ...s, lastTick: night - 60_000 }, night);
  const dark = advance({ ...s, lastTick: night }, night + 60_000);
  assert.ok(day.resources.wood! > 0);
  assert.ok(Math.abs(dark.resources.wood! - day.resources.wood! / 2) < 1e-9);
  assert.ok(Math.abs(ratesOf({ ...s, lastTick: night }).wood! - ratesOf({ ...s, lastTick: night - 1 }).wood! / 2) < 1e-9);
});

test("raids: walls, towers, villagers and armed guards defend; a lost fight steals, kills and sets a building on fire", () => {
  const s = raidTown();
  assert.deepEqual(defenseOf(s).parts.map((p) => [p.emoji, p.points]), [["🧍", 6]]);
  // 10 sets of weapons (20 × 4 each in the Bronze Age), 5 of armor, 20 wall tiles, a tower.
  const walls = Array.from({ length: 20 }, (_, i) => tileIndex(CENTER.x - 10 + i, CENTER.y + 9));
  const tower = { id: 77, type: "tower", level: 1, x: 3, y: 3 };
  const strong = { ...s, walls, wallLevel: 1, buildings: [...s.buildings, tower], resources: { ...s.resources, weapons: 800, armor: 400 } };
  assert.deepEqual(defenseOf(strong).parts.map((p) => [p.emoji, p.points]), [["🧍", 6], ["🗡️", 10], ["🛡️", 2.5], ["🧱", 20], ["🗼", 20]]);
  assert.equal(defenseOf(strong).total, 59);

  const coming = (t: IdleState, strength: number) => ({ ...t, raid: { at: T0, strength, from: { x: 1, y: 1 } }, nextRaid: T0 });
  // Won: nothing lost but a tenth of the weapons, and the town is proud for a while.
  const won = stepRaid(coming(strong, 50), () => 0)!;
  assert.equal(won.news!.stage, "won");
  assert.equal(won.state.raid, null);
  assert.ok(won.state.nextRaid > T0);
  assert.equal(won.state.resources.weapons, 720);
  assert.equal(won.state.resources.wood, 1000);
  assert.ok(happinessOf(won.state, T0).parts.some((p) => p.label === "aanval afgeslagen" && p.points === 10));
  assert.equal(won.state.lastRaid!.won, true);

  // Lost with half the strength: a fifth of everything stolen, 1.5 → 2 dead, a building on fire.
  const lost = stepRaid(coming(s, 12), () => 0)!;
  assert.equal(lost.news!.stage, "lost");
  assert.equal(lost.state.resources.wood, 800);
  assert.equal(lost.state.population, 28);
  const burnt = lost.state.buildings.find((b) => b.damaged)!;
  assert.equal(lost.news!.damaged, burnt.id);
  assert.match(lost.news!.label, /^🔥 Het dorp is geplunderd! 🛡️ 6 tegen ⚔️ 12: 2 doden, (een|de) .+ staat in brand, een deel van de voorraad is weg$/);
  assert.ok(happinessOf(lost.state, T0).parts.some((p) => p.points === -15));
  assert.deepEqual(lost.state.lastRaid!.stolen, { food: 200, wood: 200, stone: 200 });
});

test("raids: a building on fire does nothing until a vote repairs it", () => {
  const s = raidTown();
  const house = s.buildings.find((b) => b.type === "house")!;
  const cutter = s.buildings.find((b) => b.type === "wood")!;
  const storage = s.buildings.find((b) => b.type === "storage")!;
  const fire = (ids: number[]) => ({ ...s, buildings: s.buildings.map((b) => (ids.includes(b.id) ? { ...b, damaged: true } : b)) });
  const burnt = fire([house.id, cutter.id, storage.id]);
  assert.equal(bedsOf(burnt), bedsOf(s) - 3);
  assert.equal(assignWorkers(burnt).workers[cutter.id], undefined);
  assert.ok(capOf(burnt, "wood") < capOf(s, "wood"));
  const repair = { kind: "repair" as const, building: house.id };
  assert.equal(actionError(s, repair), "niet beschadigd");
  assert.equal(actionError(burnt, repair), null);
  assert.equal(actionLabel(burnt, repair), "🔧 Hut herstellen");
  assert.deepEqual(repairCost(s, house), { wood: 27, stone: 9 });
  assert.equal(actionError(unlockEra(burnt, 2), { kind: "upgrade", building: house.id }), "eerst herstellen");
  const fixed = applyAction(burnt, repair);
  assert.equal(fixed.building!.damaged, undefined);
  assert.equal(fixed.state.resources.wood, 1000 - 27);
});

test("walls: drawn on free land near the village like paths, upgraded all at once, block paths and buildings", () => {
  const s = raidTown();
  const free = findTile((x, y) => isBuildableTile(x, y) && !s.buildings.some((b) => b.x === x && b.y === y) && Math.abs(x - CENTER.x) + Math.abs(y - CENTER.y) < 6 && !isRoad(s.roads, x, y));
  const tile = tileIndex(free.x, free.y);
  const action = { kind: "walls" as const, tiles: [tile] };
  assert.equal(actionError(s, action), null);
  assert.deepEqual(wallCost(s, [tile, tile + 1]), { wood: 24, stone: 16 });
  assert.equal(actionLabel(s, action), "🧱 1 tegel palissade bouwen");
  const walled = applyAction(s, action).state;
  assert.deepEqual(walled.walls, [tile]);
  assert.match(actionError(walled, action)!, /daar staat al een muur/);
  assert.match(actionError(walled, { kind: "paths", tiles: [tile] })!, /daar staat een muur/);
  assert.equal(actionError(walled, { kind: "build", type: "house", ...free }), "daar staat een muur");
  assert.match(actionError(s, { kind: "walls", tiles: [tileIndex(1, 1)] })!, /een muur kan alleen op land|te ver van het dorp/);
  // Upgrading the whole wall to the era; taking it off gives a bit back.
  assert.equal(actionError(s, { kind: "fortify" }), "er staan nog geen muren");
  assert.equal(actionLabel(walled, { kind: "fortify" }), "🧱 Palissade → Aarden wal");
  assert.equal(applyAction(walled, { kind: "fortify" }).state.wallLevel, 1);
  const off = applyAction(walled, { kind: "unwall", tiles: [tile] }).state;
  assert.deepEqual(off.walls, []);
  assert.equal(off.resources.wood, walled.resources.wood + 3);
});

test("gates: a wall tile becomes a gate through a vote, for its own price; taking the wall off takes the gate too", () => {
  const s = raidTown();
  const free = findTile((x, y) => isBuildableTile(x, y) && !s.buildings.some((b) => b.x === x && b.y === y) && Math.abs(x - CENTER.x) + Math.abs(y - CENTER.y) < 6 && !isRoad(s.roads, x, y));
  const tile = tileIndex(free.x, free.y);
  const gate = { kind: "gate" as const, tiles: [tile] };
  assert.equal(actionError(s, gate), "een poort komt in een muur");
  const walled = applyAction(s, { kind: "walls", tiles: [tile] }).state;
  assert.equal(actionError(walled, gate), null);
  assert.deepEqual(gateCost(walled, [tile]), { wood: 60, stone: 20 });
  assert.equal(actionLabel(walled, gate), "🚪 Poort in de muur");
  const gated = applyAction(walled, gate).state;
  assert.deepEqual(gated.gates, [tile]);
  assert.equal(gated.resources.wood, walled.resources.wood - 60);
  assert.equal(actionError(gated, gate), "daar is al een poort");
  const off = applyAction(gated, { kind: "unwall", tiles: [tile] }).state;
  assert.deepEqual([off.walls, off.gates], [[], []]);

  // On the server: proposed like anything else, and only gates in the wall survive a restart.
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const file = path.join(dir, "idle.json");
    writeFileSync(file, JSON.stringify({ ...walled, gates: [tile + 1] }));
    const game = createIdleGame(file, T0);
    assert.deepEqual(game.message("a", 0, 0, 1, T0).state.gates, []);
    assert.equal(game.propose("a", "Ann", gate, 2, T0).error, undefined);
    assert.deepEqual(game.message("a", 0, 0, 2, T0).proposals.map((p) => p.action), [gate]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("happiness: food variety, beds, decorations and the tavern; it sets the work speed", () => {
  const s = town(T0); // meat from the hunters, berries from a gatherer
  assert.deepEqual(happinessOf(s, T0), { level: 50, target: 50, parts: [{ emoji: "🍽️", label: "2 soorten voedsel", points: 0 }], mult: 1 });

  // One kind of food: unhappy, they work slower.
  const bland = { ...s, gatherers: { wood: 2 } };
  assert.deepEqual([happinessOf(bland, T0).level, happinessOf(bland, T0).mult], [30, 0.8]);
  assert.ok(near(ratesOf(bland).food, 0.4));

  // Decorations (+4 each, +20 at most), the tavern and a party.
  const decor = Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, type: "decor_flowers", level: 0, x: i, y: 0 }));
  const merry = {
    ...s,
    buildings: [...s.buildings, ...decor, { id: 200, type: "shop_tavern", level: 0, x: 0, y: 1 }],
    boosts: [{ item: "party", resource: null, mult: 2, until: T0 + 1000 }],
  };
  const h = happinessOf(merry, T0);
  assert.deepEqual(h.parts.map((p) => p.points), [0, 20, 10, 15]);
  assert.equal(h.level, 95);
  assert.ok(near(h.mult, 1.18));
  assert.equal(happinessOf(merry, T0 + 1000).level, 80, "the party is over");

  // Sleeping outside: a share of the town without a bed costs that share of 60 points.
  const crowded = { ...s, population: 9 };
  assert.deepEqual(happinessOf(crowded, T0).parts.at(-1), { emoji: "⛺", label: "3 zonder bed", points: -20 });
  assert.equal(happinessOf(crowded, T0).level, 30);
  assert.equal(happinessOf({ ...s, population: 100, gatherers: {} }, T0).level, 0, "never below 0");
});

test("population: nobody moves in by themselves, people leave an unhappy town", () => {
  const s = { ...town(T0), resources: {} };
  assert.equal(s.population, 6, "a fresh town: one per bed");
  assert.equal(populationTarget(s, T0), 6, "content: as many as there are beds");

  // A happy town draws more, and a new hut has room, but newcomers knock (and wait for a vote).
  const decor = Array.from({ length: 5 }, (_, i) => ({ id: 100 + i, type: "decor_flowers", level: 0, x: i, y: 0 }));
  const happy = { ...s, buildings: [...s.buildings, ...decor, { id: 200, type: "shop_tavern", level: 0, x: 0, y: 1 }] };
  assert.equal(populationTarget(happy, T0), 6 * (1 + 30 / 200));
  assert.equal(advance(happy, T0 + 10 * MOVE_MS).population, 6);
  const hut = { ...s, buildings: [...s.buildings, { id: 300, type: "house", level: 0, x: 2, y: 2 }] };
  assert.equal(freeBedsOf(hut), 3);
  assert.equal(advance(hut, T0 + 3 * MOVE_MS).population, 6);

  // A miserable town loses up to half its people.
  const bland = { ...s, gatherers: { wood: 2 } };
  assert.equal(populationTarget(bland, T0), 6 * 0.8);
  assert.equal(advance(bland, T0 + 3 * MOVE_MS).population, 5, "only whole villagers leave");
  assert.equal(advance({ ...s, happiness: 49 }, T0 + 3 * MOVE_MS).population, 6, "a hair under content: nobody leaves");
  assert.equal(s.population, 6, "pure");
});

test("newcomers: one knocks while there's a free bed and the town is happy enough; the players vote", () => {
  const seq = (...xs: number[]) => () => xs.shift() ?? 0;
  const s: IdleState = { ...town(T0), resources: {} };
  assert.equal(stepNewcomer(s, seq(0)), null, "no free bed: nobody knocks");
  const hut = { ...s, buildings: [...s.buildings, { id: 300, type: "house", level: 0, x: 2, y: 2 }] };
  const knock = stepNewcomer(hut, seq(0, 0, 0))!;
  assert.equal(knock.label, "🚪 Er klopt iemand aan: Aaltje, jager, van over de rivier. Stem of die mag blijven!");
  const p = knock.state.proposals[0];
  assert.deepEqual([p.action, p.by, p.votes, p.deadline], [{ kind: "newcomer", who: { name: "Aaltje", trade: "jager", from: "van over de rivier" } }, "Aaltje", {}, T0 + VOTE_MS]);
  assert.equal(actionLabel(hut, p.action), "🚪 Aaltje mag blijven");
  assert.equal(stepNewcomer(knock.state, seq(0)), null, "one at a time");
  assert.equal(stepNewcomer({ ...knock.state, proposals: [] }, seq(0)), null, "and at most one per half hour");
  assert.ok(stepNewcomer({ ...knock.state, proposals: [], lastTick: T0 + MOVE_MS }, seq(0)));
  assert.equal(stepNewcomer({ ...hut, happiness: 20 }, seq(0)), null, "an unhappy town draws nobody");
  // Voted in: one more villager, while there's still a bed.
  assert.equal(actionError(hut, p.action), null);
  assert.equal(applyAction(hut, p.action).state.population, 7);
  assert.equal(actionError(s, p.action), "geen bed vrij");
  // Trades come with their era.
  assert.equal(newcomerProfile(0, seq(0, 0.99, 0)).trade, "visser");
  assert.equal(newcomerProfile(10, seq(0, 0.99, 0)).trade, "androïde");
});

test("children: a couple has one now and then, with a free bed and a happy enough town", () => {
  const seq = (...xs: number[]) => () => xs.shift() ?? 0.5;
  const s = { ...town(T0), resources: {}, buildings: [...town(T0).buildings, { id: 300, type: "house", level: 0, x: 2, y: 2 }] };
  const planned = stepBirth(s, seq(0.5))!;
  assert.equal(planned.state.nextBirth, T0 + BIRTH_MS / 3, "3 couples: three times as often");
  assert.equal(planned.label, undefined);
  assert.equal(stepBirth({ ...planned.state, lastTick: T0 + 1000 }, seq()), null, "not yet");
  const later = { ...planned.state, lastTick: planned.state.nextBirth };
  const born = stepBirth(later, seq(0.5, 0, 0.1, 0.2))!;
  assert.equal(born.state.population, 7);
  assert.match(born.label!, /^👶 .+ en .+ kregen een kind: welkom, .+!$/);
  assert.ok(born.state.nextBirth > later.lastTick);
  assert.equal(stepBirth({ ...later, buildings: town(T0).buildings }, seq())!.state.population, 6, "no free bed: no child");
  assert.equal(stepBirth({ ...later, happiness: 40 }, seq())!.state.population, 6, "too unhappy: no child");
});

test("happiness: the meter creeps a point per 10 minutes towards what the town is worth, up and down", () => {
  const s = { ...town(T0), happiness: 50 };
  const decor = Array.from({ length: 5 }, (_, i) => ({ id: 100 + i, type: "decor_flowers", level: 0, x: i, y: 0 }));
  const merry = { ...s, buildings: [...s.buildings, ...decor, { id: 200, type: "shop_tavern", level: 0, x: 0, y: 1 }] };
  const h = happinessOf(merry, T0);
  assert.deepEqual([h.level, h.target, h.mult], [50, 80, 1], "they work as happy as the meter says");
  assert.ok(near(advance(merry, T0 + 5 * HAPPY_STEP_MS).happiness, 55));
  assert.equal(advance(merry, T0 + 100 * HAPPY_STEP_MS).happiness, 80, "and it stops there");
  // Down just as slowly: one kind of food.
  const bland = { ...s, gatherers: { wood: 2 } };
  assert.ok(near(advance(bland, T0 + 3 * HAPPY_STEP_MS).happiness, 47));
  // People come and go by the meter, not by where it's heading.
  assert.equal(populationTarget(bland, T0), 6);
  assert.equal(populationTarget({ ...bland, happiness: 40 }, T0), 6 * 0.9);
});

test("a new town: a campfire, one hut and a barn; three villagers without a job, content", () => {
  const s = newIdleState(T0);
  assert.deepEqual(s.buildings.map((b) => b.type), ["center", "house", "storage"]);
  assert.deepEqual([s.population, s.happiness, assignWorkers(s).idle], [3, 50, 3]);
  assert.equal(s.roads.length > 0, true, "with streets around it");
});

/** The Stone Age goals met: 15 people, three kinds of food, a barn. */
function readyTown(): IdleState {
  let s = rich(town(T0));
  for (const t of ["storage", "farm", "fishery"]) s = build(s, t);
  for (let i = 0; i < 3; i++) s = build(s, "house");
  return { ...s, population: 15 };
}

test("eras: goals first, then the world wonder in phases; its last phase starts the next era", () => {
  const fresh = town(T0);
  const goals = eraGoals(fresh);
  assert.deepEqual(goals.map((g) => [g.label, g.have, g.done]), [
    ["👥 15 inwoners", 6, false],
    ["😊 minstens 50% geluk", 50, true],
    ["🍽️ 3 soorten voedsel", 2, false],
    ["🏚️ een Schuur", 0, false],
  ]);
  // A wonder needs all its tiles free (Stonehenge 3×3).
  const spot = (st: IdleState) => ({ kind: "build" as const, type: "wonder_0", ...findTile((x, y) => !placeError(st.buildings, st.roads, "wonder_0", x, y, st.walls)) });
  assert.equal(actionError(rich(fresh), spot(fresh)), "eerst de doelen van dit tijdperk halen");
  assert.equal(actionError(rich(fresh), { ...spot(fresh), type: "wonder_1" }), "nog niet ontgrendeld");

  let s = readyTown();
  assert.ok(eraGoals(s).every((g) => g.done), JSON.stringify(eraGoals(s)));
  assert.equal(actionLabel(s, spot(s)), `🗿 Stonehenge bouwen (fase 1/${WONDER_PHASES})`);
  assert.equal(actionError({ ...s, resources: {} }, spot(s)), "te duur");
  const before = s.resources.wood;
  s = applyAction(s, spot(s)).state;
  const w = currentWonder(s)!;
  assert.deepEqual([w.type, w.stage, w.ready], ["wonder_0", 1, T0 + WONDER_BUILD_MS]);
  assert.equal(before - s.resources.wood, wonderCost(s, 0).wood);
  assert.equal(actionError(s, spot(s)), "bestaat al");
  const next = { kind: "wonder" as const, building: w.id };
  assert.match(actionError(s, next)!, /^de bouwers zijn nog bezig \(nog 24 u 00\)$/);
  assert.equal(actionError(s, { kind: "demolish", building: w.id }), "een wereldwonder blijft staan");

  // Each phase costs more; after the last one it's done and the Bronze Age begins.
  assert.ok(wonderCost(s, 1).wood > wonderCost(s, 0).wood);
  for (let phase = 1; phase < WONDER_PHASES; phase++) {
    s = { ...s, lastTick: currentWonder(s)!.ready! };
    assert.equal(actionLabel(s, next), `🗿 Stonehenge: fase ${phase + 1}/${WONDER_PHASES}`);
    assert.equal(actionError(s, next), null);
    s = applyAction(s, next).state;
  }
  assert.equal(s.era, 1);
  const done = s.buildings.find((b) => b.id === w.id)!;
  assert.deepEqual([done.stage, done.ready, done.level], [undefined, undefined, 0], "finished, it stays as a Stone Age monument");
  assert.equal(currentWonder(s), null, "the Bronze Age has its own wonder");
  assert.equal(eraGoals(s)[0].label, "👥 30 inwoners");
  assert.equal(actionError(s, next), "al af");
  assert.equal(actionError(s, { ...spot(s), type: "wonder_0" }), "bestaat al");
  assert.equal(eraGoals(unlockEra(s, ERAS.length - 1)).length, 0, "nothing after the last era");
});

test("supply drops: a crate lands on free land near the center and holds a few minutes of production", () => {
  const s = town(T0);
  let r = 0;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  let t = addDrop(s, rand);
  assert.equal(t.drops.length, 1);
  const [d] = t.drops;
  assert.ok(isLand(d.x, d.y) && !isRoad(t.roads, d.x, d.y) && !t.buildings.some((b) => b.x === d.x && b.y === d.y));
  assert.ok(Math.abs(d.x - CENTER.x) <= 6 && Math.abs(d.y - CENTER.y) <= 6);
  for (let i = 0; i < 5; i++) t = addDrop(t, rand);
  assert.equal(t.drops.length, 3, "at most three wait");

  // Five minutes of production, at least 60 of each base resource.
  const got = dropContents(t);
  assert.equal(got.food, Math.floor(ratesOf(t).food * 300));
  assert.equal(got.stone, 60);
  const opened = openDrop({ ...t, resources: {} }, d.id);
  assert.ok(typeof opened !== "string");
  assert.deepEqual(opened.state.resources, got);
  assert.equal(opened.state.drops.length, 2);
  assert.equal(openDrop(opened.state, d.id), "die krat is al open");
});

test("lucky events: now and then on a +1, at most once per half hour", () => {
  const s = { ...rich(town(T0)), lastTick: T0 + 3600_000 };
  const seq = (...xs: number[]) => () => xs.shift() ?? 0;
  assert.equal(rollLucky(s, seq(0.5)), null, "not this time");
  assert.equal(rollLucky({ ...s, lastLucky: s.lastTick - 60_000 }, seq(0)), null, "cooling down");

  const gold = rollLucky(s, seq(0, 0, 0.5))!;
  assert.match(gold.label, /^🌟 Gouden uur: 🪵 ×3 voor 10 minuten$/);
  assert.equal(multiplierAt(gold.state, "wood", s.lastTick), 3);
  assert.equal(gold.state.lastLucky, s.lastTick);

  const roomy = { ...s, buildings: [...s.buildings, { id: 300, type: "house", level: 0, x: 2, y: 2 }, { id: 301, type: "house", level: 0, x: 3, y: 2 }] };
  const come = rollLucky(roomy, seq(0, 0.4))!;
  assert.equal(come.label, "🧳 Nieuwkomers: 3 mensen trekken het dorp in");
  assert.equal(come.state.population, s.population + 3);
  const one = rollLucky({ ...roomy, population: 11 }, seq(0, 0.4))!;
  assert.equal(one.label, "🧳 Nieuwkomers: iemand trekt het dorp in", "only as far as there are beds");
  assert.match(rollLucky(s, seq(0, 0.4))!.label, /^🥳 Spontaan feest/, "no free bed: a party instead");

  const party = rollLucky(s, seq(0, 0.7))!;
  assert.equal(happinessOf(party.state, s.lastTick).level, happinessOf(s, s.lastTick).level + 20);
  assert.equal(multiplierAt(party.state, "wood", s.lastTick), 1, "no production boost");
});

test("boost stacks by 67 s, up to an hour ahead", () => {
  let s = applyBoost(town(T0), T0);
  assert.equal(s.boostUntil, T0 + BOOST_MS);
  for (let i = 0; i < 200; i++) s = applyBoost(s, T0);
  assert.equal(s.boostUntil, T0 + MAX_BOOST_MS);
});

test("build: at the current era, unlocked types only, cost grows per copy, pays", () => {
  let s = town(T0);
  const spot = { x: 40, y: 38 };
  assert.equal(actionError(s, { kind: "build", type: "center", ...spot }), "bestaat al");
  assert.equal(actionError(s, { kind: "build", type: "mine_bronze", ...spot }), "nog niet ontgrendeld");
  assert.equal(actionError(s, { kind: "build", type: "nope", ...spot }), "onbekend");
  assert.equal(actionError({ ...s, resources: {} }, at(s, "house")), "te duur");

  const first = buildCost(s, "house")!;
  assert.deepEqual(first, { wood: Math.ceil(30 * 1.5 * 1.3 ** 2 * 2), stone: Math.ceil(10 * 1.5 * 1.3 ** 2 * 2) }, "×1.5, ×1.3 per hut already there, ×2 for every price");
  s = { ...s, resources: { wood: 1000, stone: 1000 } };
  const action = at(s, "house");
  const { state, building } = applyAction(s, action);
  assert.equal(building!.level, 0);
  assert.deepEqual([building!.x, building!.y], [action.x, action.y], "exactly where it was proposed");
  assert.equal(state.resources.wood, 1000 - first.wood);
  assert.ok(buildCost(state, "house")!.wood > first.wood);

  // In the Bronze Age a new house is a level-1 house and costs bronze.
  const bronzeAge = rich(unlockEra(town(T0), 1));
  assert.ok(buildCost(bronzeAge, "house")!.bronze > 0);
  assert.equal(applyAction(bronzeAge, at(bronzeAge, "house")).building!.level, 1);
  // A copper mine never costs copper.
  assert.equal(buildCost(bronzeAge, "mine_bronze")!.bronze, undefined);
});

test("developer menu: free mode builds without paying, a wonder's phases follow each other at once; full storage", () => {
  const poor = { ...readyTown(), resources: { food: 1, wood: 2, stone: 3 } };
  const spot = { kind: "build" as const, type: "wonder_0", ...findTile((x, y) => !placeError(poor.buildings, poor.roads, "wonder_0", x, y, poor.walls)) };
  assert.equal(actionError(poor, spot), "te duur");
  assert.equal(actionError(withPlenty(poor), spot), null);
  let s = poor;
  const first = doForFree(s, spot);
  assert.ok(typeof first !== "string");
  s = first.state;
  assert.deepEqual(s.resources, poor.resources, "nothing paid");
  const w = currentWonder(s)!;
  assert.deepEqual([w.stage, w.ready], [1, undefined], "no builders to wait for");
  for (let phase = 1; phase < WONDER_PHASES; phase++) {
    const done = doForFree(s, { kind: "wonder", building: w.id });
    assert.ok(typeof done !== "string", String(done));
    s = done.state;
  }
  assert.equal(s.era, 1, "the last phase starts the next era");
  assert.equal(doForFree(s, { kind: "upgrade", building: 12345 }), "onbekend gebouw", "the same checks");

  // Outside free mode the builders still take their time, until "bouwfases klaar".
  const paid = applyAction(rich(poor), spot).state;
  const busy = { kind: "wonder" as const, building: currentWonder(paid)!.id };
  assert.match(actionError(paid, busy)!, /^de bouwers zijn nog bezig/);
  assert.equal(actionError(finishPhases(paid), busy), null);

  const full = fillStorage(poor);
  assert.equal(full.resources.wood, capOf(poor, "wood"));
  assert.equal(full.resources.stone, capOf(poor, "stone"));
});

test("big buildings: De Senaat takes 3×3 once the Kampvuur grows, wonders their own shape; the tiles must be cleared first", () => {
  assert.deepEqual(tilesOf({ type: "center", level: 0, x: 42, y: 42 }), [{ x: 42, y: 42 }]);
  assert.equal(tilesOf({ type: "center", level: 1, x: 42, y: 42 }).length, 9);
  assert.equal(buildingName("center", 0), "Kampvuur");
  assert.equal(buildingName("center", 3), "De Senaat");
  assert.equal(tilesOf({ type: "wonder_0", x: 10, y: 10 }).length, 9, "Stonehenge 3×3");
  assert.deepEqual(tilesOf({ type: "wonder_4", x: 10, y: 10 }).map((t) => [t.x - 10, t.y - 10]).sort(), [[-1, 0], [0, -1], [0, 0], [0, 1], [1, 0]], "the cathedral is a cross");
  assert.deepEqual(middleOf({ type: "wonder_2", x: 10, y: 10 }), { x: 11, y: 11 }, "a 2×2 colossus");
  assert.equal(buildingOn([{ id: 1, type: "wonder_0", level: 0, x: 10, y: 10 }], 11, 9)?.id, 1);

  // A new town keeps the tiles round the Kampvuur free, and so does building.
  const fresh = newIdleState(T0);
  assert.ok(fresh.buildings.slice(1).every((b) => Math.max(Math.abs(b.x - CENTER.x), Math.abs(b.y - CENTER.y)) > 1));
  assert.equal(placeError(fresh.buildings, fresh.roads, "house", CENTER.x + 1, CENTER.y), "hier komt later De Senaat");
  assert.equal(placeError(fresh.buildings, [], "wonder_0", CENTER.x + 2, CENTER.y), "te dicht bij het Kampvuur: daar komt later De Senaat");

  // An old town with a hut next to the fire: De Senaat waits until it's gone.
  const hut = { id: 90, type: "house", level: 0, x: CENTER.x + 1, y: CENTER.y + 1 };
  const old = rich(unlockEra({ ...fresh, buildings: [...fresh.buildings, hut] }, 1));
  const center = old.buildings.find((b) => b.type === "center")!;
  assert.equal(actionError(old, { kind: "upgrade", building: center.id }), "eerst vrijmaken: Hut staat in de weg");
  const cleared = applyAction(old, { kind: "demolish", building: hut.id }).state;
  assert.equal(actionError(cleared, { kind: "upgrade", building: center.id }), null);
  const senaat = applyAction(cleared, { kind: "upgrade", building: center.id }).state;
  assert.equal(tilesOf(senaat.buildings.find((b) => b.type === "center")!).length, 9);
  assert.equal(placeError(senaat.buildings, senaat.roads, "house", CENTER.x + 1, CENTER.y), "daar staat al iets");

  // Loading such a town moves the hut out of the way, a bit further from the fire.
  const roomy = makeRoomForSenate(old);
  const moved = roomy.buildings.find((b) => b.id === hut.id)!;
  assert.ok(Math.max(Math.abs(moved.x - CENTER.x), Math.abs(moved.y - CENTER.y)) > 1);
  assert.ok(!isRoad(roomy.roads, moved.x, moved.y) && !roomy.buildings.some((b) => b !== moved && b.x === moved.x && b.y === moved.y));
  assert.deepEqual({ ...moved, x: 0, y: 0 }, { ...hut, x: 0, y: 0 }, "the same hut");
  assert.equal(actionError(rich(roomy), { kind: "upgrade", building: center.id }), null);
  assert.equal(makeRoomForSenate(fresh), fresh, "a new town is left as it is");

  // A wonder on top of a building: clear it first.
  const spot = findTile((x, y) => !placeError(fresh.buildings, fresh.roads, "wonder_0", x, y));
  const inTheWay = [...fresh.buildings, { id: 91, type: "house", level: 0, x: spot.x + 1, y: spot.y }];
  assert.equal(placeError(inTheWay, fresh.roads, "wonder_0", spot.x, spot.y), "eerst vrijmaken: Hut staat in de weg");
});

test("upgrade: old buildings go straight to the current era, decorations never", () => {
  let s = rich(town(T0));
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
  assert.ok(bedsOf(state) > bedsOf(s), "bigger house");

  const statue = s.buildings.find((b) => b.type === "decor_statue67")!;
  assert.equal(actionError(s, { kind: "upgrade", building: statue.id }), "kan niet upgraden");
  assert.equal(actionError(s, { kind: "upgrade", building: 12345 }), "onbekend gebouw");
});

test("demolish: anything but the center, for a share of its cost back, up to the storage limit", () => {
  const s = rich(town(T0), 0);
  const center = s.buildings.find((b) => b.type === "center")!;
  assert.equal(actionError(s, { kind: "demolish", building: center.id }), "het centrum blijft staan");
  assert.equal(actionError(s, { kind: "demolish", building: 12345 }), "onbekend gebouw");
  const hut = s.buildings.find((b) => b.type === "house")!;
  const action = { kind: "demolish" as const, building: hut.id };
  assert.equal(actionError(s, action), null, "free: nothing to pay");
  assert.equal(actionLabel(s, action), "🧨 Hut afbreken");
  assert.deepEqual(refundOf(s, action), { wood: 22, stone: 7 }, "25% of 1.5 × 2 × the base cost");
  const { state } = applyAction(s, action);
  assert.ok(!state.buildings.some((b) => b.id === hut.id));
  assert.equal(bedsOf(state), bedsOf(s) - 3);
  assert.equal(assignWorkers(state).homeless, 3, "its people sleep outside now");
  assert.deepEqual([state.resources.wood, state.resources.stone], [22, 7]);
  const full = { ...s, resources: { wood: capOf(s, "wood") } };
  assert.equal(applyAction(full, action).state.resources.wood, capOf(s, "wood"), "storage limit holds");
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
  assert.equal(voteOutcome(p([true, false, false, false]), 4, T0), "fail");
  assert.equal(voteOutcome(p([true]), 4, T0 + VOTE_MS), "fail", "one yes is never enough");
  assert.equal(voteOutcome(p([true, true, false]), 9, T0 + VOTE_MS), "pass");
  assert.equal(voteOutcome(p([true, false]), 4, T0 + VOTE_MS), "fail");
});

// ---------- placing, shops ----------

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
  const { buildings, roads } = town(T0);
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
  let s = rich(town(T0));
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
  assert.deepEqual(pathCost(s, tiles), { stone: 18, wood: 6 });
  assert.equal(actionLabel(s, lay), "🛤️ 3 tegels pad leggen");
  const laid = applyAction(s, lay).state;
  assert.ok(tiles.every((i) => isRoad(laid.roads, tileOf(i).x, tileOf(i).y)));
  assert.equal(laid.resources.stone, s.resources.stone - 18);
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
  assert.ok(isRoad(cleared.roads, woods.x, woods.y));
  const peak = findTile((x, y) => terrainAt(x, y) === "mountain");
  assert.equal(pathError(s.buildings, s.roads, peak.x, peak.y), "hier kan geen pad");
  assert.equal(pathError(s.buildings, s.roads, 0, 40), "hier kan geen pad", "the sea");

  // Over the river: a bridge, pricier; villagers can cross there afterwards.
  const river = findTile((x, y) => isRiver(x, y) && free(x, y));
  const bridge = [tileIndex(river.x, river.y), tileIndex(river.x + 1, river.y)];
  assert.ok(isRiver(river.x + 1, river.y));
  assert.equal(actionError(s, { kind: "paths", tiles: bridge }), null);
  assert.deepEqual(pathCost(s, [...bridge, tiles[0]]), { wood: 50, stone: 30 });
  assert.deepEqual(refundOf(s, { kind: "unpave", tiles: bridge }), { wood: 12, stone: 6 });
  assert.equal(placeError(s.buildings, s.roads, "house", river.x, river.y), "hier kan je niet bouwen", "a bridge is no building plot");

  // A path blocks building there, until it's gone again.
  assert.equal(placeError(laid.buildings, laid.roads, "house", a.x, a.y), "daar ligt een pad");

  // Remove it again for a bit back (a share of the cost, rounded down).
  const unpave = { kind: "unpave" as const, tiles };
  assert.equal(actionError(s, unpave), "daar ligt geen pad");
  assert.equal(actionError(laid, unpave), null);
  assert.deepEqual(refundOf(laid, unpave), { stone: 4, wood: 1 });
  assert.equal(actionLabel(laid, unpave), "⛏️ 3 tegels pad weghalen");
  const gone = applyAction({ ...laid, resources: {} }, unpave).state;
  assert.deepEqual(gone.roads, s.roads);
  assert.deepEqual(gone.resources, { stone: 4, wood: 1 });

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
  let s = rich(town(T0));
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

test("party: the big village party costs more the more villagers it feeds", () => {
  const party = SHOP_ITEMS.find((i) => i.id === "party")!;
  const s = rich(town(T0)); // 6 villagers: the price for 10
  assert.deepEqual(itemCost(s, party), { food: 300, wood: 200, stone: 200 });
  assert.deepEqual(itemCost({ ...s, population: 30 }, party), { food: 900, wood: 600, stone: 600 });
  assert.deepEqual(itemCost({ ...s, population: 30 }, TOOLS_WOOD), itemCost(s, TOOLS_WOOD), "the rest doesn't");
});

test("no trading: there's no market, and the bank sells no trade deals", () => {
  assert.equal(buildTypeError(town(T0), "shop_market"), "onbekend");
  assert.ok(!SHOP_ITEMS.some((i) => i.id === "tradeDeal"));
});

// ---------- server ----------

test("idle game: propose + vote builds and places, state survives a reload, v1 files start fresh", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const file = path.join(dir, "idle.json");
    const game = createIdleGame(file, T0);
    // A fresh town can pay for its first hut.
    const later = T0 + 10_000;
    const action = at(newIdleState(T0), "house");
    const { error, events } = game.propose("a", "  Ann  ", action, 3, later);
    assert.equal(error, undefined);
    assert.deepEqual(events, [{ kind: "proposed", label: "🛖 Hut bouwen", by: "Ann" }]);
    // Votes stay open side by side, for a day.
    assert.deepEqual(game.propose("b", "Bob", action, 3, later).events, [{ kind: "proposed", label: "🛖 Hut bouwen", by: "Bob" }]);
    const open = game.message("a", 0, 0, 3, later).proposals;
    assert.deepEqual(open.map((p) => [p.id, p.by, p.yes, p.myVote, p.deadline]), [[1, "Ann", 1, true, later + VOTE_MS], [2, "Bob", 1, null, later + VOTE_MS]]);

    // Two of three online is more than a third: it passes; Bob's stays open.
    const done = game.vote("b", 1, true, 3, later);
    assert.deepEqual(done.map((e) => e.kind), ["bought"]);
    const bought = done[0] as { kind: string; building: PlacedBuilding };
    assert.equal(bought.kind, "bought");
    assert.equal(bought.building.type, "house");
    assert.deepEqual([bought.building.x, bought.building.y], [action.x, action.y]);
    assert.deepEqual(game.message("a", 0, 0, 3, later).proposals.map((p) => p.by), ["Bob"]);
    // Checked again when it passes: that spot is taken now.
    assert.deepEqual(game.vote("a", 2, true, 3, later), [{ kind: "rejected", label: "🛖 Hut bouwen", by: "Bob", reason: "daar staat al iets" }]);
    const msg = game.message("a", 0, 0, 3, later);
    assert.ok(msg.state.buildings.some((b) => b.id === bought.building.id));
    assert.deepEqual(msg.proposals, []);

    // Villagers without a job: put on a resource right away, no vote.
    assert.deepEqual(game.assign(null, "stone", later), { events: [] });
    assert.deepEqual(game.message("a", 0, 0, 3, later).state.gatherers, { stone: 1 });
    assert.equal(game.assign(null, "bronze", later).error, "dat groeit hier niet");
    assert.equal(game.assign("x", 5, later).error, "onbekende grondstof");

    game.flush();
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.v, 7);
    assert.deepEqual(saved.roads, msg.state.roads);
    const reloaded = createIdleGame(file, T0 + 1000);
    assert.equal(reloaded.message("a", 0, 0, 1, T0 + 1000).state.buildings.length, msg.state.buildings.length);
    assert.deepEqual(reloaded.message("a", 0, 0, 1, T0 + 1000).state.gatherers, { stone: 1 }, "choices are saved");

    // A v1 file (never released) quietly becomes a fresh town, no backup.
    writeFileSync(file, JSON.stringify({ resources: { flint: 5 }, buildings: { cave: 1 }, inventions: [] }));
    assert.equal(createIdleGame(file, T0).message("a", 0, 0, 1, T0).state.buildings.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("idle game: open votes wait for resources, count once per player, survive a restart, expire after a day", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  const KEY = "0123456789abcdef-secret";
  try {
    const file = path.join(dir, "idle.json");
    const start = { ...town(T0), resources: { wood: 400, stone: 60 } };
    writeFileSync(file, JSON.stringify(start));
    const game = createIdleGame(file, T0);
    const first = at(start, "house");
    const second = { ...first, ...placeBuilding([...start.buildings, { ...first, id: 99, level: 0 }], "house")! };

    // Both affordable when proposed; after the first, the second can't be paid: it waits, voted through.
    game.propose("a", "Ann", first, 2, T0);
    game.propose("a", "Ann", second, 2, T0);
    assert.deepEqual(game.vote("b", 1, true, 2, T0).map((e) => e.kind), ["bought"]);
    assert.deepEqual(game.vote("b", 2, true, 2, T0), []);
    assert.equal(game.message("a", 0, 0, 2, T0).proposals[0].approved, true);
    // Two villagers without a job gather stone for it.
    game.assign(null, "stone", T0);
    game.assign(null, "stone", T0);
    // 57 stone short, at 0.05 stone/s each: about ten minutes, longer as night falls (half speed).
    // (Newcomers knock and couples have children meanwhile: "lucky" news, left out here.)
    const news = (events: { kind: string }[]) => events.filter((e) => e.kind !== "lucky");
    assert.deepEqual(news(game.tick(2, T0 + 1_200_000)).map((e) => e.kind), ["bought"], "built once there's enough");

    // Two tabs of one player are one voter.
    game.hello("t1", KEY, "Ann", T0);
    game.hello("t2", KEY, "Ann", T0);
    game.propose("t1", "Ann", at(game.message("t1", 0, 0, 2, T0).state as IdleState, "farm"), 2, T0);
    const farm = game.message("t2", 0, 0, 2, T0).proposals.find((p) => p.action.kind === "build")!.id;
    assert.deepEqual(game.vote("t2", farm, true, 2, T0), [], "same player: still one yes");
    const mine = game.message("t2", 0, 0, 2, T0).proposals.find((p) => p.id === farm)!;
    assert.deepEqual([mine.yes, mine.myVote, mine.approved], [1, true, false]);

    // It survives a restart, votes and all, and expires a day after it was proposed.
    game.flush();
    const again = createIdleGame(file, T0 + 1000);
    again.hello("t3", KEY, "Ann", T0 + 1000);
    const kept = again.message("t3", 0, 0, 1, T0 + 1000).proposals.filter((p) => p.action.kind !== "newcomer");
    assert.deepEqual(kept.map((p) => [p.id, p.myVote, p.deadline]), [[farm, true, T0 + VOTE_MS]]);
    assert.deepEqual(news(again.tick(1, T0 + VOTE_MS - 1)), []);
    const expired = news(again.tick(1, T0 + VOTE_MS)).filter((e) => e.kind !== "rejected" || !e.label.startsWith("🚪"));
    assert.deepEqual(expired.map((e) => e.kind === "rejected" && e.reason), ["verlopen: minstens 2 keer ja nodig"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("idle game: a mine keeps the ore it was switched to; unknown ores are dropped", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const file = path.join(dir, "idle.json");
    const s = unlockEra(town(T0), 2);
    const spot = placeBuilding(s.buildings, "mine")!;
    const mines = [
      { id: 50, type: "mine", level: 2, ...spot, ore: "iron" },
      { id: 51, type: "mine", level: 2, x: spot.x + 1, y: spot.y + 1, ore: "flint" },
      { id: 52, type: "wood", level: 0, x: 3, y: 3, ore: "iron" },
    ];
    writeFileSync(file, JSON.stringify({ ...s, buildings: [...s.buildings, ...mines] }));
    const got = createIdleGame(file, T0).message("a", 0, 0, 1, T0).state.buildings.filter((b) => b.id >= 50);
    assert.deepEqual(got.map((b) => [b.id, b.ore]), [[50, "iron"], [51, undefined], [52, undefined]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("idle game: raids come by on the tick and are saved; walls and fires survive a restart", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const file = path.join(dir, "idle.json");
    const s = raidTown();
    const walls = [tileIndex(CENTER.x + 3, CENTER.y + 5)];
    const burnt = s.buildings.map((b, i) => (i === 1 ? { ...b, damaged: true } : b));
    writeFileSync(file, JSON.stringify({ ...s, walls, wallLevel: 1, buildings: burnt, nextRaid: T0 + RAID_WARNING_MS, boosts: [{ item: "raid_lost", resource: null, mult: 1, until: T0 + 1000 }] }));
    const game = createIdleGame(file, T0);
    const first = game.message("a", 0, 0, 1, T0).state;
    assert.deepEqual(first.walls, walls);
    assert.equal(first.wallLevel, 1);
    assert.equal(first.buildings[1].damaged, true);
    assert.deepEqual(first.boosts.map((b) => b.item), ["raid_lost"]);

    const seen = game.tick(1, T0 + 10, () => 0.5);
    assert.deepEqual(seen.map((e) => [e.kind, (e as { stage: string }).stage]), [["raid", "coming"]]);
    assert.ok(game.message("a", 0, 0, 1, T0 + 10).state.raid);
    assert.deepEqual(game.tick(1, T0 + 20, () => 0.5), []);
    const fought = game.tick(1, T0 + RAID_WARNING_MS + 20, () => 0.5);
    assert.equal(fought[0].kind, "raid");
    game.flush();
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.raid, null);
    assert.ok(saved.lastRaid && saved.nextRaid > T0);
    const again = createIdleGame(file, T0 + RAID_WARNING_MS + 30).message("a", 0, 0, 1, T0 + RAID_WARNING_MS + 30).state;
    assert.deepEqual(again.lastRaid, saved.lastRaid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("idle game: at most MAX_PROPOSALS votes are open at once", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const game = createIdleGame(path.join(dir, "idle.json"), T0);
    const later = T0 + 10_000;
    const action = at(town(T0), "house");
    for (let i = 0; i < MAX_PROPOSALS; i++) assert.equal(game.propose(`c${i}`, "x", action, 9, later).error, undefined);
    assert.equal(game.message("c0", 0, 0, 9, later).proposals.length, MAX_PROPOSALS);
    assert.equal(game.propose("late", "x", action, 9, later).error, "te veel open stemmingen");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("idle game: a saved town is kept; small buys are instant, big ones go to a vote", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const file = path.join(dir, "idle.json");
    const { boosts: _b, perks: _p, ...saved } = build(rich(town(T0)), "shop_tavern");
    writeFileSync(file, JSON.stringify({ ...saved, resources: { food: 600, wood: 600, stone: 600 } }));
    const game = createIdleGame(file, T0);
    const first = game.message("a", 0, 0, 1, T0).state;
    assert.equal(first.buildings.length, saved.buildings.length);
    assert.deepEqual(first.roads, saved.roads);
    assert.deepEqual([first.boosts, first.perks], [[], {}]);

    assert.deepEqual(game.buy("a", "  Ann ", "feast_food", T0).events, [{ kind: "deal", label: "🍗 Feestmaal", by: "Ann" }]);
    assert.equal(game.message("a", 0, 0, 1, T0).state.boosts.length, 1);
    assert.equal(game.buy("a", "Ann", "party", T0).error, "hiervoor is een stemming nodig");
    assert.equal(game.propose("a", "Ann", { kind: "buy", item: "feast_food" }, 1, T0).error, "dat kan je meteen kopen");
    assert.equal(game.propose("a", "Ann", { kind: "build", type: "house", x: 0, y: 0 }, 1, T0).error, "hier kan je niet bouwen");
    assert.equal(game.propose("a", "Ann", { kind: "build", type: "house" }, 1, T0).error, "onbekend voorstel", "a build needs a tile");
    // Alone online, nothing passes: it needs a second yes.
    assert.deepEqual(game.propose("a", "Ann", { kind: "buy", item: "party" }, 1, T0).events.map((e) => e.kind), ["proposed"]);
    assert.deepEqual(game.tick(1, T0 + VOTE_MS), [{ kind: "rejected", label: "🎉 Groot dorpsfeest kopen", by: "Ann", reason: "verlopen: minstens 2 keer ja nodig" }]);
    game.propose("a", "Ann", { kind: "buy", item: "party" }, 2, T0 + VOTE_MS);
    assert.deepEqual(game.vote("b", 2, true, 2, T0 + VOTE_MS).map((e) => e.kind), ["bought"]);
    assert.ok(game.message("a", 0, 0, 2, T0 + VOTE_MS).state.boosts.some((b) => b.item === "party"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("idle game: a town from an older version starts over; players keep their name and look, not what they bought", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const file = path.join(dir, "idle.json");
    const old = build(rich(town(T0)), "storage");
    const ann = { name: "Ann", look: { skin: 2, clothes: 5, hat: "crown", pattern: "stripes" }, owned: ["crown"], seen: T0 };
    writeFileSync(file, JSON.stringify({ ...old, v: 6, era: 4, players: { "0123456789ab": ann } }));
    const s = createIdleGame(file, T0).message("a", 0, 0, 1, T0).state;
    assert.deepEqual([s.era, s.buildings.length, s.resources, s.happiness], [0, 3, newIdleState(T0).resources, 50], "a fresh town");
    const game = createIdleGame(file, T0);
    game.hello("t", "0123456789abcdef-secret", "x", T0);
    // Not this key's player, so look at the file once it's saved again.
    game.flush();
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(saved.v, 7);
    assert.deepEqual(saved.players["0123456789ab"], { ...ann, owned: [], look: { skin: 2, clothes: 5, hat: "none", pattern: "stripes" } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("your own villager: a task makes you one more worker while you're online; relations grow and fade", () => {
  const s = town(T0);
  const camp = s.buildings.find((b) => b.type === "wood")!;
  assert.equal(taskError(s, { kind: "work", building: camp.id }), null);
  assert.equal(taskError(s, { kind: "work", building: s.buildings.find((b) => b.type === "house")!.id }), "daar is geen werk");
  assert.equal(taskError(s, { kind: "gather", res: "iron" }), "dat groeit hier niet");
  const workers = assignWorkers(s).workers[camp.id];
  const helped = ratesOf({ ...s, helpers: [{ kind: "work", building: camp.id }] }).wood! - ratesOf(s).wood!;
  assert.ok(near(helped, (fullRateOf(camp) / slotsOf(camp.level)) * happinessOf(s, T0).mult), `one worker more (${workers} there)`);
  const gathering = ratesOf({ ...s, helpers: [{ kind: "gather", res: "stone" }] }).stone! - (ratesOf(s).stone ?? 0);
  assert.ok(gathering > 0);

  // Relations: points up to RELATION_MAX, fading 2 a day without seeing each other.
  const r = { relations: {} };
  const met = meet(r, "b", "a", 12, T0);
  assert.deepEqual(Object.keys(met.relations), [pairKey("a", "b")]);
  assert.equal(relationLevel(relationPoints(met.relations["a|b"], T0)).name, "vrienden");
  assert.ok(near(relationPoints(met.relations["a|b"], T0 + 3 * 86_400_000), 6));
  assert.equal(meet(r, "a", "b", 0, T0), r, "just seeing each other starts nothing");
  assert.equal(meet(met, "a", "b", 500, T0).relations["a|b"].points, 100);
});

test("players together: tasks count while online, waving, talking, gifts and matchmaking, the same task brings them closer", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const file = path.join(dir, "idle.json");
    const s = rich(town(T0));
    writeFileSync(file, JSON.stringify(s));
    const game = createIdleGame(file, T0);
    const camp = s.buildings.find((b) => b.type === "wood")!;
    const [A, B, C] = ["0123456789abcdef-annann", "0123456789abcdef-bobbob", "0123456789abcdef-cascas"];
    game.hello("a", A, "Ann", T0);
    game.hello("b", B, "Bob", T0);
    const ann = game.message("a", 0, 0, 2, T0).me!.id;
    const bob = game.message("b", 0, 0, 2, T0).me!.id;
    assert.equal(game.task("a", { kind: "work", building: 9999 }, T0).error, "daar is geen werk");
    game.task("a", { kind: "work", building: camp.id }, T0);
    let msg = game.message("b", 0, 0, 2, T0);
    assert.deepEqual(msg.state.helpers, [{ kind: "work", building: camp.id }]);
    assert.deepEqual(msg.people.find((p) => p.id === ann)!.task, { kind: "work", building: camp.id }, "everyone sees where Ann works");
    game.leave("a", T0 + 1000);
    assert.deepEqual(game.message("b", 0, 0, 1, T0 + 1000).state.helpers, [], "only while online");
    game.hello("a", A, "Ann", T0 + 2000);
    assert.equal(game.message("b", 0, 0, 2, T0 + 2000).state.helpers.length, 1, "the task stays for next time");

    // Waving, with a cooldown per pair; not to yourself or someone offline.
    assert.equal(game.social("a", "wave", ann, undefined, T0).error, "die speler is niet online");
    assert.deepEqual(game.social("a", "wave", bob, undefined, T0).events, [{ kind: "social", from: ann, to: bob, emoji: "👋", label: "👋 Ann zwaait naar Bob" }]);
    assert.match(game.social("a", "wave", bob, undefined, T0 + 1000).error!, /^even wachten/);
    assert.equal(game.social("b", "wave", ann, undefined, T0 + 1000).error, undefined, "Bob may wave back");
    // A gift is paid from the town's storage.
    const food = game.message("a", 0, 0, 2, T0).state.resources.food;
    assert.equal(game.social("a", "gift", bob, undefined, T0).error, undefined);
    assert.ok(game.message("a", 0, 0, 2, T0).state.resources.food < food);
    assert.ok(Math.abs(game.message("a", 0, 0, 2, T0).relations[0].points - (SOCIAL.wave.points * 2 + SOCIAL.gift.points)) < 0.001);

    // Matchmaking: Cas brings Ann and Bob closer.
    game.hello("c", C, "Cas", T0);
    assert.equal(game.social("c", "introduce", ann, ann, T0).error, "kies een andere speler die online is");
    const intro = game.social("c", "introduce", ann, bob, T0).events[0];
    assert.equal(intro.kind === "social" && intro.label, "🤝 Cas stelt voor aan Ann en Bob");

    // On the same task, every TOGETHER_MS they grow a bit closer.
    game.task("b", { kind: "work", building: camp.id }, T0);
    const before = game.message("a", 0, 0, 3, T0).relations.find((r) => r.id === bob)!.points;
    game.tick(3, T0 + TOGETHER_MS);
    const after = game.message("a", 0, 0, 3, T0 + TOGETHER_MS).relations.find((r) => r.id === bob)!.points;
    assert.ok(after > before);
    // Saved with the town.
    game.flush();
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.ok(saved.relations[pairKey(ann, bob)].points > 0);
    assert.deepEqual(saved.players[ann].task, { kind: "work", building: camp.id });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("De raad: one vote per player for the next update, ideas sent in, kept in the town (even through a reset)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  try {
    const file = path.join(dir, "idle.json");
    writeFileSync(file, JSON.stringify(town(T0)));
    const game = createIdleGame(file, T0);
    const [first, second] = COUNCIL_ITEMS;
    assert.equal(game.councilVote("a", first.id).error, "eerst inloggen");
    game.hello("a", "0123456789abcdef-annann", "Ann", T0);
    game.hello("b", "0123456789abcdef-bobbob", "Bob", T0);
    game.hello("b2", "0123456789abcdef-bobbob", "Bob", T0); // Bob's second tab
    assert.equal(game.councilVote("a", "nope").error, "dat staat niet in de raad");
    game.councilVote("a", second.id);
    game.councilVote("b", second.id);
    game.councilVote("b2", first.id); // Bob moves his one vote
    let view = game.message("a", 0, 0, 2, T0).council;
    assert.deepEqual(view.items.slice(0, 2).map((i) => [i.id, i.votes]), [[first.id, 1], [second.id, 1]], "ties in the roadmap's order");
    assert.equal(view.myVote, second.id);
    game.councilVote("b", null);
    assert.equal(game.message("a", 0, 0, 2, T0).council.items.find((i) => i.id === first.id)!.votes, 0, "taken back");

    // Ideas: as many as you like, only your own can be taken back.
    const sent = IDEAS_DONE_UNTIL + 1000;
    assert.equal(game.idea("a", "   ", sent).error, "schrijf eerst je idee");
    assert.equal(game.idea("a", "x".repeat(201), sent).error, "hooguit 200 tekens");
    assert.deepEqual(game.idea("a", "  draken   in de bergen ", sent).events, [{ kind: "deal", label: "💡 een idee ingestuurd bij De raad", by: "Ann" }]);
    assert.equal(game.idea("a", "nog een", sent + 1000).error, undefined);
    view = game.message("b", 0, 0, 2, T0).council;
    assert.deepEqual(view.ideas.map((i) => [i.by, i.text, i.mine]), [["Ann", "nog een", false], ["Ann", "draken in de bergen", false]]);
    assert.equal(game.unidea("b", view.ideas[0].id).error, "dat idee is niet van jou");
    game.unidea("a", view.ideas[0].id);
    view = game.message("a", 0, 0, 2, T0).council;
    assert.deepEqual(view.ideas.map((i) => [i.text, i.mine]), [["draken in de bergen", true]]);
    assert.equal(
      councilText(view, Date.UTC(2026, 9, 27, 12)),
      [
        "- 2026-10-27, uitslag van De raad:",
        ...view.items.map((i) => `  - ${i.emoji} ${i.title}: ${i.votes} ${i.votes === 1 ? "stem" : "stemmen"}`),
        '  - ingestuurd door Ann: "draken in de bergen"',
        `  <!-- ideeën t/m ${sent} -->`,
      ].join("\n"),
    );

    // Saved with the town, and kept when an old file makes the town start over;
    // ideas from before IDEAS_DONE_UNTIL are in FEEDBACK.md already, so they go.
    game.flush();
    const saved = JSON.parse(readFileSync(file, "utf8"));
    assert.equal(Object.keys(saved.council.votes).length, 1);
    const processed = { id: 99, player: saved.council.ideas[0].player, by: "Ann", text: "al verwerkt", at: IDEAS_DONE_UNTIL };
    writeFileSync(file, JSON.stringify({ ...saved, v: 1, council: { ...saved.council, ideas: [processed, ...saved.council.ideas] } }));
    const reset = createIdleGame(file, T0);
    reset.hello("a", "0123456789abcdef-annann", "Ann", T0);
    view = reset.message("a", 0, 0, 1, T0).council;
    assert.equal(view.myVote, second.id);
    assert.equal(view.ideas.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("players: a key becomes a hidden id, looks and names stick, outfits are bought from the town", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "idle-"));
  const KEY = "0123456789abcdef-secret";
  try {
    const file = path.join(dir, "idle.json");
    writeFileSync(file, JSON.stringify(build(rich(town(T0)), "shop_tailor")));
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

test("counter socket: a new 67 drops a crate, gatherers reach the others, vote builds", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "counter-"));
  const file = path.join(dir, "counter.json");
  writeFileSync(file, JSON.stringify({ count: 60 })); // format from before `peak`
  // A rich town, so the test doesn't have to click for minutes.
  const rich = { ...town(Date.now()), resources: { food: 600, wood: 600, stone: 600 } };
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

    // a puts a villager without a job on stone; everyone's town shows it.
    a.send({ type: "assign", from: null, to: "stone" });
    await b.wait<IdleStateMsg>((m) => m.type === "idle" && m.state.gatherers.stone === 1);

    // Propose a house; b votes yes; it appears with a position.
    a.send({ type: "propose", action: at(rich, "house"), name: "Ann" });
    await b.wait(event("proposed"));
    const pending = await b.wait<IdleStateMsg>((m) => m.type === "idle" && m.proposals.length > 0);
    assert.equal(pending.proposals[0].label, "🛖 Hut bouwen");
    assert.equal(pending.proposals[0].needed, 2);
    b.send({ type: "vote", id: pending.proposals[0].id, yes: true });
    const bought = await a.wait(event("bought"));
    assert.equal(bought.event.building.type, "house");
    assert.ok(Number.isInteger(bought.event.building.x));
    await a.wait<IdleStateMsg>((m) => m.type === "idle" && m.state.buildings.some((x) => x.id === bought.event.building.id));

    // 7 × +1 reaches 67: a crate lands for everyone, the era stays (the town earns that itself).
    await sleep(1100); // fresh rate-limit window
    for (let i = 0; i < 7; i++) a.send({ type: "inc" });
    const isDrop = (m: { type: string; event?: { kind: string; label?: string } }) => m.type === "idleEvent" && m.event?.kind === "lucky" && !!m.event.label?.startsWith("📦");
    await a.wait(isDrop);
    await b.wait(isDrop);
    const crate = await b.wait<IdleStateMsg>((m) => m.type === "idle" && m.state.drops.length === 1);
    assert.equal(crate.state.era, 0);
    b.send({ type: "dec" });
    const afterDec = await b.wait((m) => m.type === "count" && m.delta === -1);
    assert.equal(afterDec.peak, 67);
    // b opens it, once.
    b.send({ type: "open", id: crate.state.drops[0].id, name: "Bob" });
    const opened = await a.wait(event("deal"));
    assert.ok(opened.event.label.startsWith("📦 supply drop: +"));
    await a.wait<IdleStateMsg>((m) => m.type === "idle" && m.state.drops.length === 0);
    b.send({ type: "open", id: crate.state.drops[0].id });
    assert.equal((await b.wait(event("error"))).event.message, "die krat is al open");

    await sleep(1100);
    a.send({ type: "propose", action: { kind: "upgrade", building: bought.event.building.id } });
    assert.equal((await a.wait(event("error"))).event.message, "al up-to-date");
    a.send({ type: "propose", action: at(rich, "decor_statue67") });
    assert.equal((await a.wait(event("error"))).event.message, "eerst een Beeldhouwer bouwen");
    // Shop messages reach the game too.
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

test("counter socket: the developer menu only with IDLE_DEV on this computer; free mode builds at once without paying", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "counter-"));
  const poor = { ...town(Date.now()), resources: { food: 0, wood: 0, stone: 0 } };
  writeFileSync(path.join(dir, "idle.json"), JSON.stringify(poor));
  const servers: { wss: ReturnType<typeof createCounterServer>; http: ReturnType<typeof createServer>; url: string }[] = [];
  const start = async (dev: boolean) => {
    const wss = createCounterServer({ file: path.join(dir, "counter.json"), dev });
    const http = createServer();
    http.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req)));
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    servers.push({ wss, http, url: `ws://127.0.0.1:${(http.address() as AddressInfo).port}/` });
    return servers.at(-1)!.url;
  };
  const peers: Peer[] = [];
  try {
    // Without IDLE_DEV: no menu, and the message does nothing.
    const plain = await new Peer(await start(false)).open();
    peers.push(plain);
    assert.equal((await plain.wait<IdleStateMsg>((m) => m.type === "idle")).dev, undefined);
    plain.send({ type: "dev", cmd: "free" });
    plain.send({ type: "propose", action: at(poor, "house") });
    assert.equal((await plain.wait(event("error"))).event.message, "te duur");

    // With it, from this computer: the menu, and free mode.
    const dev = await new Peer(await start(true)).open();
    peers.push(dev);
    assert.deepEqual((await dev.wait<IdleStateMsg>((m) => m.type === "idle")).dev, { free: false });
    dev.send({ type: "dev", cmd: "free" });
    await dev.wait<IdleStateMsg>((m) => m.type === "idle" && m.dev?.free === true);
    dev.send({ type: "propose", action: at(poor, "house"), name: "Dev" });
    const built = await dev.wait(event("bought"));
    assert.equal(built.event.label, "🛠️ 🛖 Hut bouwen");
    const after = await dev.wait<IdleStateMsg>((m) => m.type === "idle" && m.state.buildings.some((b) => b.id === built.event.building.id));
    assert.equal(after.proposals.length, 0, "no vote");
    assert.ok((after.state.resources.wood ?? 0) < 1, "nothing paid");
    dev.send({ type: "dev", cmd: "era" });
    assert.equal((await dev.wait(event("era"))).event.era, 1);
    dev.send({ type: "dev", cmd: "fill" });
    await dev.wait<IdleStateMsg>((m) => m.type === "idle" && (m.state.resources.stone ?? 0) >= 100);

    // Only straight from this computer: not from elsewhere, not through a proxy or tunnel.
    const req = (addr: string, headers: Record<string, string>) => ({ socket: { remoteAddress: addr }, headers }) as unknown as IncomingMessage;
    assert.ok(isLocal(req("127.0.0.1", { host: "localhost:5173" })));
    assert.ok(isLocal(req("::1", { host: "127.0.0.1:3000" })));
    assert.ok(!isLocal(req("192.168.1.20", { host: "localhost:3000" })));
    assert.ok(!isLocal(req("127.0.0.1", { host: "mijn-tunnel.example.com" })));
    assert.ok(!isLocal(req("127.0.0.1", { host: "localhost", "x-forwarded-for": "8.8.8.8" })));
    assert.ok(!isLocal(undefined));
  } finally {
    for (const p of peers) await p.close();
    for (const { wss, http } of servers) {
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
    await sleep(600);
    rmSync(dir, { recursive: true, force: true });
  }
});
