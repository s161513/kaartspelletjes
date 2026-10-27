// "67 Beschaving": the shared idle game behind the 67 counter page.
//
// One town for everyone, kept by the server. The town earns its next era: once
// it meets the era's goals (people, happiness, food, certain buildings) it
// builds that era's world wonder, phase by phase, and the last phase starts
// the next era. The 67 counter only gives extras: every +1 a short boost,
// every new 67 a supply drop to open, and now and then a lucky event. While the town
// is happy enough and has a free bed, a newcomer knocks now and then and the players
// vote whether they may stay; couples have a child (a grown-up villager straight
// away) when there's a bed for it. People leave (slowly) when the town is unhappy
// (the happiness meter creeps towards what the town is worth); each needs a bed in a house or
// sleeps outside, which makes everyone less happy (so does eating the same
// thing every day; decorations and the tavern help). Villagers staff work
// buildings, work buildings fill the storage (every resource its own: a Schuur for
// wood, a Voorraadkuil for food, …; a full one stops its workers), and unhappy ones work less. Villagers
// without a job gather from the nature around the town, whatever the players
// point them at. Food has kinds by where it comes from (grain, meat, fish,
// berries) but is one resource in storage. Nature runs out: gatherers and
// work buildings use up patches of forest, rock and ore (the more valuable,
// the longer they last), which slowly grow back; hunters catch less where the
// forest is cut down. Mines dug into the mountain never run out; the players
// vote which ore each one digs. Smiths turn iron and coal into weapons and
// armor, or into tools: from the Iron Age on every job has its own tool (an axe,
// a pick, a bow, a rod, a sickle) that wears out, workers without one work
// slower, and now and then one comes out rare or epic (players can also smith
// one themselves, in a little game). Days and nights take 20 minutes each, by the clock; at night most
// villagers sleep and everything is made at half speed. From the Bronze Age on,
// enemies raid the town a few times a day, always at night, seen coming an
// hour before: walls (with gates for the villagers), towers, villagers and guards with
// weapons and armor hold them off, or they steal, kill and set a building on
// fire (it does nothing until the players vote to repair it). Building (on a tile someone
// clicked), laying or removing paths (drawn tile by tile, through nature and
// over the river as bridges), tearing down a building (for a bit of its cost
// back), upgrading (buildings or the whole street network) and big shop
// purchases go through a vote: everything proposed stays open side by side
// for a day, and happens as soon as enough people said yes; small shop items happen right
// away. There is no trading: what the town needs, it makes. Everyone has their own NPC walking around while
// they're online, dressed in what they bought at the tailor.
//
// The rules here are pure and shared: the server is authoritative, the browser
// uses them to keep numbers moving between updates. State is plain JSON;
// functions return new state and never mutate.

import {
  BASE_CAP,
  BASE_RATE,
  BIRTH_HAPPY,
  BIRTH_MS,
  NEWCOMER_NAMES,
  NEWCOMER_ORIGINS,
  NEWCOMER_TRADES,
  BRIDGE_TILE_COST,
  BUILDING_TYPES,
  BUILD_COST_MULT,
  CENTER_CAP,
  CLICK_BASE,
  COST_GROWTH,
  DECOR_POINTS,
  DROP_MIN,
  DROP_SECONDS,
  ERA_GOALS,
  HAPPY_BASE,
  LUCKY_CHANCE,
  LUCKY_COOLDOWN_MS,
  LUCKY_EVENTS,
  LUCKY_GOLD_MULT,
  LUCKY_MS,
  LUCKY_NEWCOMERS_SHARE,
  LUCKY_PARTY_POINTS,
  MAX_DROPS,
  WONDER_BUILD_MS,
  WONDER_COST,
  WONDER_PHASES,
  WONDER_SPECIAL_COST,
  HOMELESS_POINTS,
  ARMOR_POINTS,
  ARMS_PER_GUARD,
  GUARD_POINTS,
  PERSON_DEFENSE,
  RAID_BASE,
  RAID_FROM_ERA,
  RAID_GAP_MS,
  RAID_GAP_SPREAD_MS,
  RAID_HOURS,
  RAID_KILL,
  RAID_MOODS,
  RAID_PER_ERA,
  RAID_PER_PERSON,
  RAID_SPREAD,
  RAID_STEAL,
  RAID_WARNING_MS,
  RAID_WEAR,
  REPAIR_SHARE,
  TOWER_POINTS,
  WALL_NAMES,
  GATE_TILE_COST,
  DAY_MS,
  NIGHT_MS,
  NIGHT_WORK,
  WALL_POINTS,
  WALL_SPECIAL_COST,
  WALL_TILE_COST,
  WALL_UPGRADE_COST,
  MAX_DECOR_POINTS,
  MOVE_MS,
  HAPPY_STEP_MS,
  PARTY_PEOPLE,
  PRICE_MULT,
  PARTY_POINTS,
  TAVERN_POINTS,
  VARIETY_POINTS,
  GATHER_RANGE,
  GATHER_RATE,
  ERAS,
  MAX_ITEM_BOOST_MS,
  MAX_PATH_TILES,
  OUTFITS,
  PATH_TILE_COST,
  PERK_GROWTH,
  REFUND_SHARE,
  RESOURCES,
  ROAD_COST,
  ROAD_NAMES,
  ROAD_SPECIAL_COST,
  CLOTHES_COLORS,
  SKIN_TONES,
  SHOP_ITEMS,
  SPECIAL_BASE_RATE,
  STORAGE_CAP,
  UPGRADE_SHARE,
  WORK_DRAIN,
  EPIC_CHANCE,
  NO_TOOL_MULT,
  RARE_CHANCE,
  RARITIES,
  TOOL_COST,
  TOOL_CRAFT_MS,
  TOOL_LIFE_MS,
  TOOLS,
  TOOLS_FROM_ERA,
  toolKindOf,
  WORK_RANGE,
  buildingName,
  buildingType,
  footprintOffsets,
  housingOf,
  outfit,
  resourceDef,
  scaleOf,
  shopItem,
  slotsOf,
  type Amounts,
  type EraGoal,
  type FoodKind,
  type NpcLook,
  type Outfit,
  type ResourceId,
  type ShopItem,
  type ToolKind,
} from "./idleContent.js";
import {
  CENTER,
  classicStreets,
  isLand,
  isRiver,
  isRoad,
  natureAt,
  buildingOn,
  footprintError,
  patchAt,
  patches,
  pathError,
  placeBuilding,
  placeError,
  reservedFor,
  takenTiles,
  tileIndex,
  tileOf,
  wallError,
  MAP_SIZE,
  type Patch,
} from "./idleMap.js";

export * from "./idleContent.js";
export * from "./idleMap.js";

/** Every new 67 on the counter (by its highest value) drops a crate in town. */
export const IDLE_MILESTONE = 67;
/** Every +1 on the counter: production ×2 for 67 s (stacks by extending). */
export const BOOST_MULT = 2;
export const BOOST_MS = 67_000;
export const MAX_BOOST_MS = 60 * 60_000;
/** Production while nobody is around is caught up to at most this long. */
export const MAX_OFFLINE_MS = 7 * 24 * 60 * 60_000;
/** A proposal stays open this long. */
export const VOTE_MS = 24 * 60 * 60_000;
/** Open proposals at once, at most. */
export const MAX_PROPOSALS = 20;
export const STATE_VERSION = 7;
export const MAX_NAME_LENGTH = 20;

// ---------- state ----------

export interface PlacedBuilding {
  id: number;
  type: string;
  /** Era it was built in or upgraded to: its look and strength. */
  level: number;
  x: number;
  y: number;
  /** A world wonder under construction: phases done so far (gone once it's finished). */
  stage?: number;
  /** …and when the builders are ready for the next phase. */
  ready?: number;
  /** A mine: the ore it digs, when the players picked another than its type's. */
  ore?: ResourceId;
  /** Set on fire by raiders: does nothing until it's repaired. */
  damaged?: boolean;
  /** A smith making tools instead of weapons or armor (update 22). */
  tools?: true;
}

/** Enemies on their way: they arrive at `at`, from `from`. */
export interface Raid {
  at: number;
  strength: number;
  from: { x: number; y: number };
}

/** How the last fight went. */
export interface RaidReport {
  at: number;
  won: boolean;
  strength: number;
  defense: number;
  stolen: Amounts;
  killed: number;
  /** Name of the building set on fire. */
  damaged: string | null;
}

/** A crate from the counter, waiting on a tile for someone to open it. */
export interface SupplyDrop {
  id: number;
  x: number;
  y: number;
}

/** A shop boost: production of `resource` (null = all) ×mult until `until`. */
export interface ActiveBoost {
  item: string;
  resource: ResourceId | null;
  mult: number;
  until: number;
}

/** Everything production depends on; the browser gets exactly this. */
export interface IdleWorld {
  v: typeof STATE_VERSION;
  /** Highest unlocked era. */
  era: number;
  resources: Amounts;
  buildings: PlacedBuilding[];
  nextBuildingId: number;
  /** Server time (ms) up to which `resources` has been produced. */
  lastTick: number;
  /** Server time (ms) until which the counter boost runs. */
  boostUntil: number;
  boosts: ActiveBoost[];
  /** Shop perk id → levels bought. */
  perks: Record<string, number>;
  /** Level (era) of the whole street network. */
  roadLevel: number;
  /** Street tiles (y × MAP_SIZE + x), sorted. */
  roads: number[];
  /** Patch id → clicks used up, as of `lastTick` (missing = full). */
  nature: Record<string, number>;
  /** Villagers without a job the players put on a resource; the others spread over the basics. */
  gatherers: Amounts;
  /** Villagers living in town, as of `lastTick` (fractional while someone is moving in or out). */
  population: number;
  /** The happiness meter (0–100) as of `lastTick`; it creeps towards what the town is worth. */
  happiness: number;
  /** Crates from the counter, not opened yet. */
  drops: SupplyDrop[];
  nextDropId: number;
  /** When the last lucky event happened (ms). */
  lastLucky: number;
  /** Wall tiles (y × MAP_SIZE + x), sorted, and the level of the whole wall. */
  walls: number[];
  wallLevel: number;
  /** The wall tiles that are a gate (sorted): villagers only walk through those. */
  gates: number[];
  /** Enemies seen coming, if any. */
  raid: Raid | null;
  /** When the next raid arrives (0: not planned yet); it's seen coming RAID_WARNING_MS before. */
  nextRaid: number;
  lastRaid: RaidReport | null;
  /** No newcomer knocks before this (ms); one at a time. */
  nextNewcomer: number;
  /** When a couple may next have a child (0: not planned yet). */
  nextBirth: number;
  /** Tools in town per kind, by rarity (index into RARITIES); fractional as they wear (update 22). */
  tools: Partial<Record<ToolKind, number[]>>;
  /** Tools the smiths have made but nobody has looked at yet: the server turns every whole one into a tool. */
  forged: number;
}

/** Who knocks on the door, for the vote: only for the story. */
export interface NewcomerProfile {
  name: string;
  trade: string;
  from: string;
}

export type ProposalAction =
  | { kind: "build"; type: string; x: number; y: number }
  | { kind: "upgrade"; building: number }
  | { kind: "roads" }
  | { kind: "buy"; item: string }
  /** Lay a path on these tiles (y × MAP_SIZE + x). */
  | { kind: "paths"; tiles: number[] }
  /** Take the path off these tiles, for a bit back. */
  | { kind: "unpave"; tiles: number[] }
  /** Tear a building down, for a bit back. */
  | { kind: "demolish"; building: number }
  /** The next phase of the world wonder under construction. */
  | { kind: "wonder"; building: number }
  /** A mine digs another ore from now on. */
  | { kind: "ore"; building: number; ore: ResourceId }
  /** A smith makes tools from now on (or goes back to its own thing). */
  | { kind: "tools"; building: number; on: boolean }
  /** Put a wall on these tiles, or take it off for a bit back. */
  | { kind: "walls"; tiles: number[] }
  | { kind: "unwall"; tiles: number[] }
  /** Make these wall tiles a gate. */
  | { kind: "gate"; tiles: number[] }
  /** Bring the whole wall up to the current era. */
  | { kind: "fortify" }
  /** Fix a building the raiders set on fire. */
  | { kind: "repair"; building: number }
  /** Someone knocked on the door: may they stay? (Only the town proposes this.) */
  | { kind: "newcomer"; who: NewcomerProfile };

