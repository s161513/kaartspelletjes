// The town as a full-screen isometric canvas under the counter bar: terrain,
// nature, buildings and villagers, depth-sorted every frame. Drag to look
// around, wheel or pinch to zoom, click nature to gather, click a building to
// inspect it, click free land to build, click a villager to say hi. While
// drawing paths, dragging paints tiles instead (pan with the right mouse
// button or two fingers).

import {
  CENTER,
  DEPOSITS,
  MAP_SIZE,
  goneTiles,
  patches,
  clickAmount as clickAmountFor,
  natureAt,
  resourceDef,
  terrainAt,
  tileOf,
  type IdlePerson,
  type IdleWorld,
  type PlacedBuilding,
  type ProposalAction,
  type ResourceId,
} from "@app/shared/idle";
import {
  RESOURCE_COLORS,
  buildingBounds,
  drawBridge,
  drawBubble,
  drawBuilding,
  drawBush,
  drawDeposit,
  drawMountain,
  drawNameTag,
  drawRoadDetail,
  drawRock,
  drawUsedUp,
  drawTree,
  drawVillager,
  groundColor,
} from "./draw";
import { Camera, TILE_H, TILE_W, toTileSpace, toWorld } from "./iso";
import { Population } from "./villagers";

const DRAG_THRESHOLD = 6;
const MAX_PARTICLES = 400;
/** Below this zoom the landscape comes from a pre-drawn picture instead of being drawn every frame. */
const FAR_ZOOM = 0.75;
/** Resolution of that picture, and the world area it covers (mountains stick out above row 0). */
const LAND_SCALE = 0.6;
const LAND_LEFT = -(MAP_SIZE * TILE_W) / 2;
const LAND_TOP = -80;

export interface WorldOptions {
  canvas: HTMLCanvasElement;
  /** Nature was clicked; the world already showed the effect. */
  onGather(resource: ResourceId, x: number, y: number): void;
  onSelect(building: PlacedBuilding | null): void;
  /** Land (no building, no nature) was clicked, or any tile while placing; screen point for a popup. */
  onTile(x: number, y: number, px: number, py: number): void;
  /** Drawing paths: the pointer touched this tile; `first` at the start of a stroke. */
  onPaint(x: number, y: number, first: boolean): void;
}

export interface TownWorld {
  setWorld(world: IdleWorld): void;
  /** Players online, each as their own NPC; `me` gets a yellow name tag. */
  setPeople(people: IdlePerson[], me: string | null): void;
  /** "+n" where someone (else) gathered. */
  showGather(resource: ResourceId, amount: number, x: number, y: number): void;
  built(b: PlacedBuilding): void;
  cheer(): void;
  celebrate(): void;
  select(id: number | null): void;
  focus(b: PlacedBuilding): void;
  recenter(): void;
  /** Placing mode: every click picks a tile, the hovered one shows green/red by `ok`. Null ends it. */
  setPlacing(ok: ((x: number, y: number) => boolean) | null): void;
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
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let world: IdleWorld | null = null;
  let roads = new Set<string>();
  let roadLevel = 0;
  let landCache: { key: string; canvas: HTMLCanvasElement } | null = null;
  /** Used-up nature, as "x,y" (redrawn from scratch when it changes). */
  let usedUp = new Set<string>();
  let usedUpKey = "";
  let selected: number | null = null;
  let placing: ((x: number, y: number) => boolean) | null = null;
  let hover: { x: number; y: number } | null = null;
  let marked: { x: number; y: number } | null = null;
  let ghost: ProposalAction | null = null;
  let painting: ((x: number, y: number) => boolean) | null = null;
  let draft: { tiles: Iterable<number>; erase: boolean } | null = null;
  let clickAmount = 1;
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

