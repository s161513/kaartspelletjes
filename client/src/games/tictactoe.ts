import type { TicTacToeState } from "@app/shared";
import { setupGamePage, type GameContext } from "../gameHost.js";

// Tic-tac-toe renderer. The host (gameHost.ts) owns the socket, chat, status
// line, back button and navigation; this file only draws the board and turns
// clicks into moves.

const cells: HTMLButtonElement[] = [];

function mount(ctx: GameContext): void {
  ctx.container.classList.add("board");
  for (let i = 0; i < 9; i++) {
    const b = document.createElement("button");
    b.className = "cell";
    b.dataset.cell = String(i);
    b.addEventListener("click", () => ctx.sendMove({ cell: i }));
    cells.push(b);
    ctx.container.appendChild(b);
  }
}

function update(state: TicTacToeState, ctx: GameContext): void {
  const myTurn = state.turn === ctx.playerId;
  for (let i = 0; i < 9; i++) {
    const mark = state.board[i];
    const cell = cells[i];
    cell.textContent = mark ?? "";
    cell.classList.toggle("x", mark === "X");
    cell.classList.toggle("o", mark === "O");
    // Disabled when it's not our turn, the cell is taken, or the game is over
    // (turn === null once the game ends).
    cell.disabled = !myTurn || mark !== null;
  }

  // Only set the turn status while the game is live; the host sets the
  // win/lose/draw message on game over.
  if (state.turn !== null) {
    const myMark = state.marks[ctx.playerId];
    ctx.setStatus(
      myTurn ? `Your turn — you are ${myMark}` : `Opponent's turn — you are ${myMark}`,
    );
  }
}

function onGameOver(_winner: string | "draw", _state: TicTacToeState, _ctx: GameContext): void {
  // Freeze the board — no further moves.
  for (const cell of cells) cell.disabled = true;
}

setupGamePage<TicTacToeState>({
  gameId: "tictactoe",
  mount,
  update,
  onGameOver,
});
