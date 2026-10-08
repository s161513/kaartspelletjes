import type { GameContext, GamePage } from "@app/shared";
import type { Cell, ReversiState } from "./types.js";
import { legalMoves, counts, SIZE } from "./logic.js";
import "./style.css";

// Reversi renderer. The host (client/src/gameHost.ts) owns the socket, chat,
// status line, back button and the host "End game" control; this file draws the
// board, turns cell clicks into moves, and shows the between-rounds banner.

let boardEl: HTMLDivElement;
let bannerEl: HTMLDivElement;
let resultEl: HTMLParagraphElement;
let scoreEl: HTMLParagraphElement;
let againBtn: HTMLButtonElement;
const cells: HTMLButtonElement[] = []; // index = row * SIZE + col, row 0 = top

let prevBoard: Cell[] = [];

function mount(ctx: GameContext): void {
  prevBoard = [];
  cells.length = 0;

  boardEl = document.createElement("div");
  boardEl.className = "reversi-board";

  for (let i = 0; i < SIZE * SIZE; i++) {
    const cell = document.createElement("button");
    cell.className = "reversi-cell";
    cell.dataset.cell = String(i);
    cell.addEventListener("click", () => ctx.sendMove({ cell: i }));
    const disc = document.createElement("span");
    disc.className = "reversi-disc";
    cell.appendChild(disc);
    cells[i] = cell;
    boardEl.appendChild(cell);
  }

  bannerEl = document.createElement("div");
  bannerEl.className = "reversi-banner";
  bannerEl.hidden = true;
  resultEl = document.createElement("p");
  resultEl.className = "reversi-result";
  scoreEl = document.createElement("p");
  scoreEl.className = "reversi-score";
  againBtn = document.createElement("button");
  againBtn.className = "reversi-again";
  againBtn.textContent = "Play again";
  againBtn.addEventListener("click", () => ctx.sendMove({ again: true }));
  bannerEl.append(resultEl, scoreEl);
  if (!ctx.isSpectator) bannerEl.appendChild(againBtn);

  ctx.container.append(boardEl, bannerEl);
}

function update(state: ReversiState, ctx: GameContext): void {
  const playing = state.phase === "playing";
  const myColour = state.discs[ctx.playerId];
  const myTurn = playing && state.turn === ctx.playerId;

  // Cells the current player may legally play on (used to hint on your turn).
  const legal = myTurn && myColour ? new Set(legalMoves(state.board, myColour)) : new Set<number>();

  for (let i = 0; i < SIZE * SIZE; i++) {
    const disc = state.board[i];
    const cell = cells[i];
    cell.classList.toggle("black", disc === "B");
    cell.classList.toggle("white", disc === "W");

    // Animate a disc that newly appeared or flipped colour since last update.
    if (disc !== null && prevBoard[i] !== disc) {
      const span = cell.firstElementChild as HTMLElement;
      span.classList.remove("is-placing");
      void span.offsetWidth; // reflow so the animation restarts
      span.classList.add("is-placing");
    }

    const playable = legal.has(i);
    cell.classList.toggle("is-legal", playable);
    cell.disabled = !playable;
  }

  prevBoard = state.board.slice();
  boardEl.classList.toggle("is-your-turn", myTurn);

  if (playing) {
    bannerEl.hidden = true;
    const { B, W } = counts(state.board);
    const mine = myColour === "B" ? B : W;
    const theirs = myColour === "B" ? W : B;
    const colourName = myColour === "B" ? "Black" : "White";
    let msg = myTurn
      ? `Your turn — you are ${colourName}`
      : `Opponent's turn — you are ${colourName}`;
    if (myTurn && state.passed) msg += " (opponent had to pass)";
    msg += ` · ${mine}–${theirs}`;
    ctx.setStatus(msg);
  } else {
    showIntermission(state, ctx);
  }
}

function showIntermission(state: ReversiState, ctx: GameContext): void {
  const me = ctx.playerId;
  const isPlayer = state.players.includes(me);
  const opp = state.players.find((id) => id !== me);

  let msg: string;
  if (state.result === "draw") {
    msg = "It's a draw!";
  } else if (isPlayer && state.result === me) {
    msg = "You won! 🎉";
  } else {
    msg = `${ctx.nickname(state.result ?? "")} won!`;
  }
  resultEl.textContent = msg;

  const { B, W } = counts(state.board);
  const discLine =
    isPlayer && state.discs[me] === "B" ? `${B}–${W} discs` : `${W}–${B} discs`;

  if (isPlayer && opp) {
    scoreEl.textContent =
      `${discLine} · rounds: You ${state.scores[me] ?? 0} — ${ctx.nickname(opp)} ${state.scores[opp] ?? 0}`;
  } else {
    const [a, b] = state.players;
    scoreEl.textContent =
      `rounds: ${ctx.nickname(a)} ${state.scores[a] ?? 0} — ${ctx.nickname(b)} ${state.scores[b] ?? 0}`;
  }
  if (state.draws > 0) {
    scoreEl.textContent += ` · ${state.draws} draw${state.draws === 1 ? "" : "s"}`;
  }

  bannerEl.hidden = false;
  ctx.setStatus(`${msg} — play again or let the host end the game.`);
}

export default { mount, update } satisfies GamePage<ReversiState>;