export interface IdleProposal {
  id: number;
  action: ProposalAction;
  /** Nickname of whoever proposed it. */
  by: string;
  /** Per player (or connection, before it said who it is): true = yes, false = no. */
  votes: Record<string, boolean>;
  /** It expires then. */
  deadline: number;
}

/** Someone who ever came by, kept by a secret key in their browser. */
export interface IdlePlayer {
  name: string;
  look: NpcLook;
  /** Outfits bought at the tailor (free ones aren't listed). */
  owned: string[];
  /** Last time they were online (ms). */
  seen: number;
}

export interface IdleState extends IdleWorld {
  /** Open votes, oldest first. */
  proposals: IdleProposal[];
  nextProposalId: number;
  /** Public player id → player. */
  players: Record<string, IdlePlayer>;
}

const perkOf = (s: Pick<IdleWorld, "perks">, id: string): number => s.perks[id] ?? 0;

function addBuilding<T extends IdleWorld>(s: T, type: string, level: number, spot: { x: number; y: number }): { state: T; building: PlacedBuilding } {
  const building = { id: s.nextBuildingId, type, level, x: spot.x, y: spot.y };
  return { state: { ...s, buildings: [...s.buildings, building], nextBuildingId: s.nextBuildingId + 1 }, building };
}

/** A fresh town: a campfire, one hut and a barn; the rest the players vote for. */
export function newIdleState(now: number): IdleState {
  let s: IdleState = {
    v: STATE_VERSION, era: 0, resources: { food: 150, wood: 200, stone: 100 }, buildings: [], nextBuildingId: 1,
    lastTick: now, boostUntil: 0, boosts: [], perks: {}, roadLevel: 0, roads: [], nature: {}, gatherers: {}, population: 0, happiness: HAPPY_BASE, drops: [], nextDropId: 1, lastLucky: 0,
    walls: [], wallLevel: 0, gates: [], raid: null, nextRaid: 0, lastRaid: null, nextNewcomer: 0, nextBirth: 0, tools: {}, forged: 0, proposals: [], nextProposalId: 1, players: {},
  };
  for (const type of ["center", "house", "storage"]) s = addBuilding(s, type, 0, placeBuilding(s.buildings, type)!).state;
  return { ...s, roads: classicStreets(s.buildings), population: bedsOf(s) };
}

/**
 * Move what stands round the Kampvuur, where De Senaat will come, to the
 * nearest free spot for its type (towns from before update 21 have their
 * first Hut and Schuur there). Nothing else changes.
 */
export function makeRoomForSenate<T extends IdleWorld>(s: T): T {
  const inTheWay = (b: PlacedBuilding) => reservedFor(s.buildings, b.x, b.y) !== null;
  if (!s.buildings.some(inTheWay)) return s;
  const blocked = [...s.roads, ...s.walls, ...takenTiles(s.buildings)];
  const moved = new Map<number, PlacedBuilding>();
  for (const b of s.buildings.filter(inTheWay)) {
    const spot = placeBuilding([...s.buildings, ...moved.values()], b.type, blocked);
    if (spot) moved.set(b.id, { ...b, ...spot });
  }
  return { ...s, buildings: s.buildings.map((b) => moved.get(b.id) ?? b) };
}

/** Unlock eras up to `era` (never back). */
export function unlockEra<T extends IdleWorld>(s: T, era: number): T {
  return era > s.era ? { ...s, era: Math.min(era, ERAS.length - 1) } : s;
}

export const unlockedResources = (era: number): ResourceId[] => RESOURCES.filter((r) => r.era <= era).map((r) => r.id);

// ---------- villagers and production ----------

export interface Workforce {
  population: number;
  beds: number;
  /** Villagers without a bed: they sleep outside (and still work). */
  homeless: number;
  /** Work building id → villagers working there. */
  workers: Record<number, number>;
  idle: number;
}

/** Workers one work building can take: its level's slots plus the university's perk. */
export const slotsAt = (s: Pick<IdleWorld, "perks">, b: PlacedBuilding): number => slotsOf(b.level) + perkOf(s, "workplace");

/** Beds in all houses together (not in the ones on fire). */
export function bedsOf(s: Pick<IdleWorld, "buildings">): number {
  let beds = 0;
  for (const b of s.buildings) if (buildingType(b.type)?.category === "house" && !b.damaged) beds += housingOf(b.level);
  return beds;
}

/** Whole villagers in town (someone halfway moving out still counts until they're gone). */
const peopleOf = (s: Pick<IdleWorld, "population">): number => Math.max(0, Math.floor(s.population + 1e-9));

/** Beds nobody sleeps in: only then does a newcomer knock or a couple have a child. */
export const freeBedsOf = (s: Pick<IdleWorld, "buildings" | "population">): number => Math.max(0, bedsOf(s) - peopleOf(s));

/**
 * Fill work buildings one villager at a time, round robin in build order, so
 * everyone gets staff before anyone is full. Leftovers are idle.
 */
export function assignWorkers(s: Pick<IdleWorld, "buildings" | "perks" | "population">): Workforce {
  const population = peopleOf(s);
  const beds = bedsOf(s);
  const jobs = s.buildings.filter((b) => buildingType(b.type)?.category === "work" && !b.damaged);
  const workers: Record<number, number> = Object.fromEntries(jobs.map((b) => [b.id, 0]));
  let left = population;
  let open = true;
  while (left > 0 && open) {
    open = false;
    for (const b of jobs) {
      if (left > 0 && workers[b.id] < slotsAt(s, b)) {
        workers[b.id]++;
        left--;
        open = true;
      }
    }
  }
  return { population, beds, homeless: Math.max(0, population - beds), workers, idle: left };
}

/** What a work building makes: a mine the ore the players picked. */
export const producesOf = (b: Pick<PlacedBuilding, "type" | "ore">): ResourceId | undefined => b.ore ?? buildingType(b.type)?.produces;

/** The ores a mine can dig now (empty for anything else). */
export const oresOf = (s: Pick<IdleWorld, "era">, type: string): ResourceId[] =>
  (buildingType(type)?.ores ?? []).filter((id) => (resourceDef(id)?.era ?? Infinity) <= s.era);

/** Output of one work building with its level's slots filled (each extra worker adds the same). */
export function fullRateOf(b: PlacedBuilding): number {
  const res = producesOf(b);
  if (!res) return 0;
  return (BASE_RATE[res] ?? SPECIAL_BASE_RATE) * scaleOf(b.level) * (buildingType(b.type)?.oreShare ?? 1);
}

/** The smith's bonus on a resource: ×1.1 per level. */
const toolsOf = (s: Pick<IdleWorld, "perks">, res: ResourceId): number =>
  1 + 0.1 * perkOf(s, res in BASE_RATE ? `tools_${res}` : "tools_special");

// ---------- tools (update 22) ----------

/** The smiths, who can make tools instead of weapons or armor. */
export const isSmith = (type: string): boolean => type === "weaponsmith" || type === "armorsmith";

/** The tool a work building's workers need, if any (none before the Iron Age). */
export const toolOf = (s: Pick<IdleWorld, "era">, b: PlacedBuilding): ToolKind | null => (s.era >= TOOLS_FROM_ERA ? toolKindOf(b.type, producesOf(b)) : null);
/** …and gatherers: an axe for wood, a pick for stone (berries are picked by hand). */
const gatherTool = (res: ResourceId): ToolKind | null => (res === "wood" ? "axe" : res === "stone" ? "pick" : null);

export interface ToolUse {
  /** Workers who need this tool (in buildings and gathering). */
  need: number;
  /** How many of them have one, per rarity (RARITIES order): the best go first. */
  have: number[];
  /** How fast they work together: 1 with a common tool each. */
  mult: number;
}

type ToolTown = Pick<IdleWorld, "buildings" | "perks" | "era" | "gatherers" | "population"> & { tools?: IdleWorld["tools"]; resources?: Amounts };

/** Per tool kind that anyone needs: who has one, and how fast that makes them. */
export function toolUseOf(s: ToolTown): Partial<Record<ToolKind, ToolUse>> {
  if (s.era < TOOLS_FROM_ERA) return {};
  const need: Partial<Record<ToolKind, number>> = {};
  const { workers } = assignWorkers(s);
  for (const b of s.buildings) {
    const k = toolOf(s, b);
    if (k && workers[b.id]) need[k] = (need[k] ?? 0) + workers[b.id];
  }
  const { chosen, auto } = gatheringOf(s);
  for (const res of ["wood", "stone"]) {
    const n = (chosen[res] ?? 0) + (auto[res] ?? 0);
    const k = gatherTool(res)!;
    if (n) need[k] = (need[k] ?? 0) + n;
  }
  const out: Partial<Record<ToolKind, ToolUse>> = {};
  for (const [k, n] of Object.entries(need) as [ToolKind, number][]) {
    const stock = s.tools?.[k] ?? [];
    const have = RARITIES.map(() => 0);
    let left = n;
    for (let r = RARITIES.length - 1; r >= 0 && left > 0; r--) {
      have[r] = Math.min(left, stock[r] ?? 0);
      left -= have[r];
    }
    out[k] = { need: n, have, mult: (RARITIES.reduce((a, rarity, r) => a + have[r] * rarity.mult, 0) + left * NO_TOOL_MULT) / n };
  }
  return out;
}

/** Made but not handed out yet: the server does that every second, so this is never reached unless nobody is online. */
const MAX_FORGED = 20;

/** Tools in stock of a kind, all rarities together. */
export const toolCount = (s: Pick<IdleWorld, "tools">, kind: ToolKind): number => (s.tools?.[kind] ?? []).reduce((a, n) => a + n, 0);

/** Tools per ms of work the smiths on tools make together, with all their workers at full speed. */
function craftRate(s: Pick<IdleWorld, "buildings" | "perks" | "population">): number {
  const { workers } = assignWorkers(s);
  let rate = 0;
  for (const b of s.buildings) if (b.tools && !b.damaged) rate += (workers[b.id] ?? 0) / slotsOf(b.level) / TOOL_CRAFT_MS;
  return rate;
}

/** The kind the town is shortest of: most workers without one (else the fewest in stock). */
function mostNeeded(s: ToolTown): ToolKind {
  const use = toolUseOf(s);
  let best: ToolKind = TOOLS[0].id;
  let bestScore = -Infinity;
  for (const t of TOOLS) {
    const u = use[t.id];
    const score = u ? u.need - toolCount({ tools: s.tools ?? {} }, t.id) : -1000 - toolCount({ tools: s.tools ?? {} }, t.id);
    if (score > bestScore) {
      bestScore = score;
      best = t.id;
    }
  }
  return best;
}

/**
 * One more tool, of the kind the town is shortest of. `roll` (0..1) decides
 * its rarity; `skill` (0..1, from the smithing game) makes rare and epic likelier.
 */
export function addTool<T extends IdleWorld>(s: T, roll: number, skill = 0): { state: T; kind: ToolKind; rarity: number } {
  const kind = mostNeeded(s);
  const epic = EPIC_CHANCE + 0.25 * skill * skill;
  const rare = RARE_CHANCE + 0.4 * skill;
  const rarity = roll < epic ? 2 : roll < epic + rare ? 1 : 0;
  const stock = RARITIES.map((_, i) => (s.tools[kind]?.[i] ?? 0) + (i === rarity ? 1 : 0));
  return { state: { ...s, tools: { ...s.tools, [kind]: stock } }, kind, rarity };
}

/** "een zeldzame bijl", "een gewone hengel". */
export function toolText(kind: ToolKind, rarity: number): string {
  const t = TOOLS.find((x) => x.id === kind)!;
  const adj = ["gewone", "zeldzame", "epische"][rarity];
  return `${t.emoji} een ${adj} ${t.name}`;
}

/** Turn a whole tool the smiths made into a real one (the server, every tick); rare and epic ones are news. */
export function stepForge<T extends IdleWorld>(s: T, rand: () => number): { state: T; label?: string } | null {
  if (s.forged < 1) return null;
  const { state, kind, rarity } = addTool({ ...s, forged: s.forged - 1 }, rand());
  return { state, ...(rarity > 0 ? { label: `🔨 De smeden maakten ${toolText(kind, rarity)}!` } : {}) };
}

/** Why nobody can smith a tool at this building right now (the smithing game), or null. */
export function forgeError(s: IdleWorld, building: number): string | null {
  if (s.era < TOOLS_FROM_ERA) return `gereedschap komt pas in de ${ERAS[TOOLS_FROM_ERA].name}`;
  const b = s.buildings.find((x) => x.id === building);
  if (!b || !isSmith(b.type)) return "dat is geen smidse";
  if (b.damaged) return "eerst herstellen";
  return canAfford(s, TOOL_COST) ? null : "te duur";
}

