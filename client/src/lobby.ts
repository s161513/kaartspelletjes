import type { PlayerPublic, SpectatorPublic, GameMeta } from "@app/shared";
import { GameSocket } from "./ws.js";
import { session } from "./session.js";
import { setupChat } from "./chat.js";
import { GAME_LIST } from "./catalog.js";
import { el, gameTile, hue, lockIcon } from "./ui.js";

// Guard: must have a seat to be here.
if (!session.roomCode || !session.playerId) {
  location.href = "/";
}

const roomNameEl = document.getElementById("roomName") as HTMLElement;
const playersEl = document.getElementById("players") as HTMLUListElement;
const gameListEl = document.getElementById("gameList") as HTMLDivElement;
const leaveBtn = document.getElementById("leave") as HTMLButtonElement;
const hintEl = document.getElementById("hint") as HTMLParagraphElement;
const spectatorsBox = document.getElementById("spectatorsBox") as HTMLDivElement;
const spectatorsEl = document.getElementById("spectators") as HTMLUListElement;
const joinAsPlayerBtn = document.getElementById("joinAsPlayer") as HTMLButtonElement;

const socket = new GameSocket();
setupChat(
  socket,
  document.getElementById("chatLog") as HTMLElement,
  document.getElementById("chatForm") as HTMLFormElement,
  document.getElementById("chatInput") as HTMLInputElement,
);

function showRoomName(name: string | undefined, locked: boolean | undefined): void {
  if (!name) return;
  roomNameEl.textContent = name;
  if (locked) roomNameEl.prepend(lockIcon());
  document.title = `${name} · Classroom Games`;
}

/** Neutral info (waiting, player counts) vs. a server error. */
function setHint(text: string, isError = false): void {
  hintEl.textContent = text;
  hintEl.className = isError ? "hint error" : "hint";
}

// One tile with a Start button per catalogued game. Enabled/disabled is
// updated from room state. Kept keyed by gameId so we can toggle them.
const startButtons = new Map<string, HTMLButtonElement>();
for (const meta of [...GAME_LIST].sort((a, b) => a.title.localeCompare(b.title))) {
  const tile = gameTile(meta);
  const btn = el("button", undefined, "Start");
  btn.disabled = true;
  btn.addEventListener("click", () => {
    socket.send({ type: "startGame", gameId: meta.id });
  });
  tile.append(btn);
  startButtons.set(meta.id, btn);
  gameListEl.appendChild(tile);
}

/** A player chip: coloured initial, name, and optional badges. */
function personChip(nickname: string, isYou: boolean, connected: boolean, badges: string[]): HTMLLIElement {
  const li = el("li", connected ? "" : "is-away");
  const avatar = el("span", "avatar", nickname.charAt(0).toUpperCase());
  avatar.style.setProperty("--hue", String(hue(nickname)));
  const name = el("span", "name", nickname);
  if (isYou) name.append(el("span", "you", " (you)"));
  li.append(avatar, name);
  for (const b of badges) li.append(el("span", `badge ${b}`, b === "off" ? "away" : b));
  return li;
}

function renderPlayers(players: PlayerPublic[], hostId: string): void {
  playersEl.innerHTML = "";
  for (const p of players) {
    const badges = [p.id === hostId ? "host" : "", p.connected ? "" : "off"].filter(Boolean);
    playersEl.appendChild(personChip(p.nickname, p.id === session.playerId, p.connected, badges));
  }
}

function renderSpectators(spectators: SpectatorPublic[]): void {
  const amSpectator = spectators.some((s) => s.id === session.playerId);
  spectatorsBox.hidden = spectators.length === 0;
  spectatorsEl.innerHTML = "";
  for (const s of spectators) {
    spectatorsEl.appendChild(personChip(s.nickname, s.id === session.playerId, s.connected, s.connected ? [] : ["off"]));
  }
  // A watcher who ended up back in the lobby can take a seat for the next game.
  joinAsPlayerBtn.hidden = !amSpectator;
}

function fits(meta: GameMeta, count: number): boolean {
  return count >= meta.minPlayers && count <= meta.maxPlayers;
}

function updateGameButtons(players: PlayerPublic[], hostId: string): void {
  const isHost = hostId === session.playerId;
  const count = players.filter((p) => p.connected).length;

  for (const meta of GAME_LIST) {
    const btn = startButtons.get(meta.id)!;
    const ready = fits(meta, count);
    btn.disabled = !(isHost && ready);
    btn.closest(".game-tile")?.classList.toggle("is-ready", isHost && ready);
    btn.textContent = ready
      ? isHost ? "Start" : "Host starts"
      : count < meta.minPlayers ? `Need ${meta.minPlayers - count} more` : "Too many players";
  }

  if (!isHost) {
    setHint("Waiting for the host to start a game…");
    return;
  }
  // Each tile says what it still needs; the hint only covers "nothing fits yet".
  const anyReady = GAME_LIST.some((m) => fits(m, count));
  setHint(anyReady ? "" : `Not enough players yet (${count}) — others can find this room in the list on the start page.`);
}

// A one-off notice from the previous page (e.g. "Anna ended the game.").
let notice = sessionStorage.getItem("cg.notice");
sessionStorage.removeItem("cg.notice");

socket.on("roomState", (msg) => {
  showRoomName(msg.roomName, msg.locked);
  renderPlayers(msg.players, msg.hostId);
  updateGameButtons(msg.players, msg.hostId);
  renderSpectators(msg.spectators ?? []);
  if (notice) {
    setHint(notice);
    notice = null;
  }
  // If we were a watcher and have now been seated, we're a normal player again.
  if (msg.players.some((p) => p.id === session.playerId)) session.role = "player";
});

socket.on("joined", (msg) => {
  showRoomName(msg.roomName, msg.locked);
  session.secret = msg.secret;
  session.role = msg.role ?? "player";
  renderSpectators(msg.spectators ?? []);
});

joinAsPlayerBtn.addEventListener("click", () => {
  socket.send({ type: "joinNextRound" });
});

// When a game begins (started by anyone, incl. us) go to that game's page.
socket.on("gameStarted", (msg) => {
  location.href = `/game.html?game=${encodeURIComponent(msg.gameId)}`;
});

socket.on("error", (msg) => {
  // Our seat is gone (server restarted, room pruned, or stale token): drop the
  // dead session and return to landing instead of being stuck in a dead lobby.
  if (msg.code === "no_room" || msg.code === "no_seat" || msg.code === "bad_secret") {
    session.clearRoom();
    location.href = "/";
    return;
  }
  setHint(msg.message, true);
});

leaveBtn.addEventListener("click", () => {
  socket.send({ type: "leave" });
  session.clearRoom();
  socket.close();
  location.href = "/";
});
