// The town as a full-screen isometric canvas under the counter bar: terrain,
// nature, buildings and villagers, depth-sorted every frame. Drag to look
// around, wheel or pinch to zoom, click a building to inspect it, click free
// land to build, click a villager to see (and choose) what they do. While
// drawing paths, dragging paints tiles instead (pan with the right mouse
// button or two fingers).

import {
  CENTER,
  DEPOSITS,
  ERAS,
  MAP_SIZE,
  goneTiles,
  patches,
  natureAt,
  resourceDef,
  terrainAt,
  tileOf,
  type IdlePerson,
  type IdleWorld,
  type PlacedBuilding,
  type ProposalAction,
  type ResourceId,
  RAID_WARNING_MS,
  buildingOn,
  isNight,
  middleOf,
  tilesOf,
  type RaidStage,
} from "@app/shared/idle";
import {
  RESOURCE_COLORS,
  buildingBounds,
  drawBridge,
  drawBubble,
  drawBuilding,
  drawAnimal,
  drawDrop,
  drawBush,
  drawDeposit,
  drawFlowers,
  drawMountain,
  drawNameTag,
  drawRoadDetail,
  grassDetail,
  shade,
  drawWall,
  drawRaiders,
  drawRock,
  drawUsedUp,
  drawWaterTile,
  drawTree,
  drawVillager,
  groundColor,
  rand2,
} from "./draw";
import { clearBaked, drawBaked } from "./pixel";
import { drawSprite, spritesLoaded, variant } from "./sprites";
import { Camera, TILE_H, TILE_W, toTileSpace, toWorld } from "./iso";
import { Wildlife } from "./animals";
import { findPath, setTown } from "./path";
import { buildingLights, darknessAt, drawNight, streetLights, type Light } from "./night";
import { Population, type Gather, type VillagerInfo } from "./villagers";

const DRAG_THRESHOLD = 6;
/** Depth for sorting: the front-most tile a building stands on (big ones take several). */
const depthOf = (b: PlacedBuilding): number => Math.max(...tilesOf(b).map((t) => t.x + t.y));
/** What a step over a wall costs the raiders, against 1 on open ground: climbing is slow. */
const RAID_CLIMB = 6;
/** Players' NPCs are drawn this much bigger than the townsfolk. */
const PLAYER_SCALE = 1.3;
const MAX_PARTICLES = 400;
/** Below this zoom the landscape comes from a pre-drawn picture instead of being drawn every frame. */
const FAR_ZOOM = 0.75;
/** Resolution of that picture, and the world area it covers (mountains stick out above row 0). */
const LAND_SCALE = 0.6;
const LAND_LEFT = -(MAP_SIZE * TILE_W) / 2;
const LAND_TOP = -80;

export interface WorldOptions {
  canvas: HTMLCanvasElement;
  onSelect(building: PlacedBuilding | null): void;
  /** A villager (or a player's NPC) was clicked. */
  onVillager(id: string): void;
  /** Land (no building, no nature) was clicked, or any tile while placing; screen point for a popup. */
  onTile(x: number, y: number, px: number, py: number): void;
  /** Drawing paths: the pointer touched this tile; `first` at the start of a stroke. */
  onPaint(x: number, y: number, first: boolean): void;
  /** The server's clock (ms): day and night go by it. */
  now(): number;
}

export interface TownWorld {
  setWorld(world: IdleWorld): void;
  /** Players online, each as their own NPC; `me` gets a yellow name tag. */
  setPeople(people: IdlePerson[], me: string | null): void;
  /** The newcomer waiting for the vote, if any. */
  setNewcomer(name: string | null): void;
  built(b: PlacedBuilding): void;
  cheer(): void;
  celebrate(): void;
  /** Enemies: seen coming, beaten or not (the building they set on fire). */
  raid(stage: RaidStage, damaged?: number): void;
  select(id: number | null): void;
  /** Ring a villager, or none. */
  selectVillager(id: string | null): void;
  /** What a villager is up to, or null if they're gone. */
  villager(id: string): VillagerInfo | null;
  /** Someone chose what this villager gathers (shown before the server confirms). */
  setGather(id: string, g: Gather | null): void;
  focus(b: PlacedBuilding): void;
  /** Move the view to a tile. */
  lookAt(x: number, y: number): void;
  recenter(): void;
  /** Placing mode: every click picks a tile, the hovered one shows green/red by `ok`. Null ends it. */
  setPlacing(ok: ((x: number, y: number) => boolean) | null, type?: string): void;
  /** Outline a tile (the build popup's), or none. */
  mark(tile: { x: number; y: number } | null): void;
  /** What a running vote would do, shown in the town (a see-through building, marked tiles). */
  setGhost(action: ProposalAction | null): void;
  /** Drawing paths: drags paint tiles, the hovered one shows green/red by `ok`. Null ends it. */
  setPainting(ok: ((x: number, y: number) => boolean) | null): void;
  /** The tiles drawn so far: new path (green) or path to remove (red). */
  setDraft(draft: { tiles: Iterable<number>; erase: boolean } | null): void;
}

