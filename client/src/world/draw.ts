// Everything drawn in the town: ground, streets, nature, buildings, world
// wonders (with scaffolding while they go up), supply drops,
// decorations, animals and the villagers (players' own NPCs included). All shapes are simple isometric boxes and polygons in code; the
// look per era comes from ERAS[level].style (shared/idleContent.ts).

import { ERAS, WONDER_PHASES, buildingType, depositAt, type PlacedBuilding, type ResourceId, type Terrain } from "@app/shared/idle";
import { TILE_H, TILE_W, toWorld } from "./iso";

type Ctx = CanvasRenderingContext2D;

const HW = TILE_W / 2;
const HH = TILE_H / 2;

// ---------- colors ----------

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const shadeCache = new Map<string, string>();
/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb color. */
export function shade(hex: string, amt: number): string {
  const key = hex + amt;
  let out = shadeCache.get(key);
  if (!out) {
    const [r, g, b] = parse(hex);
    const f = (c: number) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
    out = `rgb(${f(r)},${f(g)},${f(b)})`;
    shadeCache.set(key, out);
  }
  return out;
}

export const RESOURCE_COLORS: Record<ResourceId, string> = {
  food: "#e4572e", wood: "#8b5a2b", stone: "#9ca3af", bronze: "#cd7f32", iron: "#5f6b73",
  gold: "#ffd23f", wool: "#f5f5f4", knowledge: "#f1e3b5", coal: "#222222", oil: "#3b2f2f",
  data: "#22f0ff", titanium: "#60a5fa", antimatter: "#c084fc",
};

/** Street surface per road level: sand, gravel, … asphalt, light lanes. */
const ROAD_COLORS = ["#c9ad7a", "#b3a68c", "#a68b62", "#bdb5a3", "#9a948a", "#a3563f", "#7a746c", "#4b4f55", "#3c434d", "#d5dde6", "#2b2545"];

/** Ground color for a tile (two shades for a subtle checker); `road` is the street level, or null. */
export function groundColor(t: Terrain, x: number, y: number, era: number, road: number | null): string {
  const odd = (x + y) % 2 === 0 ? 0 : -0.04;
  const grass = ERAS[era].style.grass;
  if (road !== null) return shade(ROAD_COLORS[Math.min(road, ROAD_COLORS.length - 1)], odd / 2);
  switch (t) {
    case "water":
    case "bridge":
      return "#2f6fb0";
    case "rock":
    case "mountain":
      return shade("#8d8a80", odd);
    case "sand":
      return shade("#e3cf8f", odd);
    case "forest":
      return shade(grass, -0.18 + odd);
    case "deposit":
      return shade("#8a8274", odd);
    default:
      return shade(grass, odd);
  }
}

/** The texture on a street tile: stones, bricks, markings or light, per level. */
export function drawRoadDetail(ctx: Ctx, x: number, y: number, level: number, t: number): void {
  const top = toWorld(x, y);
  const cx = top.x;
  const cy = top.y + HH;
  // A point on the tile from (u, v) in 0..1.
  const at = (u: number, v: number): [number, number] => [cx + (u - v) * HW, cy - HH + (u + v) * HH];
  if (level === 0) {
    for (let i = 0; i < 3; i++) {
      const [px, py] = at(rand2(x, y, i), rand2(x, y, i + 9));
      ellipse(ctx, px, py, 1.6, 0.8, "rgba(120,90,50,0.35)");
    }
    return;
  }
  if (level === 1 || level === 2 || level === 6) {
    const n = level === 2 ? 4 : 9;
    for (let i = 0; i < n; i++) {
      const [px, py] = at(0.1 + rand2(x, y, i) * 0.8, 0.1 + rand2(x, y, i + 20) * 0.8);
      ellipse(ctx, px, py, level === 2 ? 2.5 : 1.2, level === 2 ? 1 : 0.7, level === 6 ? "rgba(30,30,30,0.35)" : "rgba(80,70,60,0.4)");
    }
    return;
  }
  if (level >= 3 && level <= 5) {
    // Slabs (Roman), cobbles, bricks: a grid of joints.
    const n = level === 3 ? 2 : level === 4 ? 4 : 5;
    ctx.strokeStyle = level === 5 ? "rgba(70,25,15,0.55)" : "rgba(60,55,50,0.45)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let i = 1; i < n; i++) {
      const [ax, ay] = at(i / n, 0);
      const [bx, by] = at(i / n, 1);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      const [c1, d1] = at(0, i / n);
      const [c2, d2] = at(1, i / n);
      ctx.moveTo(c1, d1);
      ctx.lineTo(c2, d2);
    }
    ctx.stroke();
    return;
  }
  // Asphalt and beyond: a line down the middle (dashed, LEDs, glowing).
  const color = level === 7 ? "rgba(255,255,255,0.75)" : level === 8 ? "#22f0ff" : level === 9 ? "#7dd3fc" : "#b06bff";
  const pulse = level >= 8 ? 0.6 + 0.4 * Math.sin(t / 400 + x + y) : 1;
  ctx.globalAlpha = pulse;
  ctx.strokeStyle = color;
  ctx.lineWidth = level >= 8 ? 1.4 : 1;
  ctx.setLineDash(level === 7 ? [3, 3] : []);
  ctx.beginPath();
  const horizontal = x % 4 !== 0;
  const [ax, ay] = horizontal ? at(0, 0.5) : at(0.5, 0);
  const [bx, by] = horizontal ? at(1, 0.5) : at(0.5, 1);
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// ---------- small helpers ----------

function poly(ctx: Ctx, pts: number[], fill: string): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Deterministic 0..1 from two ints, for variety that doesn't flicker. */
export function rand2(x: number, y: number, salt = 0): number {
  let h = Math.imul(x * 73856093 ^ y * 19349663 ^ salt * 83492791, 0x9e3779b1);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * An isometric box standing on (cx, cy) with footprint w (share of a tile)
 * and height h. Returns the four corners of its top.
 */
function box(ctx: Ctx, cx: number, cy: number, w: number, h: number, wall: string, top?: string) {
  const hw = HW * w;
  const hh = HH * w;
  poly(ctx, [cx - hw, cy, cx, cy + hh, cx, cy + hh - h, cx - hw, cy - h], shade(wall, -0.12));
  poly(ctx, [cx, cy + hh, cx + hw, cy, cx + hw, cy - h, cx, cy + hh - h], shade(wall, -0.3));
  const t = { L: [cx - hw, cy - h], B: [cx, cy + hh - h], R: [cx + hw, cy - h], T: [cx, cy - hh - h] };
  if (top) poly(ctx, [...t.L, ...t.B, ...t.R, ...t.T], top);
  return t;
}

/** A point on the left (side = 0) or right (side = 1) wall: u along, v up (0..1). */
function wallPoint(cx: number, cy: number, w: number, h: number, side: 0 | 1, u: number, v: number): [number, number] {
  const hw = HW * w;
  const hh = HH * w;
  return side === 0 ? [cx - hw + u * hw, cy + u * hh - v * h] : [cx + u * hw, cy + hh - u * hh - v * h];
}

function windows(ctx: Ctx, cx: number, cy: number, w: number, h: number, color: string, floors: number, perFloor: number): void {
  if (!color) return;
  ctx.fillStyle = color;
  for (const side of [0, 1] as const) {
    for (let f = 0; f < floors; f++) {
      const v1 = (f + 0.35) / floors;
      const v2 = (f + 0.75) / floors;
      for (let i = 0; i < perFloor; i++) {
        const u1 = (i + 0.3) / perFloor;
        const u2 = (i + 0.7) / perFloor;
        const p = [
          ...wallPoint(cx, cy, w, h, side, u1, v1), ...wallPoint(cx, cy, w, h, side, u2, v1),
          ...wallPoint(cx, cy, w, h, side, u2, v2), ...wallPoint(cx, cy, w, h, side, u1, v2),
        ];
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        for (let k = 2; k < 8; k += 2) ctx.lineTo(p[k], p[k + 1]);
        ctx.fill();
      }
    }
  }
}

function door(ctx: Ctx, cx: number, cy: number, w: number, h: number): void {
  const doorH = Math.min(9, h * 0.7);
  const p = [
    ...wallPoint(cx, cy, w, h, 0, 0.4, 0), ...wallPoint(cx, cy, w, h, 0, 0.62, 0),
    ...wallPoint(cx, cy, w, h, 0, 0.62, doorH / h), ...wallPoint(cx, cy, w, h, 0, 0.4, doorH / h),
  ];
  poly(ctx, p, "#3b2a1a");
}

type RoofType = "cone" | "gable" | "flat" | "dome";

function roof(ctx: Ctx, cx: number, top: ReturnType<typeof box>, w: number, type: RoofType, color: string, rh: number): void {
  const { L, B, R, T } = top;
  if (type === "cone") {
    const apex = [cx, (L[1] + B[1]) / 2 - rh];
    poly(ctx, [...T, ...L, ...apex], shade(color, -0.1));
    poly(ctx, [...L, ...B, ...apex], color);
    poly(ctx, [...B, ...R, ...apex], shade(color, -0.25));
  } else if (type === "gable") {
    const A = [(T[0] + L[0]) / 2, (T[1] + L[1]) / 2 - rh];
    const C = [(B[0] + R[0]) / 2, (B[1] + R[1]) / 2 - rh];
    poly(ctx, [...T, ...R, ...C, ...A], shade(color, -0.3));
    poly(ctx, [...L, ...B, ...C, ...A], color);
    poly(ctx, [...B, ...R, ...C], shade(color, -0.45));
  } else if (type === "flat") {
    poly(ctx, [...L, ...B, ...R, ...T], color);
    const inset = 0.8;
    const c = [(L[0] + R[0]) / 2, (T[1] + B[1]) / 2];
    poly(ctx, [L, B, R, T].flatMap(([x, y]) => [c[0] + (x - c[0]) * inset, c[1] + (y - c[1]) * inset]), shade(color, -0.12));
  } else {
    const r = HW * w * 0.9;
    const cy = (T[1] + B[1]) / 2;
    poly(ctx, [...L, ...B, ...R, ...T], shade(color, -0.2));
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.5, 0, Math.PI, 0);
    ctx.ellipse(cx, cy, r, r * 0.9, 0, 0, Math.PI, true);
    ctx.fillStyle = color;
    ctx.fill();
    ellipse(ctx, cx - r * 0.35, cy - r * 0.45, r * 0.22, r * 0.14, "rgba(255,255,255,0.45)");
  }
}

