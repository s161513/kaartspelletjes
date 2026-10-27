// The villagers: cosmetic, simulated in each browser, but derived from the
// shared town (assignWorkers, gatheringOf), so everyone sees the same number
// of people with the same jobs. Workers and gatherers walk to their spot,
// work, and carry the loot to storage; whoever has nothing to do hangs out by
// the fire, the decorations or home. There's one villager per person in town
// (`population`): they fill the beds in build order, the rest sleep outside.
// Only some of the townsfolk are on the map, NPCS_PER_PLAYER for everyone
// online, so the town doesn't drown in people; the jobs are shared out over
// everyone first.
// Everyone online also has their own NPC (id "p:<player>"), dressed as they
// chose, wandering around town with a name tag. A newcomer who knocked waits
// at the edge of town (id "n:<name>") until the players voted.
// At night (update 20) most of the townsfolk sleep: at home, or by the fire
// without a bed. The night shift (about half of them, which is why work goes
// at half speed) keeps working.

import {
  CENTER,
  CLOTHES_COLORS,
  DEPOSITS,
  ERAS,
  assignWorkers,
  buildingName,
  buildingType,
  capOf,
  producesOf,
  gatherPatches,
  gatheringOf,
  isLand,
  isRiver,
  isRoad,
  isUsedUp,
  housingOf,
  resourceDef,
  SKIN_TONES,
  terrainAt,
  type IdlePerson,
  type IdleWorld,
  type PlacedBuilding,
  type ResourceId,
} from "@app/shared/idle";
import { rand2, type VillagerLook } from "./draw";
import type { Point } from "./iso";
import { findPath, nearestOpen, nearestWalkable } from "./path";

/** A villager who can't get somewhere through a gate climbs the wall: a step on it costs this. */
const CLIMB = 8;
/** At night, asleep at home: checks every this often whether it's morning. */
const SLEEP_CHECK_MS = 30_000;

/** For every player online this many townsfolk walk around, picked from all of them. */
export const NPCS_PER_PLAYER = 1;

/** What the villager panel shows. */
export interface VillagerInfo {
  name: string;
  /** "speler" or "dat ben jij!" for a player's NPC. */
  player: string | null;
  /** The player's public id, for a player's NPC. */
  playerId: string | null;
  home: string | null;
  /** Work building, or null: out of work. */
  job: string | null;
  /** Without a job: what they gather, and whether the players chose it. */
  gather: Gather | null;
  doing: string;
  /** A newcomer waiting for the vote. */
  visitor: boolean;
}

export interface Gather {
  resource: ResourceId;
  chosen: boolean;
}
const SPEED = 1.3; // tiles per second
const MAX_BUBBLES = 6;
/** How long everyone does the 67 after a +1 on the counter. */
const SIX_SEVEN_MS = 2200;

const NAMES = [
  "Kevin", "Jayden", "Sem", "Daan", "Fleur", "Noor", "Bram", "Lotte", "Mees", "Saar", "Joep", "Tess", "Gijs",
  "Yara", "Luuk", "Ilse", "Teun", "Roos", "Skibidi Sven", "Rizzler Rik", "Sigma Sanne", "Mewing Mila",
  "Ohio Olaf", "Fanum Femke", "Gyatt Gerrit", "Aura Anouk", "No-cap Niels", "Sheesh Sophie",
];
const SKINS = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac", "#a1665e"];

const CHAT = {
  work: ["hard werken 💪", "nog 67 te gaan", "no cap, dit is zwaar", "wanneer is het pauze", "grind never stops", "sigma grindset"],
  /** Workers on their way to work or to storage. */
  walk: [
    "op weg naar m'n werk", "zwaar spul fr", "bijna bij de opslag", "nog één ritje", "sjouwen sjouwen",
    "Who's gonna carry the logs and the boats?",
  ],
  idle: ["six seven!", "skibidi", "67?!", "fr fr", "ik ben werkloos lol", "wie bouwt er een huis voor mij", "aura +67", "chillen"],
  dance: ["💃 67 67 67", "vibe check ✅", "dit is fire"],
  photo: ["📸 67!", "story-waardig", "cheese 🧀"],
  pose: ["🗿", "mewing 🤫", "kijk mij"],
  sit: ["gezellig hier", "🔥 warm", "marshmallows?"],
  sleep: ["😴", "zzz…", "welterusten", "nog vijf minuutjes"],
  cheer: ["67!!", "SIX SEVEN", "🤲 67 🤲", "6️⃣7️⃣", "67 67 67", "six… SEVENNN"],
  sixseven: ["🤲 67 🤲", "6️⃣7️⃣"],
  knock: ["mag ik hier wonen? 🧳", "hallo? 👋", "ik kan hard werken!", "is er nog een bed vrij?", "stem op mij fr"],
};

