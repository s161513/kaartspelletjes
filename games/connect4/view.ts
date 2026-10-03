import type { GameContext, GamePage } from "@app/shared";
import type { Cell, Connect4State } from "./types.js";
import { winningLine } from "./logic.js";
import "./style.css";

// Connect Four renderer. The host (client/src/gameHost.ts) owns the socket, chat,
// status line, back button and the host "End game" control; this file draws the
// board, turns column clicks into moves, and shows the between-rounds banner.

const COLS = 7;
const ROWS = 6;

let boardEl: HTMLDivElement;
let bannerEl: HTMLDivElement;
let resultEl: HTMLParagraphElement;
let scoreEl: HTMLParagraphElement;
let againBtn: HTMLButtonElement;
const columns: HTMLButtonElement[] = [];
const cells: HTMLDivElement[] = []; // index = row * COLS + col, row 0 = top

// Previous board, to detect the disc that landed this update and animate only
// that one falling into place.
let prevBoard: Cell[] = Array<Cell>(COLS * ROWS).fill(null);

function mount(ctx: GameContext): void {
  prevBoard = Array<Cell>(COLS * ROWS).fill(null);

  boardEl = document.createElement("div");
  boardEl.className = "connect4-board";

  for (let col = 0; col < COLS; col++) {
    const column = document.createElement("button");
    column.className = "connect4-col";
    column.dataset.col = String(col);
    column.addEventListener("click", () => ctx.sendMove({ col }));

    for (let row = 0; row < ROWS; row++) {
      const cell = document.createElement("div");
      cell.className = "connect4-cell";
      cells[row * COLS + col] = cell;
      column.appendChild(cell);
    }

    columns[col] = column;
    boardEl.appendChild(column);
  }

  // Colour the hover ghost for seated players only (spectators can't move).
  if (!ctx.isSpectator) boardEl.classList.add("has-ghost");

  // Between-rounds banner (hidden while playing).
  bannerEl = document.createElement("div");
  bannerEl.className = "connect4-banner";
  bannerEl.hidden = true;
  resultEl = document.createElement("p");
  resultEl.className = "connect4-result";
  scoreEl = document.createElement("p");
  scoreEl.className = "connect4-score";
  againBtn = document.createElement("button");
  againBtn.className = "connect4-again";
  againBtn.textContent = "Play again";
  againBtn.addEventListener("click", () => ctx.sendMove({ again: true }));
  bannerEl.append(resultEl, scoreEl);
  if (!ctx.isSpectator) bannerEl.appendChild(againBtn);

  ctx.container.append(boardEl, bannerEl);
}

function update(state: Connect4State, ctx: GameContext): void {
  const playing = state.phase === "playing";
  const myTurn = playing && state.turn === ctx.playerId;

  // Tell the CSS which colour this player drops, for the hover ghost.
  const myDisc = state.discs[ctx.playerId];
  if (myDisc) {
    boardEl.style.setProperty("--c4-my-color", myDisc === "R" ? "var(--red)" : "var(--gold)");
  }

  for (let col = 0; col < COLS; col++) {
    let full = true;
    for (let row = 0; row < ROWS; row++) {
      const i = row * COLS + col;
      const disc = state.board[i];
      const cell = cells[i];
      cell.classList.toggle("red", disc === "R");
      cell.classList.toggle("yellow", disc === "Y");
      cell.classList.remove("is-winning"); // re-added below during intermission
      if (disc === null) full = false;

      if (disc === null) {
        cell.classList.remove("is-dropping"); // clear leftover from a prior round
      } else if (prevBoard[i] === null) {
        // Newly landed disc — (re)play the drop animation.
        cell.classList.remove("is-dropping");
        void cell.offsetWidth; // reflow so the animation restarts
        cell.style.setProperty("--c4-fall", String(row + 1));
        cell.classList.add("is-dropping");
      }
    }
    // Columns are only playable on your turn during a live round.
    columns[col].disabled = !myTurn || full;
  }

  prevBoard = state.board.slice();

  // Pulse the board only while it's your turn.
  boardEl.classList.toggle("is-your-turn", myTurn);

  if (playing) {
    bannerEl.hidden = true;
    const myColour = myDisc === "R" ? "Red" : "Yellow";
    ctx.setStatus(
      myTurn
        ? `Your turn — you are ${myColour}`
        : `Opponent's turn — you are ${myColour}`,
    );
  } else {
    showIntermission(state, ctx);
  }
}

/** Render the between-rounds banner, highlight the winning four, set the status. */
function showIntermission(state: Connect4State, ctx: GameContext): void {
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

/** Light up the 4 discs that form a line, if any. */
function highlightWin(board: Cell[]): void {
  const line = winningLine(board);
  if (!line) return;
  for (const i of line.cells) cells[i].classList.add("is-winning");
}

export default { mount, update } satisfies GamePage<Connect4State>;