// ---------- nature ----------

export function drawTree(ctx: Ctx, cx: number, cy: number, x: number, y: number, era: number, t: number): void {
  const r = rand2(x, y, 1);
  const ox = (rand2(x, y, 2) - 0.5) * 18;
  const oy = (rand2(x, y, 3) - 0.5) * 8;
  const s = 0.8 + r * 0.5;
  const px = cx + ox;
  const py = cy + oy;
  const sway = Math.sin(t / 900 + x * 0.7 + y) * 1.2;
  ellipse(ctx, px, py, 9 * s, 4 * s, "rgba(0,0,0,0.18)");
  poly(ctx, [px - 1.5, py, px + 1.5, py, px + 1.5, py - 8 * s, px - 1.5, py - 8 * s], "#5b3a1e");
  const green = era >= 10 ? "#6d5bd0" : r > 0.5 ? "#2f7d32" : "#3b8f3e";
  if (r > 0.45) {
    poly(ctx, [px - 10 * s, py - 6 * s, px + 10 * s, py - 6 * s, px + sway, py - 26 * s], shade(green, -0.15));
    poly(ctx, [px - 8 * s, py - 14 * s, px + 8 * s, py - 14 * s, px + sway, py - 32 * s], green);
  } else {
    ellipse(ctx, px + sway * 0.5, py - 16 * s, 10 * s, 11 * s, shade(green, -0.1));
    ellipse(ctx, px - 3 * s + sway * 0.5, py - 19 * s, 5 * s, 5 * s, shade(green, 0.15));
  }
}

export function drawRock(ctx: Ctx, cx: number, cy: number, x: number, y: number): void {
  const ox = (rand2(x, y, 5) - 0.5) * 16;
  const s = 0.7 + rand2(x, y, 6) * 0.6;
  const px = cx + ox;
  poly(ctx, [px - 10 * s, cy + 2, px - 6 * s, cy - 8 * s, px + 2 * s, cy - 11 * s, px + 9 * s, cy - 4 * s, px + 10 * s, cy + 2], "#8f8b83");
  poly(ctx, [px + 2 * s, cy - 11 * s, px + 9 * s, cy - 4 * s, px + 10 * s, cy + 2, px + 2 * s, cy + 3], "#76726b");
}

export function drawMountain(ctx: Ctx, cx: number, cy: number, x: number, y: number): void {
  const h = 34 + rand2(x, y, 7) * 30;
  poly(ctx, [cx - HW, cy, cx, cy - h, cx, cy + HH], "#7d786f");
  poly(ctx, [cx, cy + HH, cx, cy - h, cx + HW, cy], "#625e57");
  if (h > 45) {
    poly(ctx, [cx - 9, cy - h + 14, cx, cy - h, cx, cy - h + 18], "#f3f4f6");
    poly(ctx, [cx, cy - h + 18, cx, cy - h, cx + 9, cy - h + 14], "#d1d5db");
  }
}

export function drawBush(ctx: Ctx, cx: number, cy: number, x: number, y: number, picked = false): void {
  const ox = (rand2(x, y, 8) - 0.5) * 14;
  ellipse(ctx, cx + ox, cy - 4, 9, 6, picked ? "#6b7f3a" : "#2e7d32");
  ellipse(ctx, cx + ox + 4, cy - 7, 6, 5, picked ? "#7d8f45" : "#388e3c");
  if (picked) return;
  ctx.fillStyle = "#e11d48";
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(cx + ox - 6 + rand2(x, y, 10 + i) * 12, cy - 9 + rand2(x, y, 20 + i) * 7, 2, 2);
  }
}

/** What's left of used-up nature: a stump where a tree stood, rubble where a rock was. */
export function drawUsedUp(ctx: Ctx, cx: number, cy: number, x: number, y: number, kind: "forest" | "rock"): void {
  if (kind === "forest") {
    const px = cx + (rand2(x, y, 2) - 0.5) * 18;
    const py = cy + (rand2(x, y, 3) - 0.5) * 8;
    ellipse(ctx, px, py + 1, 4, 2, "rgba(0,0,0,0.18)");
    poly(ctx, [px - 2.5, py, px + 2.5, py, px + 2.5, py - 3, px - 2.5, py - 3], "#5b3a1e");
    ellipse(ctx, px, py - 3, 2.5, 1.2, "#c8a26b");
    return;
  }
  for (let i = 0; i < 3; i++) {
    const px = cx + (rand2(x, y, 30 + i) - 0.5) * 18;
    const py = cy + (rand2(x, y, 40 + i) - 0.5) * 6;
    poly(ctx, [px - 2.5, py + 1, px - 1, py - 2, px + 2, py - 1.5, px + 2.5, py + 1], "#8f8b83");
  }
}

export function drawBridge(ctx: Ctx, cx: number, cy: number): void {
  poly(ctx, [cx - HW * 0.9, cy - 2, cx, cy + HH * 0.9 - 2, cx + HW * 0.9, cy - 2, cx, cy - HH * 0.9 - 2], "#8b6a43");
  ctx.strokeStyle = "#5b4429";
  ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 7 - 12, cy - 2 + i * 3.5 - 6);
    ctx.lineTo(cx + i * 7 + 12, cy - 2 + i * 3.5 + 6);
    ctx.stroke();
  }
}