/** Smith a tool yourself: pay TOOL_COST, `score` (0..1) from the game makes it likelier to be rare. */
export function forgeTool<T extends IdleWorld>(s: T, score: number, roll: number): { state: T; kind: ToolKind; rarity: number } {
  return addTool(pay(s, TOOL_COST), roll, Math.max(0, Math.min(1, score)));
}

// ---------- nature running out ----------

type Used = Readonly<Record<string, number>>;
const leftIn = (p: Patch, used: Used): number => p.capacity - (used[p.id] ?? 0);

/**
 * The patches a work building takes from, nearest first: its kind of nature
 * within WORK_RANGE. Null if it needs none (farms grow their own food).
 * Hunters look at the forest: that's where the game lives.
 */
export function sourcePatches(b: PlacedBuilding): Patch[] | null {
  const t = buildingType(b.type);
  const res = t?.source === undefined ? t?.produces : t.source;
  if (!res) return null;
  const near = new Map<Patch, number>();
  for (let dy = -WORK_RANGE; dy <= WORK_RANGE; dy++) {
    for (let dx = -WORK_RANGE; dx <= WORK_RANGE; dx++) {
      const p = patchAt(b.x + dx, b.y + dy);
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      if (p?.resource === res && d < (near.get(p) ?? Infinity)) near.set(p, d);
    }
  }
  return [...near].sort((a, b) => a[1] - b[1]).map(([p]) => p);
}

/** What's left around a work building, in clicks; null if it needs no source. */
export function sourceLeft(s: Pick<IdleWorld, "nature">, b: PlacedBuilding): { left: number; total: number } | null {
  const src = sourcePatches(b);
  if (!src) return null;
  return { left: src.reduce((a, p) => a + Math.max(0, leftIn(p, s.nature)), 0), total: src.reduce((a, p) => a + p.capacity, 0) };
}

// ---------- villagers without a job gather ----------

const gatherCache = new Map<ResourceId, Patch[]>();

/** The patches of a resource gatherers take from, nearest the town center first. */
export function gatherPatches(res: ResourceId): Patch[] {
  let list = gatherCache.get(res);
  if (!list) {
    const dist = (p: Patch) => Math.min(...p.tiles.map((t) => Math.max(Math.abs(t.x - CENTER.x), Math.abs(t.y - CENTER.y))));
    list = patches()
      .filter((p) => p.resource === res && dist(p) <= GATHER_RANGE)
      .map((p) => [p, dist(p)] as const)
      .sort((a, b) => a[1] - b[1])
      .map(([p]) => p);
    gatherCache.set(res, list);
  }
  return list;
}

/** What villagers without a job can gather: unlocked, and growing near the town. */
export const gatherable = (era: number): ResourceId[] => unlockedResources(era).filter((id) => gatherPatches(id).length > 0);

export interface Gathering {
  /** Put there by the players. */
  chosen: Amounts;
  /** Left to themselves: spread over the basic resources. */
  auto: Amounts;
}

/**
 * Who of the villagers without a job gathers what. The players' choices
 * count as far as there are people (in resource order); everyone else is
 * spread evenly over food, wood and stone, skipping what's full (with
 * `resources` given) as long as something isn't.
 */
export function gatheringOf(s: Pick<IdleWorld, "buildings" | "perks" | "era" | "gatherers" | "population"> & { resources?: Amounts }): Gathering {
  const options = gatherable(s.era);
  let left = assignWorkers(s).idle;
  const chosen: Amounts = {};
  for (const id of options) {
    const n = Math.min(left, Math.max(0, Math.floor(s.gatherers[id] ?? 0)));
    if (n > 0) chosen[id] = n;
    left -= n;
  }
  const auto: Amounts = {};
  const full = s.resources ? fullOf({ ...s, resources: s.resources }) : new Set<ResourceId>();
  const all = options.filter((id) => id in BASE_RATE);
  const basics = all.some((id) => !full.has(id)) ? all.filter((id) => !full.has(id)) : all;
  for (let i = 0; left > 0 && basics.length; i++, left--) {
    const id = basics[i % basics.length];
    auto[id] = (auto[id] ?? 0) + 1;
  }
  return { chosen, auto };
}

/**
 * Put one villager without a job on `to` (null: leave it to them), taking
 * them off `from` if the players had put them there. An error text if that
 * can't be done.
 */
export function assignGatherer<T extends IdleWorld>(s: T, from: ResourceId | null, to: ResourceId | null): T | string {
  const options = gatherable(s.era);
  if ((from !== null && !options.includes(from)) || (to !== null && !options.includes(to))) return "dat groeit hier niet";
  if (from === to) return s;
  // Start from what actually counts, so choices for people who since got a job don't linger.
  const g: Amounts = { ...gatheringOf(s).chosen };
  if (from !== null) {
    if (!g[from]) return "die verzamelt dat niet";
    g[from]--;
    if (!g[from]) delete g[from];
  }
  if (to !== null) {
    const total = Object.values(g).reduce((a, n) => a + n, 0);
    if (total >= assignWorkers(s).idle) return "iedereen zonder werk heeft al een taak";
    g[to] = (g[to] ?? 0) + 1;
  }
  return { ...s, gatherers: g };
}

/** Patches grow back over `ms`. */
function regrow(used: Used, ms: number): Record<string, number> {
  const out: Record<string, number> = {};
  const all = patches();
  for (const [id, n] of Object.entries(used)) {
    const left = n - (all[Number(id)]?.regrow ?? Infinity) * ms;
    if (left > 0.001) out[id] = left;
  }
  return out;
}

// ---------- production ----------

/** Something that makes a resource: where it takes it from (null: nowhere) and how many clicks that costs per click's worth. */
interface Output {
  res: ResourceId;
  kind?: FoodKind;
  rate: number;
  src: Patch[] | null;
  drain: number;
  /** Used per unit made (the smiths). */
  uses?: Amounts;
}

/**
 * What each work building and the gatherers make per second without boosts;
 * nothing if their nature is used up (only checked when `nature` is given).
 */
function outputs(s: ToolTown & { nature?: Used }): Output[] {
  const { workers } = assignWorkers(s);
  const tools = toolUseOf(s);
  const toolMult = (k: ToolKind | null) => (k && tools[k]?.mult) || 1;
  const out: Output[] = [];
  const left = (src: Patch[] | null) => !s.nature || !src || src.some((p) => leftIn(p, s.nature!) > 0.01);
  for (const b of s.buildings) {
    const t = buildingType(b.type);
    const res = producesOf(b);
    // A smith on tools makes those instead (see advance).
    if (!t || !res || b.tools) continue;
    const src = sourcePatches(b);
    const rate = ((fullRateOf(b) * (workers[b.id] ?? 0)) / slotsOf(b.level)) * toolsOf(s, res) * toolMult(toolOf(s, b));
    if (t.sparesSource) {
      // Hunters: as much as the forest around them still stands.
      const share = s.nature ? sourceShare(s.nature, src) : 1;
      if (share > 0.001) out.push({ res, kind: t.foodKind, rate: rate * share, src: null, drain: 0 });
      continue;
    }
    if (!left(src)) continue;
    out.push({ res, kind: t.foodKind, rate, src, drain: WORK_DRAIN, uses: t.consumes });
  }
  const { chosen, auto } = gatheringOf(s);
  for (const res of gatherable(s.era)) {
    const n = (chosen[res] ?? 0) + (auto[res] ?? 0);
    const src = gatherPatches(res);
    if (n > 0 && left(src)) out.push({ res, kind: res === "food" ? "berries" : undefined, rate: n * GATHER_RATE * clickAmount(s.era) * toolsOf(s, res) * toolMult(s.era >= TOOLS_FROM_ERA ? gatherTool(res) : null), src, drain: 1 });
  }
  return out;
}

/** Share of a building's source still there (1 with no source at all). */
function sourceShare(used: Used, src: Patch[] | null): number {
  if (!src) return 1;
  const total = src.reduce((a, p) => a + p.capacity, 0);
  return total ? src.reduce((a, p) => a + Math.max(0, leftIn(p, used)), 0) / total : 0;
}

/** Share of what a work building works from that's still there: hunters catch this share. */
export const sourceShareOf = (s: Pick<IdleWorld, "nature">, b: PlacedBuilding): number => sourceShare(s.nature, sourcePatches(b));

/** Food per second by kind, without boosts (the lab's robots make no particular kind). */
export function foodKindsOf(s: Pick<IdleWorld, "buildings" | "perks" | "era" | "gatherers" | "population"> & { nature?: Used }): Partial<Record<FoodKind, number>> {
  const out: Partial<Record<FoodKind, number>> = {};
  // What the town eats doesn't change while the food storage happens to be full.
  for (const { kind, rate } of outputs({ ...s, resources: undefined })) if (kind && rate > 0) out[kind] = (out[kind] ?? 0) + rate;
  return out;
}

// ---------- happiness ----------

type Town = Pick<IdleWorld, "buildings" | "perks" | "era" | "gatherers" | "population" | "boosts"> & { nature?: Used; happiness?: number };

/** One thing that makes the town happier or unhappier, for the overview. */
export interface HappinessPart {
  emoji: string;
  label: string;
  points: number;
}

export interface Happiness {
  /** The meter, 0–100; 50 is content. */
  level: number;
  /** Where the meter is heading: the base plus the parts. */
  target: number;
  /** What the target is made of (the base not included). */
  parts: HappinessPart[];
  /** Work speed of workers and gatherers: ×0.5 (0) to ×1 (50) to ×1.2 (100). */
  mult: number;
}

const clampHappy = (n: number) => Math.max(0, Math.min(100, n));

/** Everything but beds: what draws people to the town (or makes them leave). */
function moodParts(s: Town, now: number): HappinessPart[] {
  const kinds = Object.keys(foodKindsOf(s)).length;
  const parts: HappinessPart[] = [
    { emoji: "🍽️", label: kinds === 1 ? "1 soort voedsel" : `${kinds} soorten voedsel`, points: VARIETY_POINTS[Math.min(kinds, VARIETY_POINTS.length - 1)] },
  ];
  const decor = s.buildings.filter((b) => buildingType(b.type)?.category === "decor").length;
  if (decor) parts.push({ emoji: "🗿", label: decor === 1 ? "1 decoratie" : `${decor} decoraties`, points: Math.min(MAX_DECOR_POINTS, decor * DECOR_POINTS) });
  if (hasBuilding(s, "shop_tavern")) parts.push({ emoji: "🍺", label: buildingName("shop_tavern", s.era), points: TAVERN_POINTS });
  if (s.boosts.some((b) => b.item === "party" && b.until > now)) parts.push({ emoji: "🎉", label: "dorpsfeest", points: PARTY_POINTS });
  if (s.boosts.some((b) => b.item === "lucky_party" && b.until > now)) parts.push({ emoji: "🥳", label: "spontaan feest", points: LUCKY_PARTY_POINTS });
  for (const m of RAID_MOODS) if (s.boosts.some((b) => b.item === m.id && b.until > now)) parts.push({ emoji: m.emoji, label: m.name, points: m.points });
  return parts;
}

const sumParts = (parts: readonly HappinessPart[]) => clampHappy(HAPPY_BASE + parts.reduce((a, p) => a + p.points, 0));

/**
 * How happy the town is: the meter (without one, straight at the target), and
 * the target it creeps to from food variety, beds, decorations, the tavern.
 */
export function happinessOf(s: Town, now: number): Happiness {
  const parts = moodParts(s, now);
  const { population, homeless } = assignWorkers(s);
  if (homeless > 0) parts.push({ emoji: "⛺", label: `${homeless} zonder bed`, points: -Math.round((HOMELESS_POINTS * homeless) / population) });
  const target = sumParts(parts);
  const level = clampHappy(s.happiness ?? target);
  return { level, target, parts, mult: level < 50 ? 0.5 + level / 100 : 1 + (0.2 * (level - 50)) / 50 };
}

/**
 * How many villagers the town draws: its beds while content (50), down to
 * half of them when miserable, up to a quarter more than there are beds when
 * very happy. Below it newcomers knock (as far as there are free beds), above
 * it people leave. It follows the meter, so people only come or go once the
 * town has really become happier or unhappier; sleeping outside doesn't count here.
 */
export function populationTarget(s: Town, now: number): number {
  const h = happinessOf(s, now);
  const outside = h.parts.find((p) => p.emoji === "⛺")?.points ?? 0;
  const mood = clampHappy(h.level - outside);
  return bedsOf(s) * (mood < 50 ? 0.5 + mood / 100 : 1 + (mood - 50) / 200);
}

