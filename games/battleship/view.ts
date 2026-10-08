import type { GameContext, GamePage } from "@app/shared";
import type { BattleshipView, Orient } from "./types.js";
import "./style.css";

// Battleship renderer. It receives the per-player view from logic.playerView(),
// so the opponent's un-sunk ships are never present in the data here. The host
// (client/src/gameHost.ts) owns the socket, chat, status line and back button.

let wrapEl: HTMLDivElement;
let controlsEl: HTMLDivElement;
let fleetEl: HTMLDivElement;
let orientBtn: HTMLButtonElement;
let readyBtn: HTMLButtonElement;
let hintEl: HTMLParagraphElement;

let gridsEl: HTMLDivElement;
let myLabel: HTMLParagraphElement;
let enemyWrap: HTMLDivElement;

let bannerEl: HTMLDivElement;
let resultEl: HTMLParagraphElement;
let scoreEl: HTMLParagraphElement;
let againBtn: HTMLButtonElement;

const myCells: HTMLButtonElement[] = [];
const enemyCells: HTMLButtonElement[] = [];
let fleetBtns: HTMLButtonElement[] = [];

// Local placement UI state.
let selectedShip = 0;
let orient: Orient = "h";
let curStage: BattleshipView["stage"] = "placement";
let size = 10;
let fleetSizes: number[] = [];
let builtPalette = false;

function makeGrid(cells: HTMLButtonElement[], onClick: (i: number) => void): HTMLDivElement {
  const grid = document.createElement("div");
  grid.className = "battleship-grid";
  grid.style.setProperty("--battleship-size", String(size));
  for (let i = 0; i < size * size; i++) {
    const cell = document.createElement("button");
    cell.className = "battleship-cell";
    cell.dataset.i = String(i);
    cell.addEventListener("click", () => onClick(i));
    cells[i] = cell;
    grid.appendChild(cell);
  }
  return grid;
}

function mount(ctx: GameContext): void {
  myCells.length = 0;
  enemyCells.length = 0;
  fleetBtns = [];
  selectedShip = 0;
  orient = "h";
  builtPalette = false;

  wrapEl = document.createElement("div");
  wrapEl.className = "battleship-wrap";

  // --- placement controls -------------------------------------------------
  controlsEl = document.createElement("div");
  controlsEl.className = "battleship-controls";
  fleetEl = document.createElement("div");
  fleetEl.className = "battleship-fleet";
  const toolRow = document.createElement("div");
  toolRow.className = "battleship-tools";
  orientBtn = document.createElement("button");
  orientBtn.className = "battleship-orient";
  orientBtn.textContent = "Rotate: Horizontal";
  orientBtn.addEventListener("click", () => {
    orient = orient === "h" ? "v" : "h";
    orientBtn.textContent = `Rotate: ${orient === "h" ? "Horizontal" : "Vertical"}`;
  });
  readyBtn = document.createElement("button");
  readyBtn.className = "battleship-ready";
  readyBtn.textContent = "Ready";
  readyBtn.addEventListener("click", () => ctx.sendMove({ ready: true }));
  toolRow.append(orientBtn, readyBtn);
  hintEl = document.createElement("p");
  hintEl.className = "battleship-hint";
  controlsEl.append(fleetEl, toolRow, hintEl);

  // --- the two seas -------------------------------------------------------
  gridsEl = document.createElement("div");
  gridsEl.className = "battleship-grids";

  const myWrap = document.createElement("div");
  myWrap.className = "battleship-seawrap";
  myLabel = document.createElement("p");
  myLabel.className = "battleship-sealabel";
  myLabel.textContent = "Your sea";
  const myGrid = makeGrid(myCells, (i) => onMyCell(ctx, i));
  myWrap.append(myLabel, myGrid);

  enemyWrap = document.createElement("div");
  enemyWrap.className = "battleship-seawrap";
  const enemyLabel = document.createElement("p");
  enemyLabel.className = "battleship-sealabel";
  enemyLabel.textContent = "Enemy sea";
  const enemyGrid = makeGrid(enemyCells, (i) => {
    if (curStage === "firing") ctx.sendMove({ fire: { row: Math.floor(i / size), col: i % size } });
  });
  enemyWrap.append(enemyLabel, enemyGrid);

  gridsEl.append(myWrap, enemyWrap);

  // --- between-rounds banner ---------------------------------------------
  bannerEl = document.createElement("div");
  bannerEl.className = "battleship-banner";
  bannerEl.hidden = true;
  resultEl = document.createElement("p");
  resultEl.className = "battleship-result";
  scoreEl = document.createElement("p");
  scoreEl.className = "battleship-score";
  againBtn = document.createElement("button");
  againBtn.className = "battleship-again";
  againBtn.textContent = "Play again";
  againBtn.addEventListener("click", () => ctx.sendMove({ again: true }));
  bannerEl.append(resultEl, scoreEl);
  if (!ctx.isSpectator) bannerEl.appendChild(againBtn);

  wrapEl.append(controlsEl, gridsEl, bannerEl);
  ctx.container.append(wrapEl);
}

function onMyCell(ctx: GameContext, i: number): void {
  if (curStage !== "placement") return;
  ctx.sendMove({
    place: { ship: selectedShip, row: Math.floor(i / size), col: i % size, orient },
  });
}

function buildPalette(view: BattleshipView, ctx: GameContext): void {
  fleetEl.innerHTML = "";
  fleetBtns = [];
  view.fleet.forEach((ship, slot) => {
    const btn = document.createElement("button");
    btn.className = "battleship-shipbtn";
    btn.textContent = `${ship.name} (${ship.size})`;
    btn.addEventListener("click", () => {
      selectedShip = slot;
      highlightSelected();
    });
    fleetBtns[slot] = btn;
    fleetEl.appendChild(btn);
  });
  void ctx;
}

