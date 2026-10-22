// "67 Beschaving": the shared idle game behind the 67 counter page.
//
// One town for everyone, kept by the server. Every 67 on the counter (by its
// highest value ever, `peak`) unlocks the next era. Houses give villagers,
// villagers staff work buildings, work buildings fill the storage. Everyone
// can help by clicking nature in the world. Nature runs out: clicks and work
// buildings use up patches of forest, rock and ore (the more valuable, the
// longer they last), which slowly grow back. Building (on a tile someone
// clicked), laying or removing paths (drawn tile by tile, through nature and
// over the river as bridges), tearing down a building (for a bit of its cost
// back), upgrading (buildings or the whole street network) and big shop
// purchases go through a short vote, one after the other; trading on the market and small shop
// items happen right away. Everyone has their own NPC walking around while
// they're online, dressed in what they bought at the tailor.
//
// The rules here are pure and shared: the server is authoritative, the browser
// uses them to keep numbers moving between updates. State is plain JSON;
// functions return new state and never mutate.

import {
  BASE_CAP,
  BASE_RATE,
  BRIDGE_TILE_COST,
  BUILDING_TYPES,
  BUILD_COST_MULT,
  CENTER_CAP,
  CLICK_BASE,
  COST_GROWTH,
  ERAS,
  MARKET_FEE,
  MARKET_HALF_LIFE_MS,
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
  WORK_RANGE,
  WORTH,
  buildingName,
  buildingType,
  housingOf,
  outfit,
  resourceDef,
  scaleOf,
  shopItem,
  slotsOf,
  worthOf,
  type Amounts,
  type NpcLook,
  type Outfit,
  type ResourceId,
  type ShopItem,
} from "./idleContent.js";
import {
  classicStreets,
  isRiver,
  natureAt,
  patchAt,
  patches,
  pathError,
  placeBuilding,
  placeError,
  tileIndex,
  tileOf,
  type Patch,
} from "./idleMap.js";

export * from "./idleContent.js";
export * from "./idleMap.js";

export const IDLE_MILESTONE = 67;
/** Every +1 on the counter: production ×2 for 67 s (stacks by extending). */
export const BOOST_MULT = 2;
export const BOOST_MS = 67_000;
export const MAX_BOOST_MS = 60 * 60_000;
/** Production while nobody is around is caught up to at most this long. */
export const MAX_OFFLINE_MS = 7 * 24 * 60 * 60_000;
export const VOTE_MS = 30_000;
/** Proposals waiting for their turn, at most. */
export const MAX_QUEUE = 5;
export const STATE_VERSION = 4;
export const MAX_NAME_LENGTH = 20;

// ---------- state ----------

