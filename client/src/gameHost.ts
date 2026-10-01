import type { GameId, GameState } from "@app/shared";
import { GAMES } from "@app/shared";
import { GameSocket } from "./ws.js";
import { session } from "./session.js";
import { setupChat } from "./chat.js";

/**
 * What a game page receives to render itself. The host owns the socket, chat,
 * status line and navigation; the game only draws its board and sends moves.
 */
export interface GameContext {
  /** Element the game renders its board into. */
  container: HTMLElement;
  /** This client's player id. */
  playerId: string;
  /** Send a validated-server-side move payload. */
  sendMove(move: unknown): void;
  /** Set the status line text (turn indicator, etc.). */
  setStatus(text: string): void;
}

export interface GamePage<State extends GameState = GameState> {
  gameId: GameId;
  /** Build the board DOM once. Called before the first `update`. */
  mount(ctx: GameContext): void;
  /** Render a fresh state. */
  update(state: State, ctx: GameContext): void;
  /** Optional hook when the game ends (e.g. freeze the board). */
  onGameOver?(winner: string | "draw", state: State, ctx: GameContext): void;
}

/**
 * Wire up a per-game page: shared chrome (socket, chat, status, back, error,
 * reconnect-to-lobby) + delegation to the game's renderer. Each game page file
 * is just `setupGamePage(<its GamePage>)`.
 *
 * Expected DOM ids: #status, #gameRoot, #back, #error, #chatLog, #chatForm,
 * #chatInput, and optionally #gameTitle.
 */
export function setupGamePage<State extends GameState>(
  page: GamePage<State>,
): void {
  // Guard: must have a seat to be here.
  if (!session.roomCode || !session.playerId) {
    location.href = "/";
    return;
  }

  const statusEl = document.getElementById("status") as HTMLDivElement;
  const containerEl = document.getElementById("gameRoot") as HTMLDivElement;
  const backBtn = document.getElementById("back") as HTMLButtonElement;
  const errEl = document.getElementById("error") as HTMLParagraphElement;
  const titleEl = document.getElementById("gameTitle");
  if (titleEl) titleEl.textContent = GAMES[page.gameId].title;

  const socket = new GameSocket();
  setupChat(
    socket,
    document.getElementById("chatLog") as HTMLElement,
    document.getElementById("chatForm") as HTMLFormElement,
    document.getElementById("chatInput") as HTMLInputElement,
  );

  const ctx: GameContext = {
    container: containerEl,
    playerId: session.playerId,
    sendMove: (move) => socket.send({ type: "move", move }),
    setStatus: (text) => {
      statusEl.textContent = text;
    },
  };

  let mounted = false;
  let gameOver = false;

  const ensureMounted = () => {
    if (!mounted) {
      page.mount(ctx);
      mounted = true;
    }
  };

  socket.on("gameStarted", (msg) => {
    gameOver = false;
    backBtn.style.display = "none";
    errEl.textContent = "";
    ensureMounted();
    page.update(msg.state as State, ctx);
  });

  socket.on("gameState", (msg) => {
    ensureMounted();
    page.update(msg.state as State, ctx);
  });

  socket.on("gameOver", (msg) => {
    gameOver = true;
    ensureMounted();
    page.update(msg.state as State, ctx);
    page.onGameOver?.(msg.winner, msg.state as State, ctx);
    if (msg.winner === "draw") {
      ctx.setStatus("It's a draw! 🤝");
    } else if (msg.winner === session.playerId) {
      ctx.setStatus("You win! 🎉");
    } else {
      ctx.setStatus("You lose 😞");
    }
    backBtn.style.display = "inline-block";
  });

  socket.on("error", (msg) => {
    errEl.textContent = msg.message;
  });

  // Landed here with no active game (e.g. direct nav / game already ended) and
  // nothing rendered yet → go back to the lobby.
  socket.on("roomState", (msg) => {
    if (msg.currentGameId === null && !gameOver && !mounted) {
      location.href = "/lobby.html";
    }
  });

  backBtn.addEventListener("click", () => {
    location.href = "/lobby.html";
  });
}
