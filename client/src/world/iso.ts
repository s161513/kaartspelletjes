// Isometric projection and the camera for the town view.
//
// Tile space: (fx, fy) with tile (x, y) covering [x, x+1] × [y, y+1].
// World pixels: a tile is a 64×32 diamond; screen = camera transform of that.

export const TILE_W = 64;
export const TILE_H = 32;

export interface Point {
  x: number;
  y: number;
}

/** Tile space → world pixels. */
export function toWorld(fx: number, fy: number): Point {
  return { x: ((fx - fy) * TILE_W) / 2, y: ((fx + fy) * TILE_H) / 2 };
}

/** World pixels → tile space. */
export function toTileSpace(wx: number, wy: number): Point {
  return { x: wy / TILE_H + wx / TILE_W, y: wy / TILE_H - wx / TILE_W };
}

export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2.5;

export class Camera {
  /** World pixel at the middle of the screen. */
  x = 0;
  y = 0;
  zoom = 1;
  width = 1;
  height = 1;

  screenToWorld(px: number, py: number): Point {
    return { x: this.x + (px - this.width / 2) / this.zoom, y: this.y + (py - this.height / 2) / this.zoom };
  }

  worldToScreen(wx: number, wy: number): Point {
    return { x: (wx - this.x) * this.zoom + this.width / 2, y: (wy - this.y) * this.zoom + this.height / 2 };
  }

  pan(dx: number, dy: number): void {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }

  /** Zoom by `factor`, keeping the world point under (px, py) in place. */
  zoomAt(factor: number, px: number, py: number): void {
    const before = this.screenToWorld(px, py);
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    const after = this.screenToWorld(px, py);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
  }

  /** Keep the camera over the map. */
  clamp(mapSize: number): void {
    const half = (mapSize * TILE_W) / 2;
    this.x = Math.min(half, Math.max(-half, this.x));
    this.y = Math.min(mapSize * TILE_H, Math.max(0, this.y));
  }
}