/** The lab's robots: gathering every unlocked resource, from nowhere in particular. */
const autoRate = (s: Pick<IdleWorld, "perks" | "era">, res: ResourceId): number =>
  0.25 * perkOf(s, "auto") * clickAmount(s.era) * toolsOf(s, res);

// ---------- day and night ----------

const CYCLE_MS = DAY_MS + NIGHT_MS;
/** Where in its day `ms` is: from 0 the day, from DAY_MS the night. */
const phaseOf = (ms: number): number => ((ms % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;

/** Is it night in the town at `ms`? Days and nights go by the clock, the same for everyone. */
export const isNight = (ms: number): boolean => phaseOf(ms) >= DAY_MS;

/** When the next night begins, `ms` itself if one begins right then. */
export const nextNightAt = (ms: number): number => ms + ((DAY_MS - phaseOf(ms) + CYCLE_MS) % CYCLE_MS);

/** When the day after `ms` begins (`ms` itself in the daytime). */
export const nextDayAt = (ms: number): number => (isNight(ms) ? ms + CYCLE_MS - phaseOf(ms) : ms);

/** Night from the start of the clock up to `ms`. */
const nightsUpTo = (ms: number): number => Math.floor(ms / CYCLE_MS) * NIGHT_MS + Math.max(0, phaseOf(ms) - DAY_MS);

/** The work done from `from` to `to`, in ms of daytime work: a night counts for NIGHT_WORK. */
export function workMs(from: number, to: number): number {
  if (to <= from) return 0;
  return to - from - (1 - NIGHT_WORK) * (nightsUpTo(to) - nightsUpTo(from));
}

/** Production per second without boosts, as happy as the town is at `lastTick` (and at that time of day). */
export function ratesOf(s: Town & Pick<IdleWorld, "lastTick"> & { resources?: Amounts }): Amounts {
  const rates: Amounts = {};
  const mult = happinessOf(s, s.lastTick).mult * (isNight(s.lastTick) ? NIGHT_WORK : 1);
  const all = outputs(s);
  for (const { res, rate, uses } of all) if (!uses) rates[res] = (rates[res] ?? 0) + rate * mult;
  if (perkOf(s, "auto")) for (const id of unlockedResources(s.era)) rates[id] = (rates[id] ?? 0) + autoRate(s, id) * (isNight(s.lastTick) ? NIGHT_WORK : 1);
  // The smiths: only while there's iron and coal (in stock or coming in); the HUD shows what's left of those.
  for (const { res, rate, uses } of all) {
    if (!uses) continue;
    const ok = Object.keys(uses).every((id) => (s.resources?.[id] ?? 0) >= 1 || (rates[id] ?? 0) > 0);
    if (!ok) continue;
    rates[res] = (rates[res] ?? 0) + rate * mult;
    for (const [id, n] of Object.entries(uses)) rates[id] = (rates[id] ?? 0) - rate * mult * n;
  }
  // The smiths on tools use iron and coal too, while there is some.
  const craft = craftRate(s) * 1000 * mult;
  if (craft > 0 && Object.keys(TOOL_COST).every((id) => (s.resources?.[id] ?? 0) >= TOOL_COST[id] || (rates[id] ?? 0) > 0)) {
    for (const [id, n] of Object.entries(TOOL_COST)) rates[id] = (rates[id] ?? 0) - craft * n;
  }
  return rates;
}

/** What one storage building at this level adds for its resource. */
export const storeCap = (level: number): number => STORAGE_CAP * scaleOf(level);

/** One thing that adds to a resource's storage limit, for the overview. */
export interface CapPart {
  emoji: string;
  label: string;
  amount: number;
}

/**
 * What a resource's storage limit is made of: the base everyone has (×4^era),
 * the center, and every storage building that holds it (not the ones on fire);
 * the bank's vault adds a share on top of all of it.
 */
export function capPartsOf(s: Pick<IdleWorld, "buildings" | "era" | "perks">, res: ResourceId): CapPart[] {
  const parts: CapPart[] = [{ emoji: "📦", label: "basis", amount: BASE_CAP * scaleOf(s.era) }];
  for (const b of s.buildings) {
    if (b.damaged) continue;
    const t = buildingType(b.type);
    if (b.type === "center") parts.push({ emoji: t!.emoji, label: buildingName(b.type, b.level), amount: CENTER_CAP * scaleOf(b.level) });
    else if (t?.stores === res) parts.push({ emoji: t.emoji, label: buildingName(b.type, b.level), amount: storeCap(b.level) });
  }
  const vault = perkOf(s, "vault");
  if (vault) parts.push({ emoji: "🔐", label: "grotere kluis", amount: 0.25 * vault * parts.reduce((a, p) => a + p.amount, 0) });
  return parts;
}

/** Storage limit of one resource: every resource has its own (update 17). */
export function capOf(s: Pick<IdleWorld, "buildings" | "era" | "perks">, res: ResourceId): number {
  return capPartsOf(s, res).reduce((a, p) => a + p.amount, 0);
}

/** Resources whose storage is full: their workers stop, gatherers left to themselves pick something else. */
export function fullOf(s: Pick<IdleWorld, "buildings" | "era" | "perks" | "resources">): Set<ResourceId> {
  return new Set(unlockedResources(s.era).filter((id) => (s.resources[id] ?? 0) + 1e-9 >= capOf(s, id)));
}

/** The storage building type that holds a resource. */
export const storeTypeOf = (res: ResourceId): string | undefined => BUILDING_TYPES.find((t) => t.stores === res)?.id;

export const boostActive = (s: IdleWorld, now: number): boolean => s.boostUntil > now;

/** Extra milliseconds of production a resource gets from boosts between `from` and `to`. */
function boostedMs(s: IdleWorld, res: ResourceId, from: number, to: number): number {
  const overlap = (until: number) => Math.max(0, Math.min(until, to) - from);
  let extra = overlap(s.boostUntil) * (BOOST_MULT - 1);
  for (const b of s.boosts) if (b.resource === null || b.resource === res) extra += overlap(b.until) * (b.mult - 1);
  return extra;
}

/** Production multiplier of a resource right now: 1 + every running boost (they add up). */
export function multiplierAt(s: IdleWorld, res: ResourceId, now: number): number {
  return 1 + boostedMs(s, res, now, now + 1);
}

/**
 * Produce everything from `lastTick` up to `now` (capped at MAX_OFFLINE_MS and
 * the storage limit). Work buildings and gatherers use up the nature around
 * them, and stop making more than is left; nature grows back meanwhile.
 * Villagers leave a town that draws fewer than it has. Happiness and the
 * number of people are taken as they were at `lastTick` for the whole stretch
 * (the server advances often; only a long absence makes that rough).
 */
export function advance<T extends IdleWorld>(s: T, now: number): T {
  const elapsed = Math.min(Math.max(0, now - s.lastTick), MAX_OFFLINE_MS);
  const next = { ...s, resources: { ...s.resources }, lastTick: Math.max(s.lastTick, now) };
  if (elapsed === 0) return next;
  const caps: Amounts = {};
  const cap = (res: ResourceId) => (caps[res] ??= capOf(s, res));
  // At night everything goes at NIGHT_WORK: the share of real work in this stretch.
  const work = workMs(s.lastTick, s.lastTick + elapsed) / elapsed;
  const seconds = (res: ResourceId) => ((elapsed + boostedMs(s, res, s.lastTick, s.lastTick + elapsed)) * work) / 1000;
  const used = regrow(s.nature, next.lastTick - s.lastTick);
  const click = clickAmount(s.era);
  const add = (res: ResourceId, amount: number): number => {
    const have = next.resources[res] ?? 0;
    const got = Math.max(0, Math.min(amount, cap(res) - have));
    if (got > 0) next.resources[res] = have + got;
    return got;
  };
  const town = { ...s, nature: used };
  const mood = happinessOf(town, s.lastTick);
  const { mult } = mood;
  const step = elapsed / HAPPY_STEP_MS;
  next.happiness = mood.level < mood.target ? Math.min(mood.target, mood.level + step) : Math.max(mood.target, mood.level - step);
  // Nobody moves in by themselves any more (newcomers knock, couples have children: update 18),
  // but people leave an unhappy town; nobody for less than a whole villager.
  const drawn = populationTarget(town, s.lastTick);
  if (drawn < s.population) next.population = Math.max(Math.min(s.population, Math.ceil(drawn - 1e-9)), s.population - elapsed / MOVE_MS);
  // Smiths last, so they can use what the mines made meanwhile.
  const all = outputs(town).sort((a, b) => Number(!!a.uses) - Number(!!b.uses));
  if (perkOf(s, "auto")) for (const id of unlockedResources(s.era)) add(id, autoRate(s, id) * seconds(id));
  for (const { res, rate, src, drain, uses } of all) {
    let amount = Math.min(rate * mult * seconds(res), cap(res) - (next.resources[res] ?? 0));
    if (amount <= 0) continue;
    if (uses) {
      // Make only what the iron and coal in storage allow, and use that up.
      for (const [id, n] of Object.entries(uses)) amount = Math.min(amount, (next.resources[id] ?? 0) / n);
      if (amount <= 0) continue;
      for (const [id, n] of Object.entries(uses)) next.resources[id] = Math.max(0, (next.resources[id] ?? 0) - amount * n);
    }
    if (src) {
      // Take what this needs from the nearest patches; make only as much as there was.
      const need = (amount / click) * drain;
      let took = 0;
      for (const p of src) {
        const take = Math.min(Math.max(0, leftIn(p, used)), need - took);
        if (take <= 0) continue;
        used[p.id] = (used[p.id] ?? 0) + take;
        took += take;
        if (took >= need) break;
      }
      amount *= took / need;
    }
    add(res, amount);
  }
  next.nature = used;
  // Tools wear while they're used (update 22); the smiths on tools make new ones from iron and coal.
  const worked = workMs(s.lastTick, s.lastTick + elapsed);
  const use = toolUseOf(town);
  if (Object.keys(use).length) {
    const tools = { ...s.tools };
    for (const [k, u] of Object.entries(use) as [ToolKind, ToolUse][]) {
      tools[k] = RARITIES.map((r, i) => Math.max(0, (s.tools[k]?.[i] ?? 0) - (u.have[i] * worked) / (TOOL_LIFE_MS * r.life)));
    }
    next.tools = tools;
  }
  let made = craftRate(town) * worked * mult;
  for (const [id, n] of Object.entries(TOOL_COST)) made = Math.min(made, (next.resources[id] ?? 0) / n);
  if (made > 0) {
    for (const [id, n] of Object.entries(TOOL_COST)) next.resources[id] = Math.max(0, (next.resources[id] ?? 0) - made * n);
    next.forged = Math.min(MAX_FORGED, s.forged + made);
  }
  if (s.boosts.some((b) => b.until <= next.lastTick)) next.boosts = s.boosts.filter((b) => b.until > next.lastTick);
  return next;
}

/** A +1 on the counter: extend the boost by BOOST_MS, up to MAX_BOOST_MS ahead. */
export function applyBoost<T extends IdleWorld>(s: T, now: number): T {
  return { ...s, boostUntil: Math.min(Math.max(s.boostUntil, now) + BOOST_MS, now + MAX_BOOST_MS) };
}

export const clickAmount = (era: number): number => CLICK_BASE * scaleOf(era);

// ---------- building and upgrading ----------

/** Cost of a type at a level, before the per-copy growth. */
function levelCost(typeId: string, level: number): Amounts {
  const t = buildingType(typeId)!;
  const cost: Amounts = {};
  for (const [id, n] of Object.entries(t.baseCost)) cost[id] = n * scaleOf(level);
  // A building never needs the special resource it makes; fall back to the era before.
  let special = ERAS[level]?.special ?? null;
  if (special && special === t.produces) special = level > 1 ? ERAS[level - 1].special : null;
  if (special && t.specialCost) cost[special] = (cost[special] ?? 0) + t.specialCost * scaleOf(level);
  return cost;
}

/** A price: the amounts in idleContent × `f` × PRICE_MULT, rounded up. */
const scaled = (a: Amounts, f: number): Amounts => Object.fromEntries(Object.entries(a).map(([k, n]) => [k, Math.ceil(n * f * PRICE_MULT)]));
/** Like `scaled`, rounded down and without the zeros: for what you get back. */
const refunded = (a: Amounts, f: number): Amounts =>
  Object.fromEntries(Object.entries(a).map(([k, n]): [string, number] => [k, Math.floor(n * f * PRICE_MULT)]).filter(([, n]) => n > 0));
/** The university's architecture perk: −10% per level. */
const discountOf = (s: Pick<IdleWorld, "perks">): number => 1 - 0.1 * perkOf(s, "architecture");

/** Building a new one, always at the current era's level. */
export function buildCost(s: Pick<IdleWorld, "buildings" | "era" | "perks">, typeId: string): Amounts | null {
  if (!buildingType(typeId)) return null;
  const group = buildingType(typeId)!.costGroup;
  const copies = s.buildings.filter((b) => b.type === typeId || (group && buildingType(b.type)?.costGroup === group)).length;
  return scaled(levelCost(typeId, s.era), BUILD_COST_MULT * COST_GROWTH ** copies * discountOf(s));
}

/** Bringing an old building up to the current era. */
export function upgradeCost(s: Pick<IdleWorld, "era" | "perks">, b: PlacedBuilding): Amounts {
  return scaled(levelCost(b.type, s.era), UPGRADE_SHARE * discountOf(s));
}

export function canAfford(s: Pick<IdleWorld, "resources">, cost: Amounts): boolean {
  // A hair of tolerance so float production doesn't block an exactly-earned buy.
  return Object.entries(cost).every(([id, n]) => (s.resources[id] ?? 0) + 1e-9 >= n);
}

/** What is still missing for a cost (empty when affordable). */
export function shortfall(s: Pick<IdleWorld, "resources">, cost: Amounts): Amounts {
  const out: Amounts = {};
  for (const [id, n] of Object.entries(cost)) {
    const have = s.resources[id] ?? 0;
    if (have + 1e-9 < n) out[id] = n - have;
  }
  return out;
}

const hasBuilding = (s: Pick<IdleWorld, "buildings">, type: string) => s.buildings.some((b) => b.type === type);
const needShop = (s: Pick<IdleWorld, "era">, shop: string) => `eerst een ${buildingName(shop, s.era)} bouwen`;

/** Why this type can't be built anywhere right now (place aside), or null. */
export function buildTypeError(s: Pick<IdleWorld, "buildings" | "era">, typeId: string): string | null {
  const t = buildingType(typeId);
  if (!t) return "onbekend";
  if (t.unique && hasBuilding(s, typeId)) return "bestaat al";
  if (t.minEra > s.era) return "nog niet ontgrendeld";
  if (t.category === "decor" && !hasBuilding(s, "shop_sculptor")) return needShop(s, "shop_sculptor");
  if (t.category === "wonder" && t.minEra < s.era) return "hoort bij een vorig tijdperk";
  return null;
}

/** Types that can go on a free tile through the build popup, in menu order (decorations come from the sculptor, the wonder from the center). */
export const buildableTypes = (s: Pick<IdleWorld, "buildings" | "era">) =>
  BUILDING_TYPES.filter((t) => t.category !== "decor" && t.category !== "wonder" && !buildTypeError(s, t.id));

/** Decorations the sculptor sells now. */
export const decorTypes = (era: number) => BUILDING_TYPES.filter((t) => t.category === "decor" && t.minEra <= era);

// ---------- eras: goals and the world wonder ----------

export interface GoalStatus {
  goal: EraGoal;
  label: string;
  have: number;
  need: number;
  done: boolean;
}

const countsAsCurrent = (b: PlacedBuilding) => !["decor", "wonder"].includes(buildingType(b.type)?.category ?? "");

/** How far the town is with the goals for leaving its era (none in the last era). */
export function eraGoals(s: IdleWorld): GoalStatus[] {
  return (ERA_GOALS[s.era] ?? []).map((goal): GoalStatus => {
    if (goal.kind === "population") {
      const have = assignWorkers(s).population;
      return { goal, label: `👥 ${goal.n} inwoners`, have, need: goal.n, done: have >= goal.n };
    }
    if (goal.kind === "happiness") {
      const have = Math.round(happinessOf(s, s.lastTick).level);
      return { goal, label: `😊 minstens ${goal.n}% geluk`, have, need: goal.n, done: have >= goal.n };
    }
    if (goal.kind === "foodKinds") {
      const have = Object.keys(foodKindsOf(s)).length;
      return { goal, label: `🍽️ ${goal.n} soorten voedsel`, have, need: goal.n, done: have >= goal.n };
    }
    if (goal.kind === "building") {
      const have = hasBuilding(s, goal.type) ? 1 : 0;
      return { goal, label: `${buildingType(goal.type)?.emoji ?? ""} een ${buildingName(goal.type, s.era)}`, have, need: 1, done: have >= 1 };
    }
    const have = s.buildings.filter((b) => countsAsCurrent(b) && b.level >= s.era).length;
    const era = ERAS[s.era];
    return { goal, label: `${era.emoji} ${goal.n} gebouwen uit de ${era.name} (nieuw of geüpgraded)`, have, need: goal.n, done: have >= goal.n };
  });
}

/** The era's world wonder type, or null in the last era. */
export const wonderType = (era: number): string | null => (buildingType(`wonder_${era}`) ? `wonder_${era}` : null);

/** The wonder under construction for the current era, if it was started. */
export const currentWonder = (s: Pick<IdleWorld, "buildings" | "era">): PlacedBuilding | null =>
  s.buildings.find((b) => b.type === wonderType(s.era)) ?? null;

/** Cost of a phase (0 = the first) of the current era's wonder. */
export function wonderCost(s: Pick<IdleWorld, "era" | "perks">, phase: number): Amounts {
  const cost: Amounts = { ...WONDER_COST };
  const special = ERAS[s.era].special;
  if (special) cost[special] = WONDER_SPECIAL_COST;
  return scaled(cost, scaleOf(s.era) * (1 + 0.5 * phase) * discountOf(s));
}

/** Milliseconds until the builders of a wonder are ready for its next phase, or null if they are. */
export function wonderWait(s: Pick<IdleWorld, "lastTick">, b: PlacedBuilding): number | null {
  return b.ready !== undefined && b.ready > s.lastTick ? b.ready - s.lastTick : null;
}

// ---------- the counter's extras: supply drops and lucky events ----------

/**
 * A crate lands on a free tile near the center (picked with `rand`, 0..1).
 * Nothing happens if MAX_DROPS are already waiting or no tile was found.
 */
export function addDrop<T extends IdleWorld>(s: T, rand: () => number): T {
  if (s.drops.length >= MAX_DROPS) return s;
  for (let i = 0; i < 60; i++) {
    const x = CENTER.x + Math.round((rand() - 0.5) * 12);
    const y = CENTER.y + Math.round((rand() - 0.5) * 12);
    const taken = !!buildingOn(s.buildings, x, y) || s.drops.some((d) => d.x === x && d.y === y);
    if (!isLand(x, y) || isRoad(s.roads, x, y) || isRoad(s.walls, x, y) || taken) continue;
    return { ...s, drops: [...s.drops, { id: s.nextDropId, x, y }], nextDropId: s.nextDropId + 1 };
  }
  return s;
}

/** What a crate holds right now: DROP_SECONDS of production, and at least DROP_MIN of each base resource. */
export function dropContents(s: IdleWorld): Amounts {
  const rates = ratesOf(s);
  const out: Amounts = {};
  for (const id of unlockedResources(s.era)) {
    const min = id in BASE_RATE ? DROP_MIN * scaleOf(s.era) : 0;
    const n = Math.floor(Math.max(min, (rates[id] ?? 0) * DROP_SECONDS));
    if (n > 0) out[id] = n;
  }
  return out;
}

/** Open a crate: what's in it goes into storage (as far as it holds it). */
export function openDrop<T extends IdleWorld>(s: T, id: number): { state: T; got: Amounts } | string {
  if (!s.drops.some((d) => d.id === id)) return "die krat is al open";
  const got = dropContents(s);
  return { state: { ...receive(s, got), drops: s.drops.filter((d) => d.id !== id) }, got };
}

export const luckyEvent = (id: string) => LUCKY_EVENTS.find((e) => e.id === id);

/**
 * A +1 on the counter may bring luck: LUCKY_CHANCE, at most once per
 * LUCKY_COOLDOWN_MS (at `lastTick`). Returns the new state and what
 * happened, or null. `rand` (0..1) decides; the server passes Math.random.
 */
export function rollLucky<T extends IdleWorld>(s: T, rand: () => number): { state: T; label: string } | null {
  const now = s.lastTick;
  if (now - s.lastLucky < LUCKY_COOLDOWN_MS || rand() >= LUCKY_CHANCE) return null;
  let e = LUCKY_EVENTS[Math.floor(rand() * LUCKY_EVENTS.length) % LUCKY_EVENTS.length];
  // Newcomers only for free beds: without one, it's a party instead.
  if (e.id === "lucky_newcomers" && !freeBedsOf(s)) e = luckyEvent("lucky_party")!;
  const next = { ...s, lastLucky: now };
  const boost = (resource: ResourceId | null, mult: number) => [...s.boosts.filter((b) => b.item !== e.id), { item: e.id, resource, mult, until: now + LUCKY_MS }];
  if (e.id === "lucky_gold") {
    const all = unlockedResources(s.era);
    const res = all[Math.floor(rand() * all.length) % all.length];
    return { state: { ...next, boosts: boost(res, LUCKY_GOLD_MULT) }, label: `${e.emoji} ${e.name}: ${resourceDef(res)?.emoji ?? ""} ×${LUCKY_GOLD_MULT} voor 10 minuten` };
  }
  if (e.id === "lucky_newcomers") {
    const n = Math.min(freeBedsOf(s), Math.max(3, Math.round(bedsOf(s) * LUCKY_NEWCOMERS_SHARE)));
    return { state: { ...next, population: peopleOf(s) + n }, label: `${e.emoji} ${e.name}: ${n === 1 ? "iemand trekt" : `${n} mensen trekken`} het dorp in` };
  }
  return { state: { ...next, boosts: boost(null, 1) }, label: `${e.emoji} ${e.name}: +${LUCKY_PARTY_POINTS} geluk voor 10 minuten` };
}

// ---------- shop items ----------

export const itemsOf = (shop: string, era: number): ShopItem[] =>
  SHOP_ITEMS.filter((i) => i.shop === shop && (buildingType(i.shop)?.minEra ?? 0) <= era);

export const itemLevel = (s: Pick<IdleWorld, "perks">, item: ShopItem): number => (item.effect.kind === "perk" ? perkOf(s, item.id) : 0);

export function itemCost(s: Pick<IdleWorld, "era" | "perks" | "population">, item: ShopItem): Amounts {
  const people = item.perPerson ? Math.max(1, peopleOf(s) / PARTY_PEOPLE) : 1;
  return scaled(item.cost, scaleOf(s.era) * PERK_GROWTH ** itemLevel(s, item) * people);
}

/** Why this item can't be bought now, or null. */
export function itemError(s: IdleWorld, itemId: string): string | null {
  const item = shopItem(itemId);
  if (!item) return "onbekend";
  if (!hasBuilding(s, item.shop)) return needShop(s, item.shop);
  if (item.effect.kind === "perk" && itemLevel(s, item) >= item.effect.max) return "maximaal niveau";
  if (!canAfford(s, itemCost(s, item))) return "te duur";
  return null;
}

function pay<T extends IdleWorld>(s: T, cost: Amounts): T {
  const resources = { ...s.resources };
  for (const [id, n] of Object.entries(cost)) resources[id] = Math.max(0, (resources[id] ?? 0) - n);
  return { ...s, resources };
}

/** Get resources back, as far as the storage holds them. */
function receive<T extends IdleWorld>(s: T, amounts: Amounts): T {
  const resources = { ...s.resources };
  for (const [id, n] of Object.entries(amounts)) resources[id] = Math.max(resources[id] ?? 0, Math.min(capOf(s, id), (resources[id] ?? 0) + n));
  return { ...s, resources };
}

/** Pay for an item and get its effect (at `lastTick`). Call itemError first. */
export function buyItem<T extends IdleWorld>(s: T, itemId: string): T {
  const item = shopItem(itemId)!;
  const paid = pay(s, itemCost(s, item));
  const now = s.lastTick;
  const e = item.effect;
  if (e.kind === "perk") return { ...paid, perks: { ...paid.perks, [item.id]: itemLevel(paid, item) + 1 } };
  if (e.kind === "boost") {
    const prev = paid.boosts.find((b) => b.item === item.id)?.until ?? now;
    const until = Math.min(Math.max(prev, now) + e.ms, now + MAX_ITEM_BOOST_MS);
    return { ...paid, boosts: [...paid.boosts.filter((b) => b.item !== item.id), { item: item.id, resource: e.resource, mult: e.mult, until }] };
  }
  return receive(paid, Object.fromEntries(Object.entries(ratesOf(paid)).map(([id, rate]) => [id, rate * e.seconds])));
}

// ---------- streets ----------

export const roadName = (level: number): string => ROAD_NAMES[Math.min(level, ROAD_NAMES.length - 1)];

/** Bringing every street up to the current era. */
export function roadCost(s: Pick<IdleWorld, "era" | "perks">): Amounts {
  const cost: Amounts = { ...ROAD_COST };
  const special = ERAS[s.era].special;
  if (special) cost[special] = ROAD_SPECIAL_COST;
  return scaled(cost, scaleOf(s.era) * discountOf(s));
}

/** Path tiles at level 0, before discounts: bridges over the river cost more. */
function pathBase(tiles: readonly number[]): Amounts {
  const bridges = tiles.filter((i) => isRiver(tileOf(i).x, tileOf(i).y)).length;
  const out: Amounts = {};
  for (const [cost, n] of [[PATH_TILE_COST, tiles.length - bridges], [BRIDGE_TILE_COST, bridges]] as const) {
    for (const [id, a] of Object.entries(cost)) if (n) out[id] = (out[id] ?? 0) + a * n;
  }
  return out;
}

/** Laying a path on these tiles, at the street network's level. */
export function pathCost(s: Pick<IdleWorld, "roadLevel" | "perks">, tiles: readonly number[]): Amounts {
  return scaled(pathBase(tiles), scaleOf(s.roadLevel) * discountOf(s));
}

/** Why this list of tiles can't be one proposal, or null. */
function tilesError(tiles: readonly number[]): string | null {
  if (!tiles.length) return "geen tegels gekozen";
  if (tiles.length > MAX_PATH_TILES) return `te veel tegels (max ${MAX_PATH_TILES})`;
  if (new Set(tiles).size !== tiles.length || !tiles.every(Number.isInteger)) return "ongeldige tegels";
  return null;
}

/** Why a path can't go on all of these tiles, or null. */
export function pathsError(s: Pick<IdleWorld, "buildings" | "roads" | "walls">, tiles: readonly number[]): string | null {
  const err = tilesError(tiles);
  if (err) return err;
  for (const i of tiles) {
    const { x, y } = tileOf(i);
    const e = pathError(s.buildings, s.roads, x, y, s.walls);
    if (e) return `(${x}, ${y}): ${e}`;
  }
  return null;
}

// ---------- walls ----------

export const wallName = (level: number): string => WALL_NAMES[Math.min(level, WALL_NAMES.length - 1)];

const wallBase = (n: number): Amounts => Object.fromEntries(Object.entries(WALL_TILE_COST).map(([id, a]) => [id, a * n]));

/** Building a wall on these tiles, at the wall's level. */
export function wallCost(s: Pick<IdleWorld, "wallLevel" | "perks">, tiles: readonly number[]): Amounts {
  return scaled(wallBase(tiles.length), scaleOf(s.wallLevel) * discountOf(s));
}

/** Bringing the whole wall up to the current era. */
export function fortifyCost(s: Pick<IdleWorld, "era" | "perks">): Amounts {
  const cost: Amounts = { ...WALL_UPGRADE_COST };
  const special = ERAS[s.era].special;
  if (special) cost[special] = WALL_SPECIAL_COST;
  return scaled(cost, scaleOf(s.era) * discountOf(s));
}

/** Making these wall tiles a gate, at the wall's level. */
export function gateCost(s: Pick<IdleWorld, "wallLevel" | "perks">, tiles: readonly number[]): Amounts {
  const base = Object.fromEntries(Object.entries(GATE_TILE_COST).map(([id, a]) => [id, a * tiles.length]));
  return scaled(base, scaleOf(s.wallLevel) * discountOf(s));
}

/** Why a wall can't go on all of these tiles, or null. */
export function wallsError(s: Pick<IdleWorld, "buildings" | "roads" | "walls">, tiles: readonly number[]): string | null {
  const err = tilesError(tiles);
  if (err) return err;
  for (const i of tiles) {
    const { x, y } = tileOf(i);
    const e = wallError(s.buildings, s.roads, s.walls, x, y);
    if (e) return `(${x}, ${y}): ${e}`;
  }
  return null;
}

/** Fixing a building the raiders set on fire. */
export function repairCost(s: Pick<IdleWorld, "perks">, b: PlacedBuilding): Amounts {
  return scaled(levelCost(b.type, b.level), BUILD_COST_MULT * REPAIR_SHARE * discountOf(s));
}

// ---------- enemies ----------

export interface DefensePart {
  emoji: string;
  label: string;
  points: number;
}

/** What holds raiders off: villagers, guards with weapons and armor, the wall and towers. */
export function defenseOf(s: Pick<IdleWorld, "buildings" | "population" | "resources" | "era" | "walls" | "wallLevel">): { total: number; parts: DefensePart[] } {
  const people = peopleOf(s);
  const sets = (id: ResourceId) => Math.floor((s.resources[id] ?? 0) / (ARMS_PER_GUARD * scaleOf(s.era)) + 1e-9);
  const armed = Math.min(people, sets("weapons"));
  const armored = Math.min(people, sets("armor"));
  const towers = s.buildings.filter((b) => buildingType(b.type)?.category === "defense" && !b.damaged);
  const parts: DefensePart[] = [{ emoji: "🧍", label: `${people} inwoners`, points: people * PERSON_DEFENSE }];
  if (armed) parts.push({ emoji: "🗡️", label: `${armed} gewapend`, points: armed * GUARD_POINTS });
  if (armored) parts.push({ emoji: "🛡️", label: `${armored} met harnas`, points: armored * ARMOR_POINTS });
  if (s.walls.length) parts.push({ emoji: "🧱", label: `${tilesText(s.walls.length)} ${wallName(s.wallLevel).toLowerCase()}`, points: s.walls.length * WALL_POINTS * (1 + s.wallLevel) });
  if (towers.length) parts.push({ emoji: "🗼", label: towers.length === 1 ? "1 toren" : `${towers.length} torens`, points: towers.reduce((a, b) => a + TOWER_POINTS * (1 + b.level), 0) });
  for (const p of parts) p.points = Math.round(p.points * 10) / 10;
  return { total: Math.round(parts.reduce((a, p) => a + p.points, 0)), parts };
}

/** How strong a raid on this town would be (`r` in 0..1 picks within the spread). */
export function raidStrength(s: Pick<IdleWorld, "era" | "population">, r: number): number {
  return Math.round((RAID_BASE + RAID_PER_ERA * s.era + RAID_PER_PERSON * peopleOf(s)) * (1 - RAID_SPREAD + 2 * RAID_SPREAD * r));
}

let hourFormat: Intl.DateTimeFormat | null = null;
/** The hour (0–23) in the Netherlands at `ms`. */
export function dutchHour(ms: number): number {
  hourFormat ??= new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", hour: "numeric", hourCycle: "h23" });
  return Number(hourFormat.format(ms));
}

/** How far into a night raiders arrive: it's dark by then. */
const RAID_INTO_NIGHT_MS = 2 * 60_000;

/** When the raid after `from` arrives: a few hours later, in a night of the town, while people are up. */
export function nextRaidAt(from: number, rand: () => number): number {
  let at = Math.round(from + RAID_GAP_MS + rand() * RAID_GAP_SPREAD_MS);
  for (let i = 0; i < 100; i++) {
    const h = dutchHour(at);
    if (h < RAID_HOURS[0] || h >= RAID_HOURS[1]) at += 60 * 60_000;
    else if (!isNight(at)) at = nextNightAt(at) + RAID_INTO_NIGHT_MS;
    else break;
  }
  return at;
}

/** Where raiders come from: land at the edge of the town, in a random direction. */
function raidOrigin(rand: () => number): { x: number; y: number } {
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const x = Math.round(CENTER.x + Math.cos(a) * 20);
    const y = Math.round(CENTER.y + Math.sin(a) * 20);
    if (x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE && isLand(x, y)) return { x, y };
  }
  return { x: CENTER.x - 20, y: CENTER.y };
}

const mood = (id: string, now: number): ActiveBoost => ({ item: id, resource: null, mult: 1, until: now + RAID_MOODS.find((m) => m.id === id)!.ms });

export type RaidStage = "coming" | "won" | "lost";

/**
 * Move the raids along at `lastTick` (advance first): plan the next one, see it
 * coming an hour before (never with less warning, also after a long time
 * nobody was around; and always arriving at night), and fight it when it arrives. `rand` (0..1) decides;
 * the server passes Math.random. Returns what happened, if anything.
 */
export interface RaidNews {
  stage: RaidStage;
  label: string;
  /** The building set on fire. */
  damaged?: number;
}

export function stepRaid<T extends IdleWorld>(s: T, rand: () => number): { state: T; news?: RaidNews } | null {
  const now = s.lastTick;
  if (s.era < RAID_FROM_ERA) return null;
  if (!s.raid && !s.nextRaid) return { state: { ...s, nextRaid: nextRaidAt(now, rand) } };
  if (!s.raid) {
    if (now < s.nextRaid - RAID_WARNING_MS) return null;
    // Seen late (nobody was around): still an hour's warning, and still at night.
    let at = Math.max(s.nextRaid, now + RAID_WARNING_MS);
    if (!isNight(at)) at = nextNightAt(at) + RAID_INTO_NIGHT_MS;
    const raid: Raid = { at, strength: raidStrength(s, rand()), from: raidOrigin(rand) };
    const label = `⚔️ Vijanden in aantocht! Over ${durationText(raid.at - now)} vallen ze aan: ⚔️ ${raid.strength} tegen onze 🛡️ ${defenseOf(s).total}`;
    return { state: { ...s, raid }, news: { stage: "coming", label } };
  }
  if (now < s.raid.at) return null;
  return fight(s, s.raid, rand);
}

function fight<T extends IdleWorld>(s: T, raid: Raid, rand: () => number): { state: T; news: RaidNews } {
  const now = s.lastTick;
  const defense = defenseOf(s).total;
  const resources = { ...s.resources };
  for (const id of ["weapons", "armor"]) if (resources[id]) resources[id] *= 1 - RAID_WEAR;
  const after = { ...s, resources, raid: null, nextRaid: nextRaidAt(now, rand) };
  const boosts = (id: string) => [...s.boosts.filter((b) => !RAID_MOODS.some((m) => m.id === b.item)), mood(id, now)];
  const report = { at: now, strength: raid.strength, defense };
  if (defense >= raid.strength) {
    return {
      state: { ...after, boosts: boosts("raid_won"), lastRaid: { ...report, won: true, stolen: {}, killed: 0, damaged: null } },
      news: { stage: "won", label: `🛡️ Aanval afgeslagen! 🛡️ ${defense} tegen ⚔️ ${raid.strength}` },
    };
  }
  const loss = 1 - defense / raid.strength;
  const stolen: Amounts = {};
  for (const [id, n] of Object.entries(s.resources)) {
    const take = Math.floor(n * RAID_STEAL * loss);
    if (take > 0) {
      stolen[id] = take;
      resources[id] = Math.max(0, (resources[id] ?? 0) - take);
    }
  }
  const people = peopleOf(s);
  const killed = Math.min(people, Math.max(1, Math.round(people * RAID_KILL * loss)));
  const targets = s.buildings.filter((b) => ["work", "house", "storage"].includes(buildingType(b.type)?.category ?? "") && !b.damaged);
  const target = targets.length ? targets[Math.floor(rand() * targets.length) % targets.length] : null;
  const name = target ? buildingName(target.type, target.level) : null;
  const buildings = target ? s.buildings.map((b) => (b.id === target.id ? { ...b, damaged: true } : b)) : s.buildings;
  const label =
    `🔥 Het dorp is geplunderd! 🛡️ ${defense} tegen ⚔️ ${raid.strength}: ` +
    [killed === 1 ? "1 dode" : `${killed} doden`, ...(name ? [`${target!.type === "house" ? "een" : "de"} ${name} staat in brand`] : []), "een deel van de voorraad is weg"].join(", ");
  return {
    state: {
      ...after,
      buildings,
      population: Math.max(0, s.population - killed),
      boosts: boosts("raid_lost"),
      lastRaid: { ...report, won: false, stolen, killed, damaged: name },
    },
    news: { stage: "lost", label, ...(target ? { damaged: target.id } : {}) },
  };
}

// ---------- new villagers ----------

const pickFrom = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length) % list.length];

