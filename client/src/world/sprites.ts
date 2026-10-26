// Pixel-art sprites for the town: one atlas (sprites/atlas.png, built by
// sprites/build.py from the sources in sprites/src, see sprites/CREDITS.md), loaded
// once at startup. Drawing one is a single drawImage. Until the atlas has loaded,
// or for anything without a sprite, draw.ts falls back to its drawn shapes.

import atlasUrl from "./sprites/atlas.png?url";
import atlas from "./sprites/atlas.json";

type Ctx = CanvasRenderingContext2D;

/** name -> [x, y, w, h, ax, ay, scale]; (ax, ay) goes on the tile's middle. */
const FRAMES = atlas as unknown as Record<string, [number, number, number, number, number, number, number]>;

const image = new Image();
let ready = false;
const loaded = new Promise<void>((resolve) => {
  image.onload = () => {
    ready = true;
    resolve();
  };
  image.onerror = () => resolve();
});
image.src = atlasUrl;

/** Resolves once the atlas is there (or failed to load: then everything stays drawn). */
export function spritesLoaded(): Promise<void> {
  return loaded;
}

/** How many variants `kind0`, `kind1`, … there are. */
const counts = new Map<string, number>();
for (const name of Object.keys(FRAMES)) {
  const m = /^(.*?)(\d+)$/.exec(name);
  if (m) counts.set(m[1], Math.max(counts.get(m[1]) ?? 0, Number(m[2]) + 1));
}

/** The sprite name for variant `r` (0..1) of a kind with numbered variants. */
export function variant(kind: string, r: number): string {
  const n = counts.get(kind) ?? 1;
  return `${kind}${Math.min(n - 1, Math.floor(r * n))}`;
}

export function hasSprite(name: string): boolean {
  return ready && name in FRAMES;
}

/**
 * Draw a sprite with its anchor at (x, y), `size` times its normal size, mirrored
 * with `flip`. Returns false (and draws nothing) when there is no such sprite yet.
 */
export function drawSprite(ctx: Ctx, name: string, x: number, y: number, size = 1, flip = false): boolean {
  const f = FRAMES[name];
  if (!ready || !f) return false;
  const [sx, sy, w, h, ax, ay, scale] = f;
  const k = scale * size;
  // Sharp pixels, except the City Sim sprites: drawn at half size they look better smoothed.
  ctx.imageSmoothingEnabled = scale < 1;
  if (flip) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.drawImage(image, sx, sy, w, h, -ax * k, -ay * k, w * k, h * k);
    ctx.restore();
  } else {
    ctx.drawImage(image, sx, sy, w, h, x - ax * k, y - ay * k, w * k, h * k);
  }
  return true;
}

/** How far a sprite reaches above and beside its anchor (world px), for clicks. */
export function spriteExtent(name: string): { up: number; half: number } | null {
  const f = FRAMES[name];
  if (!ready || !f) return null;
  const [, , w, , ax, ay, scale] = f;
  return { up: ay * scale, half: Math.max(ax, w - ax) * scale };
}
