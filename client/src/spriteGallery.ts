// A temporary page for checking the sprites (update 23): every building as
// it's drawn in every era, side by side, with the same drawing code as the
// town. Only in the Vite dev server (/sprites.html); the build leaves it out.

import { BUILDING_TYPES, ERAS, buildingName, middleOf, tilesOf, type BuildingType, type PlacedBuilding } from "@app/shared/idle";
import { drawBuilding, drawWall } from "./world/draw";
import { toWorld } from "./world/iso";
import { spritesLoaded } from "./world/sprites";

/** Screen px per world px: small buildings bigger, so details show. */
const ZOOM_SMALL = 2;
const ZOOM_BIG = 1;
const CELL = 150;

interface Cell {
  canvas: HTMLCanvasElement;
  draw(t: number): void;
}

const cells: Cell[] = [];

function tile(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const p = [toWorld(x, y), toWorld(x + 1, y), toWorld(x + 1, y + 1), toWorld(x, y + 1)];
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  for (const q of p.slice(1)) ctx.lineTo(q.x, q.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** One cell: the building on its tiles of grass. */
function buildingCell(b: PlacedBuilding): Cell {
  const big = tilesOf(b).length > 1;
  const zoom = big ? ZOOM_BIG : ZOOM_SMALL;
  const canvas = document.createElement("canvas");
  canvas.width = big ? 220 : CELL;
  canvas.height = big ? 200 : CELL;
  const ctx = canvas.getContext("2d")!;
  const m = toWorld(middleOf(b).x, middleOf(b).y);
  return {
    canvas,
    draw(t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(zoom, 0, 0, zoom, canvas.width / 2 - m.x * zoom, canvas.height * 0.72 - m.y * zoom);
      for (const p of tilesOf(b)) tile(ctx, p.x, p.y, (p.x + p.y) % 2 ? "#5d8a3a" : "#557f35");
      drawBuilding(ctx, b, t, false);
    },
  };
}

/** A piece of wall at this level, with a neighbour on both sides. */
function wallCell(level: number): Cell {
  const canvas = document.createElement("canvas");
  canvas.width = CELL;
  canvas.height = CELL;
  const ctx = canvas.getContext("2d")!;
  return {
    canvas,
    draw(t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, CELL, CELL);
      ctx.setTransform(ZOOM_SMALL, 0, 0, ZOOM_SMALL, CELL / 2, CELL * 0.6);
      tile(ctx, -0.5, -0.5, "#557f35");
      drawWall(ctx, 0, 0, level, [[1, 0], [-1, 0]], t);
    },
  };
}

/** The level a type is drawn at in this era, or null if it doesn't exist then. */
function levelIn(type: BuildingType, era: number): number | null {
  if (era < type.minEra) return null;
  // Decorations and wonders don't level up: only in the era they come.
  if ((type.noUpgrade || type.wonder) && era !== type.minEra) return null;
  return era;
}

let nextId = 1;
const at = (type: string, level: number, extra: Partial<PlacedBuilding> = {}): PlacedBuilding => ({ id: nextId++, type, level, x: 20, y: 20, ...extra });

function row(table: HTMLTableSectionElement, label: string, make: (era: number) => { b?: PlacedBuilding; cell?: Cell; name: string } | null): void {
  const tr = table.insertRow();
  const th = document.createElement("th");
  th.textContent = label;
  tr.append(th);
  for (let era = 0; era < ERAS.length; era++) {
    const td = tr.insertCell();
    const what = make(era);
    if (!what) {
      td.className = "sg-none";
      continue;
    }
    const cell = what.cell ?? buildingCell(what.b!);
    cells.push(cell);
    const name = document.createElement("span");
    name.textContent = what.name;
    td.append(cell.canvas, name);
  }
}

function build(): void {
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  head.append(document.createElement("th"));
  for (const [i, e] of ERAS.entries()) {
    const th = document.createElement("th");
    th.textContent = `${i}. ${e.name}`;
    head.append(th);
  }
  const body = table.createTBody();
  const order = ["center", "house", "storage", "work", "shop", "defense", "decor", "wonder"];
  const types = [...BUILDING_TYPES].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  for (const type of types) {
    row(body, `${type.emoji} ${type.id}`, (era) => {
      const level = levelIn(type, era);
      return level === null ? null : { b: at(type.id, level), name: buildingName(type.id, level) };
    });
    if (type.wonder) {
      row(body, `${type.emoji} ${type.id} (in aanbouw)`, (era) => {
        const level = levelIn(type, era);
        return level === null ? null : { b: at(type.id, level, { stage: 1, ready: 0 }), name: "fase 1" };
      });
    }
  }
  row(body, "🧱 muur", (era) => ({ cell: wallCell(era), name: `muur, niveau ${era}` }));
  document.getElementById("sg")!.append(table);
}

build();
// A few frames a second is enough to see what moves.
const tick = () => {
  const t = performance.now();
  for (const c of cells) c.draw(t);
};
void spritesLoaded().then(() => {
  tick();
  setInterval(tick, 200);
});