/** Someone to knock on the door, with a trade from this era or before. */
export function newcomerProfile(era: number, rand: () => number): NewcomerProfile {
  return {
    name: pickFrom(NEWCOMER_NAMES, rand),
    trade: pickFrom(NEWCOMER_TRADES.filter((t) => t.era <= era), rand).name,
    from: pickFrom(NEWCOMER_ORIGINS, rand),
  };
}

/** "Bram, pottenbakker, uit de bergen". */
export const profileText = (who: NewcomerProfile): string => `${who.name}, ${who.trade}, ${who.from}`;

/**
 * A newcomer knocks (at `lastTick`, advance first): one at a time, at most one
 * per MOVE_MS, only while there's a free bed and the town draws more people
 * than it has. They wait as a vote for VOTE_MS; the players decide.
 */
export function stepNewcomer<T extends IdleState>(s: T, rand: () => number): { state: T; label: string } | null {
  const now = s.lastTick;
  if (now < s.nextNewcomer || s.proposals.length >= MAX_PROPOSALS || s.proposals.some((p) => p.action.kind === "newcomer")) return null;
  if (!freeBedsOf(s) || populationTarget(s, now) < peopleOf(s) + 1) return null;
  const who = newcomerProfile(s.era, rand);
  const proposal: IdleProposal = { id: s.nextProposalId, action: { kind: "newcomer", who }, by: who.name, votes: {}, deadline: now + VOTE_MS };
  return {
    state: { ...s, proposals: [...s.proposals, proposal], nextProposalId: s.nextProposalId + 1, nextNewcomer: now + MOVE_MS },
    label: `🚪 Er klopt iemand aan: ${profileText(who)}. Stem of die mag blijven!`,
  };
}

