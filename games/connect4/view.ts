import type { GameContext, GamePage } from "@app/shared";
import type { Cell, Connect4State } from "./types.js";
import { winningLine } from "./logic.js";
import "./style.css";

// Connect Four renderer. The host (client/src/gameHost.ts) owns the socket, chat,
// status line, back button and navigation; this file only draws the board and
// turns column clicks into moves.

const COLS = 7;
const ROWS = 6;

let boardEl: HTMLDivElement;
const columns: HTMLButtonElement[] = [];
const cells: HTMLDivElement[] = []; // index = row * COLS + col, row 0 = top

// Previous board, to detect the single disc that landed this update and animate
// only that one falling into place.
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
  if (!ctx.isSpectator) {
    boardEl.classList.add("has-ghost");
  }

  ctx.container.appendChild(boardEl);
}

function update(state: Connect4State, ctx: GameContext): void {
  const myTurn = state.turn === ctx.playerId;

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
      if (disc === null) full = false;

      // Animate the one disc that just landed (null -> colour).
      if (disc !== null && prevBoard[i] === null) {
        cell.style.setProperty("--c4-fall", String(row + 1));
        cell.classList.add("is-dropping");
      }
    }
    // Disabled when it's not our turn, the column is full, or the game is over.
    columns[col].disabled = !myTurn || full;
  }

  prevBoard = state.board.slice();

  // Pulse the board while it's our turn.
  boardEl.classList.toggle("is-your-turn", myTurn && state.turn !== null);

  // Highlight the winning four as soon as a line exists.
  highlightWin(state.board);

  // Only set the turn status while the game is live; the host sets the
  // win/lose/draw message on game over.
  if (state.turn !== null) {
    const myColour = myDisc === "R" ? "Red" : "Yellow";
    ctx.setStatus(
      myTurn
        ? `Your turn — you are ${myColour}`
        : `Opponent's turn — you are ${myColour}`,
    );
  }
}

/** Light up the 4 discs that form a line, if any. */
function highlightWin(board: Cell[]): void {
  const line = winningLine(board);
  if (!line) return;
  for (const i of line.cells) cells[i].classList.add("is-winning");
}

function onGameOver(_winner: string | "draw", state: Connect4State): void {
  // Freeze the board — no further moves — and make sure the win is highlighted.
  boardEl.classList.remove("is-your-turn");
  for (const column of columns) column.disabled = true;
  highlightWin(state.board);
}

export default { mount, update, onGameOver } satisfies GamePage<Connect4State>;
