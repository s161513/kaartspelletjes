import { GameSocket } from "./ws.js";
import { session } from "./session.js";

const nickEl = document.getElementById("nickname") as HTMLInputElement;
const codeEl = document.getElementById("roomCode") as HTMLInputElement;
const createBtn = document.getElementById("create") as HTMLButtonElement;
const joinBtn = document.getElementById("join") as HTMLButtonElement;
const errEl = document.getElementById("error") as HTMLParagraphElement;

// Auto-resume: if we still hold a seat (reload, reopened tab, browser restart),
// head to the lobby, which reconnects and rejoins. A failed rejoin there clears
// the stale seat and bounces back here. Creating/joining below overwrites the
// seat from the server's `joined` reply, so starting fresh still works.
if (session.roomCode && session.playerId) {
  location.href = "/lobby.html";
}
nickEl.value = session.nickname;

const socket = new GameSocket();

socket.on("joined", (msg) => {
  session.playerId = msg.playerId;
  session.roomCode = msg.roomCode;
  session.secret = msg.secret;
  location.href = "/lobby.html";
});

socket.on("error", (msg) => {
  errEl.textContent = msg.message;
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