/** A special resource spot, once its era is unlocked. */
export function drawDeposit(ctx: Ctx, cx: number, cy: number, x: number, y: number, t: number): void {
  const d = depositAt(x, y);
  if (!d) return;
  const color = RESOURCE_COLORS[d.resource] ?? "#fff";
  const twinkle = (Math.sin(t / 300 + x) + 1) / 2;
  switch (d.resource) {
    case "wool": {
      // A meadow with sheep.
      for (let i = 0; i < 3; i++) {
        const sx = cx - 14 + i * 13 + Math.sin(t / 1500 + i) * 3;
        const sy = cy - 2 + (i % 2) * 6;
        ellipse(ctx, sx, sy, 6, 4, "#f5f5f4");
        ellipse(ctx, sx + 5, sy - 2, 2.5, 2.5, "#1f2937");
      }
      return;
    }
    case "knowledge": {
      poly(ctx, [cx - 6, cy + 2, cx - 6, cy - 30, cx + 6, cy - 34, cx + 6, cy - 2], "#4b5563");
      ctx.fillStyle = `rgba(250,204,21,${0.5 + twinkle * 0.5})`;
      for (let i = 0; i < 4; i++) ctx.fillRect(cx - 3, cy - 26 + i * 6, 6, 2);
      return;
    }
    case "oil": {
      ellipse(ctx, cx, cy, 20, 9, "#111");
      ellipse(ctx, cx - 5, cy - 2, 6, 2, `rgba(147,51,234,${0.4 + twinkle * 0.3})`);
      return;
    }
    case "data": {
      poly(ctx, [cx - 8, cy, cx, cy + 4, cx + 8, cy, cx + 8, cy - 12, cx, cy - 8, cx - 8, cy - 12], "#334155");
      ellipse(ctx, cx, cy - 16, 3, 3, twinkle > 0.5 ? "#22f0ff" : "#0e7490");
      return;
    }
    case "titanium": {
      ellipse(ctx, cx, cy, 24, 11, "#3f3a33");
      ellipse(ctx, cx, cy - 1, 17, 7, "#2a2620");
      ellipse(ctx, cx, cy - 5, 6, 5, `rgba(96,165,250,${0.6 + twinkle * 0.4})`);
      return;
    }
    case "antimatter": {
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(cx, cy - 18, 16 - i * 4, 8 - i * 2, t / (600 - i * 150), 0, Math.PI * 2);
        ctx.strokeStyle = i === 1 ? "#f0abfc" : "#a855f7";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ellipse(ctx, cx, cy - 18, 4, 4, "#fff");
      return;
    }
    default: {
      // Ore in rock with sparkles.
      drawRock(ctx, cx, cy, x, y);
      ctx.fillStyle = color;
      for (let i = 0; i < 5; i++) ctx.fillRect(cx - 7 + rand2(x, y, 30 + i) * 12, cy - 9 + rand2(x, y, 40 + i) * 8, 3, 3);
      ctx.fillStyle = `rgba(255,255,255,${twinkle})`;
      ctx.fillRect(cx + 4, cy - 12, 2, 2);
    }
  }
}

// ---------- buildings ----------

interface Shape {
  w: number;
  h: number;
  roof: RoofType | "none";
  roofH: number;
  float: number;
}

const HOUSE_H = [6, 12, 12, 14, 18, 30, 16, 18, 44, 12, 16];

function shapeOf(b: PlacedBuilding): Shape {
  const style = ERAS[b.level].style;
  const cat = buildingType(b.type)?.category;
  const roofH = (r: RoofType) => (r === "cone" ? 16 : r === "gable" ? 11 : r === "dome" ? 14 : 0);
  if (cat === "decor") return { w: 0.5, h: 30, roof: "none", roofH: 0, float: 0 };
  if (cat === "wonder") return { w: 1, h: 60, roof: "none", roofH: 0, float: 0 };
  if (cat === "center") {
    if (b.level === 0) return { w: 0.6, h: 14, roof: "none", roofH: 0, float: 0 };
    const h = b.level >= 8 ? 64 : 22 + b.level * 4;
    return { w: 0.9, h, roof: style.roofType, roofH: roofH(style.roofType) + 4, float: 0 };
  }
  if (cat === "house") {
    const r: RoofType = b.level <= 1 ? "cone" : style.roofType;
    const w = b.level === 5 ? 0.45 : b.level === 2 ? 0.7 : 0.55;
    return { w, h: HOUSE_H[b.level], roof: r, roofH: roofH(r), float: b.level === 10 ? 10 : 0 };
  }
  if (cat === "storage") {
    const r: RoofType = style.roofType === "cone" ? "gable" : style.roofType;
    return { w: 0.78, h: 14 + b.level, roof: r, roofH: roofH(r), float: 0 };
  }
  if (cat === "shop") {
    const r: RoofType = style.roofType === "cone" ? "gable" : style.roofType;
    return { w: 0.66, h: 16 + b.level, roof: r, roofH: roofH(r), float: 0 };
  }
  const r: RoofType = b.level === 0 ? "cone" : style.roofType;
  return { w: b.type === "farm" || b.type === "ranch" ? 0.4 : 0.6, h: 10 + b.level, roof: r, roofH: roofH(r), float: 0 };
}

/** Screen-space box (world px) around a building, for clicks. */
export function buildingBounds(b: PlacedBuilding): { x1: number; y1: number; x2: number; y2: number } {
  const c = toWorld(b.x + 0.5, b.y + 0.5);
  const s = shapeOf(b);
  const hw = HW * Math.max(s.w, 0.6);
  return { x1: c.x - hw, x2: c.x + hw, y1: c.y - s.h - s.roofH - s.float - 12, y2: c.y + HH * s.w };
}

function drawCampfire(ctx: Ctx, cx: number, cy: number, t: number): void {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ellipse(ctx, cx + Math.cos(a) * 14, cy + Math.sin(a) * 7, 3.5, 2.5, "#7c7c7c");
  }
  poly(ctx, [cx - 9, cy + 1, cx + 7, cy - 3, cx + 8, cy - 1, cx - 8, cy + 3], "#6b4423");
  poly(ctx, [cx - 7, cy - 3, cx + 9, cy + 1, cx + 8, cy + 3, cx - 8, cy - 1], "#7a4f2a");
  const f = Math.sin(t / 90) * 2;
  poly(ctx, [cx - 7, cy, cx + 7, cy, cx + f, cy - 20], "#f97316");
  poly(ctx, [cx - 4, cy, cx + 4, cy, cx - f * 0.6, cy - 13], "#fde047");
  smoke(ctx, cx, cy - 22, t, "rgba(200,200,200,");
}

function smoke(ctx: Ctx, x: number, y: number, t: number, rgba: string): void {
  for (let i = 0; i < 3; i++) {
    const p = ((t / 1800 + i / 3) % 1);
    ellipse(ctx, x + Math.sin(p * 6 + i) * 4, y - p * 26, 3 + p * 5, 3 + p * 5, `${rgba}${0.35 * (1 - p)})`);
  }
}

