import type { RoomSummary } from "@app/shared";
import { GameSocket } from "./ws.js";
import { session } from "./session.js";
import { getMeta } from "./catalog.js";
import { el, lockIcon } from "./ui.js";
import { iconBadge } from "./icons.js";

const nickEl = document.getElementById("nickname") as HTMLInputElement;
const createForm = document.getElementById("createForm") as HTMLFormElement;
const roomNameEl = document.getElementById("roomName") as HTMLInputElement;
const roomPasswordEl = document.getElementById("roomPassword") as HTMLInputElement;
const errEl = document.getElementById("error") as HTMLParagraphElement;
const listEl = document.getElementById("roomList") as HTMLUListElement;
const countEl = document.getElementById("roomCount") as HTMLElement;

// Auto-resume: if we still hold a seat (reload, reopened tab, browser restart),
// head to the lobby, which reconnects and rejoins. A failed rejoin there clears
// the stale seat and bounces back here. Creating/joining below overwrites the
// seat from the server's `joined` reply, so starting fresh still works.
if (session.roomCode && session.playerId) {
  location.href = "/lobby.html";
}
nickEl.value = session.nickname;

const socket = new GameSocket();
// The server pushes the open-room list; renew the subscription on every reconnect.
socket.onOpen(() => socket.send({ type: "watchRooms" }));

/** The room the last join/watch went to, so a server error lands on its row. */
let attempt: string | null = null;

socket.on("joined", (msg) => {
  session.playerId = msg.playerId;
  session.roomCode = msg.roomCode;
  session.secret = msg.secret;
  session.role = msg.role ?? "player";
  location.href = "/lobby.html";
});

socket.on("error", (msg) => {
  const row = attempt ? rows.get(attempt) : undefined;
  if (row) {
    row.error.textContent = msg.message;
    if (msg.code === "bad_password") {
      openUnlock(row);
      row.password.select();
    }
  } else {
    errEl.textContent = msg.message;
  }
});

socket.on("roomList", (msg) => renderRooms(msg.rooms));

function nickname(): string | null {
  const n = nickEl.value.trim();
  if (!n) {
    errEl.textContent = "Enter your name first.";
    nickEl.focus();
    return null;
  }
  errEl.textContent = "";
  session.nickname = n;
  return n;
}

createForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const n = nickname();
  if (!n) return;
  attempt = null;
  socket.send({
    type: "create",
    nickname: n,
    roomName: roomNameEl.value.trim() || undefined,
    password: roomPasswordEl.value || undefined,
  });
});

// ---------------------------------------------------------------------------
// Room list — rows are kept by room code and updated in place, so a password
// being typed survives the live updates.
// ---------------------------------------------------------------------------

interface Row {
  room: RoomSummary;
  li: HTMLLIElement;
  icon: HTMLElement;
  iconFor: string | null | undefined;
  name: HTMLElement;
  meta: HTMLElement;
  action: HTMLButtonElement;
  unlock: HTMLFormElement;
  password: HTMLInputElement;
  error: HTMLElement;
}

const rows = new Map<string, Row>();

function enter(row: Row, password?: string): void {
  const n = nickname();
  if (!n) return;
  attempt = row.room.code;
  row.error.textContent = "";
  socket.send({
    type: row.room.gameId ? "spectate" : "join",
    nickname: n,
    roomCode: row.room.code,
    password,
  });
}

function openUnlock(row: Row): void {
  row.unlock.hidden = false;
  row.password.focus();
}

function buildRow(room: RoomSummary): Row {
  const li = el("li", "room");
  const icon = el("div", "room-icon");
  const name = el("div", "room-name");
  const meta = el("div", "room-meta");
  const actionBox = el("div", "room-action");
  const action = el("button");
  actionBox.append(action);

  const unlock = el("form", "room-unlock");
  unlock.hidden = true;
  const password = el("input");
  password.type = "password";
  password.placeholder = "Password";
  password.autocomplete = "off";
  const go = el("button", undefined, "Enter");
  go.type = "submit";
  unlock.append(password, go);
  const error = el("p", "error room-error");

  li.append(icon, name, actionBox, meta, unlock, error);
  const row: Row = { room, li, icon, iconFor: undefined, name, meta, action, unlock, password, error };

  action.addEventListener("click", () => {
    if (row.room.locked) openUnlock(row);
    else enter(row);
  });
  unlock.addEventListener("submit", (e) => {
    e.preventDefault();
    enter(row, password.value);
  });
  return row;
}

function updateRow(row: Row, room: RoomSummary): void {
  row.room = room;
  if (row.iconFor !== room.gameId) {
    row.iconFor = room.gameId;
    row.icon.replaceChildren(iconBadge(room.gameId ? getMeta(room.gameId) ?? { id: room.gameId } : null, 40));
  }
  row.name.textContent = room.name;
  if (room.locked) row.name.prepend(lockIcon());
  const game = room.gameId ? getMeta(room.gameId)?.title ?? room.gameId : null;
  const parts = [
    game ? `Playing ${game}` : "Waiting for players",
    `${room.players} ${room.players === 1 ? "player" : "players"}`,
  ];
  if (room.spectators) parts.push(`${room.spectators} watching`);
  if (room.hostName && !game) parts.push(`host ${room.hostName}`);
  row.meta.textContent = parts.join(" · ");
  row.action.textContent = game ? "Watch" : "Join";
  row.action.className = game ? "secondary" : "";
}

function renderRooms(rooms: RoomSummary[]): void {
  const seen = new Set<string>();
  for (const room of rooms) {
    seen.add(room.code);
    let row = rows.get(room.code);
    if (!row) {
      row = buildRow(room);
      rows.set(room.code, row);
    }
    updateRow(row, room);
    listEl.append(row.li); // (re)appending keeps the server's order
  }
  for (const [code, row] of rows) {
    if (seen.has(code)) continue;
    row.li.remove();
    rows.delete(code);
    if (attempt === code) errEl.textContent = "That room just closed.";
  }

  listEl.querySelector(".room-empty")?.remove();
  if (!rooms.length) listEl.append(el("li", "room-empty", "No open rooms — create one above."));
  countEl.textContent = rooms.length ? String(rooms.length) : "";
}
