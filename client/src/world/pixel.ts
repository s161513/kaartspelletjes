// Turns the shapes from draw.ts into pixel art that sits with the sprites: each
// thing is drawn once into a small canvas at one pixel per world px, then the soft
// edges are cut hard, the flat colors get a little grain, and a dark rim goes round
// it (the sprites have one too). After that, drawing it is one drawImage. Things
// that move are baked in a few frames (FRAMES × FRAME_MS), like a pixel-art animation.

type Ctx = CanvasRenderingContext2D;

export const FRAMES = 4;
export const FRAME_MS = 200;

/** The frame for clock `t`, and the clock to draw that frame with. */
export function frameOf(t: number, frames = FRAMES, ms = FRAME_MS): { i: number; t: number } {
  const i = Math.floor(t / ms) % frames;
  return { i, t: i * ms };
}

export interface Box {
  /** World px around the anchor that the drawing may use. */
  left: number;
  right: number;
  up: number;
  down: number;
}

interface Baked {
  canvas: HTMLCanvasElement;
  left: number;
  up: number;
}

const cache = new Map<string, Baked>();
/** Least recently used first; old ones go once there are more than MAX. */
const MAX = 4000;

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Hard edges, a bit of grain, a dark rim; soft shadows stay see-through. */
function pixelize(g: Ctx, w: number, h: number): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a >= 110) {
      d[i + 3] = 255;
      const p = i / 4;
      const k = 1 + (hash(p % w, (p / w) | 0) - 0.5) * 0.09;
      d[i] = Math.min(255, d[i] * k);
      d[i + 1] = Math.min(255, d[i + 1] * k);
      d[i + 2] = Math.min(255, d[i + 2] * k);
    } else if (a >= 20 && d[i] + d[i + 1] + d[i + 2] < 120) {
      // A shadow: one flat, see-through dark.
      d[i] = d[i + 1] = d[i + 2] = 10;
      d[i + 3] = 60;
    } else d[i + 3] = 0;
  }
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 255) continue;
      // The rim takes the color of the solid pixel next to it, much darker.
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = (ny * w + nx) * 4;
        if (d[j + 3] !== 255) continue;
        out[i] = d[j] * 0.42;
        out[i + 1] = d[j + 1] * 0.42;
        out[i + 2] = d[j + 2] * 0.45;
        out[i + 3] = 255;
        break;
      }
    }
  }
  img.data.set(out);
  g.putImageData(img, 0, 0);
}

/**
 * Draw `key` with its anchor at (x, y). The first time, `draw` paints it with the
 * anchor at world point (wx, wy) of its own coordinates, inside `box`.
 */
export function drawBaked(
  ctx: Ctx, key: string, x: number, y: number, box: Box,
  wx: number, wy: number, draw: (g: Ctx) => void,
): void {
  let b = cache.get(key);
  if (b) {
    cache.delete(key);
  } else {
    const w = Math.ceil(box.left + box.right);
    const h = Math.ceil(box.up + box.down);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    g.translate(Math.round(box.left - wx), Math.round(box.up - wy));
    draw(g);
    pixelize(g, w, h);
    b = { canvas, left: Math.round(box.left), up: Math.round(box.up) };
    if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
  }
  cache.set(key, b);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(b.canvas, Math.round(x - b.left), Math.round(y - b.up));
}
