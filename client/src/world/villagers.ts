// The villagers: cosmetic, simulated in each browser, but derived from the
// shared town (assignWorkers, gatheringOf), so everyone sees the same number
// of people with the same jobs. Workers and gatherers walk to their spot,
// work, and carry the loot to storage; whoever has nothing to do hangs out by
// the fire, the decorations or home.
// Everyone online also has their own NPC (id "p:<player>"), dressed as they
// chose, wandering around town with a name tag.

import {
  CENTER,
  CLOTHES_COLORS,
  DEPOSITS,
  ERAS,
  assignWorkers,
  buildingName,
  buildingType,
  gatherPatches,
  gatheringOf,
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
import { findPath, nearestWalkable } from "./path";

export const MAX_VILLAGERS = 200;

/** What the villager panel shows. */
export interface VillagerInfo {
  name: string;
  /** "speler" or "dat ben jij!" for a player's NPC. */
  player: string | null;
  home: string | null;
  /** Work building, or null: out of work. */
  job: string | null;
  /** Without a job: what they gather, and whether the players chose it. */
  gather: Gather | null;
  doing: string;
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
  walk: ["op weg naar m'n werk", "zwaar spul fr", "bijna bij de opslag", "nog één ritje", "sjouwen sjouwen"],
  idle: ["six seven!", "skibidi", "67?!", "fr fr", "ik ben werkloos lol", "wie bouwt er een huis voor mij", "aura +67", "chillen"],
  dance: ["💃 67 67 67", "vibe check ✅", "dit is fire"],
  photo: ["📸 67!", "story-waardig", "cheese 🧀"],
  pose: ["🗿", "mewing 🤫", "kijk mij"],
  sit: ["gezellig hier", "🔥 warm", "marshmallows?"],
  cheer: ["67!!", "SIX SEVEN", "🤲 67 🤲", "6️⃣7️⃣", "67 67 67", "six… SEVENNN"],
  sixseven: ["🤲 67 🤲", "6️⃣7️⃣"],
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
  player?: { name: string; hat: string; pattern: string; mine: boolean };
}

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const hashStr = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

export class Population {
  readonly villagers = new Map<string, Villager>();
  private world: IdleWorld | null = null;
  private byId = new Map<number, PlacedBuilding>();
  private spots = new Map<number, Point>();

  /** Match the people to the current town: one per bed, jobs from assignWorkers. */
  sync(world: IdleWorld, now: number): void {
    this.world = world;
    this.byId = new Map(world.buildings.map((b) => [b.id, b]));
    this.spots.clear();
    const houses = world.buildings.filter((b) => buildingType(b.type)?.category === "house");
    const people: { id: string; home: PlacedBuilding }[] = [];
    for (const h of houses) for (let i = 0; i < housingOf(h.level); i++) people.push({ id: `${h.id}-${i}`, home: h });
    people.length = Math.min(people.length, MAX_VILLAGERS);

    // The same round robin as assignWorkers, as a list of job ids.
    const { workers } = assignWorkers(world);
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
      keep.add(p.id);
      const job = order[i] ?? null;
      const gather = gathers.get(p.id) ?? null;
      let v = this.villagers.get(p.id);
      if (!v) {
        const seed = hashStr(p.id);
        const r = (k: number) => rand2(seed, k);
        const start = nearestWalkable(p.home.x, p.home.y);
        v = {
          id: p.id, name: NAMES[Math.floor(r(1) * NAMES.length)], home: p.home.id, job, gather, level: p.home.level,
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
      v.level = p.home.level;
      const clothes = ERAS[v.level].style.clothes;
      v.clothes = clothes[Math.abs(hashStr(v.id)) % clothes.length];
    });
    for (const id of [...this.villagers.keys()]) if (!keep.has(id) && !id.startsWith("p:")) this.villagers.delete(id);
  }

  /** One NPC per player online, looking the way they chose. */
  setPeople(people: IdlePerson[], me: string | null, now: number): void {
    const keep = new Set<string>();
    for (const p of people) {
      const id = `p:${p.id}`;
      keep.add(id);
      let v = this.villagers.get(id);
      if (!v) {
        const start = nearestWalkable(CENTER.x + Math.round((Math.random() - 0.5) * 4), CENTER.y + Math.round((Math.random() - 0.5) * 4));
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
      v.player = { name: p.name, hat: p.look.hat, pattern: p.look.pattern, mine: p.id === me };
    }
    for (const id of [...this.villagers.keys()]) if (id.startsWith("p:") && !keep.has(id)) this.villagers.delete(id);
  }

  /** Where a worker of this building works: the forest, the rocks, the ore, or the building itself. */
  private workSpot(b: PlacedBuilding): Point {
    let spot = this.spots.get(b.id);
    if (spot) return spot;
    const res = buildingType(b.type)?.produces;
    spot = { x: b.x, y: b.y };
    const deposit = DEPOSITS.find((d) => d.resource === res);
    if (b.type.startsWith("mine_") && deposit) spot = { x: deposit.x, y: deposit.y };
    else if (res === "wood" || res === "stone") {
      const want = res === "wood" ? "forest" : "rock";
      let best = Infinity;
      for (let dy = -10; dy <= 10; dy++) {
        for (let dx = -10; dx <= 10; dx++) {
          const d = Math.hypot(dx, dy);
          if (d < best && terrainAt(b.x + dx, b.y + dy) === want) {
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

  /** Nearest storage or the center, where loot goes. */
  private storeNear(p: Point): Point {
    let best: Point = CENTER;
    let bestD = Infinity;
    for (const b of this.world?.buildings ?? []) {
      if (b.type !== "storage" && b.type !== "center") continue;
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
    v.path = findPath(from, to) ?? [nearestWalkable(to.x, to.y)];
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
      this.walkTo(v, { x: Math.round(d.x + Math.cos(a) * 1.4), y: Math.round(d.y + Math.sin(a) * 1.4) });
    } else if (roll < 0.6) {
      const a = Math.random() * Math.PI * 2;
      v.task = { kind: "go", then: "sit", duration: 6000 + Math.random() * 5000 };
      this.walkTo(v, { x: Math.round(CENTER.x + Math.cos(a) * 1.5), y: Math.round(CENTER.y + Math.sin(a) * 1.5) });
    } else if (roll < 0.9 || !home) {
      const base = home ?? CENTER;
      v.task = { kind: "go", then: "none", duration: 1500 + Math.random() * 3000 };
      this.walkTo(v, { x: base.x + Math.round((Math.random() - 0.5) * 12), y: base.y + Math.round((Math.random() - 0.5) * 12) });
    } else {
      v.task = { kind: "go", then: "home", duration: 6000 + Math.random() * 8000 };
      this.walkTo(v, home);
    }
  }

  /** What to do once the current task is done. */
  private next(v: Villager, now: number): void {
    const job = v.job === null ? undefined : this.byId.get(v.job);
    v.hidden = false;
    v.action = "none";
    const res = job ? buildingType(job.type)?.produces ?? null : v.gather?.resource ?? null;
    const t = v.task.kind;
    // Gatherers pick their spot each round: nature runs out.
    const spot = job ? this.workSpot(job) : res && t !== "work" && t !== "toStore" ? this.gatherSpot(v, res) : null;
    if (!job && !(res && (spot || t === "work" || t === "toStore"))) return this.chooseIdle(v, now);
    if (t === "toWork") {
      v.task = { kind: "work", until: now + 3500 + Math.random() * 2500 };
      v.action = "work";
    } else if (t === "work") {
      v.carry = res;
      v.task = { kind: "toStore" };
      this.walkTo(v, this.storeNear(v));
    } else if (t === "toStore") {
      v.task = { kind: "drop", until: now + 700 };
    } else {
      v.carry = null;
      v.task = { kind: "toWork" };
      this.walkTo(v, spot!);
    }
  }

  update(dt: number, now: number): void {
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
            v.task.kind === "work" ? CHAT.work
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
    const what = v.player ? (v.player.mine ? "dat ben jij!" : "speler") : job ? buildingName(job.type, job.level).toLowerCase()
      : v.gather ? `verzamelt ${resourceDef(v.gather.resource)?.name ?? ""}`
      : "werkloos, chillt";
    v.bubble = { text: `${v.name} · ${what}`, until: now + 3500 };
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
    const res = job ? buildingType(job.type)?.produces : v.gather?.resource;
    const emoji = (r: ResourceId | null | undefined) => (r ? resourceDef(r)?.emoji ?? "" : "");
    const task = v.task;
    let doing: string;
    if (now < v.sixSevenUntil) doing = "🤲 doet de 67";
    else if (v.hidden || task.kind === "inside") doing = "🏠 is thuis";
    else if (task.kind === "toWork") doing = job ? "🚶 loopt naar het werk" : `🚶 gaat ${emoji(res)} verzamelen`;
    else if (task.kind === "work") doing = job ? `${emoji(res)} is aan het werk` : `${emoji(res)} is aan het verzamelen`;
    else if (task.kind === "toStore") doing = `📦 brengt ${emoji(v.carry)} naar de opslag`;
    else if (task.kind === "drop") doing = "📦 levert af bij de opslag";
    else {
      const what = task.kind === "go" ? task.then : task.action;
      const going = task.kind === "go";
      doing =
        what === "home" ? "🏠 gaat naar huis"
        : what === "sit" ? (going ? "🔥 gaat bij het kampvuur zitten" : "🔥 zit bij het kampvuur")
        : what === "dance" ? (going ? "💃 gaat dansen" : "💃 danst")
        : what === "photo" ? (going ? "📸 gaat foto's maken" : "📸 maakt foto's")
        : what === "pose" ? (going ? "🗿 gaat poseren" : "🗿 poseert")
        : going ? "🚶 loopt wat rond" : "😎 chillt";
    }
    return {
      name: v.name,
      player: v.player ? (v.player.mine ? "dat ben jij!" : "speler") : null,
      home: home ? `${buildingType(home.type)?.emoji ?? ""} ${buildingName(home.type, home.level)}` : null,
      job: job ? `${buildingType(job.type)?.emoji ?? ""} ${buildingName(job.type, job.level)}` : null,
      gather: job || v.player ? null : v.gather,
      doing,
    };
  }

  look(v: Villager, now: number): VillagerLook {
    const walking = v.task.kind === "toWork" || v.task.kind === "toStore" || v.task.kind === "go";
    const job = v.job === null ? undefined : this.byId.get(v.job);
    const res = job ? buildingType(job.type)?.produces : v.gather?.resource;
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
      tool: res === "wood" ? "axe" : res === "food" ? "hoe" : "pick",
      carry: v.carry,
      jump: jumpLeft > 0 ? Math.sin((jumpLeft / 700) * Math.PI * 2) ** 2 * 6 : 0,
      hat: v.player?.hat,
      pattern: v.player?.pattern,
    };
  }
}
