import type { GameContext, GamePage } from "@app/shared";
import type { Cell, GomokuState } from "./types.js";
import { winningLine, SIZE } from "./logic.js";
import "./style.css";

// Gomoku renderer. The host (client/src/gameHost.ts) owns the socket, chat,
// status line, back button and the host "End game" control; this file draws the
// board, turns cell clicks into moves, and shows the between-rounds banner.

let boardEl: HTMLDivElement;
let bannerEl: HTMLDivElement;
let resultEl: HTMLParagraphElement;
let scoreEl: HTMLParagraphElement;
let againBtn: HTMLButtonElement;
const cells: HTMLButtonElement[] = []; // index = row * SIZE + col, row 0 = top

// Previous board, to detect the stone that landed this update and animate only
// that one placing into view.
let prevBoard: Cell[] = Array<Cell>(SIZE * SIZE).fill(null);

function mount(ctx: GameContext): void {
  prevBoard = Array<Cell>(SIZE * SIZE).fill(null);
  cells.length = 0;

  boardEl = document.createElement("div");
  boardEl.className = "gomoku-board";
  boardEl.style.setProperty("--gomoku-size", String(SIZE));

  for (let i = 0; i < SIZE * SIZE; i++) {
    const cell = document.createElement("button");
    cell.className = "gomoku-cell";
    cell.dataset.cell = String(i);
    cell.addEventListener("click", () => ctx.sendMove({ cell: i }));
    cells[i] = cell;
    boardEl.appendChild(cell);
  }

  // Between-rounds banner (hidden while playing).
  bannerEl = document.createElement("div");
  bannerEl.className = "gomoku-banner";
  bannerEl.hidden = true;
  resultEl = document.createElement("p");
  resultEl.className = "gomoku-result";
  scoreEl = document.createElement("p");
  scoreEl.className = "gomoku-score";
  againBtn = document.createElement("button");
  againBtn.className = "gomoku-again";
  againBtn.textContent = "Play again";
  againBtn.addEventListener("click", () => ctx.sendMove({ again: true }));
  bannerEl.append(resultEl, scoreEl);
  if (!ctx.isSpectator) bannerEl.appendChild(againBtn);

  ctx.container.append(boardEl, bannerEl);
}

function update(state: GomokuState, ctx: GameContext): void {
  const playing = state.phase === "playing";
  const myTurn = playing && state.turn === ctx.playerId;

  for (let i = 0; i < SIZE * SIZE; i++) {
    const stone = state.board[i];
    const cell = cells[i];
    cell.classList.toggle("black", stone === "B");
    cell.classList.toggle("white", stone === "W");
    cell.classList.remove("is-winning"); // re-added below during intermission

    if (stone === null) {
      cell.classList.remove("is-placing");
    } else if (prevBoard[i] === null) {
      // Newly placed stone — (re)play the place-in animation.
      cell.classList.remove("is-placing");
      void cell.offsetWidth; // reflow so the animation restarts
      cell.classList.add("is-placing");
    }
    // Cells are only playable on your turn, and only while empty.
    cell.disabled = !myTurn || stone !== null;
  }

  prevBoard = state.board.slice();

  // Pulse the board only while it's your turn.
  boardEl.classList.toggle("is-your-turn", myTurn);

  if (playing) {
    bannerEl.hidden = true;
    const myColour = state.stones[ctx.playerId] === "B" ? "Black" : "White";
    ctx.setStatus(
      myTurn
        ? `Your turn — you are ${myColour}`
        : `Opponent's turn — you are ${myColour}`,
    );
  } else {
    showIntermission(state, ctx);
  }
}

/** Render the between-rounds banner, highlight the winning line, set the status. */
function showIntermission(state: GomokuState, ctx: GameContext): void {
  highlightWin(state.board);

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

  if (isPlayer && opp) {
    scoreEl.textContent = `You ${state.scores[me] ?? 0} — ${ctx.nickname(opp)} ${state.scores[opp] ?? 0}`;
  } else {
    const [a, b] = state.players;
    scoreEl.textContent = `${ctx.nickname(a)} ${state.scores[a] ?? 0} — ${ctx.nickname(b)} ${state.scores[b] ?? 0}`;
  }
  if (state.draws > 0) {
    scoreEl.textContent += ` · ${state.draws} draw${state.draws === 1 ? "" : "s"}`;
  }

  bannerEl.hidden = false;
  ctx.setStatus(`${msg} — play again or let the host end the game.`);
}

/** Light up the 5 stones that form a line, if any. */
function highlightWin(board: Cell[]): void {
  const line = winningLine(board);
  if (!line) return;
  for (const i of line.cells) cells[i].classList.add("is-winning");
}

export default { mount, update } satisfies GamePage<GomokuState>;
