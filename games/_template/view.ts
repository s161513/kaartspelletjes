import type { Card, GameContext, GamePage } from "@app/shared";
import type { TemplateState } from "./types.js";

// Renderer, run in the browser. The host page (client/src/gameHost.ts) owns the
// socket, chat, status line and back button; this file only draws the game.
//   mount()  once, to build the DOM
//   update() on every new state from the server

const SUIT_SYMBOLS: Record<Card["suit"], string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

let list: HTMLUListElement;
let drawBtn: HTMLButtonElement;

function mount(ctx: GameContext): void {
  list = document.createElement("ul");
  list.className = "players";

  drawBtn = document.createElement("button");
  drawBtn.textContent = "Draw a card";
  drawBtn.addEventListener("click", () => ctx.sendMove({ action: "draw" }));

  ctx.container.append(list, drawBtn);
}

function update(state: TemplateState, ctx: GameContext): void {
  list.innerHTML = "";
  for (const id of state.players) {
    const li = document.createElement("li");
    const card = state.drawn[id];
    li.textContent =
      (id === ctx.playerId ? "You" : "Player") +
      ": " +
      (card ? `${card.rank}${SUIT_SYMBOLS[card.suit]}` : "—");
    list.appendChild(li);
  }

  const myTurn = state.turn === ctx.playerId;
  drawBtn.disabled = !myTurn;
  if (state.turn !== null) {
    ctx.setStatus(myTurn ? "Your turn — draw a card" : "Waiting for another player…");
  }
}

function onGameOver(): void {
  drawBtn.disabled = true;
}

export default { mount, update, onGameOver } satisfies GamePage<TemplateState>;
