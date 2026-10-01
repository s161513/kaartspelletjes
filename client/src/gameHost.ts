import type { GameContext, GameMeta, GamePage } from "@app/shared";
import { GameSocket } from "./ws.js";
import { session } from "./session.js";
import { setupChat } from "./chat.js";

/**
 * Wire up a per-game page: shared chrome (socket, chat, status, back, error,
 * reconnect-to-lobby) + delegation to the game's renderer (games/<id>/view.ts).
 * Called by client/src/game.ts with the view and meta of the game in the URL.
 *
 * Expected DOM ids: #status, #gameRoot, #back, #error, #chatLog, #chatForm,
 * #chatInput, and optionally #gameTitle and #leaveGame.
 */
export function setupGamePage<State>(
  page: GamePage<State>,
  meta: GameMeta,
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
  if (titleEl) titleEl.textContent = meta.title;
  document.title = `${meta.title} · Classroom Games`;

  const socket = new GameSocket();
  setupChat(
    socket,
    document.getElementById("chatLog") as HTMLElement,
    document.getElementById("chatForm") as HTMLFormElement,
    document.getElementById("chatInput") as HTMLInputElement,
  );

  // Latest player list from roomState (sent before gameStarted on every join).
  const nicknames = new Map<string, string>();

  const ctx: GameContext = {
    container: containerEl,
    playerId: session.playerId,
    nickname: (id) => nicknames.get(id) ?? "Player",
    players: [],
    get connected() { return socket.connected; },
    // Drop moves while offline instead of queueing stale, time-sensitive input.
    sendMove: (move) => {
      if (socket.connected) socket.send({ type: "move", move });
    },
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
    if (msg.gameId !== meta.id) {
      location.href = `/game.html?game=${encodeURIComponent(msg.gameId)}`;
      return;
    }
    gameOver = false;
    backBtn.style.display = "none";
    errEl.textContent = "";
    ensureMounted();
    page.update(msg.state as State, ctx);
  });

  socket.on("gameState", (msg) => {
    errEl.textContent = "";
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
    page.onError?.(msg.message, ctx);
  });

  // Landed here with no active game (e.g. direct nav / game already ended) and
  // nothing rendered yet → go back to the lobby.
  socket.on("roomState", (msg) => {
    for (const p of msg.players) nicknames.set(p.id, p.nickname);
    ctx.players = msg.players;
    page.onRoomState?.(ctx);
    if (msg.currentGameId === null && !gameOver && !mounted) {
      location.href = "/lobby.html";
    }
  });

  backBtn.addEventListener("click", () => {
    location.href = "/lobby.html";
  });

  document.getElementById("leaveGame")?.addEventListener("click", () => {
    if (mounted && !gameOver && !confirm("Leave the game? You can't rejoin it.")) return;
    socket.send({ type: "leave" });
    session.clearRoom();
    socket.close();
    location.href = "/";
  });
}
