// The night over the town (update 20): days and nights take 20 minutes each, by
// the clock (shared/idle.ts: isNight). At night a dark blue lies over
// everything, and only what gives light breaks through it: fires and torches,
// lit windows, street lamps in the later eras, the raiders' torches, and a
// lantern for every player. The dark is drawn at a coarse resolution and
// scaled up with hard edges, so the pools of light are pixel art too. Night
// doesn't fall at once: a golden evening turns into an orange sunset and a
// purple dusk, and the night ends in a pink dawn and a golden morning.

import { DAY_MS, NIGHT_MS, buildingType, isNight, middleOf, nextDayAt, nextNightAt, tilesOf, type PlacedBuilding } from "@app/shared/idle";
import { rand2 } from "./draw";
import type { Camera } from "./iso";
import { toWorld } from "./iso";

/** How dark the night gets (the alpha of the dark), and its color. */
const NIGHT_ALPHA = 0.62;
const NIGHT_RGB = [10, 14, 44] as const;
/** The color of the dark while it's still falling (or lifting): a purple dusk. */
const DUSK_RGB = [52, 26, 78] as const;
/** World px per pixel of the dark: the pools of light have steps this big. */
const CELL = 2;

const MIN = 60_000;
/**
 * The sky over one day and night, as [minute after daybreak, darkness, the
 * color of the light, how strongly it tints]: a golden evening, an orange
 * sunset turning purple, the dark night, a pink dawn and a golden morning.
 */
const SKY: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0, 255, 160, 120, 0.2], // daybreak: pink-gold
  [4, 0, 255, 220, 160, 0], // full day
  [DAY_MS / MIN - 5, 0, 255, 210, 120, 0], // the evening begins
  [DAY_MS / MIN - 2, 0, 255, 175, 80, 0.16], // golden hour
  [DAY_MS / MIN, 0.15, 255, 110, 50, 0.28], // sunset: night falls
  [DAY_MS / MIN + 1.5, 0.6, 200, 60, 110, 0.2], // purple dusk
  [DAY_MS / MIN + 3, 1, 120, 60, 140, 0], // dark
  [(DAY_MS + NIGHT_MS) / MIN - 3, 1, 140, 70, 150, 0], // the dawn begins
  [(DAY_MS + NIGHT_MS) / MIN - 1.5, 0.55, 220, 110, 150, 0.18], // pink dawn
  [(DAY_MS + NIGHT_MS) / MIN, 0, 255, 160, 120, 0.2], // sunrise
];

export interface Sky {
  /** 0 in the daytime, 1 in the dead of night, in between at dusk and dawn. */
  dark: number;
  /** The color of the low sun ("r, g, b") and how strongly it tints the town. */
  tint: string;
  tintAlpha: number;
}

/** The sky at `ms`: the dark of the night and the glow of sunrise and sunset. */
export function skyAt(ms: number): Sky {
  // Minutes since daybreak.
  const m = (isNight(ms) ? DAY_MS + NIGHT_MS - (nextDayAt(ms) - ms) : DAY_MS - (nextNightAt(ms) - ms)) / MIN;
  let i = 0;
  while (i < SKY.length - 2 && SKY[i + 1][0] <= m) i++;
  const [m0, ...a] = SKY[i];
  const [m1, ...b] = SKY[i + 1];
  const f = Math.max(0, Math.min(1, (m - m0) / (m1 - m0)));
  const v = a.map((x, k) => x + (b[k] - x) * f);
  return { dark: v[0], tint: v.slice(1, 4).map(Math.round).join(", "), tintAlpha: v[4] };
}