/** Little things in the yard that show what a work building does. */
function yard(ctx: Ctx, b: PlacedBuilding, cx: number, cy: number, t: number): void {
  const res = buildingType(b.type)?.produces;
  const fx = cx;
  const fy = cy + HH * 0.62;
  switch (res) {
    case "wood":
      for (let i = 0; i < 3; i++) poly(ctx, [fx - 10, fy - i * 3, fx + 6, fy - 4 - i * 3, fx + 7, fy - 2 - i * 3, fx - 9, fy + 2 - i * 3], i % 2 ? "#8b5a2b" : "#a0693a");
      break;
    case "stone":
      ellipse(ctx, fx - 4, fy, 6, 3.5, "#9ca3af");
      ellipse(ctx, fx + 4, fy - 1, 5, 3, "#7f8691");
      ellipse(ctx, fx, fy - 4, 4, 3, "#b5bac1");
      break;
    case "oil": {
      const a = Math.sin(t / 400) * 0.35;
      ctx.strokeStyle = "#1f2937";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx, fy - 12);
      ctx.moveTo(fx - 12 * Math.cos(a), fy - 12 - 12 * Math.sin(a));
      ctx.lineTo(fx + 12 * Math.cos(a), fy - 12 + 12 * Math.sin(a));
      ctx.stroke();
      break;
    }
    case "data":
    case "titanium":
    case "antimatter": {
      const on = Math.sin(t / 250 + b.id) > 0;
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(fx + 6, fy);
      ctx.lineTo(fx + 6, fy - 22);
      ctx.stroke();
      ellipse(ctx, fx + 6, fy - 23, 2.5, 2.5, on ? RESOURCE_COLORS[res] : "#334155");
      break;
    }
    case "wool":
      ellipse(ctx, fx - 6, fy, 5, 3.5, "#f5f5f4");
      ellipse(ctx, fx - 2, fy - 2, 2, 2, "#1f2937");
      break;
    case "food":
      if (b.type === "hunter") {
        // A drying rack with a hide, and a pair of antlers.
        ctx.strokeStyle = "#5b3a1a";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fx - 10, fy + 2);
        ctx.lineTo(fx - 10, fy - 12);
        ctx.moveTo(fx + 2, fy - 2);
        ctx.lineTo(fx + 2, fy - 16);
        ctx.moveTo(fx - 11, fy - 11);
        ctx.lineTo(fx + 3, fy - 15);
        ctx.stroke();
        poly(ctx, [fx - 9, fy - 11, fx + 1, fy - 14, fx, fy - 5, fx - 8, fy - 3], "#a0693a");
        antlers(ctx, fx + 9, fy - 2, 1);
      } else if (b.type === "fishery") {
        // Fish hanging to dry, and a little boat.
        ctx.strokeStyle = "#5b3a1a";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(fx - 12, fy - 10);
        ctx.lineTo(fx, fy - 14);
        ctx.stroke();
        for (let i = 0; i < 3; i++) ellipse(ctx, fx - 10 + i * 4, fy - 9 - i * 1.3 + Math.sin(t / 500 + i) * 0.5, 1.2, 2.6, "#cbd5e1");
        poly(ctx, [fx + 2, fy + 2, fx + 16, fy - 3, fx + 13, fy + 1, fx + 5, fy + 4], "#7a4f2a");
      } else if (b.type === "ranch") {
        const walk = Math.sin(t / 2500 + b.id);
        drawAnimal(ctx, fx - 9 + walk * 3, fy + 1, { kind: b.level >= 2 && b.id % 2 ? "sheep" : "cow", dir: walk > 0 ? 1 : -1, phase: t, walking: false });
        drawAnimal(ctx, fx + 9 - walk * 2, fy - 3, { kind: "cow", dir: walk > 0 ? -1 : 1, phase: t + 900, walking: false });
      }
      break;
    default:
      if (res) {
        // Mine entrance with a cart of ore.
        poly(ctx, [fx - 8, fy, fx + 2, fy + 5, fx + 2, fy - 3, fx - 8, fy - 8], "#1f1f1f");
        poly(ctx, [fx + 4, fy + 2, fx + 12, fy - 2, fx + 12, fy - 6, fx + 4, fy - 2], "#6b4423");
        ellipse(ctx, fx + 8, fy - 6, 3.5, 2, RESOURCE_COLORS[res] ?? "#999");
      }
  }
}

function fields(ctx: Ctx, cx: number, cy: number, level: number, t: number): void {
  // Crop rows over the tile, swaying a little.
  poly(ctx, [cx - HW * 0.95, cy, cx, cy + HH * 0.95, cx + HW * 0.95, cy, cx, cy - HH * 0.95], level >= 8 ? "#3f6212" : "#8a6d3b");
  const crop = level >= 8 ? "#84cc16" : level === 3 ? "#7e22ce" : "#e9c46a";
  ctx.strokeStyle = crop;
  ctx.lineWidth = 2;
  for (let i = -3; i <= 3; i++) {
    const sway = Math.sin(t / 700 + i) * 1;
    ctx.beginPath();
    ctx.moveTo(cx - 20 + i * 5 + sway, cy - 10 + i * 2.5 + 3);
    ctx.lineTo(cx + 4 + i * 5 + sway, cy + 2 + i * 2.5 + 3);
    ctx.stroke();
  }
}

/** A fenced meadow over the tile, for the ranch's animals. */
function pasture(ctx: Ctx, cx: number, cy: number): void {
  const pts = [cx - HW * 0.95, cy, cx, cy + HH * 0.95, cx + HW * 0.95, cy, cx, cy - HH * 0.95];
  poly(ctx, pts, "#7fb05a");
  ctx.strokeStyle = "#8b5a2b";
  ctx.lineWidth = 1.2;
  for (const lift of [2, 4.5]) {
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const k = (i % 4) * 2;
      if (i === 0) ctx.moveTo(pts[k], pts[k + 1] - lift);
      else ctx.lineTo(pts[k], pts[k + 1] - lift);
    }
    ctx.stroke();
  }
}

function antlers(ctx: Ctx, x: number, y: number, dir: number): void {
  ctx.strokeStyle = "#e7d7b1";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + side * 2 + dir, y - 4);
    ctx.lineTo(x + side * 3.5 + dir, y - 6);
    ctx.moveTo(x + side * 1.4 + dir, y - 2.8);
    ctx.lineTo(x + side * 3 + dir, y - 3);
  }
  ctx.stroke();
}

// ---------- animals ----------

export interface AnimalLook {
  kind: "deer" | "boar" | "cow" | "sheep";
  /** Facing right (1) or left (-1). */
  dir: 1 | -1;
  /** Animation clock in ms. */
  phase: number;
  walking: boolean;
}

const ANIMAL_COLORS: Record<AnimalLook["kind"], { body: string; head: string }> = {
  deer: { body: "#a0693a", head: "#8b5a2b" },
  boar: { body: "#4b3b2f", head: "#3a2d24" },
  cow: { body: "#f5f5f4", head: "#e7e5e4" },
  sheep: { body: "#f1f5f9", head: "#1f2937" },
};

/** A small animal standing on (x, y): game in the forest, cattle on the ranch. */
export function drawAnimal(ctx: Ctx, x: number, y: number, a: AnimalLook): void {
  const c = ANIMAL_COLORS[a.kind];
  const step = a.walking ? Math.sin(a.phase / 120) * 1.5 : 0;
  // Grazing: the head goes down now and then.
  const graze = !a.walking && Math.sin(a.phase / 1300) > 0.4 ? 2.5 : 0;
  const tall = a.kind === "deer" ? 6 : a.kind === "boar" ? 3.5 : 4.5;
  ellipse(ctx, x, y + 0.5, 5, 1.8, "rgba(0,0,0,0.22)");
  ctx.strokeStyle = a.kind === "sheep" ? "#1f2937" : shade(c.body, -0.35);
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  for (const [lx, s] of [[-3, step], [-1.5, -step], [1.5, step], [3, -step]] as const) {
    ctx.moveTo(x + lx, y - tall + 1);
    ctx.lineTo(x + lx + s, y);
  }
  ctx.stroke();
  const by = y - tall - 1;
  ellipse(ctx, x, by, a.kind === "sheep" ? 4.8 : 4.5, a.kind === "sheep" ? 3.2 : 2.5, c.body);
  if (a.kind === "cow") {
    ellipse(ctx, x - 1.5, by - 0.5, 1.4, 1, "#1f2937");
    ellipse(ctx, x + 2, by + 0.6, 1.1, 0.8, "#1f2937");
  }
  if (a.kind === "deer") ellipse(ctx, x - a.dir * 4.5, by - 0.8, 1, 1, "#fff");
  const hx = x + a.dir * 4.8;
  const hy = by - 1.5 + graze;
  ellipse(ctx, hx, hy, 1.9, 1.6, c.head);
  if (a.kind === "deer" && !graze) antlers(ctx, hx, hy - 1, a.dir * 0.5);
  if (a.kind === "boar") {
    ctx.strokeStyle = "#f5f5f4";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(hx + a.dir * 1.4, hy + 0.6);
    ctx.lineTo(hx + a.dir * 2.4, hy - 0.6);
    ctx.stroke();
  }
}