type Task =
  | { kind: "toWork" }
  | { kind: "work"; until: number }
  | { kind: "toStore" }
  | { kind: "drop"; until: number }
  | { kind: "go"; then: VillagerLook["action"] | "home"; duration: number }
  | { kind: "stay"; until: number; action: VillagerLook["action"] }
  | { kind: "inside"; until: number };

export interface Villager {
  id: string;
  name: string;
  home: number;
  job: number | null;
  /** Without a job: what they gather, if anything grows near the town. */
  gather: Gather | null;
  level: number;
  clothes: string;
  skin: string;
  /** Tile-space position (tile centers + a personal offset). */
  x: number;
  y: number;
  ox: number;
  oy: number;
  path: Point[];
  pathI: number;
  task: Task;
  action: VillagerLook["action"];
  carry: ResourceId | null;
  hidden: boolean;
  bubble: { text: string; until: number } | null;
  jumpUntil: number;
  /** Standing still doing the 67 (hands up and down) until then. */
  sixSevenUntil: number;
  nextChat: number;
  /** Set for a player's own NPC. */
  player?: { id: string; name: string; hat: string; pattern: string; mine: boolean };
  /** A newcomer waiting at the edge of town for the vote. */
  visitor?: boolean;
}

/** What a worker swings, by work building (the rest: an axe for wood, a pick for everything mined). */
const TOOLS: Record<string, VillagerLook["tool"]> = { farm: "hoe", hunter: "spear", fishery: "rod", ranch: "none" };

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const hashStr = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

export class Population {
  readonly villagers = new Map<string, Villager>();
  private world: IdleWorld | null = null;
  private byId = new Map<number, PlacedBuilding>();
  private spots = new Map<number, Point>();
  /** Players online, set by setPeople; decides how many townsfolk are on the map. */
  private online = 1;
  /** Is it night in town (set every update)? */
  private night = false;