/**
 * Couples have children (at `lastTick`, advance first): every couple about
 * once per BIRTH_MS, when they choose to. A child comes only with a free bed and
 * a town at least BIRTH_HAPPY happy, and is a grown-up villager straight away.
 */
export function stepBirth<T extends IdleWorld>(s: T, rand: () => number): { state: T; label?: string } | null {
  const now = s.lastTick;
  const couples = Math.floor(peopleOf(s) / 2);
  const later = (from: number) => Math.round(from + (BIRTH_MS / Math.max(1, couples)) * (0.5 + rand()));
  if (!s.nextBirth) return { state: { ...s, nextBirth: later(now) } };
  if (now < s.nextBirth) return null;
  const next = { ...s, nextBirth: later(now) };
  if (!couples || !freeBedsOf(s) || happinessOf(s, now).level < BIRTH_HAPPY) return { state: next };
  const [a, b, child] = [pickFrom(NEWCOMER_NAMES, rand), pickFrom(NEWCOMER_NAMES, rand), pickFrom(NEWCOMER_NAMES, rand)];
  return { state: { ...next, population: peopleOf(s) + 1 }, label: `👶 ${a} en ${b} kregen een kind: welkom, ${child}!` };
}

// ---------- tearing down ----------

/** What tearing down gives back: a share of what it costs at its own level. */
export function refundOf(s: Pick<IdleWorld, "buildings" | "roadLevel" | "wallLevel">, action: ProposalAction): Amounts {
  if (action.kind === "unpave") return refunded(pathBase(action.tiles), scaleOf(s.roadLevel) * REFUND_SHARE);
  if (action.kind === "unwall") return refunded(wallBase(action.tiles.length), scaleOf(s.wallLevel) * REFUND_SHARE);
  if (action.kind !== "demolish") return {};
  const b = s.buildings.find((x) => x.id === action.building);
  return b ? refunded(levelCost(b.type, b.level), BUILD_COST_MULT * REFUND_SHARE) : {};
}