interface Float {
  wx: number;
  wy: number;
  text: string;
  color: string;
  born: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  born: number;
  life: number;
  size: number;
}

export function createWorld(opts: WorldOptions): TownWorld {
  const { canvas } = opts;
  const ctx = canvas.getContext("2d")!;
  const cam = new Camera();
  const pop = new Population();
  const wild = new Wildlife();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let world: IdleWorld | null = null;
  let roads = new Set<string>();
  /** The streets as text, so the far-away picture is redrawn when they change (paths clear nature, bridges cross water). */
  let roadsKey = "";
  let wallsKey = "";
  let roadLevel = 0;
  /** Wall tiles, as "x,y", and which of them are gates. */
  let walls = new Set<string>();
  let gates = new Set<string>();
  /** The way the raiders come, and how far along it each tile is (0..1, by effort: climbing a wall is slow). */
  let raidPath: { key: string; tiles: { x: number; y: number }[]; at: number[] } | null = null;
  /** Screen shake: 0..1, decaying; the shake is its square, so small knocks barely move. */
  let trauma = 0;
  /** Buildings that just went up, by id: when (performance.now()), for their pop. */
  const born = new Map<number, number>();
  const POP_MS = 450;

  /** A new building pops up: squashed, then springing past its height and settling (volume kept). */
  function popScale(id: number, t: number): { x: number; y: number } | null {
    const at = born.get(id);
    if (at === undefined) return null;
    const p = (t - at) / POP_MS;
    if (p >= 1 || reducedMotion.matches) {
      born.delete(id);
      return null;
    }
    const c1 = 1.70158;
    const back = 1 + (c1 + 1) * (p - 1) ** 3 + c1 * (p - 1) ** 2;
    const y = 0.3 + 0.7 * back;
    return { x: 1 + (1 - y) * 0.5, y };
  }
  let landCache: { key: string; canvas: HTMLCanvasElement } | null = null;
  // The far-away picture drawn before the sprites were there is redrawn with them.
  void spritesLoaded().then(() => {
    landCache = null;
    clearBaked();
  });
  /** Used-up nature, as "x,y" (redrawn from scratch when it changes). */
  let usedUp = new Set<string>();
  let usedUpKey = "";
  let selected: number | null = null;
  let selectedVillager: string | null = null;
  let placing: ((x: number, y: number) => boolean) | null = null;
  /** What's being placed: a big building shows all its tiles under the pointer. */
  let placingType: string | null = null;
  let hover: { x: number; y: number } | null = null;
  /** The hovered tile is free land: a click opens the build popup there (outlined on top, also behind buildings). */
  let hoverLand = false;
  let marked: { x: number; y: number } | null = null;
  let ghost: ProposalAction | null = null;
  let painting: ((x: number, y: number) => boolean) | null = null;
  let draft: { tiles: Iterable<number>; erase: boolean } | null = null;
  const floats: Float[] = [];
  const particles: Particle[] = [];

  /** Look at a tile: a bit below the middle of the screen, clear of the counter bar. */
  const lookAt = (x: number, y: number) => {
    const c = toWorld(x + 0.5, y + 0.5);
    cam.x = c.x;
    cam.y = c.y - (window.innerHeight * 0.06) / cam.zoom;
  };
  const recenter = () => {
    cam.zoom = window.innerWidth < 600 ? 1 : 1.5;
    lookAt(CENTER.x, CENTER.y);
  };
  recenter();

  // ---------- effects ----------

  function burst(wx: number, wy: number, color: string, n: number, speed: number, life: number): void {
    if (reducedMotion.matches) return;
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x: wx, y: wy, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.6, color, born: now, life, size: 2 + Math.random() * 2 });
    }
  }

  function floatText(wx: number, wy: number, text: string, color: string): void {
    floats.push({ wx, wy, text, color, born: performance.now() });
    if (floats.length > 40) floats.shift();
  }

  /** Nature was clicked: the villagers gather it, say so. */
  function showNature(resource: ResourceId, x: number, y: number): void {
    const p = toWorld(x + 0.5, y + 0.5);
    floatText(p.x, p.y - 20, `${resourceDef(resource)?.emoji ?? ""} dorpelingen zonder werk verzamelen dit`, RESOURCE_COLORS[resource] ?? "#fff");
  }

  // ---------- input ----------

  const pointers = new Map<number, { x: number; y: number }>();
  let downAt: { x: number; y: number } | null = null;
  let moved = false;
  let pinchDist = 0;
  let pinchMid: { x: number; y: number } | null = null;
  /** The last tile of the paint stroke under way, if any. */
  let stroke: { x: number; y: number } | null = null;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  canvas.addEventListener("pointerdown", (e) => {
    const p = local(e);
    pointers.set(e.pointerId, p);
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      downAt = p;
      moved = false;
      if (painting && e.button === 0) {
        stroke = tileAt(p.x, p.y);
        opts.onPaint(stroke.x, stroke.y, true);
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      moved = true;
      stroke = null;
    }
  });
  canvas.addEventListener("contextmenu", (e) => {
    if (painting) e.preventDefault();
  });

  /** Paint every tile on the line from the stroke's last tile to this one, so fast drags leave no gaps. */
  function paintTo(t: { x: number; y: number }): void {
    if (!stroke || (t.x === stroke.x && t.y === stroke.y)) return;
    const from = stroke;
    const steps = Math.max(Math.abs(t.x - from.x), Math.abs(t.y - from.y));
    for (let i = 1; i <= steps; i++) {
      opts.onPaint(Math.round(from.x + ((t.x - from.x) * i) / steps), Math.round(from.y + ((t.y - from.y) * i) / steps), false);
    }
    stroke = t;
  }

  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    const prev = pointers.get(e.pointerId);
    if (!prev) {
      hover = tileAt(p.x, p.y);
      const h = placing || painting ? undefined : hit(p.x, p.y);
      hoverLand = h === null && isFreeLand(hover.x, hover.y);
      canvas.style.cursor = placing || painting ? "crosshair" : h && h.kind !== "nature" ? "pointer" : "grab";
      return;
    }
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinchDist > 0) cam.zoomAt(d / pinchDist, mid.x, mid.y);
      if (pinchMid) cam.pan(mid.x - pinchMid.x, mid.y - pinchMid.y);
      pinchDist = d;
      pinchMid = mid;
      return;
    }
    if (stroke) {
      hover = tileAt(p.x, p.y);
      paintTo(hover);
      return;
    }
    if (downAt && Math.hypot(p.x - downAt.x, p.y - downAt.y) > DRAG_THRESHOLD) moved = true;
    if (moved) {
      cam.pan(p.x - prev.x, p.y - prev.y);
      canvas.style.cursor = "grabbing";
    }
  });

  const end = (e: PointerEvent) => {
    const p = local(e);
    if (pointers.size === 1 && !moved && pointers.has(e.pointerId)) click(p.x, p.y);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      pinchDist = 0;
      pinchMid = null;
    }
    if (pointers.size === 0) {
      downAt = null;
      stroke = null;
      canvas.style.cursor = painting ? "crosshair" : "grab";
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    hoverLand = false;
  });
  canvas.addEventListener("pointercancel", (e) => {
    pointers.delete(e.pointerId);
    moved = true;
    stroke = null;
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = local(e);
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
      // A mouse wheel turns in big steps; a touchpad (and pinching, which comes as ctrl+wheel) sends many small ones.
      const speed = e.ctrlKey ? 0.012 : e.deltaMode === 0 && Math.abs(dy) < 50 ? 0.006 : 0.0015;
      cam.zoomAt(Math.exp(Math.max(-0.5, Math.min(0.5, -dy * speed))), p.x, p.y);
    },
    { passive: false },
  );

  type Hit =
    | { kind: "villager"; id: string }
    | { kind: "building"; b: PlacedBuilding }
    | { kind: "nature"; resource: ResourceId; x: number; y: number };

  function tileAt(px: number, py: number): { x: number; y: number } {
    const w = cam.screenToWorld(px, py);
    const t = toTileSpace(w.x, w.y);
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  }

  function hit(px: number, py: number): Hit | null {
    const w = cam.screenToWorld(px, py);
    // Villagers first: they're small and on top.
    let best: { id: string; d: number } | null = null;
    for (const v of pop.villagers.values()) {
      if (v.hidden) continue;
      const p = toWorld(v.x + 0.5 + v.ox, v.y + 0.5 + v.oy);
      const d = Math.hypot(p.x - w.x, p.y - 8 - w.y);
      if (d < 8 && (!best || d < best.d)) best = { id: v.id, d };
    }
    if (best) return { kind: "villager", id: best.id };
    // What stands on the tile under the pointer comes first…
    const t = toTileSpace(w.x, w.y);
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    const own = world ? buildingOn(world.buildings, tx, ty) : undefined;
    if (own) return { kind: "building", b: own };
    const natureHit = (x: number, y: number): Hit | null => {
      const res = roads.has(`${x},${y}`) ? null : natureAt(x, y, world?.era ?? 0, world?.nature);
      return res ? { kind: "nature", resource: res, x, y } : null;
    };
    const here = natureHit(tx, ty);
    if (here) return here;
    // …then free land, even behind a building or a tree that sticks up over it (2.5D): that tile gets the click.
    if (isFreeLand(tx, ty)) return null;
    // Anything else (water, the mountain): the building or tree drawn over it, front-most first.
    const bs = [...(world?.buildings ?? [])].sort((a, b) => depthOf(b) - depthOf(a));
    for (const b of bs) {
      const r = buildingBounds(b);
      if (w.x >= r.x1 && w.x <= r.x2 && w.y >= r.y1 && w.y <= r.y2) return { kind: "building", b };
    }
    return natureHit(tx + 1, ty + 1);
  }

  /** Land the build popup opens for: grass, sand, or a street or bridge. */
  const isFreeLand = (x: number, y: number) => ["grass", "sand"].includes(terrainAt(x, y)) || roads.has(`${x},${y}`);

  function click(px: number, py: number): void {
    if (painting) return;
    if (placing) {
      const t = tileAt(px, py);
      opts.onTile(t.x, t.y, px, py);
      return;
    }
    const h = hit(px, py);
    if (!h) {
      select(null);
      opts.onSelect(null);
      const t = tileAt(px, py);
      opts.onTile(t.x, t.y, px, py);
      return;
    }
    if (h.kind === "villager") {
      const v = pop.villagers.get(h.id);
      if (v) pop.introduce(v, Date.now());
      opts.onVillager(h.id);
    } else if (h.kind === "building") {
      select(h.b.id);
      opts.onSelect(h.b);
    } else {
      showNature(h.resource, h.x, h.y);
    }
  }

  // ---------- the land ----------

  /**
   * Ground (batched by color) plus nature props as depth-sorted items. With
   * `live` the water shimmers, trees sway and streets show; the cached
   * far-away picture is drawn without.
   */
  function drawLand(
    g: CanvasRenderingContext2D,
    x0: number, x1: number, y0: number, y1: number,
    era: number, t: number, items: { d: number; f: () => void }[], live: boolean,
  ): void {
    const paths = new Map<string, Path2D>();
    const bridges: [number, number][] = [];
    const tufts = new Path2D();
    const flowers = new Path2D();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const terrain = terrainAt(x, y);
        const paved = roads.has(`${x},${y}`);
        const road = live && paved && terrain !== "water";
        const c = toWorld(x + 0.5, y + 0.5);
        // Pixel-art ground where there is a sprite for it (sand and streets stay a color);
        // a forest floor is a bit darker.
        const wet = terrain === "water" || terrain === "bridge";
        const tile = road || terrain === "sand" || wet ? null : variant("grass", rand2(x, y, 60));
        let sprite = wet ? drawWaterTile(g, x, y, c.x, c.y, live ? t : null, terrainAt) : tile !== null && drawSprite(g, tile, c.x, c.y);
        if (sprite && !paved && (terrain === "grass" || terrain === "bush")) drawFlowers(g, x, y, c.x, c.y, era);
        if (!sprite && live && (road || terrain === "sand")) {
          // Streets and sand as pixel-art tiles too: the color with grain and the street's stones.
          const v = Math.floor(rand2(x, y, 62) * 4);
          const color = groundColor(road ? "grass" : "sand", v, 0, era, road ? roadLevel : null);
          const o = toWorld(v + 0.5, 0.5);
          drawBaked(g, `g${color}|${road ? roadLevel : -1}|${v}`, c.x, c.y, { left: TILE_W / 2 + 1, right: TILE_W / 2 + 1, up: TILE_H / 2 + 1, down: TILE_H / 2 + 1 }, o.x, o.y, (h) => {
            const top = toWorld(v, 0);
            h.fillStyle = color;
            h.beginPath();
            h.moveTo(top.x, top.y - 1);
            h.lineTo(top.x + TILE_W / 2 + 1, top.y + TILE_H / 2);
            h.lineTo(top.x, top.y + TILE_H + 1);
            h.lineTo(top.x - TILE_W / 2 - 1, top.y + TILE_H / 2);
            h.fill();
            if (road) drawRoadDetail(h, v, 0, roadLevel, 0);
          }, false);
          sprite = true;
        }
        let color = sprite ? (terrain === "forest" ? "rgba(20,45,15,0.22)" : null) : groundColor(terrain, x, y, era, road ? roadLevel : null);
        if (!sprite && live && wet && Math.sin(t / 900 + x * 0.8 + y * 0.5) > 0.75) color = "#3b7fc4";
        if (color) {
          let path = paths.get(color);
          if (!path) paths.set(color, (path = new Path2D()));
          const top = toWorld(x, y);
          path.moveTo(top.x, top.y);
          path.lineTo(top.x + TILE_W / 2, top.y + TILE_H / 2);
          path.lineTo(top.x, top.y + TILE_H);
          path.lineTo(top.x - TILE_W / 2, top.y + TILE_H / 2);
          path.closePath();
        }

        const d = x + y + 1;
        if (!sprite && !paved && (terrain === "grass" || terrain === "bush")) grassDetail(tufts, flowers, x, y, era);
        // A path cleared the nature here, or crosses the river as a bridge.
        if (paved) {
          if (terrain === "water") bridges.push([c.x, c.y]);
          continue;
        }
        if (usedUp.has(`${x},${y}`)) {
          if (terrain === "forest" || terrain === "rock") items.push({ d, f: () => drawUsedUp(g, c.x, c.y, x, y, terrain) });
          else if (terrain === "bush") items.push({ d, f: () => drawBush(g, c.x, c.y, x, y, true) });
          else if (terrain === "deposit") items.push({ d, f: () => drawRock(g, c.x, c.y, x, y) });
          continue;
        }
        switch (terrain) {
          case "forest":
            items.push({ d, f: () => drawTree(g, c.x, c.y, x, y, era, live ? t : 0) });
            break;
          case "rock":
            items.push({ d, f: () => drawRock(g, c.x, c.y, x, y) });
            break;
          case "mountain":
            items.push({ d, f: () => drawMountain(g, c.x, c.y, x, y) });
            break;
          case "bush":
            items.push({ d, f: () => drawBush(g, c.x, c.y, x, y) });
            break;
          case "bridge":
            bridges.push([c.x, c.y]);
            break;
          case "deposit": {
            const dep = DEPOSITS.find((p) => p.x === x && p.y === y);
            if (dep && dep.era <= era) items.push({ d, f: () => drawDeposit(g, c.x, c.y, x, y, t) });
            else items.push({ d, f: () => drawRock(g, c.x, c.y, x, y) });
            break;
          }
        }
      }
    }
    for (const [color, path] of paths) {
      g.fillStyle = color;
      g.fill(path);
    }
    g.strokeStyle = shade(ERAS[era].style.grass, -0.28);
    g.lineWidth = 1;
    g.stroke(tufts);
    g.fillStyle = era <= 1 ? "#f5e9a8" : "#f9a8d4";
    g.fill(flowers);
    for (const [bx, by] of bridges) drawBridge(g, bx, by);
  }

  /** The whole map's landscape, drawn once per era for zoomed-out views. */
  function renderLand(era: number, key: string): { key: string; canvas: HTMLCanvasElement } {
    const c = document.createElement("canvas");
    c.width = Math.ceil(MAP_SIZE * TILE_W * LAND_SCALE);
    c.height = Math.ceil((MAP_SIZE * TILE_H - LAND_TOP) * LAND_SCALE);
    const g = c.getContext("2d")!;
    g.setTransform(LAND_SCALE, 0, 0, LAND_SCALE, -LAND_LEFT * LAND_SCALE, -LAND_TOP * LAND_SCALE);
    const items: { d: number; f: () => void }[] = [];
    drawLand(g, 0, MAP_SIZE - 1, 0, MAP_SIZE - 1, era, 0, items, false);
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.f();
    if (hover && hoverLand && !placing && !painting && !draft) {
      ctx.setLineDash([4 / cam.zoom, 3 / cam.zoom]);
      outline(hover.x, hover.y, "#ffffff");
      ctx.setLineDash([]);
    }
    return { key, canvas: c };
  }

  // ---------- drawing ----------

  function resize(): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    cam.width = w;
    cam.height = h;
    return dpr;
  }

  /**
   * Where the raiders are, `k` (0..1) of the way through their march: along the
   * path they'd take, by effort, stopping before the first wall (or at 80% of the way).
   */
  function raidSpot(from: { x: number; y: number }, k: number): { x: number; y: number } {
    const key = `${from.x},${from.y}|${wallsKey}`;
    if (raidPath?.key !== key) {
      const tiles = findPath(from, CENTER, RAID_CLIMB) ?? [from, CENTER];
      const cost = tiles.map((p, i): number => (i === 0 ? 0 : walls.has(`${p.x},${p.y}`) && !gates.has(`${p.x},${p.y}`) ? RAID_CLIMB : 1));
      const total = cost.reduce((a, c) => a + c, 0) || 1;
      let sum = 0;
      raidPath = { key, tiles, at: cost.map((c) => (sum += c) / total) };
    }
    const { tiles, at } = raidPath;
    const wall = tiles.findIndex((p) => walls.has(`${p.x},${p.y}`));
    const stop = wall > 0 ? at[wall - 1] : 0.8;
    const want = k * stop;
    const i = Math.max(1, at.findIndex((a) => a >= want));
    const a = tiles[i - 1];
    const b = tiles[Math.min(i, tiles.length - 1)];
    const f = at[i] > at[i - 1] ? Math.max(0, Math.min(1, (want - at[i - 1]) / (at[i] - at[i - 1]))) : 0;
    return { x: a.x + (b.x - a.x) * f + 0.5, y: a.y + (b.y - a.y) * f + 0.5 };
  }

  function draw(t: number): void {
    const dpr = resize();
    const era = world?.era ?? 0;
    const now = Date.now();
    const serverNow = opts.now();
    cam.clamp(MAP_SIZE);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#1d4f86";
    ctx.fillRect(0, 0, cam.width, cam.height);
    const z = cam.zoom * dpr;
    // Shake only the picture, never the camera itself (clicks keep landing where they should).
    const sh = reducedMotion.matches ? 0 : trauma * trauma;
    const sx = sh * 10 * Math.sin(t / 23);
    const sy = sh * 6 * Math.sin(t / 31 + 1);
    ctx.setTransform(z, 0, 0, z, dpr * (cam.width / 2 - cam.x * cam.zoom + sx), dpr * (cam.height / 2 - cam.y * cam.zoom + sy));

    // Visible tile range (with margin for tall things below the screen edge).
    const corners = [[0, 0], [cam.width, 0], [0, cam.height], [cam.width, cam.height]].map(([x, y]) => {
      const w = cam.screenToWorld(x, y);
      return toTileSpace(w.x, w.y);
    });
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))) - 1);
    const x1 = Math.min(MAP_SIZE - 1, Math.ceil(Math.max(...corners.map((c) => c.x))) + 3);
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))) - 1);
    const y1 = Math.min(MAP_SIZE - 1, Math.ceil(Math.max(...corners.map((c) => c.y))) + 3);

    const items: { d: number; f: () => void }[] = [];
    if (cam.zoom >= FAR_ZOOM) {
      drawLand(ctx, x0, x1, y0, y1, era, t, items, true);
    } else {
      // Zoomed out: the whole landscape as one pre-drawn picture, plus the streets.
      const key = `${era}|${usedUpKey}|${roadsKey}`;
      if (!landCache || landCache.key !== key) landCache = renderLand(era, key);
      const { canvas: img } = landCache;
      ctx.drawImage(img, LAND_LEFT, LAND_TOP, img.width / LAND_SCALE, img.height / LAND_SCALE);
      for (const key of roads) {
        const [x, y] = key.split(",").map(Number);
        if (x < x0 || x > x1 || y < y0 || y > y1 || terrainAt(x, y) === "water") continue;
        const top = toWorld(x, y);
        ctx.fillStyle = groundColor("grass", x, y, era, roadLevel);
        ctx.beginPath();
        ctx.moveTo(top.x, top.y);
        ctx.lineTo(top.x + TILE_W / 2, top.y + TILE_H / 2);
        ctx.lineTo(top.x, top.y + TILE_H);
        ctx.lineTo(top.x - TILE_W / 2, top.y + TILE_H / 2);
        ctx.fill();
      }
    }

    // Tile outlines under everything standing: a vote's tiles (yellow, red to remove), the
    // paths being drawn, placing or painting (green/red), the build popup's tile (yellow).
    if (ghost?.kind === "paths" || ghost?.kind === "unpave" || ghost?.kind === "walls" || ghost?.kind === "unwall" || ghost?.kind === "gate") {
      for (const i of ghost.tiles) outline(tileOf(i).x, tileOf(i).y, ghost.kind === "unpave" || ghost.kind === "unwall" ? "#ff3b3b" : "#ffe82e");
    }
    if (ghost?.kind === "repair") {
      const id = ghost.building;
      const b = world?.buildings.find((x) => x.id === id);
      if (b) outline(b.x, b.y, "#ffe82e");
    }
    if (ghost?.kind === "demolish") {
      const id = ghost.building;
      const b = world?.buildings.find((x) => x.id === id);
      if (b) outline(b.x, b.y, "#ff3b3b");
    }
    if (draft) for (const i of draft.tiles) outline(tileOf(i).x, tileOf(i).y, draft.erase ? "#ff3b3b" : "#b6ff2e");
    const ok = placing ?? painting;
    if (ok && hover) {
      const color = ok(hover.x, hover.y) ? "#b6ff2e" : "#ff3b3b";
      const tiles = placing && placingType ? tilesOf({ type: placingType, level: era, x: hover.x, y: hover.y }) : [hover];
      for (const p of tiles) outline(p.x, p.y, color);
    }
    if (marked) outline(marked.x, marked.y, "#ffe82e");

    for (const b of world?.buildings ?? []) {
      if (b.x < x0 - 1 || b.x > x1 || b.y < y0 - 1 || b.y > y1) continue;
      items.push({
        d: depthOf(b) + 1.01,
        f: () => {
          const k = popScale(b.id, t);
          if (!k) return drawBuilding(ctx, b, t, b.id === selected);
          const c = toWorld(middleOf(b).x, middleOf(b).y);
          ctx.save();
          ctx.translate(c.x, c.y);
          ctx.scale(k.x, k.y);
          ctx.translate(-c.x, -c.y);
          drawBuilding(ctx, b, t, b.id === selected);
          ctx.restore();
        },
      });
    }
    for (const key of walls) {
      const [x, y] = key.split(",").map(Number);
      if (x < x0 - 1 || x > x1 || y < y0 - 1 || y > y1) continue;
      const links = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(([dx, dy]) => walls.has(`${x + dx},${y + dy}`));
      const c = toWorld(x + 0.5, y + 0.5);
      const gate = gates.has(key);
      items.push({ d: x + y + 1.005, f: () => drawWall(ctx, c.x, c.y, world?.wallLevel ?? 0, links, t, gate) });
    }
    const raid = world?.raid;
    const lights: Light[] = [];
    if (raid) {
      // They march from the edge of the map towards the town (through a gate, or over the
      // wall, which is slow), and wait just outside the wall or the town.
      const k = Math.max(0, Math.min(1, 1 - (raid.at - serverNow) / RAID_WARNING_MS));
      const { x: fx, y: fy } = raidSpot(raid.from, k);
      const p = toWorld(fx, fy);
      const n = Math.max(3, Math.min(12, Math.round(raid.strength / 8)));
      items.push({ d: fx + fy + 0.03, f: () => drawRaiders(ctx, p.x, p.y, n, era, t) });
      lights.push({ x: p.x, y: p.y - 10, r: 36, kind: "fire", seed: 3 });
    }
    for (const d of world?.drops ?? []) {
      if (d.x < x0 - 1 || d.x > x1 || d.y < y0 - 1 || d.y > y1) continue;
      items.push({ d: d.x + d.y + 1.01, f: () => drawDrop(ctx, d.x, d.y, t) });
    }
    if (ghost?.kind === "build") {
      const g = { id: -1, type: ghost.type, level: era, x: ghost.x, y: ghost.y };
      for (const p of tilesOf(g)) outline(p.x, p.y, "#ffe82e");
      items.push({
        d: depthOf(g) + 1.01,
        f: () => {
          ctx.globalAlpha = 0.45 + 0.15 * Math.sin(t / 250);
          drawBuilding(ctx, g, t, false);
          ctx.globalAlpha = 1;
        },
      });
    }
    for (const a of wild.animals.values()) {
      if (a.x < x0 - 1 || a.x > x1 || a.y < y0 - 1 || a.y > y1) continue;
      const fx = a.x + 0.5 + a.ox;
      const fy = a.y + 0.5 + a.oy;
      const p = toWorld(fx, fy);
      const look = wild.look(a, now);
      items.push({ d: fx + fy, f: () => drawAnimal(ctx, p.x, p.y, look) });
    }
    const bubbles: [number, number, string][] = [];
    const tags: [number, number, string, boolean][] = [];
    for (const v of pop.villagers.values()) {
      if (v.hidden || v.x < x0 - 1 || v.x > x1 || v.y < y0 - 1 || v.y > y1) continue;
      const fx = v.x + 0.5 + v.ox;
      const fy = v.y + 0.5 + v.oy;
      const p = toWorld(fx, fy);
      const look = pop.look(v, now);
      const ringed = v.id === selectedVillager;
      items.push({
        d: fx + fy + 0.02,
        f: () => {
          if (ringed) {
            ctx.beginPath();
            ctx.ellipse(p.x, p.y + 1, 8, 4, 0, 0, Math.PI * 2);
            ctx.strokeStyle = "#ffe82e";
            ctx.lineWidth = 2 / cam.zoom;
            ctx.stroke();
          }
          if (v.player) {
            // Players stand out from the townsfolk: a glow on the ground and a bit taller.
            ctx.beginPath();
            ctx.ellipse(p.x, p.y + 1, 7, 3.5, 0, 0, Math.PI * 2);
            ctx.fillStyle = v.player.mine ? "rgba(255,232,46,0.45)" : "rgba(34,240,255,0.4)";
            ctx.fill();
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.scale(PLAYER_SCALE, PLAYER_SCALE);
            drawVillager(ctx, 0, 0, look);
            ctx.restore();
          } else drawVillager(ctx, p.x, p.y, look);
        },
      });
      if (v.bubble) bubbles.push([p.x, p.y, v.bubble.text]);
      if (v.player) tags.push([p.x, p.y, v.player.name, v.player.mine]);
    }
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.f();
    if (hover && hoverLand && !placing && !painting && !draft) {
      ctx.setLineDash([4 / cam.zoom, 3 / cam.zoom]);
      outline(hover.x, hover.y, "#ffffff");
      ctx.setLineDash([]);
    }

    // The night, with the lights of the town (and a lantern for every player).
    const dark = darknessAt(serverNow);
    if (dark > 0) {
      for (const b of world?.buildings ?? []) buildingLights(b, lights);
      streetLights(roads, era, lights);
      for (const v of pop.villagers.values()) {
        if (v.player) {
          const p = toWorld(v.x + 0.5 + v.ox, v.y + 0.5 + v.oy);
          lights.push({ x: p.x, y: p.y - 8, r: 26, kind: "lantern", seed: 0 });
        }
      }
      drawNight(ctx, cam, dpr, dark, lights, t);
      ctx.setTransform(z, 0, 0, z, dpr * (cam.width / 2 - cam.x * cam.zoom + sx), dpr * (cam.height / 2 - cam.y * cam.zoom + sy));
    }

    for (const [x, y, name, mine] of tags) drawNameTag(ctx, x, y, name, mine);
    for (const [x, y, text] of bubbles) drawBubble(ctx, x, y, text);

    // Particles and floating "+n".
    const pt = performance.now();
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      const age = (pt - p.born) / 1000;
      if (age * 1000 > p.life) {
        particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = 1 - (age * 1000) / p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x + p.vx * age - p.size / 2, p.y + p.vy * age + 120 * age * age - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.font = "bold 13px system-ui, sans-serif";
    ctx.textAlign = "center";
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      const age = (pt - f.born) / 1200;
      if (age > 1) {
        floats.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = 1 - age;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = 3;
      ctx.strokeText(f.text, f.wx, f.wy - age * 30);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.wx, f.wy - age * 30);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  }

  function outline(x: number, y: number, color: string): void {
    const top = toWorld(x, y);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x + TILE_W / 2, top.y + TILE_H / 2);
    ctx.lineTo(top.x, top.y + TILE_H);
    ctx.lineTo(top.x - TILE_W / 2, top.y + TILE_H / 2);
    ctx.closePath();
    ctx.fillStyle = `${color}40`;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / cam.zoom;
    ctx.stroke();
  }

  // ---------- loop ----------

  let raf = 0;
  let last = performance.now();
  const frame = (t: number) => {
    raf = 0;
    if (document.hidden) return;
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    trauma = Math.max(0, trauma - dt * 0.9);
    pop.update(dt, Date.now(), isNight(opts.now()));
    wild.update(dt, Date.now());
    draw(t);
    raf = requestAnimationFrame(frame);
  };
  const start = () => {
    if (!raf && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  document.addEventListener("visibilitychange", start);
  start();

  function select(id: number | null): void {
    selected = id;
  }

  function selectVillager(id: string | null): void {
    selectedVillager = id;
  }

  return {
    selectVillager,
    villager(id) {
      const v = pop.villagers.get(id);
      return v ? pop.describe(v, Date.now()) : null;
    },
    setGather(id, g) {
      const v = pop.villagers.get(id);
      if (v) pop.setGather(v, g, Date.now());
    },
    setWorld(w) {
      let changed =
        !world || world.buildings !== w.buildings || world.gatherers !== w.gatherers || Math.floor(world.population) !== Math.floor(w.population);
      let forests = !world;
      const streets = w.roads.join(",");
      if (streets !== roadsKey) {
        forests = true;
        roadsKey = streets;
        roads = new Set(w.roads.map((i) => `${tileOf(i).x},${tileOf(i).y}`));
        // Work spots under a new path move elsewhere.
        changed = true;
      }
      const fence = `${w.walls.join(",")}|${w.gates.join(",")}`;
      if (fence !== wallsKey) {
        wallsKey = fence;
        changed = true;
      }
      if (changed) setTown(w.buildings, w.roads, w.walls, w.gates);
      world = w;
      roadLevel = w.roadLevel;
      walls = new Set(w.walls.map((i) => `${tileOf(i).x},${tileOf(i).y}`));
      gates = new Set(w.gates.map((i) => `${tileOf(i).x},${tileOf(i).y}`));
      // Which tiles are used up only changes when a patch crosses a tile's worth.
      const all = patches();
      const key = Object.entries(w.nature)
        .map(([id, n]) => `${id}:${goneTiles(all[Number(id)], n)}`)
        .filter((k) => !k.endsWith(":0"))
        .join(",");
      if (key !== usedUpKey) {
        forests = true;
        usedUpKey = key;
        usedUp = new Set();
        for (const [id, n] of Object.entries(w.nature)) {
          const p = all[Number(id)];
          for (const t of p.tiles.slice(0, goneTiles(p, n))) usedUp.add(`${t.x},${t.y}`);
        }
      }
      if (changed) pop.sync(w, Date.now());
      if (forests) wild.sync(w, Date.now());
    },
    setPeople(people, me) {
      pop.setPeople(people, me, Date.now());
    },
    setNewcomer(name) {
      pop.setNewcomer(name, Date.now());
    },
    built(b) {
      born.set(b.id, performance.now());
      const p = toWorld(middleOf(b).x, middleOf(b).y);
      burst(p.x, p.y - 10, "#d6c8a8", 24, 70, 1100);
      floatText(p.x, p.y - 40, "🎉", "#ffe82e");
    },
    cheer() {
      pop.cheer(Date.now());
    },
    raid(stage, damaged) {
      trauma = Math.min(1, trauma + (stage === "lost" ? 0.9 : stage === "won" ? 0.4 : 0.3));
      const b = damaged === undefined ? undefined : world?.buildings.find((x) => x.id === damaged);
      if (b) {
        const p = toWorld(middleOf(b).x, middleOf(b).y);
        burst(p.x, p.y - 16, "#f97316", 30, 90, 1400);
        burst(p.x, p.y - 16, "#3f3f46", 20, 50, 1800);
      }
      if (stage === "won") pop.cheer(Date.now());
    },
    celebrate() {
      const c = toWorld(CENTER.x + 0.5, CENTER.y + 0.5);
      const colors = ["#ff2fb3", "#ffe82e", "#b6ff2e", "#22f0ff", "#a35bff"];
      for (let i = 0; i < 8; i++) {
        window.setTimeout(() => {
          burst(c.x + (Math.random() - 0.5) * 400, c.y - 120 - Math.random() * 120, colors[i % colors.length], 40, 160, 1600);
        }, i * 350);
      }
      pop.cheer(Date.now());
    },
    select,
    focus(b) {
      lookAt(b.x, b.y);
      select(b.id);
    },
    lookAt,
    recenter,
    setPlacing(ok, type) {
      placing = ok;
      placingType = type ?? null;
      canvas.style.cursor = ok ? "pointer" : "grab";
    },
    mark(tile) {
      marked = tile;
    },
    setGhost(action) {
      ghost = action;
    },
    setPainting(ok) {
      painting = ok;
      stroke = null;
      canvas.style.cursor = ok ? "crosshair" : "grab";
    },
    setDraft(d) {
      draft = d;
    },
  };
}