export function drawBuilding(ctx: Ctx, b: PlacedBuilding, t: number, selected: boolean): void {
  const c = toWorld(b.x + 0.5, b.y + 0.5);
  const type = buildingType(b.type);
  if (!type) return;
  const style = ERAS[b.level].style;
  const s = shapeOf(b);
  const cx = c.x;
  const cy = c.y;

  if (selected) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffe82e";
    ctx.beginPath();
    ctx.moveTo(cx - HW, cy);
    ctx.lineTo(cx, cy + HH);
    ctx.lineTo(cx + HW, cy);
    ctx.lineTo(cx, cy - HH);
    ctx.closePath();
    ctx.stroke();
  }

  if (type.category === "decor") {
    drawDecor(ctx, b, cx, cy, t);
    return;
  }
  if (type.category === "wonder") {
    drawWonder(ctx, b, cx, cy, t);
    return;
  }
  if (type.category === "center" && b.level === 0) {
    drawCampfire(ctx, cx, cy, t);
    return;
  }
  if (b.type === "farm") fields(ctx, cx, cy, b.level, t);
  if (b.type === "ranch") pasture(ctx, cx, cy);

  ellipse(ctx, cx, cy + 2, HW * s.w * 1.05, HH * s.w * 1.05, "rgba(0,0,0,0.2)");
  const by = cy - s.float;
  if (s.float) ellipse(ctx, cx, by + 4, 10, 4, style.glow ? `${style.glow}66` : "rgba(255,255,255,0.3)");
  const wall = b.level === 0 && type.category === "house" ? "#7a5a3a" : style.wall;
  const top = box(ctx, cx, by, s.w, s.h, wall, s.roof === "none" ? shade(wall, 0.1) : undefined);
  // Half-timbering in the Middle Ages.
  if (b.level === 4 && type.category !== "work") {
    ctx.strokeStyle = "#4a3426";
    ctx.lineWidth = 1.5;
    for (const side of [0, 1] as const) {
      for (const u of [0.15, 0.5, 0.85]) {
        const [x1, y1] = wallPoint(cx, by, s.w, s.h, side, u, 0);
        const [x2, y2] = wallPoint(cx, by, s.w, s.h, side, u, 1);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
  }
  const floors = Math.max(1, Math.round(s.h / 14));
  windows(ctx, cx, by, s.w, s.h, style.window, floors, s.w > 0.7 ? 3 : 2);
  if (s.h >= 10) door(ctx, cx, by, s.w, s.h);
  if (s.roof !== "none") roof(ctx, cx, top, s.w, s.roof, b.level === 0 ? "#c9a65a" : style.roof, s.roofH);

  // Chimneys smoke in the industrial era; the center flies a flag.
  if (b.level === 6) smoke(ctx, cx + 6, by - s.h - 6, t + b.id * 333, "rgba(80,80,80,");
  if (type.category === "center") {
    const fx = cx;
    const fy = by - s.h - s.roofH;
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx, fy - 18);
    ctx.stroke();
    const wave = Math.sin(t / 300) * 2;
    poly(ctx, [fx, fy - 18, fx + 12, fy - 15 + wave, fx, fy - 11], "#ff2fb3");
    ctx.fillStyle = "#fff";
    ctx.font = "bold 5px sans-serif";
    ctx.fillText("67", fx + 2, fy - 13);
  }
  if (style.glow && (type.category === "house" || type.category === "center")) {
    ellipse(ctx, cx, by - s.h - s.roofH - 2, 3, 3, style.glow);
  }
  if (type.category === "work") yard(ctx, b, cx, cy, t);
  if (type.category === "storage") {
    poly(ctx, [cx + 6, cy + 9, cx + 14, cy + 5, cx + 14, cy - 1, cx + 6, cy + 3], "#a0693a");
    poly(ctx, [cx - 2, cy + 12, cx + 6, cy + 8, cx + 6, cy + 2, cx - 2, cy + 6], "#8b5a2b");
  }
  if (type.category === "shop") shopSign(ctx, type.emoji, cx, by - s.h - s.roofH - 8, t + b.id * 500);
}

/** A swinging sign with the shop's emoji above the roof, so shops stand out. */
function shopSign(ctx: Ctx, emoji: string, x: number, y: number, t: number): void {
  const sway = Math.sin(t / 600) * 1.5;
  ellipse(ctx, x, y + sway, 9, 9, "#fff8e1");
  ctx.strokeStyle = "#5b3a1a";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y + sway, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, x, y + sway + 1);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

/** A world wonder; while it goes up, see-through behind scaffolding with how far it is. */
function drawWonder(ctx: Ctx, b: PlacedBuilding, cx: number, cy: number, t: number): void {
  const w = buildingType(b.type)?.wonder;
  if (!w) return;
  ellipse(ctx, cx, cy + 3, HW * 1.1, HH * 1.1, "rgba(0,0,0,0.2)");
  if (b.stage === undefined) return wonderShape(ctx, w.shape, w.color, cx, cy, t);
  ctx.save();
  ctx.globalAlpha *= 0.25 + 0.6 * (b.stage / WONDER_PHASES);
  wonderShape(ctx, w.shape, w.color, cx, cy, t);
  ctx.restore();
  // Scaffolding: poles and planks around it.
  ctx.strokeStyle = "#8b5a2b";
  ctx.lineWidth = 1.5;
  const height = 20 + 14 * b.stage;
  for (const dx of [-HW * 0.8, -HW * 0.3, HW * 0.3, HW * 0.8]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy + 4 - Math.abs(dx) * 0.3);
    ctx.lineTo(cx + dx, cy + 4 - Math.abs(dx) * 0.3 - height);
    ctx.stroke();
  }
  for (let y = 10; y < height; y += 12) {
    ctx.beginPath();
    ctx.moveTo(cx - HW * 0.8, cy - y);
    ctx.lineTo(cx + HW * 0.8, cy - y);
    ctx.stroke();
  }
  // A crane swinging slowly.
  const a = Math.sin(t / 2000) * 0.4;
  ctx.strokeStyle = "#f59e0b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx + HW * 0.9, cy);
  ctx.lineTo(cx + HW * 0.9, cy - height - 16);
  ctx.lineTo(cx + HW * 0.9 - Math.cos(a) * 30, cy - height - 16 + Math.sin(a) * 6);
  ctx.stroke();
  shopSign(ctx, "🚧", cx, cy - height - 12, t);
}