export interface PlacedBuilding {
  id: number;
  type: string;
  /** Era it was built in or upgraded to: its look and strength. */
  level: number;
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
  /** Market pressure per resource bought (it gets pricier), as of `lastTick`. */
  market: Amounts;
  /** Level (era) of the whole street network. */
  roadLevel: number;
  /** Street tiles (y × MAP_SIZE + x), sorted. */
  roads: number[];
  /** Patch id → clicks used up, as of `lastTick` (missing = full). */
  nature: Record<string, number>;
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
  | { kind: "demolish"; building: number };

export interface IdleProposal {
  id: number;
  action: ProposalAction;
  /** Nickname of whoever proposed it. */
  by: string;
  /** Per connection: true = yes, false = no. */
  votes: Record<string, boolean>;
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
  proposal: IdleProposal | null;
  /** Next in line once the running vote is done; their deadline starts then. */
  queue: IdleProposal[];
  nextProposalId: number;
  /** Public player id → player. */
  players: Record<string, IdlePlayer>;
}

/** Era unlocked by the highest counter value ever reached. */
export function eraFor(peak: number): number {
  return Math.max(0, Math.min(ERAS.length - 1, Math.floor(peak / IDLE_MILESTONE)));
}

const perkOf = (s: Pick<IdleWorld, "perks">, id: string): number => s.perks[id] ?? 0;

function addBuilding<T extends IdleWorld>(s: T, type: string, level: number, spot: { x: number; y: number }): { state: T; building: PlacedBuilding } {
  const building = { id: s.nextBuildingId, type, level, x: spot.x, y: spot.y };
  return { state: { ...s, buildings: [...s.buildings, building], nextBuildingId: s.nextBuildingId + 1 }, building };
}

/** A fresh town: a campfire, two huts, hunters and a woodcutter. */
export function newIdleState(now: number): IdleState {
  let s: IdleState = {
    v: STATE_VERSION, era: 0, resources: { food: 50, wood: 60, stone: 40 }, buildings: [], nextBuildingId: 1,
    lastTick: now, boostUntil: 0, boosts: [], perks: {}, market: {}, roadLevel: 0, roads: [], nature: {}, proposal: null, queue: [], nextProposalId: 1, players: {},
  };
  for (const type of ["center", "house", "house", "food", "wood"]) s = addBuilding(s, type, 0, placeBuilding(s.buildings, type)!).state;
  return { ...s, roads: classicStreets(s.buildings) };
}

/** Unlock eras up to `era` (never back). */
export function unlockEra<T extends IdleWorld>(s: T, era: number): T {
  return era > s.era ? { ...s, era: Math.min(era, ERAS.length - 1) } : s;
}

export const unlockedResources = (era: number): ResourceId[] => RESOURCES.filter((r) => r.era <= era).map((r) => r.id);

// ---------- villagers and production ----------

export interface Workforce {
  population: number;
  /** Work building id → villagers working there. */
  workers: Record<number, number>;
  idle: number;
}

/** Workers one work building can take: its level's slots plus the university's perk. */
export const slotsAt = (s: Pick<IdleWorld, "perks">, b: PlacedBuilding): number => slotsOf(b.level) + perkOf(s, "workplace");

/**
 * Fill work buildings one villager at a time, round robin in build order, so
 * everyone gets staff before anyone is full. Leftovers are idle.
 */
export function assignWorkers(s: Pick<IdleWorld, "buildings" | "perks">): Workforce {
  let population = 0;
  for (const b of s.buildings) if (buildingType(b.type)?.category === "house") population += housingOf(b.level);
  const jobs = s.buildings.filter((b) => buildingType(b.type)?.category === "work");
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
  return { population, workers, idle: left };
}

/** Output of one work building with its level's slots filled (each extra worker adds the same). */
export function fullRateOf(b: PlacedBuilding): number {
  const res = buildingType(b.type)?.produces;
  if (!res) return 0;
  return (BASE_RATE[res] ?? SPECIAL_BASE_RATE) * scaleOf(b.level);
}

/** The smith's bonus on a resource: ×1.1 per level. */
const toolsOf = (s: Pick<IdleWorld, "perks">, res: ResourceId): number =>
  1 + 0.1 * perkOf(s, res in WORTH ? `tools_${res}` : "tools_special");

// ---------- nature running out ----------

type Used = Readonly<Record<string, number>>;
const leftIn = (p: Patch, used: Used): number => p.capacity - (used[p.id] ?? 0);

/**
 * The patches a work building takes from, nearest first: its kind of nature
 * within WORK_RANGE. Null if it needs none (farms grow their own food).
 */
export function sourcePatches(b: PlacedBuilding): Patch[] | null {
  const res = buildingType(b.type)?.produces;
  if (!res || b.type === "food") return null;
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

/** What each work building makes per second without boosts; nothing if its nature is used up. */
function outputs(s: Pick<IdleWorld, "buildings" | "perks"> & { nature?: Used }): { b: PlacedBuilding; res: ResourceId; rate: number }[] {
  const { workers } = assignWorkers(s);
  const out: { b: PlacedBuilding; res: ResourceId; rate: number }[] = [];
  for (const b of s.buildings) {
    const res = buildingType(b.type)?.produces;
    if (!res) continue;
    const src = s.nature ? sourcePatches(b) : null;
    if (src && !src.some((p) => leftIn(p, s.nature!) > 0.01)) continue;
    out.push({ b, res, rate: ((fullRateOf(b) * (workers[b.id] ?? 0)) / slotsOf(b.level)) * toolsOf(s, res) });
  }
  return out;
}

/** The lab's robots: gathering every unlocked resource, from nowhere in particular. */
const autoRate = (s: Pick<IdleWorld, "perks" | "era">, res: ResourceId): number =>
  0.5 * perkOf(s, "auto") * clickAmount(s.era) * toolsOf(s, res);

/** Production per second without boosts. */
export function ratesOf(s: Pick<IdleWorld, "buildings" | "perks" | "era"> & { nature?: Used }): Amounts {
  const rates: Amounts = {};
  for (const { res, rate } of outputs(s)) rates[res] = (rates[res] ?? 0) + rate;
  if (perkOf(s, "auto")) for (const id of unlockedResources(s.era)) rates[id] = (rates[id] ?? 0) + autoRate(s, id);
  return rates;
}

/** Storage limit per resource (the same for every resource). */
export function capOf(s: Pick<IdleWorld, "buildings" | "era" | "perks">): number {
  let cap = BASE_CAP * scaleOf(s.era);
  for (const b of s.buildings) {
    if (b.type === "storage") cap += STORAGE_CAP * scaleOf(b.level);
    else if (b.type === "center") cap += CENTER_CAP * scaleOf(b.level);
  }
  return cap * (1 + 0.25 * perkOf(s, "vault"));
}

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
 * the storage limit). Work buildings use up the nature around them, and stop
 * making more than is left; nature grows back meanwhile.
 */
export function advance<T extends IdleWorld>(s: T, now: number): T {
  const elapsed = Math.min(Math.max(0, now - s.lastTick), MAX_OFFLINE_MS);
  const next = { ...s, resources: { ...s.resources }, lastTick: Math.max(s.lastTick, now) };
  if (elapsed === 0) return next;
  const cap = capOf(s);
  const seconds = (res: ResourceId) => (elapsed + boostedMs(s, res, s.lastTick, s.lastTick + elapsed)) / 1000;
  const used = regrow(s.nature, next.lastTick - s.lastTick);
  const click = clickAmount(s.era);
  const add = (res: ResourceId, amount: number): number => {
    const have = next.resources[res] ?? 0;
    const got = Math.max(0, Math.min(amount, cap - have));
    if (got > 0) next.resources[res] = have + got;
    return got;
  };
  for (const { b, res, rate } of outputs({ ...s, nature: used })) {
    let amount = Math.min(rate * seconds(res), cap - (next.resources[res] ?? 0));
    if (amount <= 0) continue;
    const src = sourcePatches(b);
    if (src) {
      // Take what this needs from the nearest patches; make only as much as there was.
      const need = (amount / click) * WORK_DRAIN;
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
  if (perkOf(s, "auto")) for (const id of unlockedResources(s.era)) add(id, autoRate(s, id) * seconds(id));
  next.nature = used;
  if (s.boosts.some((b) => b.until <= next.lastTick)) next.boosts = s.boosts.filter((b) => b.until > next.lastTick);
  const keep = 0.5 ** ((next.lastTick - s.lastTick) / MARKET_HALF_LIFE_MS);
  next.market = {};
  for (const [id, p] of Object.entries(s.market)) if (p * keep > 0.001) next.market[id] = p * keep;
  return next;
}

/** A +1 on the counter: extend the boost by BOOST_MS, up to MAX_BOOST_MS ahead. */
export function applyBoost<T extends IdleWorld>(s: T, now: number): T {
  return { ...s, boostUntil: Math.min(Math.max(s.boostUntil, now) + BOOST_MS, now + MAX_BOOST_MS) };
}

export const clickAmount = (era: number): number => CLICK_BASE * scaleOf(era);

/**
 * Someone clicked nature in the world: one click's worth, taken from that
 * patch. Null if there's nothing (left) to gather there.
 */
export function gather<T extends IdleWorld>(s: T, x: number, y: number): { state: T; resource: ResourceId } | null {
  // A path cleared this tile's nature.
  const resource = s.roads.includes(tileIndex(x, y)) ? null : natureAt(x, y, s.era, s.nature);
  if (!resource) return null;
  const cap = capOf(s);
  const have = s.resources[resource] ?? 0;
  // A full storage takes nothing, so nature isn't wasted either.
  if (have >= cap) return { state: s, resource };
  const p = patchAt(x, y)!;
  return {
    state: {
      ...s,
      resources: { ...s.resources, [resource]: Math.min(cap, have + clickAmount(s.era)) },
      nature: { ...s.nature, [p.id]: Math.min(p.capacity, (s.nature[p.id] ?? 0) + 1) },
    },
    resource,
  };
}

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

const scaled = (a: Amounts, f: number): Amounts => Object.fromEntries(Object.entries(a).map(([k, n]) => [k, Math.ceil(n * f)]));
/** Like `scaled`, rounded down and without the zeros: for what you get back. */
const refunded = (a: Amounts, f: number): Amounts =>
  Object.fromEntries(Object.entries(a).map(([k, n]): [string, number] => [k, Math.floor(n * f)]).filter(([, n]) => n > 0));
/** The university's architecture perk: −10% per level. */
const discountOf = (s: Pick<IdleWorld, "perks">): number => 1 - 0.1 * perkOf(s, "architecture");

/** Building a new one, always at the current era's level. */
export function buildCost(s: Pick<IdleWorld, "buildings" | "era" | "perks">, typeId: string): Amounts | null {
  if (!buildingType(typeId)) return null;
  const copies = s.buildings.filter((b) => b.type === typeId).length;
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
  return null;
}

/** Types that can go on a free tile through the build popup, in menu order (decorations come from the sculptor). */
export const buildableTypes = (s: Pick<IdleWorld, "buildings" | "era">) =>
  BUILDING_TYPES.filter((t) => t.category !== "decor" && !buildTypeError(s, t.id));

/** Decorations the sculptor sells now. */
export const decorTypes = (era: number) => BUILDING_TYPES.filter((t) => t.category === "decor" && t.minEra <= era);

// ---------- shop items ----------

export const itemsOf = (shop: string, era: number): ShopItem[] =>
  SHOP_ITEMS.filter((i) => i.shop === shop && (buildingType(i.shop)?.minEra ?? 0) <= era);

export const itemLevel = (s: Pick<IdleWorld, "perks">, item: ShopItem): number => (item.effect.kind === "perk" ? perkOf(s, item.id) : 0);

export function itemCost(s: Pick<IdleWorld, "era" | "perks">, item: ShopItem): Amounts {
  return scaled(item.cost, scaleOf(s.era) * PERK_GROWTH ** itemLevel(s, item));
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
  const cap = capOf(s);
  const resources = { ...s.resources };
  for (const [id, n] of Object.entries(amounts)) resources[id] = Math.max(resources[id] ?? 0, Math.min(cap, (resources[id] ?? 0) + n));
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
  const cap = capOf(paid);
  const resources = { ...paid.resources };
  for (const [id, rate] of Object.entries(ratesOf(paid))) resources[id] = Math.max(resources[id] ?? 0, Math.min(cap, (resources[id] ?? 0) + rate * e.seconds));
  return { ...paid, resources };
}

// ---------- market ----------

/** How much of `to` one `from` buys right now. */
export function tradeRate(s: Pick<IdleWorld, "buildings" | "perks" | "market">, from: ResourceId, to: ResourceId): number {
  const level = s.buildings.find((b) => b.type === "shop_market")?.level ?? 0;
  const fee = MARKET_FEE + 0.02 * level + 0.05 * perkOf(s, "tradeDeal");
  return ((worthOf(from) / worthOf(to)) * fee) / (1 + (s.market[to] ?? 0));
}

/**
 * Trade up to `amount` of `from` for `to`: as much as there is, and no more
 * than fits in storage. Returns what changes hands, or why it can't.
 */
export function tradeQuote(s: IdleWorld, from: ResourceId, to: ResourceId, amount: number): { give: number; get: number } | string {
  if (!hasBuilding(s, "shop_market")) return needShop(s, "shop_market");
  const unlocked = unlockedResources(s.era);
  if (!unlocked.includes(from) || !unlocked.includes(to) || from === to) return "onbekende ruil";
  if (!Number.isFinite(amount) || amount <= 0) return "niets om te ruilen";
  let give = Math.min(amount, s.resources[from] ?? 0);
  if (give < 1) return "niets om te ruilen";
  const rate = tradeRate(s, from, to);
  const room = capOf(s) - (s.resources[to] ?? 0);
  if (room < 1) return "opslag vol";
  let get = give * rate;
  if (get > room) {
    get = room;
    give = room / rate;
  }
  return { give, get };
}

/** Do a trade (see tradeQuote); buying something makes it pricier for a while. */
export function trade<T extends IdleWorld>(s: T, from: ResourceId, to: ResourceId, amount: number): { state: T; give: number; get: number } | string {
  const q = tradeQuote(s, from, to, amount);
  if (typeof q === "string") return q;
  const resources = { ...s.resources, [from]: Math.max(0, (s.resources[from] ?? 0) - q.give), [to]: (s.resources[to] ?? 0) + q.get };
  const market = { ...s.market, [to]: (s.market[to] ?? 0) + (0.5 * q.get) / capOf(s) };
  return { state: { ...s, resources, market }, ...q };
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
export function pathsError(s: Pick<IdleWorld, "buildings" | "roads">, tiles: readonly number[]): string | null {
  const err = tilesError(tiles);
  if (err) return err;
  for (const i of tiles) {
    const { x, y } = tileOf(i);
    const e = pathError(s.buildings, s.roads, x, y);
    if (e) return `(${x}, ${y}): ${e}`;
  }
  return null;
}

// ---------- tearing down ----------

/** What tearing down gives back: a share of what it costs at its own level. */
export function refundOf(s: Pick<IdleWorld, "buildings" | "roadLevel">, action: ProposalAction): Amounts {
  if (action.kind === "unpave") return refunded(pathBase(action.tiles), scaleOf(s.roadLevel) * REFUND_SHARE);
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
  if (action.kind === "build") return buildCost(s, action.type);
  if (action.kind === "roads") return roadCost(s);
  if (action.kind === "paths") return pathCost(s, action.tiles);
  if (action.kind === "unpave" || action.kind === "demolish") return {};
  if (action.kind === "buy") {
    const item = shopItem(action.item);
    return item ? itemCost(s, item) : null;
  }
  const b = s.buildings.find((x) => x.id === action.building);
  return b ? upgradeCost(s, b) : null;
}

/** Why this can't happen now, or null if it can. */
export function actionError(s: IdleWorld, action: ProposalAction): string | null {
  if (action.kind === "buy") return itemError(s, action.item);
  if (action.kind === "build") {
    const err = buildTypeError(s, action.type) ?? placeError(s.buildings, s.roads, action.type, action.x, action.y);
    if (err) return err;
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
  } else {
    const b = s.buildings.find((x) => x.id === action.building);
    if (!b) return "onbekend gebouw";
    if (buildingType(b.type)?.noUpgrade) return "kan niet upgraden";
    if (b.level >= s.era) return "al up-to-date";
  }
  if (!canAfford(s, actionCost(s, action)!)) return "te duur";
  return null;
}

/** Pay and do it. Call actionError first; returns the new or upgraded building, if any. */
export function applyAction<T extends IdleWorld>(s: T, action: ProposalAction): { state: T; building?: PlacedBuilding } {
  if (action.kind === "buy") return { state: buyItem(s, action.item) };
  if (action.kind === "unpave") {
    const gone = new Set(action.tiles);
    return { state: { ...receive(s, refundOf(s, action)), roads: s.roads.filter((i) => !gone.has(i)) } };
  }
  if (action.kind === "demolish") {
    return { state: { ...receive(s, refundOf(s, action)), buildings: s.buildings.filter((b) => b.id !== action.building) } };
  }
  const paid = pay(s, actionCost(s, action)!);
  if (action.kind === "build") return addBuilding(paid, action.type, s.era, action);
  if (action.kind === "roads") return { state: { ...paid, roadLevel: s.era } };
  if (action.kind === "paths") return { state: { ...paid, roads: [...s.roads, ...action.tiles].sort((a, b) => a - b) } };
  const building = { ...s.buildings.find((b) => b.id === action.building)!, level: s.era };
  return { state: { ...paid, buildings: paid.buildings.map((b) => (b.id === building.id ? building : b)) }, building };
}

const tilesText = (n: number) => (n === 1 ? "1 tegel" : `${n} tegels`);

/** "🛖 Hut bouwen" / "⬆️ Hut → Lemen huis" / "🎉 Groot dorpsfeest kopen" / "🛤️ 12 tegels pad leggen". */
export function actionLabel(s: Pick<IdleWorld, "buildings" | "era" | "roadLevel">, action: ProposalAction): string {
  if (action.kind === "build") {
    return `${buildingType(action.type)?.emoji ?? ""} ${buildingName(action.type, s.era)} bouwen`.trim();
  }
  if (action.kind === "buy") {
    const item = shopItem(action.item);
    return item ? `${item.emoji} ${item.name} kopen` : "iets kopen";
  }
  if (action.kind === "roads") return `🛣️ ${roadName(s.roadLevel)} → ${roadName(s.era)}`;
  if (action.kind === "paths") return `🛤️ ${tilesText(action.tiles.length)} pad leggen`;
  if (action.kind === "unpave") return `⛏️ ${tilesText(action.tiles.length)} pad weghalen`;
  const b = s.buildings.find((x) => x.id === action.building);
  if (action.kind === "demolish") return b ? `🧨 ${buildingName(b.type, b.level)} afbreken` : "afbreken";
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
 * Pass once votesNeeded said yes (and yes leads); fail once as many said no,
 * or once nobody left could still make it pass. At the deadline the votes
 * that were cast decide, with at least MIN_YES yes.
 */
export function voteOutcome(p: IdleProposal, online: number, now: number): "pass" | "fail" | "pending" {
  const { yes, no } = voteCounts(p);
  const needed = votesNeeded(online);
  const undecided = Math.max(0, online - yes - no);
  if (yes >= needed && yes > no) return "pass";
  if ((no >= needed && no >= yes) || yes + undecided <= no) return "fail";
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
}

/** Someone online, as their NPC. */
export interface IdlePerson {
  id: string;
  name: string;
  look: NpcLook;
}

export interface IdleStateMsg {
  type: "idle";
  state: IdleWorld;
  proposal: IdleProposalView | null;
  /** Waiting for their turn, first first. */
  queue: { label: string; by: string }[];
  /** Everyone online who said hello, one NPC each. */
  people: IdlePerson[];
  /** This viewer, once they said hello. */
  me: (IdlePerson & { owned: string[] }) | null;
  count: number;
  peak: number;
  online: number;
  /** Server clock when sent, to keep producing in the browser. */
  now: number;
}

export type IdleEvent =
  | { kind: "era"; era: number }
  /** `queued`: its place in line, when another vote is still running. */
  | { kind: "proposed"; label: string; by: string; queued?: number }
  /** A vote passed; `building` when something was built or upgraded. */
  | { kind: "bought"; label: string; by: string; building?: PlacedBuilding }
  | { kind: "rejected"; label: string; by: string; reason: string }
  /** A trade or a small shop item, no vote needed. */
  | { kind: "deal"; label: string; by: string }
  /** Someone else clicked nature: show it where it happened. */
  | { kind: "click"; resource: ResourceId; amount: number; x: number; y: number }
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
  /** A click on nature at this tile. */
  | { type: "gather"; x: number; y: number }
  | { type: "propose"; action: ProposalAction; name?: string }
  | { type: "vote"; id: number; yes: boolean }
  | { type: "trade"; from: ResourceId; to: ResourceId; amount: number; name?: string }
  /** A small shop item (vote: false). */
  | { type: "buy"; item: string; name?: string };
