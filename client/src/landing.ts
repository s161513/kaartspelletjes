import { GameSocket } from "./ws.js";
import { session } from "./session.js";

const nickEl = document.getElementById("nickname") as HTMLInputElement;
const codeEl = document.getElementById("roomCode") as HTMLInputElement;
const createBtn = document.getElementById("create") as HTMLButtonElement;
const joinBtn = document.getElementById("join") as HTMLButtonElement;
const errEl = document.getElementById("error") as HTMLParagraphElement;

// Fresh landing: forget any old seat so we don't auto-rejoin a stale room.
session.clearRoom();
nickEl.value = session.nickname;

const socket = new GameSocket();

// Appears when a join is rejected because the game is already running.
const watchBtn = document.createElement("button");
watchBtn.className = "secondary";
watchBtn.textContent = "👀 Watch this game";
watchBtn.style.display = "none";
watchBtn.style.marginTop = "0.5rem";
errEl.insertAdjacentElement("beforebegin", watchBtn);

socket.on("joined", (msg) => {
  session.playerId = msg.playerId;
  session.roomCode = msg.roomCode;
  session.role = msg.role ?? "player";
  location.href = "/lobby.html";
});

socket.on("error", (msg) => {
  errEl.textContent = msg.message;
  // The room is mid-game — offer to watch instead of joining.
  watchBtn.style.display = msg.code === "in_progress" ? "inline-block" : "none";
});

watchBtn.addEventListener("click", () => {
  const n = nickname();
  if (!n) return;
  const code = codeEl.value.trim().toUpperCase();
  if (!code) {
    errEl.textContent = "Enter a room code to watch.";
    return;
  }
  socket.send({ type: "spectate", nickname: n, roomCode: code });
});

function nickname(): string | null {
  const n = nickEl.value.trim();
  if (!n) {
    errEl.textContent = "Please enter a nickname.";
    return null;
  }
  session.nickname = n;
  return n;
}

createBtn.addEventListener("click", () => {
  const n = nickname();
  if (n) socket.send({ type: "create", nickname: n });
});

joinBtn.addEventListener("click", () => {
  const n = nickname();
  if (!n) return;
  const code = codeEl.value.trim().toUpperCase();
  if (!code) {
    errEl.textContent = "Enter a room code to join.";
    return;
  }
  socket.send({ type: "join", nickname: n, roomCode: code });
});

// Enter-to-submit on the join field.
codeEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});
