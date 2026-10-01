import type { PlayerPublic, GameMeta } from "@app/shared";
import { GAMES, GAME_LIST } from "@app/shared";
import { GameSocket } from "./ws.js";
import { session } from "./session.js";
import { setupChat } from "./chat.js";

// Guard: must have a seat to be here.
if (!session.roomCode || !session.playerId) {
  location.href = "/";
}

const roomCodeEl = document.getElementById("roomCode") as HTMLDivElement;
const playersEl = document.getElementById("players") as HTMLUListElement;
const gameListEl = document.getElementById("gameList") as HTMLDivElement;
const leaveBtn = document.getElementById("leave") as HTMLButtonElement;
const hintEl = document.getElementById("hint") as HTMLParagraphElement;

roomCodeEl.textContent = session.roomCode;

const socket = new GameSocket();
setupChat(
  socket,
  document.getElementById("chatLog") as HTMLElement,
  document.getElementById("chatForm") as HTMLFormElement,
  document.getElementById("chatInput") as HTMLInputElement,
);

// Build one "Start <title>" button per catalogued game. Enabled/disabled is
// updated from room state. Kept keyed by gameId so we can toggle them.
const startButtons = new Map<string, HTMLButtonElement>();
for (const meta of GAME_LIST) {
  const btn = document.createElement("button");
  btn.textContent = `Start ${meta.title}`;
  btn.title = meta.description ?? "";
  btn.disabled = true;
  btn.addEventListener("click", () => {
    socket.send({ type: "startGame", gameId: meta.id });
  });
  startButtons.set(meta.id, btn);
  gameListEl.appendChild(btn);
}

function renderPlayers(players: PlayerPublic[], hostId: string): void {
  playersEl.innerHTML = "";
  for (const p of players) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent =
      p.nickname +
      (p.id === session.playerId ? " (you)" : "") +
      (p.id === hostId ? " 👑" : "");
    li.appendChild(name);

    const badge = document.createElement("span");
    badge.className = "badge" + (p.connected ? "" : " off");
    badge.textContent = p.connected ? "online" : "away";
    li.appendChild(badge);

    playersEl.appendChild(li);
  }
}

function fits(meta: GameMeta, count: number): boolean {
  return count >= meta.minPlayers && count <= meta.maxPlayers;
}

function updateGameButtons(players: PlayerPublic[], hostId: string): void {
  const isHost = hostId === session.playerId;
  const count = players.filter((p) => p.connected).length;

  for (const meta of GAME_LIST) {
    const btn = startButtons.get(meta.id)!;
    btn.disabled = !(isHost && fits(meta, count));
  }

  if (!isHost) {
    hintEl.textContent = "Waiting for the host to start a game…";
    return;
  }
  // Host hint: if nothing is currently startable, say why (based on the catalog).
  const anyReady = GAME_LIST.some((m) => fits(m, count));
  if (anyReady) {
    hintEl.textContent = "";
  } else {
    const ranges = GAME_LIST.map(
      (m) =>
        `${m.title} needs ${
          m.minPlayers === m.maxPlayers
            ? m.minPlayers
            : `${m.minPlayers}–${m.maxPlayers}`
        }`,
    ).join("; ");
    hintEl.textContent = `Not enough players yet (${count}). ${ranges}.`;
  }
}

socket.on("roomState", (msg) => {
  renderPlayers(msg.players, msg.hostId);
  updateGameButtons(msg.players, msg.hostId);
});

// When a game begins (started by anyone, incl. us) go to that game's page.
socket.on("gameStarted", (msg) => {
  location.href = GAMES[msg.gameId].page;
});

socket.on("error", (msg) => {
  hintEl.textContent = msg.message;
});

leaveBtn.addEventListener("click", () => {
  socket.send({ type: "leave" });
  session.clearRoom();
  socket.close();
  location.href = "/";
});