function wonderShape(ctx: Ctx, shape: string, col: string, cx: number, cy: number, t: number): void {
  switch (shape) {
    case "stonehenge":
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const x = cx + Math.cos(a) * 22;
        const y = cy + Math.sin(a) * 10 - 2;
        box(ctx, x, y, 0.14, 20, col, shade(col, 0.15));
        if (i % 2 === 0) {
          const b = ((i + 1) / 7) * Math.PI * 2;
          poly(ctx, [x - 3, y - 22, cx + Math.cos(b) * 22 + 3, cy + Math.sin(b) * 10 - 24, cx + Math.cos(b) * 22 + 3, cy + Math.sin(b) * 10 - 20, x - 3, y - 18], shade(col, -0.1));
        }
      }
      return;
    case "pyramid":
      poly(ctx, [cx - HW * 1.05, cy, cx, cy + HH * 1.05, cx, cy - 52], col);
      poly(ctx, [cx, cy + HH * 1.05, cx + HW * 1.05, cy, cx, cy - 52], shade(col, -0.25));
      for (let i = 1; i < 6; i++) {
        ctx.strokeStyle = shade(col, -0.15);
        ctx.lineWidth = 0.8;
        const f = i / 6;
        ctx.beginPath();
        ctx.moveTo(cx - HW * 1.05 * (1 - f), cy - 52 * f);
        ctx.lineTo(cx, cy + HH * 1.05 * (1 - f) - 52 * f);
        ctx.lineTo(cx + HW * 1.05 * (1 - f), cy - 52 * f);
        ctx.stroke();
      }
      return;
    case "colossus": {
      box(ctx, cx, cy, 0.6, 12, "#a8a29e", "#d6d3d1");
      const y = cy - 12;
      poly(ctx, [cx - 7, y, cx - 3, y, cx - 2, y - 22, cx - 6, y - 22], col);
      poly(ctx, [cx + 3, y, cx + 7, y, cx + 6, y - 22, cx + 2, y - 22], shade(col, -0.2));
      poly(ctx, [cx - 8, y - 22, cx + 8, y - 22, cx + 7, y - 44, cx - 7, y - 44], col);
      ellipse(ctx, cx, y - 50, 6, 6, col);
      // The torch held high.
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + 7, y - 42);
      ctx.lineTo(cx + 13, y - 60);
      ctx.stroke();
      ellipse(ctx, cx + 13, y - 63 + Math.sin(t / 150), 3, 4, "#fb923c");
      return;
    }
    case "colosseum": {
      ellipse(ctx, cx, cy - 2, HW * 1.05, HH * 1.1, shade(col, -0.25));
      ctx.beginPath();
      ctx.ellipse(cx, cy - 2, HW * 1.05, HH * 1.1, 0, 0, Math.PI);
      ctx.lineTo(cx - HW * 1.05, cy - 26);
      ctx.ellipse(cx, cy - 26, HW * 1.05, HH * 1.1, 0, Math.PI, 0, true);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      ellipse(ctx, cx, cy - 26, HW * 0.75, HH * 0.75, "#c8a165");
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.1 + (0.8 * i) / 8);
        const x = cx - Math.cos(a) * HW * 0.95;
        const y = cy - 2 + Math.sin(a) * HH;
        poly(ctx, [x - 3, y - 4, x + 3, y - 4, x + 3, y - 12, x - 3, y - 12], shade(col, -0.45));
        poly(ctx, [x - 3, y - 15, x + 3, y - 15, x + 3, y - 22, x - 3, y - 22], shade(col, -0.45));
      }
      return;
    }
    case "cathedral": {
      const top = box(ctx, cx, cy, 0.75, 30, col);
      roof(ctx, cx, top, 0.75, "gable", "#57534e", 14);
      for (const dx of [-14, 14]) {
        const tt = box(ctx, cx + dx, cy - 6, 0.24, 44, col, shade(col, 0.1));
        roof(ctx, cx + dx, tt, 0.24, "cone", "#78716c", 14);
      }
      ellipse(ctx, cx, cy - 18, 5, 5, "#60a5fa");
      return;
    }
    case "dome": {
      const top = box(ctx, cx, cy, 0.9, 22, col, shade(col, 0.1));
      for (const u of [0.2, 0.4, 0.6, 0.8]) {
        const [x1, y1] = wallPoint(cx, cy, 0.9, 22, 0, u, 0);
        poly(ctx, [x1 - 1, y1, x1 + 1, y1, x1 + 1, y1 - 22, x1 - 1, y1 - 22], shade(col, -0.25));
      }
      roof(ctx, cx, top, 0.75, "dome", "#94a3b8", 20);
      box(ctx, cx, cy - 46, 0.12, 10, col, col);
      return;
    }
    case "eiffel": {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      const legs: [number, number][] = [[-HW * 0.8, 0], [HW * 0.8, 0], [-HW * 0.3, HH * 0.6], [HW * 0.3, -HH * 0.6]];
      for (const [dx, dy] of legs) {
        ctx.beginPath();
        ctx.moveTo(cx + dx, cy + dy);
        ctx.quadraticCurveTo(cx + dx * 0.25, cy - 30, cx, cy - 80);
        ctx.stroke();
      }
      ctx.lineWidth = 1;
      for (const [y, r] of [[-18, 0.55], [-38, 0.28], [-58, 0.12]] as const) {
        ctx.beginPath();
        ctx.moveTo(cx - HW * r, cy + y);
        ctx.lineTo(cx + HW * r, cy + y);
        ctx.stroke();
      }
      ellipse(ctx, cx, cy - 82, 2, 2, Math.sin(t / 300) > 0 ? "#fef08a" : col);
      return;
    }
    case "skyscraper": {
      box(ctx, cx, cy, 0.6, 84, col, shade(col, 0.1));
      windows(ctx, cx, cy, 0.6, 84, "#fef3c7", 8, 3);
      box(ctx, cx, cy - 84, 0.35, 12, "#cbd5e1", "#e2e8f0");
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 96 - HH * 0.35);
      ctx.lineTo(cx, cy - 112);
      ctx.stroke();
      ellipse(ctx, cx, cy - 113, 2, 2, Math.sin(t / 400) > 0 ? "#ef4444" : "#7f1d1d");
      return;
    }
    case "computer": {
      for (let i = 0; i < 3; i++) {
        box(ctx, cx - 14 + i * 14, cy - 6 + i * 4, 0.3, 40, "#1f2937", "#374151");
        for (let k = 0; k < 6; k++) {
          const on = Math.sin(t / 120 + i * 7 + k * 3) > 0.2;
          const [x, y] = wallPoint(cx - 14 + i * 14, cy - 6 + i * 4, 0.3, 40, 1, 0.5, 0.1 + k * 0.14);
          ellipse(ctx, x, y, 1.5, 1.5, on ? col : "#0e7490");
        }
      }
      ctx.save();
      ctx.globalAlpha *= 0.5 + 0.3 * Math.sin(t / 500);
      ellipse(ctx, cx, cy - 56, 12, 6, col);
      ctx.restore();
      return;
    }
    case "rocket": {
      box(ctx, cx, cy, 0.9, 6, "#475569", "#64748b");
      // The launch tower.
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 18, cy - 4);
      ctx.lineTo(cx + 18, cy - 74);
      ctx.stroke();
      poly(ctx, [cx - 7, cy - 6, cx + 7, cy - 6, cx + 7, cy - 66, cx - 7, cy - 66], col);
      poly(ctx, [cx - 7, cy - 66, cx + 7, cy - 66, cx, cy - 86], "#ef4444");
      poly(ctx, [cx - 7, cy - 6, cx - 14, cy - 2, cx - 7, cy - 22], "#ef4444");
      poly(ctx, [cx + 7, cy - 6, cx + 14, cy - 2, cx + 7, cy - 22], "#b91c1c");
      ellipse(ctx, cx, cy - 50, 3.5, 3.5, "#7dd3fc");
      smoke(ctx, cx, cy - 2, t, "rgba(226,232,240,");
      return;
    }
  }
}