// ---------- players' NPCs ----------

/** A look picked from a seed, for someone who hasn't chosen yet. */
export function defaultLook(seed: number): NpcLook {
  const n = Math.abs(seed | 0);
  return { skin: n % SKIN_TONES.length, clothes: Math.floor(n / 7) % CLOTHES_COLORS.length, hat: "none", pattern: "plain" };
}

export const ownsOutfit = (p: Pick<IdlePlayer, "owned">, id: string): boolean => !!outfit(id) && (!outfit(id)!.cost || p.owned.includes(id));

/** Why a look can't be worn, or null. */
export function lookError(p: Pick<IdlePlayer, "owned">, look: NpcLook): string | null {
  if (!Number.isInteger(look.skin) || look.skin < 0 || look.skin >= SKIN_TONES.length) return "onbekende huidskleur";
  if (!Number.isInteger(look.clothes) || look.clothes < 0 || look.clothes >= CLOTHES_COLORS.length) return "onbekende kleur";
  if (outfit(look.hat)?.kind !== "hat" || outfit(look.pattern)?.kind !== "pattern") return "onbekende kleding";
  if (!ownsOutfit(p, look.hat) || !ownsOutfit(p, look.pattern)) return "nog niet gekocht";
  return null;
}

/** What the tailor sells right now, hats first. */
export const outfitsFor = (era: number): Outfit[] => OUTFITS.filter((o) => o.minEra <= era);

export const outfitCost = (s: Pick<IdleWorld, "era">, o: Outfit): Amounts => scaled(o.cost ?? {}, scaleOf(s.era));

/** Why this player can't buy this outfit now, or null. */
export function outfitError(s: IdleWorld, p: Pick<IdlePlayer, "owned">, id: string): string | null {
  const o = outfit(id);
  if (!o) return "onbekend";
  if (ownsOutfit(p, id)) return "heb je al";
  if (o.minEra > s.era) return "nog niet ontgrendeld";
  if (!hasBuilding(s, "shop_tailor")) return needShop(s, "shop_tailor");
  if (!canAfford(s, outfitCost(s, o))) return "te duur";
  return null;
}

/** Pay for an outfit from the town's storage. Call outfitError first. */
export function buyOutfit<T extends IdleWorld>(s: T, p: IdlePlayer, id: string): { state: T; player: IdlePlayer } {
  return { state: pay(s, outfitCost(s, outfit(id)!)), player: { ...p, owned: [...p.owned, id] } };
}

// ---------- proposals ----------

export function actionCost(s: IdleWorld, action: ProposalAction): Amounts | null {
  if (action.kind === "build") return buildingType(action.type)?.category === "wonder" ? wonderCost(s, 0) : buildCost(s, action.type);
  if (action.kind === "roads") return roadCost(s);
  if (action.kind === "paths") return pathCost(s, action.tiles);
  if (action.kind === "unpave" || action.kind === "demolish" || action.kind === "ore" || action.kind === "tools" || action.kind === "unwall" || action.kind === "newcomer") return {};
  if (action.kind === "walls") return wallCost(s, action.tiles);
  if (action.kind === "gate") return gateCost(s, action.tiles);
  if (action.kind === "fortify") return fortifyCost(s);
  if (action.kind === "buy") {
    const item = shopItem(action.item);
    return item ? itemCost(s, item) : null;
  }
  const b = s.buildings.find((x) => x.id === action.building);
  if (action.kind === "wonder") return b ? wonderCost(s, b.stage ?? 0) : null;
  if (action.kind === "repair") return b ? repairCost(s, b) : null;
  return b ? upgradeCost(s, b) : null;
}