function highlightSelected(): void {
  fleetBtns.forEach((btn, slot) => btn.classList.toggle("is-selected", slot === selectedShip));
}

function update(view: BattleshipView, ctx: GameContext): void {
  size = view.size;
  fleetSizes = view.fleet.map((f) => f.size);
  curStage = view.stage;

  if (!builtPalette) {
    buildPalette(view, ctx);
    highlightSelected();
    builtPalette = true;
  }

  const intermission = view.phase === "intermission";
  const placement = !intermission && view.stage === "placement";
  const firing = !intermission && view.stage === "firing";

  controlsEl.hidden = !placement;
  enemyWrap.hidden = !firing && !intermission; // enemy sea only matters once firing
  bannerEl.hidden = !intermission;

  if (placement) renderPlacement(view, ctx);
  else renderSeas(view, ctx);

  if (intermission) showIntermission(view, ctx);
}

/** Placement: draw your own fleet-in-progress and manage the palette/ready. */
function renderPlacement(view: BattleshipView, ctx: GameContext): void {
  const self = view.self;
  myLabel.textContent = "Place your fleet";

  // Map each occupied cell to its ship slot so we can colour placed ships.
  const occupied = new Map<number, number>();
  self?.ships.forEach((ship, slot) => {
    if (ship) for (const c of ship.cells) occupied.set(c, slot);
  });

  for (let i = 0; i < size * size; i++) {
    const cell = myCells[i];
    cell.className = "battleship-cell";
    if (occupied.has(i)) cell.classList.add("ship");
    cell.disabled = !!self?.placed; // lock the board once ready
  }

  // Mark which ships are placed in the palette.
  self?.ships.forEach((ship, slot) => {
    fleetBtns[slot]?.classList.toggle("is-placed", ship !== null);
  });

  const allPlaced = !!self && self.ships.every((s) => s !== null);
  readyBtn.disabled = !allPlaced || !!self?.placed;
  orientBtn.disabled = !!self?.placed;

  if (self?.placed) {
    hintEl.textContent = "Locked in — waiting for your opponent…";
    ctx.setStatus("Waiting for your opponent to place their fleet…");
  } else {
    hintEl.textContent = allPlaced
      ? "All ships placed — press Ready."
      : "Pick a ship, rotate if you like, then click your sea to place it.";
    ctx.setStatus("Place your fleet.");
  }
}

/** Firing / intermission: draw both seas with hits, misses and sunk ships. */
function renderSeas(view: BattleshipView, ctx: GameContext): void {
  myLabel.textContent = "Your sea";
  const self = view.self;
  const enemy = view.opponents[0];

  // Your sea: show your ships and the opponent's incoming fire.
  const myShipCells = new Set<number>();
  self?.ships.forEach((ship) => ship?.cells.forEach((c) => myShipCells.add(c)));
  const incomingHits = new Set(self?.incomingHits ?? []);
  const incoming = new Set(self?.incoming ?? []);
  for (let i = 0; i < size * size; i++) {
    const cell = myCells[i];
    cell.className = "battleship-cell";
    cell.disabled = true;
    if (myShipCells.has(i)) cell.classList.add("ship");
    if (incomingHits.has(i)) cell.classList.add("hit");
    else if (incoming.has(i)) cell.classList.add("miss");
  }

  // Enemy sea: your shots (hit/miss) and any ships you've fully sunk.
  const myTurn = view.phase === "playing" && view.turn === view.viewerId;
  const enemyHits = new Set(enemy?.hits ?? []);
  const enemyShots = new Set(enemy?.shots ?? []);
  const sunkCells = new Set<number>();
  enemy?.sunk.forEach((s) => s.cells.forEach((c) => sunkCells.add(c)));
  for (let i = 0; i < size * size; i++) {
    const cell = enemyCells[i];
    cell.className = "battleship-cell";
    if (sunkCells.has(i)) cell.classList.add("sunk");
    else if (enemyHits.has(i)) cell.classList.add("hit");
    else if (enemyShots.has(i)) cell.classList.add("miss");
    cell.disabled = !myTurn || enemyShots.has(i) || ctx.isSpectator === true;
  }

  gridsEl.classList.toggle("is-your-turn", myTurn);

  if (view.phase === "playing") {
    const sunkCount = enemy?.sunk.length ?? 0;
    const total = view.fleet.length;
    ctx.setStatus(
      (myTurn ? "Your turn — fire at the enemy sea" : "Opponent is taking aim…") +
        ` · enemy ships sunk: ${sunkCount}/${total}`,
    );
  }
}

function showIntermission(view: BattleshipView, ctx: GameContext): void {
  const me = view.viewerId;
  const isPlayer = view.players.includes(me);

  let msg: string;
  if (isPlayer && view.result === me) msg = "You won! 🎉";
  else if (view.result) msg = `${ctx.nickname(view.result)} won!`;
  else msg = "Round over";
  resultEl.textContent = msg;

  const opp = view.players.find((id) => id !== me);
  if (isPlayer && opp) {
    scoreEl.textContent = `You ${view.scores[me] ?? 0} — ${ctx.nickname(opp)} ${view.scores[opp] ?? 0}`;
  } else {
    const [a, b] = view.players;
    scoreEl.textContent = `${ctx.nickname(a)} ${view.scores[a] ?? 0} — ${ctx.nickname(b)} ${view.scores[b] ?? 0}`;
  }

  ctx.setStatus(`${msg} — play again or let the host end the game.`);
  void fleetSizes;
}

export default { mount, update } satisfies GamePage<BattleshipView>;