  /** Match the people to the current town: beds first, jobs from assignWorkers, a few of them on the map. */
  sync(world: IdleWorld, now: number): void {
    this.world = world;
    this.byId = new Map(world.buildings.map((b) => [b.id, b]));
    this.spots.clear();
    const houses = world.buildings.filter((b) => buildingType(b.type)?.category === "house");
    const { population, workers } = assignWorkers(world);
    const people: { id: string; home: PlacedBuilding | null }[] = [];
    for (const h of houses) for (let i = 0; i < housingOf(h.level) && people.length < population; i++) people.push({ id: `${h.id}-${i}`, home: h });
    for (let i = 0; people.length < population; i++) people.push({ id: `out-${i}`, home: null });
    // Who's on the map goes by a fixed draw per person, so mostly the same ones stay as the town grows.
    const draw = (id: string) => rand2(hashStr(id), 7);
    const onMap = new Set(
      [...people].sort((a, b) => draw(a.id) - draw(b.id)).slice(0, this.online * NPCS_PER_PLAYER).map((p) => p.id),
    );

    // The same round robin as assignWorkers, as a list of job ids.
    const jobs = world.buildings.filter((b) => workers[b.id] !== undefined);
    const order: number[] = [];
    const given: Record<number, number> = {};
    for (let open = true; open; ) {
      open = false;
      for (const j of jobs) {
        if ((given[j.id] ?? 0) < workers[j.id]) {
          given[j.id] = (given[j.id] ?? 0) + 1;
          order.push(j.id);
          open = true;
        }
      }
    }

    // Whoever has no job gathers; keep people on what they did if that still has room.
    const { chosen, auto } = gatheringOf(world);
    const room = new Map<string, number>();
    for (const [res, n] of Object.entries(chosen)) room.set(`${res}:1`, n);
    for (const [res, n] of Object.entries(auto)) room.set(`${res}:0`, n);
    const take = (g: Gather): boolean => {
      const key = `${g.resource}:${g.chosen ? 1 : 0}`;
      const n = room.get(key) ?? 0;
      if (n > 0) room.set(key, n - 1);
      return n > 0;
    };
    const jobless = people.slice(order.length).map((p) => p.id);
    const gathers = new Map<string, Gather>();
    for (const id of jobless) {
      const g = this.villagers.get(id)?.gather;
      if (g && take(g)) gathers.set(id, g);
    }
    for (const id of jobless) {
      if (gathers.has(id)) continue;
      const free = [...room].find(([, n]) => n > 0)?.[0];
      if (!free) break;
      const [resource, c] = free.split(":");
      const g = { resource, chosen: c === "1" };
      take(g);
      gathers.set(id, g);
    }

    const keep = new Set<string>();
    people.forEach((p, i) => {
      if (!onMap.has(p.id)) return;
      keep.add(p.id);
      const job = order[i] ?? null;
      const gather = gathers.get(p.id) ?? null;
      let v = this.villagers.get(p.id);
      if (!v) {
        const seed = hashStr(p.id);
        const r = (k: number) => rand2(seed, k);
        const start = nearestWalkable(p.home?.x ?? CENTER.x, p.home?.y ?? CENTER.y);
        v = {
          id: p.id, name: NAMES[Math.floor(r(1) * NAMES.length)], home: p.home?.id ?? -1, job, gather, level: p.home?.level ?? 0,
          clothes: "", skin: SKINS[Math.floor(r(2) * SKINS.length)],
          x: start.x, y: start.y, ox: (r(3) - 0.5) * 0.5, oy: (r(4) - 0.5) * 0.5,
          path: [], pathI: 0, task: { kind: "stay", until: now + r(5) * 3000, action: "none" },
          action: "none", carry: null, hidden: false, bubble: null, jumpUntil: 0, sixSevenUntil: 0,
          nextChat: now + 5000 + r(6) * 30_000,
        };
        this.villagers.set(p.id, v);
      } else if (v.job !== job || v.gather?.resource !== gather?.resource) {
        v.job = job;
        v.gather = gather;
        v.carry = null;
        v.task = { kind: "stay", until: now, action: "none" };
      } else v.gather = gather;
      v.home = p.home?.id ?? -1;
      v.level = p.home?.level ?? 0;
      const clothes = ERAS[v.level].style.clothes;
      v.clothes = clothes[Math.abs(hashStr(v.id)) % clothes.length];
    });
    for (const id of [...this.villagers.keys()]) if (!keep.has(id) && !id.startsWith("p:") && !id.startsWith("n:")) this.villagers.delete(id);
  }

  /** The newcomer waiting for the vote (null: nobody), standing at the edge of town with their bundle. */
  setNewcomer(name: string | null, now: number): void {
    const id = name === null ? null : `n:${name}`;
    for (const key of [...this.villagers.keys()]) if (key.startsWith("n:") && key !== id) this.villagers.delete(key);
    if (id === null || this.villagers.has(id)) return;
    const seed = hashStr(id);
    const spot = nearestOpen(CENTER.x + 4, CENTER.y + 4);
    this.villagers.set(id, {
      id, name: name!, home: -1, job: null, gather: null, level: this.world?.era ?? 0,
      clothes: "#8b5a2b", skin: SKINS[Math.abs(seed) % SKINS.length],
      x: spot.x, y: spot.y, ox: 0, oy: 0, path: [], pathI: 0, task: { kind: "stay", until: Infinity, action: "none" },
      action: "none", carry: null, hidden: false, bubble: { text: "mag ik hier wonen? 🧳", until: now + 4000 }, jumpUntil: now + 800, sixSevenUntil: 0,
      nextChat: now + 10_000, visitor: true,
    });
  }