/** "3 u 05" / "12:30" / "40 s". */
export function durationText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} u ${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} s`;
}

/** Why this can't happen now, or null if it can. */
export function actionError(s: IdleWorld, action: ProposalAction): string | null {
  if (action.kind === "buy") return itemError(s, action.item);
  if (action.kind === "newcomer") return freeBedsOf(s) ? null : "geen bed vrij";
  if (action.kind === "build") {
    const err = buildTypeError(s, action.type) ?? placeError(s.buildings, s.roads, action.type, action.x, action.y, s.walls);
    if (err) return err;
    if (buildingType(action.type)!.category === "wonder" && !eraGoals(s).every((g) => g.done)) return "eerst de doelen van dit tijdperk halen";
  } else if (action.kind === "wonder") {
    const b = s.buildings.find((x) => x.id === action.building);
    if (!b || buildingType(b.type)?.category !== "wonder") return "onbekend wereldwonder";
    if (b.stage === undefined) return "al af";
    const wait = wonderWait(s, b);
    if (wait !== null) return `de bouwers zijn nog bezig (nog ${durationText(wait)})`;
  } else if (action.kind === "ore") {
    const b = s.buildings.find((x) => x.id === action.building);
    if (!b || !buildingType(b.type)?.ores) return "onbekende mijn";
    if (!oresOf(s, b.type).includes(action.ore)) return "dat erts kan hier nog niet";
    if (producesOf(b) === action.ore) return "die delft dat al";
  } else if (action.kind === "tools") {
    const b = s.buildings.find((x) => x.id === action.building);
    if (!b || !isSmith(b.type)) return "dat is geen smidse";
    if (s.era < TOOLS_FROM_ERA) return `gereedschap komt pas in de ${ERAS[TOOLS_FROM_ERA].name}`;
    if (!!b.tools === action.on) return action.on ? "die maakt al gereedschap" : `die maakt al ${resourceDef(producesOf(b)!)?.name}`;
  } else if (action.kind === "walls") {
    const err = wallsError(s, action.tiles);
    if (err) return err;
  } else if (action.kind === "unwall") {
    const err = tilesError(action.tiles);
    if (err) return err;
    if (!action.tiles.every((i) => s.walls.includes(i))) return "daar staat geen muur";
  } else if (action.kind === "gate") {
    const err = tilesError(action.tiles);
    if (err) return err;
    if (!action.tiles.every((i) => s.walls.includes(i))) return "een poort komt in een muur";
    if (action.tiles.some((i) => s.gates.includes(i))) return "daar is al een poort";
  } else if (action.kind === "fortify") {
    if (!s.walls.length) return "er staan nog geen muren";
    if (s.wallLevel >= s.era) return "al up-to-date";
  } else if (action.kind === "repair") {
    const b = s.buildings.find((x) => x.id === action.building);
    if (!b) return "onbekend gebouw";
    if (!b.damaged) return "niet beschadigd";
  } else if (action.kind === "roads") {
    if (s.roadLevel >= s.era) return "al up-to-date";
  } else if (action.kind === "paths") {
    const err = pathsError(s, action.tiles);
    if (err) return err;
  } else if (action.kind === "unpave") {
    const err = tilesError(action.tiles);
    if (err) return err;
    if (!action.tiles.every((i) => s.roads.includes(i))) return "daar ligt geen pad";
  } else if (action.kind === "demolish") {
    const b = s.buildings.find((x) => x.id === action.building);
    if (!b) return "onbekend gebouw";
    if (buildingType(b.type)?.category === "center") return "het centrum blijft staan";
    if (buildingType(b.type)?.category === "wonder") return "een wereldwonder blijft staan";
  } else {
    const b = s.buildings.find((x) => x.id === action.building);
    if (!b) return "onbekend gebouw";
    if (buildingType(b.type)?.noUpgrade) return "kan niet upgraden";
    if (b.level >= s.era) return "al up-to-date";
    if (b.damaged) return "eerst herstellen";
    // The Kampvuur grows into De Senaat: its 3×3 tiles must be free first.
    const grow = footprintError(s.buildings, s.roads, s.walls, b.type, s.era, b.x, b.y, b.id);
    if (grow && footprintOffsets(b.type, s.era).length > footprintOffsets(b.type, b.level).length) return grow;
  }
  if (!canAfford(s, actionCost(s, action)!)) return "te duur";
  return null;
}

/** Pay and do it. Call actionError first; returns the new or upgraded building, if any. */
export function applyAction<T extends IdleWorld>(s: T, action: ProposalAction): { state: T; building?: PlacedBuilding } {
  if (action.kind === "buy") return { state: buyItem(s, action.item) };
  if (action.kind === "newcomer") return { state: { ...s, population: peopleOf(s) + 1 } };
  if (action.kind === "unpave") {
    const gone = new Set(action.tiles);
    return { state: { ...receive(s, refundOf(s, action)), roads: s.roads.filter((i) => !gone.has(i)) } };
  }
  if (action.kind === "demolish") {
    return { state: { ...receive(s, refundOf(s, action)), buildings: s.buildings.filter((b) => b.id !== action.building) } };
  }
  if (action.kind === "unwall") {
    const gone = new Set(action.tiles);
    return { state: { ...receive(s, refundOf(s, action)), walls: s.walls.filter((i) => !gone.has(i)), gates: s.gates.filter((i) => !gone.has(i)) } };
  }
  if (action.kind === "tools") {
    const { tools: _, ...rest } = s.buildings.find((b) => b.id === action.building)!;
    const building: PlacedBuilding = action.on ? { ...rest, tools: true } : rest;
    return { state: { ...s, buildings: s.buildings.map((b) => (b.id === building.id ? building : b)) }, building };
  }
  if (action.kind === "ore") {
    const { ore: _, ...rest } = s.buildings.find((b) => b.id === action.building)!;
    const building: PlacedBuilding = action.ore === buildingType(rest.type)?.produces ? rest : { ...rest, ore: action.ore };
    return { state: { ...s, buildings: s.buildings.map((b) => (b.id === building.id ? building : b)) }, building };
  }
  const paid = pay(s, actionCost(s, action)!);
  if (action.kind === "build" && buildingType(action.type)?.category === "wonder") {
    const { state, building } = addBuilding(paid, action.type, s.era, action);
    return wonderPhase(state, { ...building, stage: 0 });
  }
  if (action.kind === "wonder") return wonderPhase(paid, s.buildings.find((b) => b.id === action.building)!);
  if (action.kind === "build") return addBuilding(paid, action.type, s.era, action);
  if (action.kind === "roads") return { state: { ...paid, roadLevel: s.era } };
  if (action.kind === "paths") return { state: { ...paid, roads: [...s.roads, ...action.tiles].sort((a, b) => a - b) } };
  if (action.kind === "walls") return { state: { ...paid, walls: [...s.walls, ...action.tiles].sort((a, b) => a - b) } };
  if (action.kind === "gate") return { state: { ...paid, gates: [...s.gates, ...action.tiles].sort((a, b) => a - b) } };
  if (action.kind === "fortify") return { state: { ...paid, wallLevel: s.era } };
  if (action.kind === "repair") {
    const { damaged: _, ...building } = s.buildings.find((b) => b.id === action.building)!;
    return { state: { ...paid, buildings: paid.buildings.map((b) => (b.id === building.id ? building : b)) }, building };
  }
  const building = { ...s.buildings.find((b) => b.id === action.building)!, level: s.era };
  return { state: { ...paid, buildings: paid.buildings.map((b) => (b.id === building.id ? building : b)) }, building };
}

/** One more phase of a wonder done; after the last one it's finished and the next era starts. */
function wonderPhase<T extends IdleWorld>(s: T, b: PlacedBuilding): { state: T; building: PlacedBuilding } {
  const stage = (b.stage ?? 0) + 1;
  const { stage: _, ready: __, ...rest } = b;
  const building: PlacedBuilding = stage >= WONDER_PHASES ? rest : { ...rest, stage, ready: s.lastTick + WONDER_BUILD_MS };
  const state = { ...s, buildings: s.buildings.map((x) => (x.id === b.id ? building : x)) };
  return { state: stage >= WONDER_PHASES ? unlockEra(state, s.era + 1) : state, building };
}

const tilesText = (n: number) => (n === 1 ? "1 tegel" : `${n} tegels`);

/** "🛖 Hut bouwen" / "⬆️ Hut → Lemen huis" / "🎉 Groot dorpsfeest kopen" / "🛤️ 12 tegels pad leggen". */
export function actionLabel(s: Pick<IdleWorld, "buildings" | "era" | "roadLevel" | "wallLevel">, action: ProposalAction): string {
  if (action.kind === "build") {
    const phase = buildingType(action.type)?.category === "wonder" ? ` (fase 1/${WONDER_PHASES})` : "";
    return `${buildingType(action.type)?.emoji ?? ""} ${buildingName(action.type, s.era)} bouwen${phase}`.trim();
  }
  if (action.kind === "buy") {
    const item = shopItem(action.item);
    return item ? `${item.emoji} ${item.name} kopen` : "iets kopen";
  }
  if (action.kind === "roads") return `🛣️ ${roadName(s.roadLevel)} → ${roadName(s.era)}`;
  if (action.kind === "newcomer") return `🚪 ${action.who.name} mag blijven`;
  if (action.kind === "paths") return `🛤️ ${tilesText(action.tiles.length)} pad leggen`;
  if (action.kind === "unpave") return `⛏️ ${tilesText(action.tiles.length)} pad weghalen`;
  if (action.kind === "walls") return `🧱 ${tilesText(action.tiles.length)} ${wallName(s.wallLevel).toLowerCase()} bouwen`;
  if (action.kind === "unwall") return `⛏️ ${tilesText(action.tiles.length)} muur weghalen`;
  if (action.kind === "gate") return action.tiles.length === 1 ? "🚪 Poort in de muur" : `🚪 ${action.tiles.length} poorten in de muur`;
  if (action.kind === "fortify") return `🧱 ${wallName(s.wallLevel)} → ${wallName(s.era)}`;
  const b = s.buildings.find((x) => x.id === action.building);
  if (action.kind === "demolish") return b ? `🧨 ${buildingName(b.type, b.level)} afbreken` : "afbreken";
  if (action.kind === "wonder") return b ? `${buildingType(b.type)?.emoji ?? ""} ${buildingName(b.type, b.level)}: fase ${(b.stage ?? 0) + 1}/${WONDER_PHASES}` : "wereldwonder";
  if (action.kind === "repair") return b ? `🔧 ${buildingName(b.type, b.level)} herstellen` : "herstellen";
  if (action.kind === "tools") {
    const what = action.on ? "🔨 gereedschap" : b ? `${resourceDef(producesOf(b)!)?.emoji ?? ""} ${resourceDef(producesOf(b)!)?.name ?? ""}` : "";
    return `${b ? `${buildingType(b.type)?.emoji ?? ""} ${buildingName(b.type, b.level)}` : "smidse"}: ${what} maken`;
  }
  if (action.kind === "ore") {
    const ore = resourceDef(action.ore);
    return `${b ? `${buildingType(b.type)?.emoji ?? ""} ${buildingName(b.type, b.level)}` : "mijn"}: ${ore?.emoji ?? ""} ${ore?.name ?? action.ore} delven`;
  }
  if (!b) return "upgrade";
  return `⬆️ ${buildingName(b.type, b.level)} → ${buildingName(b.type, s.era)}`;
}

// ---------- voting ----------

/** Nothing passes on fewer yes votes than this, so nobody builds on their own. */
export const MIN_YES = 2;

/** Yes votes needed to pass right away: more than a third of everyone online, and at least MIN_YES. */
export const votesNeeded = (online: number): number => Math.max(MIN_YES, Math.floor(Math.max(1, online) / 3) + 1);

export function voteCounts(p: IdleProposal): { yes: number; no: number } {
  const all = Object.values(p.votes);
  const yes = all.filter(Boolean).length;
  return { yes, no: all.length - yes };
}

/**
 * Pass once votesNeeded said yes (and yes leads); fail once as many said no.
 * At the deadline the votes that were cast decide, with at least MIN_YES yes.
 */
export function voteOutcome(p: IdleProposal, online: number, now: number): "pass" | "fail" | "pending" {
  const { yes, no } = voteCounts(p);
  const needed = votesNeeded(online);
  if (yes >= needed && yes > no) return "pass";
  if (no >= needed && no >= yes) return "fail";
  if (now >= p.deadline) return yes >= MIN_YES && yes > no ? "pass" : "fail";
  return "pending";
}

// ---------- messages on /counter-ws ----------

export interface IdleProposalView {
  id: number;
  action: ProposalAction;
  label: string;
  by: string;
  yes: number;
  no: number;
  needed: number;
  deadline: number;
  /** This viewer's vote, if any. */
  myVote: boolean | null;
  /** Voted through, waiting until the town can pay for it. */
  approved: boolean;
}

// ---------- the developer menu (update 23) ----------
// Only for whoever runs the server with IDLE_DEV=1, from a browser on that
// same computer (checked by the server, see server/src/counter.ts).

/** What "plenty" is: more than anything costs. */
const PLENTY = 1e12;

/** The town as if it had plenty of everything and no builders to wait for: to check what free mode allows. */
export function withPlenty<T extends IdleWorld>(s: T): T {
  return {
    ...s,
    resources: Object.fromEntries(RESOURCES.map((r) => [r.id, PLENTY])),
    buildings: s.buildings.map(({ ready: _, ...b }) => b),
  };
}

/**
 * Do it now, without a vote and without paying (free mode): the same checks,
 * but every resource as if there were plenty. What it gives (a trade) is
 * kept; a wonder's next phase can start right away.
 */
export function doForFree<T extends IdleWorld>(s: T, action: ProposalAction): { state: T; building?: PlacedBuilding } | string {
  const plenty = withPlenty(s);
  const err = actionError(plenty, action);
  if (err) return err;
  const done = applyAction(plenty, action);
  const resources: Amounts = { ...s.resources };
  for (const [id, n] of Object.entries(done.state.resources)) if ((n ?? 0) > PLENTY) resources[id] = (s.resources[id] ?? 0) + (n - PLENTY);
  const buildings = done.state.buildings.map((b) => {
    const was = s.buildings.find((x) => x.id === b.id);
    // The builders of other wonders still need their time.
    if (was?.ready !== undefined && was.stage === b.stage) return { ...b, ready: was.ready };
    const { ready: _, ...rest } = b;
    return rest;
  });
  const building = done.building && buildings.find((b) => b.id === done.building!.id);
  return { state: { ...done.state, resources, buildings }, ...(building ? { building } : {}) };
}

/** Every wonder's builders ready for the next phase now. */
export const finishPhases = <T extends IdleWorld>(s: T): T => ({ ...s, buildings: s.buildings.map(({ ready: _, ...b }) => b) });

/** Every storage full. */
export function fillStorage<T extends IdleWorld>(s: T): T {
  return { ...s, resources: { ...s.resources, ...Object.fromEntries(unlockedResources(s.era).map((id) => [id, capOf(s, id)])) } };
}

export type DevCommand = "free" | "phases" | "era" | "fill";

/** Someone online, as their NPC. */
export interface IdlePerson {
  id: string;
  name: string;
  look: NpcLook;
}

export interface IdleStateMsg {
  type: "idle";
  state: IdleWorld;
  /** Open votes, oldest first. */
  proposals: IdleProposalView[];
  /** Everyone online who said hello, one NPC each. */
  people: IdlePerson[];
  /** This viewer, once they said hello. */
  me: (IdlePerson & { owned: string[] }) | null;
  count: number;
  peak: number;
  online: number;
  /** Server clock when sent, to keep producing in the browser. */
  now: number;
  /** Only for a developer on the server's own computer (IDLE_DEV=1): the developer menu, and whether free mode is on. */
  dev?: { free: boolean };
}

export type IdleEvent =
  | { kind: "era"; era: number }
  | { kind: "proposed"; label: string; by: string }
  /** A vote passed; `building` when something was built or upgraded. */
  | { kind: "bought"; label: string; by: string; building?: PlacedBuilding }
  | { kind: "rejected"; label: string; by: string; reason: string }
  /** A small shop item, no vote needed; or a supply drop opened. */
  | { kind: "deal"; label: string; by: string }
  /** From the counter: a supply drop landed, or a lucky event. */
  | { kind: "lucky"; label: string }
  /** Enemies: seen coming, or how the fight went (`damaged`: the building set on fire). */
  | { kind: "raid"; stage: RaidStage; label: string; damaged?: number }
  /** Only to the one connection whose request failed. */
  | { kind: "error"; message: string };

export interface IdleEventMsg {
  type: "idleEvent";
  event: IdleEvent;
}

export type IdleClientMsg =
  /** Who this browser is: a secret key kept in localStorage (never shown to others). */
  | { type: "hello"; key: string; name?: string }
  /** Change your name and your NPC's look. */
  | { type: "look"; name: string; look: NpcLook }
  /** Buy an outfit at the tailor, for yourself. */
  | { type: "outfit"; item: string }
  /** Put one villager without a job on `to` (null: let them choose), off `from` if they were put there. */
  | { type: "assign"; from: ResourceId | null; to: ResourceId | null }
  | { type: "propose"; action: ProposalAction; name?: string }
  | { type: "vote"; id: number; yes: boolean }
  /** A small shop item (vote: false). */
  | { type: "buy"; item: string; name?: string }
  /** Open a supply drop. */
  | { type: "open"; id: number; name?: string }
  /** Smith a tool yourself at a smith: `score` (0..1) is how well the game went. */
  | { type: "forge"; building: number; score: number; name?: string }
  /** The developer menu (only when the server allows it for this browser). */
  | { type: "dev"; cmd: DevCommand; name?: string };