/** A supply drop from the counter: a crate under a little parachute, bobbing to be clicked. */
export function drawDrop(ctx: Ctx, x: number, y: number, t: number): void {
  const c = toWorld(x + 0.5, y + 0.5);
  const bob = Math.abs(Math.sin(t / 400)) * 3;
  ellipse(ctx, c.x, c.y + 2, 12, 5, "rgba(0,0,0,0.25)");
  const top = box(ctx, c.x, c.y - bob, 0.36, 14, "#b45309", "#d97706");
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(top.L[0], top.L[1] + 7);
  ctx.lineTo(top.B[0], top.B[1] + 7);
  ctx.lineTo(top.R[0], top.R[1] + 7);
  ctx.stroke();
  // Parachute strings and canopy.
  const py = c.y - bob - 34;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  for (const p of [top.L, top.R, top.T]) {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(c.x + (p[0] - c.x) * 1.4, py);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(c.x, py, 16, 9, 0, Math.PI, 0);
  ctx.fillStyle = "#ff2fb3";
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 7px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("67", c.x, py - 2);
  ctx.textAlign = "start";
}

function drawDecor(ctx: Ctx, b: PlacedBuilding, cx: number, cy: number, t: number): void {
  const d = buildingType(b.type)?.decor;
  if (!d) return;
  const col = d.color;
  ellipse(ctx, cx, cy + 2, 18, 8, "rgba(0,0,0,0.18)");
  switch (d.shape) {
    case "flowers":
      for (let i = 0; i < 9; i++) {
        const fx = cx - 16 + (i % 3) * 14 + (Math.floor(i / 3) % 2) * 6;
        const fy = cy - 6 + Math.floor(i / 3) * 5;
        ellipse(ctx, fx, fy, 3, 3, ["#f472b6", "#fde047", "#f87171"][i % 3]);
      }
      poly(ctx, [cx - 22, cy, cx, cy + 10, cx + 22, cy, cx, cy - 10], "rgba(34,120,40,0.35)");
      return;
    case "totem":
      for (let i = 0; i < 4; i++) {
        box(ctx, cx, cy - i * 10, 0.22, 10, ["#b45309", "#92400e", "#c2410c", "#78350f"][i], "#d97706");
        ellipse(ctx, cx - 3, cy - i * 10 - 5, 1.5, 1.5, "#fff");
      }
      poly(ctx, [cx - 12, cy - 38, cx + 12, cy - 38, cx, cy - 44], "#dc2626");
      return;
    case "menhir":
      poly(ctx, [cx - 7, cy + 2, cx - 6, cy - 36, cx + 2, cy - 40, cx + 7, cy - 2], col);
      poly(ctx, [cx + 2, cy - 40, cx + 7, cy - 2, cx + 1, cy + 3], shade(col, -0.3));
      return;
    case "fountain": {
      poly(ctx, [cx - 24, cy, cx, cy + 12, cx + 24, cy, cx, cy - 12], col);
      poly(ctx, [cx - 20, cy - 1, cx, cy + 9, cx + 20, cy - 1, cx, cy - 10], "#60a5fa");
      box(ctx, cx, cy, 0.12, 14, col, col);
      for (let i = 0; i < 4; i++) {
        const p = (t / 700 + i / 4) % 1;
        const a = (i / 4) * Math.PI * 2;
        ellipse(ctx, cx + Math.cos(a) * p * 14, cy - 14 - Math.sin(p * Math.PI) * 10 + Math.sin(a) * p * 6, 2, 2, "#bfdbfe");
      }
      return;
    }
    case "tower": {
      const top = box(ctx, cx, cy, 0.35, 52, col);
      roof(ctx, cx, top, 0.35, "cone", "#334155", 16);
      ellipse(ctx, cx - 5, cy - 40, 4, 4, "#fefce8");
      const a = (t / 60000) * Math.PI * 2;
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 5, cy - 40);
      ctx.lineTo(cx - 5 + Math.cos(a) * 3, cy - 40 + Math.sin(a) * 3);
      ctx.stroke();
      return;
    }
    case "neon": {
      ctx.strokeStyle = "#475569";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx, cy - 22);
      ctx.stroke();
      const on = Math.sin(t / 200) > -0.6;
      poly(ctx, [cx - 18, cy - 22, cx + 18, cy - 22, cx + 18, cy - 42, cx - 18, cy - 42], "#111827");
      ctx.fillStyle = on ? col : "#4b5563";
      ctx.font = "bold 14px Arial Black, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("67", cx, cy - 27);
      ctx.textAlign = "start";
      return;
    }
    case "hologram": {
      poly(ctx, [cx - 12, cy, cx, cy + 6, cx + 12, cy, cx, cy - 6], "#334155");
      ctx.globalAlpha = 0.55 + Math.sin(t / 150) * 0.2;
      ctx.fillStyle = col;
      ctx.font = "bold 22px Arial Black, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("67", cx, cy - 12 - Math.sin(t / 500) * 3);
      ctx.textAlign = "start";
      ctx.globalAlpha = 1;
      return;
    }
    case "monument67": {
      box(ctx, cx, cy, 0.8, 8, "#475569", "#64748b");
      ctx.save();
      ctx.translate(cx, cy - 14);
      ctx.fillStyle = col;
      ctx.font = "bold 40px Arial Black, sans-serif";
      ctx.textAlign = "center";
      ctx.shadowColor = col;
      ctx.shadowBlur = 12 + Math.sin(t / 300) * 6;
      ctx.fillText("67", 0, 0);
      ctx.restore();
      return;
    }
    case "statue67":
    case "statue": {
      box(ctx, cx, cy, 0.4, 10, "#a8a29e", "#d6d3d1");
      const y = cy - 10;
      if (d.shape === "statue67") {
        ctx.fillStyle = col;
        ctx.font = "bold 18px Arial Black, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("67", cx, y - 2);
        ctx.textAlign = "start";
        // Two hands weighing it up.
        ellipse(ctx, cx - 13, y - 14 + Math.sin(t / 250) * 2, 4, 3, col);
        ellipse(ctx, cx + 13, y - 14 - Math.sin(t / 250) * 2, 4, 3, col);
        return;
      }
      // A figure on a pedestal.
      poly(ctx, [cx - 4, y, cx + 4, y, cx + 3, y - 16, cx - 3, y - 16], col);
      ellipse(ctx, cx, y - 20, 4, 4, col);
      ctx.strokeStyle = shade(col, -0.25);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + 3, y - 14);
      ctx.lineTo(cx + 9, y - 22);
      ctx.stroke();
      return;
    }
  }
}

// ---------- villagers ----------

export interface VillagerLook {
  clothes: string;
  skin: string;
  level: number;
  walking: boolean;
  /** Animation clock in ms. */
  phase: number;
  /** "sixseven": both hands up, palms flat, bouncing up and down in turn. */
  action: "none" | "work" | "dance" | "photo" | "pose" | "sit" | "sixseven";
  tool: "axe" | "pick" | "hoe" | "spear" | "rod" | "none";
  carry: ResourceId | null;
  jump: number;
  /** A player's own NPC: hat and pattern from the tailor (else the era's look). */
  hat?: string;
  pattern?: string;
}

export function drawVillager(ctx: Ctx, x: number, y: number, v: VillagerLook): void {
  const lift = v.jump + (v.action === "dance" ? Math.abs(Math.sin(v.phase / 180)) * 4 : 0);
  const sit = v.action === "sit" ? 3 : 0;
  const by = y - lift + sit;
  ellipse(ctx, x, y + 1, 4.5, 2, "rgba(0,0,0,0.25)");
  // Legs.
  ctx.strokeStyle = "#1f2937";
  ctx.lineWidth = 1.6;
  const step = v.walking ? Math.sin(v.phase / 110) * 2.2 : 0;
  ctx.beginPath();
  ctx.moveTo(x - 1.2, by - 5);
  ctx.lineTo(x - 1.2 + step, by);
  ctx.moveTo(x + 1.2, by - 5);
  ctx.lineTo(x + 1.2 - step, by);
  ctx.stroke();
  // Body and head.
  ctx.fillStyle = v.clothes;
  ctx.fillRect(x - 3, by - 11, 6, 7);
  if (v.pattern) drawPattern(ctx, x - 3, by - 11, v.pattern, v.clothes, v.phase);
  ellipse(ctx, x, by - 13.5, 2.8, 2.8, v.skin);
  if (v.hat !== undefined) drawHat(ctx, x, by - 13.5, v.hat);
  // Era headwear.
  else if (v.level === 6) {
    ctx.fillStyle = "#111";
    ctx.fillRect(x - 2.5, by - 19.5, 5, 4);
  }
  else if (v.level === 4) poly(ctx, [x - 3.2, by - 14, x + 3.2, by - 14, x, by - 19], v.clothes);
  if (v.hat === undefined && v.level >= 9) {
    ctx.strokeStyle = "rgba(186,230,253,0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, by - 13.5, 4.2, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Arms and tools.
  ctx.strokeStyle = v.skin;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (v.action === "work") {
    const a = Math.sin(v.phase / 140) * 1.1 - 0.6;
    const hx = x + 4 + Math.cos(a) * 3;
    const hy = by - 9 + Math.sin(a) * 3;
    ctx.moveTo(x + 2.5, by - 9);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.strokeStyle = "#78350f";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    // Bare hands: picking berries, tending the cattle.
    if (v.tool === "none") return;
    if (v.tool === "rod") {
      // Casting a line: a long rod, the line hanging down.
      const tx = hx + 9;
      const ty = hy - 8 + Math.sin(v.phase / 600) * 1.5;
      ctx.moveTo(hx, hy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + 1, by);
      ctx.stroke();
      return;
    }
    const len = v.tool === "spear" ? 11 : 7;
    ctx.moveTo(hx, hy);
    const tx = hx + Math.cos(a - 1.2) * len;
    const ty = hy + Math.sin(a - 1.2) * len;
    ctx.lineTo(tx, ty);
    ctx.stroke();
    if (v.tool === "spear") {
      const d = a - 1.2;
      poly(ctx, [tx + Math.cos(d) * 3, ty + Math.sin(d) * 3, tx + Math.cos(d + 1.6) * 1.2, ty + Math.sin(d + 1.6) * 1.2, tx + Math.cos(d - 1.6) * 1.2, ty + Math.sin(d - 1.6) * 1.2], "#d1d5db");
    } else if (v.tool !== "hoe") {
      ctx.fillStyle = "#9ca3af";
      ctx.fillRect(tx - 1.5, ty - 1.5, 3, 3);
    }
    return;
  }
  if (v.action === "sixseven") {
    // Six… seven: one hand up while the other goes down, like weighing something.
    const s = Math.sin(v.phase / 110) * 2.5;
    for (const [side, dy] of [[-1, s], [1, -s]] as const) {
      const hx = x + side * 5.5;
      const hy = by - 11 + dy;
      ctx.beginPath();
      ctx.moveTo(x + side * 2.5, by - 9);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.fillStyle = v.skin;
      ctx.fillRect(hx - 2, hy - 0.8, 4, 1.6);
    }
    return;
  }
  if (v.action === "dance" || v.action === "pose") {
    const w = v.action === "dance" ? Math.sin(v.phase / 160) * 3 : 0;
    ctx.moveTo(x - 2.5, by - 9);
    ctx.lineTo(x - 5, by - 15 + w);
    ctx.moveTo(x + 2.5, by - 9);
    ctx.lineTo(x + 5, by - 15 - w);
    ctx.stroke();
    return;
  }
  if (v.action === "photo") {
    ctx.moveTo(x - 2.5, by - 9);
    ctx.lineTo(x - 1, by - 12);
    ctx.moveTo(x + 2.5, by - 9);
    ctx.lineTo(x + 1, by - 12);
    ctx.stroke();
    ctx.fillStyle = "#111827";
    ctx.fillRect(x - 2.5, by - 14, 5, 3);
    if (Math.sin(v.phase / 400) > 0.97) ellipse(ctx, x, by - 13, 5, 5, "rgba(255,255,255,0.9)");
    return;
  }
  const swing = v.walking ? Math.sin(v.phase / 110) * 1.5 : 0;
  ctx.moveTo(x - 3, by - 10);
  ctx.lineTo(x - 3.5 - swing, by - 5);
  ctx.moveTo(x + 3, by - 10);
  ctx.lineTo(x + 3.5 + swing, by - 5);
  ctx.stroke();
  if (v.carry) {
    ctx.fillStyle = RESOURCE_COLORS[v.carry] ?? "#fff";
    ctx.fillRect(x - 3, by - 21, 6, 5);
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x - 3, by - 21, 6, 5);
  }
}