  /** One NPC per player online, looking the way they chose. */
  setPeople(people: IdlePerson[], me: string | null, now: number): void {
    const online = Math.max(1, people.length);
    if (online !== this.online) {
      this.online = online;
      if (this.world) this.sync(this.world, now);
    }
    const keep = new Set<string>();
    for (const p of people) {
      const id = `p:${p.id}`;
      keep.add(id);
      let v = this.villagers.get(id);
      if (!v) {
        const start = nearestOpen(CENTER.x + Math.round((Math.random() - 0.5) * 4), CENTER.y + Math.round((Math.random() - 0.5) * 4));
        v = {
          id, name: p.name, home: -1, job: null, gather: null, level: 0, clothes: "", skin: "",
          x: start.x, y: start.y, ox: (Math.random() - 0.5) * 0.4, oy: (Math.random() - 0.5) * 0.4,
          path: [], pathI: 0, task: { kind: "stay", until: now + 1000, action: "none" },
          action: "none", carry: null, hidden: false, bubble: { text: "👋 hoi!", until: now + 2500 }, jumpUntil: now + 800, sixSevenUntil: 0,
          nextChat: now + 20_000 + Math.random() * 30_000,
        };
        this.villagers.set(id, v);
      }
      v.name = p.name;
      v.skin = SKIN_TONES[p.look.skin] ?? SKIN_TONES[0];
      v.clothes = CLOTHES_COLORS[p.look.clothes] ?? CLOTHES_COLORS[0];
      v.player = { id: p.id, name: p.name, hat: p.look.hat, pattern: p.look.pattern, mine: p.id === me };
      // Their task (update 14): off to that building or that nature, like any villager with a job.
      const job = p.task?.kind === "work" ? p.task.building : null;
      const gather = p.task?.kind === "gather" ? p.task.res : null;
      if (v.job !== job || (v.gather?.resource ?? null) !== gather) {
        v.job = job;
        v.gather = gather ? { resource: gather, chosen: true } : null;
        v.carry = null;
        v.task = { kind: "stay", until: now, action: "none" };
      }
    }
    for (const id of [...this.villagers.keys()]) if (id.startsWith("p:") && !keep.has(id)) this.villagers.delete(id);
  }

  /** Where a worker of this building works: the forest (woodcutters, hunters), the rocks, the ore, the riverbank, or the building itself. */
  private workSpot(b: PlacedBuilding): Point {
    let spot = this.spots.get(b.id);
    if (spot) return spot;
    const res = buildingType(b.type)?.produces;
    const roads = this.world?.roads ?? [];
    spot = { x: b.x, y: b.y };
    const deposit = DEPOSITS.find((d) => d.resource === res);
    if (b.type.startsWith("mine_") && deposit) spot = { x: deposit.x, y: deposit.y };
    // Miners go into the mountain through their own building.
    else if (b.type !== "mine" && (res === "wood" || res === "stone" || b.type === "hunter" || b.type === "fishery")) {
      const want = (x: number, y: number) =>
        b.type === "fishery" ? isLand(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => isRiver(x + dx, y + dy))
        : terrainAt(x, y) === (res === "stone" ? "rock" : "forest");
      let best = Infinity;
      for (let dy = -10; dy <= 10; dy++) {
        for (let dx = -10; dx <= 10; dx++) {
          const d = Math.hypot(dx, dy);
          if (d < best && want(b.x + dx, b.y + dy) && !isRoad(roads, b.x + dx, b.y + dy)) {
            best = d;
            spot = { x: b.x + dx, y: b.y + dy };
          }
        }
      }
    }
    this.spots.set(b.id, spot);
    return spot;
  }

  /** Where a gatherer goes: a tile of the nearest patch of their resource that isn't used up (spread out a bit). */
  private gatherSpot(v: Villager, res: ResourceId): Point | null {
    const used = this.world?.nature ?? {};
    const roads = this.world?.roads ?? [];
    for (const p of gatherPatches(res)) {
      const tiles = p.tiles.filter((t) => !isUsedUp(t.x, t.y, used) && !isRoad(roads, t.x, t.y));
      if (tiles.length) return tiles[Math.abs(hashStr(v.id)) % tiles.length];
    }
    return null;
  }

  /** Is the storage for this resource full? Then its workers and gatherers take a break. */
  private full(res: ResourceId | null): boolean {
    return !!res && !!this.world && (this.world.resources[res] ?? 0) >= capOf(this.world, res);
  }