/** The glow of the low sun over the town, strongest towards the horizon at the top of the screen. */
export function drawSunGlow(ctx: CanvasRenderingContext2D, w: number, h: number, sky: Sky): void {
  if (sky.tintAlpha <= 0.002) return;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(${sky.tint}, ${sky.tintAlpha})`);
  g.addColorStop(1, `rgba(${sky.tint}, ${sky.tintAlpha * 0.55})`);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

export type LightKind = "fire" | "window" | "lamp" | "lantern" | "magic";

export interface Light {
  /** World px. */
  x: number;
  y: number;
  r: number;
  kind: LightKind;
  /** For the flicker of flames. */
  seed: number;
}

const TINT: Record<LightKind, string> = {
  fire: "255, 150, 60",
  window: "255, 210, 120",
  lamp: "230, 236, 255",
  lantern: "255, 220, 140",
  magic: "120, 220, 255",
};

/**
 * The light a building gives at night, if any: the campfire and fires, lit
 * windows in houses, shops and the center, torches on the towers. Storage and
 * most work buildings stay dark; the smith's forge glows.
 */
export function buildingLights(b: PlacedBuilding, out: Light[]): void {
  const type = buildingType(b.type);
  if (!type) return;
  const m = middleOf(b);
  const c = toWorld(m.x, m.y);
  const seed = b.id * 7.3;
  const cat = type.category;
  if (b.damaged) out.push({ x: c.x, y: c.y - 14, r: 46, kind: "fire", seed });
  if (cat === "center") out.push(b.level === 0 ? { x: c.x, y: c.y - 4, r: 70, kind: "fire", seed } : { x: c.x, y: c.y - 10, r: 120, kind: b.level >= 8 ? "lamp" : "window", seed });
  else if (cat === "house" || cat === "shop") out.push({ x: c.x, y: c.y - 6, r: b.level <= 1 ? 30 : 36, kind: b.level <= 1 ? "fire" : b.level >= 8 ? "lamp" : "window", seed });
  else if (cat === "defense") out.push({ x: c.x, y: c.y - 20, r: 44, kind: b.level >= 7 ? "lamp" : "fire", seed });
  else if (cat === "wonder") out.push({ x: c.x, y: c.y - 20, r: 30 + 34 * Math.sqrt(tilesOf(b).length), kind: b.level >= 8 ? "magic" : "fire", seed });
  else if (b.type === "smith") out.push({ x: c.x, y: c.y - 4, r: 34, kind: "fire", seed });
  else if (cat === "decor" && (b.type === "decor_neon" || b.type === "decor_hologram" || b.type === "decor_monument67")) {
    out.push({ x: c.x, y: c.y - 20, r: 34, kind: "magic", seed });
  }
}

/** Street lamps from the industrial era on: on some of the street tiles. */
export function streetLights(roads: Iterable<string>, era: number, out: Light[]): void {
  if (era < 6) return;
  for (const key of roads) {
    const [x, y] = key.split(",").map(Number);
    if (rand2(x, y, 70) > 0.22) continue;
    const c = toWorld(x + 0.5, y + 0.5);
    out.push({ x: c.x, y: c.y, r: 30, kind: "lamp", seed: x * 3 + y });
  }
}

let dark: HTMLCanvasElement | null = null;

/**
 * Lay the night over what's drawn (call with the screen transform reset):
 * dark everywhere but round the lights, with a warm or cold tint near them.
 */
export function drawNight(ctx: CanvasRenderingContext2D, cam: Camera, dpr: number, amount: number, lights: readonly Light[], t: number): void {
  if (amount <= 0) return;
  const k = CELL * cam.zoom; // screen px per dark px
  const w = Math.ceil(cam.width / (cam.zoom * CELL)) + 2;
  const h = Math.ceil(cam.height / (cam.zoom * CELL)) + 2;
  dark ??= document.createElement("canvas");
  if (dark.width !== w || dark.height !== h) {
    dark.width = w;
    dark.height = h;
  }
  const g = dark.getContext("2d")!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = "source-over";
  g.clearRect(0, 0, w, h);
  const rgb = NIGHT_RGB.map((c, k) => Math.round(DUSK_RGB[k] + (c - DUSK_RGB[k]) * amount)).join(", ");
  g.fillStyle = `rgba(${rgb}, ${NIGHT_ALPHA * amount})`;
  g.fillRect(0, 0, w, h);
  // World px → dark px (snapped to whole cells, so the steps don't crawl).
  const left = Math.floor((cam.x - cam.width / 2 / cam.zoom) / CELL) * CELL;
  const top = Math.floor((cam.y - cam.height / 2 / cam.zoom) / CELL) * CELL;
  g.setTransform(1 / CELL, 0, 0, 1 / CELL, -left / CELL, -top / CELL);
  const view = { x0: left - 80, y0: top - 80, x1: left + w * CELL + 80, y1: top + h * CELL + 80 };
  const seen = lights.filter((l) => l.x > view.x0 && l.x < view.x1 && l.y > view.y0 && l.y < view.y1);
  const radius = (l: Light) => l.r + (l.kind === "fire" ? Math.sin(t / 90 + l.seed) * 2 + Math.sin(t / 37 + l.seed * 2) : 0);
  const circle = (l: Light, f: number) => {
    g.beginPath();
    g.ellipse(l.x, l.y, radius(l) * f, radius(l) * f * 0.62, 0, 0, Math.PI * 2);
    g.fill();
  };
  // Cut the pools of light out of the dark, in three steps.
  g.globalCompositeOperation = "destination-out";
  for (const [f, a] of [[1, 0.35], [0.72, 0.45], [0.45, 0.7]] as const) {
    g.fillStyle = `rgba(0,0,0,${a})`;
    for (const l of seen) circle(l, f);
  }
  // And a tint of their color.
  g.globalCompositeOperation = "source-over";
  for (const l of seen) {
    g.fillStyle = `rgba(${TINT[l.kind]}, ${0.16 * amount})`;
    circle(l, 0.8);
  }
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  // Back to screen px: dark px (0,0) is world (left, top).
  const sx = (left - cam.x) * cam.zoom + cam.width / 2;
  const sy = (top - cam.y) * cam.zoom + cam.height / 2;
  ctx.drawImage(dark, sx, sy, w * k, h * k);
  ctx.restore();
}
