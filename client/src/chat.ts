import type { GameSocket } from "./ws.js";

/**
 * Wire a chat log + form to the socket. Shared by the lobby and game pages.
 */
export function setupChat(
  socket: GameSocket,
  logEl: HTMLElement,
  formEl: HTMLFormElement,
  inputEl: HTMLInputElement,
): void {
  socket.on("chat", (msg) => {
    const line = document.createElement("div");
    line.className = "msg";
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = `${msg.from}: `;
    line.appendChild(who);
    line.appendChild(document.createTextNode(msg.text));
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  });

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    if (!text) return;
    socket.send({ type: "chat", text });
    inputEl.value = "";
  });
}