  /** Nearest storage for this resource, or the center, where loot goes. */
  private storeNear(p: Point, res: ResourceId | null): Point {
    let best: Point = CENTER;
    let bestD = Infinity;
    for (const b of this.world?.buildings ?? []) {
      if (b.type !== "center" && (!res || buildingType(b.type)?.stores !== res || b.damaged)) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private walkTo(v: Villager, to: Point): void {
    const from = { x: Math.round(v.x), y: Math.round(v.y) };
    // Through the gates; over the wall only when there's no way round.
    v.path = findPath(from, to) ?? findPath(from, to, CLIMB) ?? [nearestWalkable(to.x, to.y)];
    v.pathI = 0;
  }

  private chooseIdle(v: Villager, now: number): void {
    const decor = this.world?.buildings.filter((b) => buildingType(b.type)?.category === "decor") ?? [];
    const home = this.byId.get(v.home);
    const roll = Math.random();
    if (decor.length && roll < 0.35) {
      const d = pick(decor);
      const behavior = buildingType(d.type)!.decor!.behavior;
      const a = Math.random() * Math.PI * 2;
      v.task = { kind: "go", then: behavior, duration: 6000 + Math.random() * 6000 };
      this.walkTo(v, nearestOpen(Math.round(d.x + Math.cos(a) * 1.4), Math.round(d.y + Math.sin(a) * 1.4)));
    } else if (roll < 0.6) {
      v.task = { kind: "go", then: "sit", duration: 6000 + Math.random() * 5000 };
      this.walkTo(v, this.fireSeat());
    } else if (roll < 0.9 || !home) {
      const base = home ?? CENTER;
      v.task = { kind: "go", then: "none", duration: 1500 + Math.random() * 3000 };
      this.walkTo(v, nearestOpen(base.x + Math.round((Math.random() - 0.5) * 12), base.y + Math.round((Math.random() - 0.5) * 12)));
    } else {
      v.task = { kind: "go", then: "home", duration: 6000 + Math.random() * 8000 };
      this.walkTo(v, home);
    }
  }

  /** The night shift: about half the townsfolk keep working at night. */
  private nightShift(v: Villager): boolean {
    return Math.abs(hashStr(v.id)) % 2 === 0;
  }

  /** Go to bed: home, or by the fire for whoever has no bed. */
  private toBed(v: Villager, now: number): void {
    const home = this.byId.get(v.home);
    v.carry = null;
    if (home) {
      v.task = { kind: "go", then: "home", duration: SLEEP_CHECK_MS };
      this.walkTo(v, home);
    } else {
      const a = Math.random() * Math.PI * 2;
      v.task = { kind: "go", then: "sleep", duration: SLEEP_CHECK_MS };
      this.walkTo(v, nearestOpen(Math.round(CENTER.x + Math.cos(a) * 2), Math.round(CENTER.y + Math.sin(a) * 2)));
    }
    if (Math.random() < 0.2) v.bubble = { text: pick(CHAT.sleep), until: now + 2500 };
  }

  /** A seat by the fire: on one of the logs round the Kampvuur, else somewhere round De Senaat. */
  private fireSeat(): Point {
    const center = this.world?.buildings.find((b) => b.type === "center");
    if (center && center.level === 0) {
      const [dx, dy] = pick([[1, 0], [-1, 0], [0, 1], [0, -1]] as const);
      return nearestOpen(center.x + dx, center.y + dy);
    }
    const a = Math.random() * Math.PI * 2;
    return nearestOpen(Math.round(CENTER.x + Math.cos(a) * 2.2), Math.round(CENTER.y + Math.sin(a) * 2.2));
  }

  /** What to do once the current task is done. */
  private next(v: Villager, now: number): void {
    // A newcomer stays put until the vote is over.
    if (v.visitor) return void (v.task = { kind: "stay", until: Infinity, action: "none" });
    const job = v.job === null ? undefined : this.byId.get(v.job);
    const asleep = v.task.kind === "inside" || (v.task.kind === "stay" && v.task.action === "sleep");
    if (this.night && !v.player && !(this.nightShift(v) && (job || v.gather))) {
      // Bedtime (or still night: sleep on).
      if (asleep) return void (v.task = v.task.kind === "inside" ? { kind: "inside", until: now + SLEEP_CHECK_MS } : { kind: "stay", until: now + SLEEP_CHECK_MS, action: "sleep" });
      return this.toBed(v, now);
    }
    v.hidden = false;
    v.action = "none";
    const res = job ? producesOf(job) ?? null : v.gather?.resource ?? null;
    const t = v.task.kind;
    // Gatherers pick their spot each round: nature runs out.
    const spot = job ? this.workSpot(job) : res && t !== "work" && t !== "toStore" ? this.gatherSpot(v, res) : null;
    if (!job && !(res && (spot || t === "work" || t === "toStore"))) return this.chooseIdle(v, now);
    if (t === "toWork" && this.full(res)) {
      // Nowhere to put it: sit by the fire until there's room again.
      v.task = { kind: "go", then: "sit", duration: 15_000 + Math.random() * 10_000 };
      v.bubble = { text: "opslag vol, pauze 😴", until: now + 3000 };
      this.walkTo(v, this.fireSeat());
    } else if (t === "toWork") {
      v.task = { kind: "work", until: now + 3500 + Math.random() * 2500 };
      v.action = "work";
    } else if (t === "work") {
      v.carry = res;
      v.task = { kind: "toStore" };
      this.walkTo(v, this.storeNear(v, res));
    } else if (t === "toStore") {
      v.task = { kind: "drop", until: now + 700 };
    } else {
      v.carry = null;
      v.task = { kind: "toWork" };
      this.walkTo(v, spot!);
    }
  }

  update(dt: number, now: number, night = false): void {
    this.night = night;
    let bubbles = 0;
    for (const v of this.villagers.values()) {
      if (v.bubble && v.bubble.until < now) v.bubble = null;
      if (v.bubble) bubbles++;
    }
    for (const v of this.villagers.values()) {
      const task = v.task;
      const walking = task.kind === "toWork" || task.kind === "toStore" || task.kind === "go";
      if (now < v.sixSevenUntil) {
        // Busy doing the 67: everything else waits.
      } else if (walking) {
        let step = SPEED * dt;
        while (step > 0 && v.pathI < v.path.length) {
          const p = v.path[v.pathI];
          const dx = p.x - v.x;
          const dy = p.y - v.y;
          const d = Math.hypot(dx, dy);
          if (d <= step) {
            v.x = p.x;
            v.y = p.y;
            v.pathI++;
            step -= d;
          } else {
            v.x += (dx / d) * step;
            v.y += (dy / d) * step;
            step = 0;
          }
        }
        if (v.pathI >= v.path.length) {
          if (task.kind === "go") {
            if (task.then === "home") {
              v.hidden = true;
              v.task = { kind: "inside", until: now + task.duration };
            } else {
              v.action = task.then;
              v.task = { kind: "stay", until: now + task.duration, action: task.then };
            }
          } else this.next(v, now);
        }
      } else if (now >= (task as { until: number }).until) {
        this.next(v, now);
      }

      if (now > v.nextChat && !v.hidden) {
        v.nextChat = now + 15_000 + Math.random() * 40_000;
        if (bubbles < MAX_BUBBLES) {
          // Only the jobless say they're out of work.
          const pool =
            v.visitor ? CHAT.knock
            : v.action === "sleep" ? CHAT.sleep
            : v.task.kind === "work" ? CHAT.work
            : v.job !== null || v.gather ? CHAT.walk
            : v.action !== "none" && v.action !== "work" ? CHAT[v.action]
            : CHAT.idle;
          v.bubble = { text: pick(pool), until: now + 3000 };
          bubbles++;
        }
      }
    }
  }

  /** A +1 on the counter: everyone (even those at home) stops and does the 67; some shout. */
  cheer(now: number): void {
    let shouts = 0;
    for (const v of this.villagers.values()) {
      v.hidden = false;
      v.sixSevenUntil = now + SIX_SEVEN_MS;
      if (shouts < 12 && Math.random() < 0.35) {
        v.bubble = { text: pick(CHAT.cheer), until: now + 2000 };
        shouts++;
      }
    }
  }

  /** Clicked: say who you are and what you do. */
  introduce(v: Villager, now: number): void {
    const job = v.job === null ? undefined : this.byId.get(v.job);
    const what = v.player ? (v.player.mine ? "dat ben jij!" : "speler") : v.visitor ? "nieuwkomer, mag ik blijven?" : job ? buildingName(job.type, job.level).toLowerCase()
      : v.gather ? `verzamelt ${resourceDef(v.gather.resource)?.name ?? ""}`
      : "werkloos, chillt";
    v.bubble = { text: `${v.name} · ${what}`, until: now + 3500 };
  }

  /** Two players did something together: a bubble over both. */
  social(from: string, to: string, emoji: string, now: number): void {
    for (const id of [from, to]) {
      const v = this.villagers.get(`p:${id}`);
      if (v) {
        v.bubble = { text: emoji, until: now + 3000 };
        v.jumpUntil = now + 700;
      }
    }
  }

  /** Someone picked what this villager gathers: show it right away, the town's next sync keeps them on it. */
  setGather(v: Villager, g: Gather | null, now: number): void {
    if (v.job !== null || v.gather?.resource === g?.resource) {
      v.gather = g;
      return;
    }
    v.gather = g;
    v.carry = null;
    v.task = { kind: "stay", until: now, action: "none" };
  }

  /** For the panel when someone clicks this villager. */
  describe(v: Villager, now: number): VillagerInfo {
    const job = v.job === null ? undefined : this.byId.get(v.job);
    const home = this.byId.get(v.home);
    const res = job ? producesOf(job) : v.gather?.resource;
    const emoji = (r: ResourceId | null | undefined) => (r ? resourceDef(r)?.emoji ?? "" : "");
    const task = v.task;
    let doing: string;
    if (v.visitor) doing = "🧳 klopt aan: mag die in het dorp komen wonen? Stem rechts bij de stemmingen";
    else if (now < v.sixSevenUntil) doing = "🤲 doet de 67";
    else if (v.hidden || task.kind === "inside") doing = this.night ? "😴 slaapt thuis" : "🏠 is thuis";
    else if (task.kind === "toWork") doing = job ? "🚶 loopt naar het werk" : `🚶 gaat ${emoji(res)} verzamelen`;
    else if (task.kind === "work") doing = job ? `${emoji(res)} is aan het werk` : `${emoji(res)} is aan het verzamelen`;
    else if (task.kind === "toStore") doing = `📦 brengt ${emoji(v.carry)} naar de opslag`;
    else if (task.kind === "drop") doing = "📦 levert af bij de opslag";
    else {
      const what = task.kind === "go" ? task.then : task.action;
      const going = task.kind === "go";
      doing =
        what === "home" ? (this.night ? "😴 gaat naar huis om te slapen" : "🏠 gaat naar huis")
        : what === "sleep" ? (going ? "😴 gaat bij het vuur slapen (geen bed)" : "😴 slaapt bij het vuur (geen bed)")
        : what === "sit" && (job || v.gather) && this.full(res ?? null) ? `🔥 de opslag voor ${emoji(res)} is vol: pauze bij het kampvuur`
        : what === "sit" ? (going ? "🔥 gaat bij het kampvuur zitten" : "🔥 zit bij het kampvuur")
        : what === "dance" ? (going ? "💃 gaat dansen" : "💃 danst")
        : what === "photo" ? (going ? "📸 gaat foto's maken" : "📸 maakt foto's")
        : what === "pose" ? (going ? "🗿 gaat poseren" : "🗿 poseert")
        : going ? "🚶 loopt wat rond" : "😎 chillt";
    }
    return {
      name: v.name,
      player: v.player ? (v.player.mine ? "dat ben jij!" : "speler") : null,
      playerId: v.player?.id ?? null,
      home: home ? `${buildingType(home.type)?.emoji ?? ""} ${buildingName(home.type, home.level)}` : null,
      job: job ? `${buildingType(job.type)?.emoji ?? ""} ${buildingName(job.type, job.level)}` : null,
      gather: job ? null : v.gather,
      doing,
      visitor: !!v.visitor,
    };
  }

  look(v: Villager, now: number): VillagerLook {
    const walking = v.task.kind === "toWork" || v.task.kind === "toStore" || v.task.kind === "go";
    const job = v.job === null ? undefined : this.byId.get(v.job);
    const res = job ? producesOf(job) : v.gather?.resource;
    const jumpLeft = v.jumpUntil - now;
    const sixSeven = now < v.sixSevenUntil;
    return {
      clothes: v.clothes,
      skin: v.skin,
      level: v.level,
      walking: walking && !sixSeven,
      // The 67 is in step for the whole town.
      phase: sixSeven ? now : now + hashStr(v.id),
      action: sixSeven ? "sixseven" : v.action,
      tool: job ? TOOLS[job.type] ?? (res === "wood" ? "axe" : "pick") : res === "wood" ? "axe" : res === "food" ? "none" : "pick",
      carry: v.carry,
      jump: jumpLeft > 0 ? Math.sin((jumpLeft / 700) * Math.PI * 2) ** 2 * 6 : 0,
      hat: v.player?.hat,
      pattern: v.player?.pattern,
    };
  }
}
