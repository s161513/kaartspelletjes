import type { GameContext, GameMeta, GamePage, PlayerPublic, SpectatorPublic } from "@app/shared";
import { GameSocket } from "./ws.js";
import { session } from "./session.js";
import { setupChat } from "./chat.js";
import { iconBadge } from "./icons.js";

/**
 * Wire up a per-game page: shared chrome (socket, chat, status, back, error,
 * reconnect-to-lobby) + delegation to the game's renderer (games/<id>/view.ts).
 * Called by client/src/game.ts with the view and meta of the game in the URL.
 *
 * Expected DOM ids: #status, #gameRoot, #back, #error, #chatLog, #chatForm,
 * #chatInput, and optionally #gameTitle, #gameIcon, #endGame and #leaveGame.
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
  document.getElementById("gameIcon")?.replaceChildren(iconBadge(meta, 38));
  document.title = `${meta.title} · Classroom Games`;

  const socket = new GameSocket();
  setupChat(
    socket,
    document.getElementById("chatLog") as HTMLElement,
    document.getElementById("chatForm") as HTMLFormElement,
    document.getElementById("chatInput") as HTMLInputElement,
  );

  // Watching, not seated. Bootstrapped from the session and kept correct live
  // from room-state membership (so a joiner flips to player automatically).
  let isSpectator = session.role === "spectator";
  let joinable = false; // the running game supports joining mid-game
  let committedJoin = false; // we clicked "join next round"
  let spectators: SpectatorPublic[] = [];

  // Player names, from `joined` (the first reply on every (re)connect, before
  // any game state) and kept current by `roomState`.
  const nicknames = new Map<string, string>();
  const rememberPlayers = (players: PlayerPublic[]) => {
    for (const p of players) nicknames.set(p.id, p.nickname);
    ctx.players = players;
  };

  const ctx: GameContext = {
    container: containerEl,
    playerId: session.playerId,
    nickname: (id) => nicknames.get(id) ?? "Player",
    players: [],
    get spectators() { return spectators; },
    get isSpectator() { return isSpectator; },
    get connected() { return socket.connected; },
    // Watchers never send moves; players drop moves while offline instead of
    // queueing stale, time-sensitive input.
    sendMove: (move) => {
      if (!isSpectator && socket.connected) socket.send({ type: "move", move });
    },
    setStatus: (text) => {
      statusEl.textContent = text;
    },
  };

  // --- Spectator chrome (host-level, so every game gets it for free) ---------
  const banner = document.createElement("div");
  banner.className = "spectator-banner";
  banner.style.display = "none";
  const bannerText = document.createElement("span");
  bannerText.textContent = "👀 You are watching — you can chat but not play";
  const joinSwitch = document.createElement("button");
  joinSwitch.className = "secondary spectator-join";
  joinSwitch.textContent = "Join as a player next round";
  joinSwitch.style.display = "none";
  joinSwitch.addEventListener("click", () => {
    committedJoin = true;
    socket.send({ type: "joinNextRound" });
    renderSpectatorChrome();
  });
  banner.append(bannerText, joinSwitch);

  const strip = document.createElement("div");
  strip.className = "spectator-strip";
  strip.style.display = "none";
  containerEl.insertAdjacentElement("beforebegin", banner);
  containerEl.insertAdjacentElement("beforebegin", strip);

  function renderSpectatorChrome(): void {
    banner.style.display = isSpectator ? "flex" : "none";
    const myPending =
      committedJoin || spectators.some((s) => s.id === session.playerId && s.pendingPlayer);
    if (isSpectator && myPending) {
      joinSwitch.textContent = "✓ Joining next round as citizen";
      joinSwitch.disabled = true;
      joinSwitch.style.display = "inline-block";
    } else if (isSpectator && joinable) {
      joinSwitch.textContent = "Join as a player next round";
      joinSwitch.disabled = false;
      joinSwitch.style.display = "inline-block";
    } else {
      joinSwitch.style.display = "none";
    }

    // The watcher list "on the table", visible to everyone.
    strip.innerHTML = "";
    if (spectators.length) {
      const label = document.createElement("span");
      label.className = "spectator-strip-label";
      label.textContent = "👀 Watching:";
      strip.appendChild(label);
      for (const s of spectators) {
        const chip = document.createElement("span");
        chip.className = "spectator-chip" + (s.connected ? "" : " off");
        chip.textContent = s.nickname + (s.pendingPlayer ? " (joining)" : "");
        strip.appendChild(chip);
      }
      strip.style.display = "flex";
    } else {
      strip.style.display = "none";
    }
  }

  // Reconcile role + watcher list from a room snapshot.
  const applyRoomMembership = (
    players: PlayerPublic[],
    specs: SpectatorPublic[] | undefined,
    joinableFlag: boolean | undefined,
  ) => {
    spectators = specs ?? [];
    for (const s of spectators) nicknames.set(s.id, s.nickname);
    if (joinableFlag !== undefined) joinable = joinableFlag;

    const amPlayer = players.some((p) => p.id === session.playerId);
    const amSpectator = spectators.some((s) => s.id === session.playerId);
    if (amPlayer) {
      if (isSpectator) committedJoin = false; // we got dealt in
      isSpectator = false;
      session.role = "player";
    } else if (amSpectator) {
      isSpectator = true;
      session.role = "spectator";
    }
    renderSpectatorChrome();
  };

  let mounted = false;
  let gameOver = false;
  let hostId = "";

  // The host can stop the game (or, once it is over, call everyone back) and
  // the whole room returns to the lobby together.
  const endBtn = document.getElementById("endGame") as HTMLButtonElement | null;
  const renderEndButton = () => {
    if (!endBtn) return;
    endBtn.hidden = isSpectator || hostId !== session.playerId || !mounted;
    endBtn.textContent = gameOver ? "Everyone to lobby" : "End game";
  };
  endBtn?.addEventListener("click", () => {
    if (!gameOver && !confirm("End the game for everyone and go back to the lobby?")) return;
    socket.send({ type: "endGame" });
  });
  socket.on("gameEnded", (msg) => {
    // Chat is not kept across pages, so carry the reason over to the lobby.
    sessionStorage.setItem("cg.notice", `${msg.by} ended the game.`);
    location.href = "/lobby.html";
  });

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
    renderEndButton();
  });

  socket.on("gameState", (msg) => {
    errEl.textContent = "";
    ensureMounted();
    page.update(msg.state as State, ctx);
  });

  socket.on("gameOver", (msg) => {
    if (msg.gameId && msg.gameId !== meta.id) {
      location.href = `/game.html?game=${encodeURIComponent(msg.gameId)}`;
      return;
    }
    gameOver = true;
    ensureMounted();
    renderEndButton();
    page.update(msg.state as State, ctx);
    page.onGameOver?.(msg.winner, msg.state as State, ctx);
    if (msg.winner === "draw") {
      ctx.setStatus("It's a draw! 🤝");
    } else if (isSpectator) {
      ctx.setStatus(`Game over — ${ctx.nickname(msg.winner)} won 🎉`);
    } else if (msg.winner === session.playerId) {
      ctx.setStatus("You win! 🎉");
    } else {
      ctx.setStatus("You lose 😞");
    }
    backBtn.style.display = "inline-block";
  });

  socket.on("error", (msg) => {
    // Our seat is gone (server restarted, room pruned, or stale token): drop the
    // dead session and return to landing instead of stranding the user here.
    if (msg.code === "no_room" || msg.code === "no_seat" || msg.code === "bad_secret") {
      session.clearRoom();
      location.href = "/";
      return;
    }
    errEl.textContent = msg.message;
    page.onError?.(msg.message, ctx);
  });

  // Landed here with no active game (e.g. direct nav / game already ended) and
  // nothing rendered yet → go back to the lobby.
  socket.on("joined", (msg) => {
    hostId = msg.hostId;
    rememberPlayers(msg.players);
    applyRoomMembership(msg.players, msg.spectators, msg.joinable);
    renderEndButton();
  });

  socket.on("roomState", (msg) => {
    hostId = msg.hostId;
    rememberPlayers(msg.players);
    applyRoomMembership(msg.players, msg.spectators, msg.joinable);
    renderEndButton();
    page.onRoomState?.(ctx);
    if (msg.currentGameId === null && !gameOver && !mounted) {
      location.href = "/lobby.html";
    }
  });

  backBtn.addEventListener("click", () => {
    location.href = "/lobby.html";
  });

  document.getElementById("leaveGame")?.addEventListener("click", () => {
    const prompt = isSpectator ? "Stop watching?" : "Leave the game? You can't rejoin it.";
    if (mounted && !gameOver && !confirm(prompt)) return;
    socket.send({ type: "leave" });
    session.clearRoom();
    socket.close();
    location.href = "/";
  });
}