/** A pattern over the 6×7 shirt at (x, y). */
function drawPattern(ctx: Ctx, x: number, y: number, pattern: string, base: string, phase: number): void {
  switch (pattern) {
    case "stripes":
      ctx.fillStyle = shade(base, -0.45);
      for (let i = 1; i < 7; i += 2) ctx.fillRect(x, y + i, 6, 1);
      return;
    case "dots":
      ctx.fillStyle = "#fff";
      for (const [dx, dy] of [[1, 1], [4, 2], [2, 4], [5, 5], [1, 6]]) ctx.fillRect(x + dx, y + dy, 1, 1);
      return;
    case "sixseven":
      ctx.fillStyle = "#000";
      ctx.font = "bold 4px sans-serif";
      ctx.fillText("67", x + 0.5, y + 5.5);
      return;
    case "camo":
      for (const [dx, dy, c] of [[0, 0, "#4d5d2b"], [3, 2, "#6b7f3a"], [1, 4, "#3b2f1e"], [4, 5, "#4d5d2b"]] as const) {
        ctx.fillStyle = c;
        ctx.fillRect(x + dx, y + dy, 3, 2);
      }
      return;
    case "gold": {
      const g = ctx.createLinearGradient(x, y, x + 6, y + 7);
      g.addColorStop(0, "#fff3b0");
      g.addColorStop(0.5, "#ffd23f");
      g.addColorStop(1, "#b8860b");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 6, 7);
      return;
    }
    case "check":
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      for (let i = 0; i < 6; i += 2) for (let j = 0; j < 7; j += 2) ctx.fillRect(x + i + ((j / 2) % 2), y + j, 1, 1);
      return;
    case "neon":
      ctx.strokeStyle = `hsl(${(phase / 10) % 360}, 100%, 60%)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, 5, 6);
      return;
    case "galaxy": {
      ctx.fillStyle = "#1e1b4b";
      ctx.fillRect(x, y, 6, 7);
      ctx.fillStyle = "#fff";
      for (const [dx, dy] of [[1, 1], [4, 3], [2, 5], [5, 6]]) ctx.fillRect(x + dx, y + dy, 1, 1);
      ctx.fillStyle = "#c084fc";
      ctx.fillRect(x + 3, y + 1, 1, 1);
      return;
    }
  }
}

/** A hat on a head centered at (x, y). */
function drawHat(ctx: Ctx, x: number, y: number, hat: string): void {
  switch (hat) {
    case "cap":
      poly(ctx, [x - 3, y - 1, x + 3, y - 1, x + 2.5, y - 3.5, x - 2.5, y - 3.5], "#2563eb");
      ctx.fillStyle = "#1e40af";
      ctx.fillRect(x, y - 1.5, 4.5, 1);
      return;
    case "straw":
      ellipse(ctx, x, y - 2, 5, 1.5, "#e9c46a");
      ellipse(ctx, x, y - 3.2, 2.6, 1.8, "#d4a73c");
      return;
    case "horns":
      ellipse(ctx, x, y - 1.8, 3.1, 2.3, "#9ca3af");
      poly(ctx, [x - 3, y - 2, x - 5, y - 6, x - 2, y - 3.5], "#f5f5f4");
      poly(ctx, [x + 3, y - 2, x + 5, y - 6, x + 2, y - 3.5], "#f5f5f4");
      return;
    case "crown":
      poly(ctx, [x - 3, y - 2, x + 3, y - 2, x + 3, y - 6, x + 1.5, y - 4, x, y - 6.5, x - 1.5, y - 4, x - 3, y - 6], "#ffd23f");
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(x - 0.5, y - 4, 1, 1);
      return;
    case "tophat":
      ctx.fillStyle = "#111";
      ctx.fillRect(x - 4, y - 2.5, 8, 1);
      ctx.fillRect(x - 2.5, y - 8, 5, 6);
      ctx.fillStyle = "#b91c1c";
      ctx.fillRect(x - 2.5, y - 3.5, 5, 1);
      return;
    case "headphones":
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 3.4, Math.PI, 0);
      ctx.stroke();
      ellipse(ctx, x - 3.2, y + 0.3, 1.2, 1.6, "#ec4899");
      ellipse(ctx, x + 3.2, y + 0.3, 1.2, 1.6, "#ec4899");
      return;
    case "helmet":
      ctx.strokeStyle = "rgba(186,230,253,0.95)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y, 4.4, 0, Math.PI * 2);
      ctx.stroke();
      ellipse(ctx, x + 1.5, y - 1.5, 1, 0.7, "rgba(255,255,255,0.8)");
      return;
  }
}

/** A name tag under a player's NPC; their own one stands out. */
export function drawNameTag(ctx: Ctx, x: number, y: number, name: string, mine: boolean): void {
  ctx.font = "bold 7px system-ui, sans-serif";
  const w = ctx.measureText(name).width + 6;
  ctx.fillStyle = mine ? "rgba(255,232,46,0.95)" : "rgba(10,8,24,0.75)";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y + 3, w, 9, 3);
  ctx.fill();
  ctx.fillStyle = mine ? "#000" : "#fff";
  ctx.textAlign = "center";
  ctx.fillText(name, x, y + 10);
  ctx.textAlign = "start";
}

/** A speech bubble above a point. */
export function drawBubble(ctx: Ctx, x: number, y: number, text: string): void {
  ctx.font = "bold 9px system-ui, sans-serif";
  const w = ctx.measureText(text).width + 10;
  const bx = x - w / 2;
  const byTop = y - 34;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.roundRect(bx, byTop, w, 15, 6);
  ctx.moveTo(x - 3, byTop + 15);
  ctx.lineTo(x, byTop + 20);
  ctx.lineTo(x + 3, byTop + 15);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.fillText(text, bx + 5, byTop + 11);
}