  function showGather(resource: ResourceId, amount: number, x: number, y: number): void {
    const p = toWorld(x + 0.5, y + 0.5);
    const def = resourceDef(resource);
    floatText(p.x, p.y - 20, `+${amount} ${def?.emoji ?? ""}`, RESOURCE_COLORS[resource] ?? "#fff");
    burst(p.x, p.y - 10, RESOURCE_COLORS[resource] ?? "#fff", 8, 90, 700);
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
      canvas.style.cursor = placing || painting ? "crosshair" : hit(p.x, p.y) ? "pointer" : "grab";
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
  canvas.addEventListener("pointerleave", () => (hover = null));
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
      cam.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
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
    // Buildings, front-most first.
    const bs = [...(world?.buildings ?? [])].sort((a, b) => b.x + b.y - (a.x + a.y));
    for (const b of bs) {
      const r = buildingBounds(b);
      if (w.x >= r.x1 && w.x <= r.x2 && w.y >= r.y1 && w.y <= r.y2) return { kind: "building", b };
    }
    // Nature: the tile under the pointer, or the one in front (trees stick up into this one).
    const t = toTileSpace(w.x, w.y);
    const tx = Math.floor(t.x);
    const ty = Math.floor(t.y);
    for (const [x, y] of [[tx + 1, ty + 1], [tx, ty]]) {
      const res = natureAt(x, y, world?.era ?? 0, world?.nature);
      if (res) return { kind: "nature", resource: res, x, y };
    }
    return null;
  }

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
    } else if (h.kind === "building") {
      select(h.b.id);
      opts.onSelect(h.b);
    } else {
      showGather(h.resource, clickAmount, h.x, h.y);
      opts.onGather(h.resource, h.x, h.y);
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
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const terrain = terrainAt(x, y);
        const road = live && roads.has(`${x},${y}`);
        let color = groundColor(terrain, x, y, era, road ? roadLevel : null);
        if (live && terrain === "water" && Math.sin(t / 900 + x * 0.8 + y * 0.5) > 0.75) color = "#3b7fc4";
        let path = paths.get(color);
        if (!path) paths.set(color, (path = new Path2D()));
        const top = toWorld(x, y);
        path.moveTo(top.x, top.y);
        path.lineTo(top.x + TILE_W / 2, top.y + TILE_H / 2);
        path.lineTo(top.x, top.y + TILE_H);
        path.lineTo(top.x - TILE_W / 2, top.y + TILE_H / 2);
        path.closePath();

        const c = toWorld(x + 0.5, y + 0.5);
        const d = x + y + 1;
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
    if (live) {
      for (const key of roads) {
        const [x, y] = key.split(",").map(Number);
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) drawRoadDetail(g, x, y, roadLevel, t);
      }
    }
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

  function draw(t: number): void {
    const dpr = resize();
    const era = world?.era ?? 0;
    const now = Date.now();
    cam.clamp(MAP_SIZE);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#1d4f86";
    ctx.fillRect(0, 0, cam.width, cam.height);
    const z = cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, dpr * (cam.width / 2 - cam.x * cam.zoom), dpr * (cam.height / 2 - cam.y * cam.zoom));

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
      const key = `${era}|${usedUpKey}`;
      if (!landCache || landCache.key !== key) landCache = renderLand(era, key);
      const { canvas: img } = landCache;
      ctx.drawImage(img, LAND_LEFT, LAND_TOP, img.width / LAND_SCALE, img.height / LAND_SCALE);
      for (const key of roads) {
        const [x, y] = key.split(",").map(Number);
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
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
    if (ghost?.kind === "paths" || ghost?.kind === "unpave") {
      for (const i of ghost.tiles) outline(tileOf(i).x, tileOf(i).y, ghost.kind === "paths" ? "#ffe82e" : "#ff3b3b");
    }
    if (ghost?.kind === "demolish") {
      const id = ghost.building;
      const b = world?.buildings.find((x) => x.id === id);
      if (b) outline(b.x, b.y, "#ff3b3b");
    }
    if (draft) for (const i of draft.tiles) outline(tileOf(i).x, tileOf(i).y, draft.erase ? "#ff3b3b" : "#b6ff2e");
    const ok = placing ?? painting;
    if (ok && hover) outline(hover.x, hover.y, ok(hover.x, hover.y) ? "#b6ff2e" : "#ff3b3b");
    if (marked) outline(marked.x, marked.y, "#ffe82e");

    for (const b of world?.buildings ?? []) {
      if (b.x < x0 - 1 || b.x > x1 || b.y < y0 - 1 || b.y > y1) continue;
      items.push({ d: b.x + b.y + 1.01, f: () => drawBuilding(ctx, b, t, b.id === selected) });
    }
    if (ghost?.kind === "build") {
      const g = { id: -1, type: ghost.type, level: era, x: ghost.x, y: ghost.y };
      items.push({
        d: g.x + g.y + 1.01,
        f: () => {
          ctx.globalAlpha = 0.45 + 0.15 * Math.sin(t / 250);
          drawBuilding(ctx, g, t, false);
          ctx.globalAlpha = 1;
        },
      });
    }
    const bubbles: [number, number, string][] = [];
    const tags: [number, number, string, boolean][] = [];
    for (const v of pop.villagers.values()) {
      if (v.hidden || v.x < x0 - 1 || v.x > x1 || v.y < y0 - 1 || v.y > y1) continue;
      const fx = v.x + 0.5 + v.ox;
      const fy = v.y + 0.5 + v.oy;
      const p = toWorld(fx, fy);
      const look = pop.look(v, now);
      items.push({ d: fx + fy + 0.02, f: () => drawVillager(ctx, p.x, p.y, look) });
      if (v.bubble) bubbles.push([p.x, p.y, v.bubble.text]);
      if (v.player) tags.push([p.x, p.y, v.player.name, v.player.mine]);
    }
    items.sort((a, b) => a.d - b.d);
    for (const it of items) it.f();

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
    pop.update(dt, Date.now());
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

  return {
    setWorld(w) {
      const changed = !world || world.buildings !== w.buildings;
      if (!world || world.roads !== w.roads) roads = new Set(w.roads.map((i) => `${tileOf(i).x},${tileOf(i).y}`));
      world = w;
      roadLevel = w.roadLevel;
      // Which tiles are used up only changes when a patch crosses a tile's worth.
      const all = patches();
      const key = Object.entries(w.nature)
        .map(([id, n]) => `${id}:${goneTiles(all[Number(id)], n)}`)
        .filter((k) => !k.endsWith(":0"))
        .join(",");
      if (key !== usedUpKey) {
        usedUpKey = key;
        usedUp = new Set();
        for (const [id, n] of Object.entries(w.nature)) {
          const p = all[Number(id)];
          for (const t of p.tiles.slice(0, goneTiles(p, n))) usedUp.add(`${t.x},${t.y}`);
        }
      }
      clickAmount = clickAmountFor(w.era);
      if (changed) pop.sync(w, Date.now());
    },
    setPeople(people, me) {
      pop.setPeople(people, me, Date.now());
    },
    showGather,
    built(b) {
      const p = toWorld(b.x + 0.5, b.y + 0.5);
      burst(p.x, p.y - 10, "#d6c8a8", 24, 70, 1100);
      floatText(p.x, p.y - 40, "🎉", "#ffe82e");
    },
    cheer() {
      pop.cheer(Date.now());
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
    recenter,
    setPlacing(ok) {
      placing = ok;
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
