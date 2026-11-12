// The village chat (update 26): a window at the bottom right, opened with 💬.
// The server keeps the last CHAT_KEEP lines; a new line also shows as a
// bubble over the NPC of whoever said it (that's the world's job).

import { CHAT_LENGTH, chatError, type IdleClientMsg, type IdleStateMsg } from "@app/shared/idle";
import { button, h } from "./panels";

export interface ChatDeps {
  send(msg: IdleClientMsg): void;
  msg(): IdleStateMsg | null;
  connected(): boolean;
}

export interface Chat {
  /** New state from the server: the lines, and the unread count on the button. */
  refresh(): void;
}

const clock = (at: number) => new Date(at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

export function createChat(deps: ChatDeps): Chat {
  const panel = document.getElementById("sx-chat") as HTMLDivElement;
  const fab = document.getElementById("sx-chat-btn") as HTMLButtonElement;
  const list = h("div", "sx-chat-list");
  list.setAttribute("aria-live", "polite");
  const input = h("input", "sx-input sx-chat-input");
  input.maxLength = CHAT_LENGTH;
  input.placeholder = "zeg iets tegen het dorp…";
  input.setAttribute("aria-label", "chatbericht");
  const status = h("p", "sx-note");
  const sendLine = () => {
    const err = chatError(input.value);
    if (err) {
      status.textContent = err;
      return;
    }
    deps.send({ type: "chat", text: input.value });
    input.value = "";
    status.textContent = "";
  };
  const sendBtn = button("sx-act sx-act-now", "sturen", sendLine);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendLine();
    if (e.key === "Escape") toggle(false);
  });
  const close = button("sx-x", "✕", () => toggle(false));
  close.setAttribute("aria-label", "sluiten");
  const form = h("div", "sx-chat-form");
  form.append(input, sendBtn);
  panel.append(close, h("h3", "sx-panel-title", "💬 Dorpschat"), list, form, status);

  /** The last line seen with the window open; newer ones count as unread. */
  let seen = -1;
  let shown = "";

  function toggle(open: boolean): void {
    panel.hidden = !open;
    render();
    if (open) {
      list.scrollTop = list.scrollHeight;
      input.focus();
    }
  }
  fab.addEventListener("click", () => toggle(panel.hidden));

  function render(): void {
    const msg = deps.msg();
    const lines = msg?.chat ?? [];
    const last = lines.at(-1)?.id ?? 0;
    // The first state: what was said before you came isn't news.
    if (seen < 0 && msg) seen = last;
    if (!panel.hidden) seen = last;
    const unread = lines.filter((l) => l.id > seen).length;
    fab.textContent = unread ? `💬 ${unread}` : "💬";
    fab.classList.toggle("sx-fab-news", unread > 0);
    fab.hidden = !msg?.me;
    input.disabled = sendBtn.disabled = !deps.connected() || !msg?.me;
    const sig = lines.map((l) => l.id).join(",");
    if (sig === shown) return;
    shown = sig;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
    list.replaceChildren(
      ...(lines.length
        ? lines.map((l) => {
            const row = h("div", l.mine ? "sx-chat-line sx-chat-mine" : "sx-chat-line");
            row.append(h("span", "sx-chat-time", clock(l.at)), h("b", "", `${l.by}: `), document.createTextNode(l.text));
            return row;
          })
        : [h("p", "sx-note", "Nog niets gezegd. Begin maar!")]),
    );
    if (atBottom) list.scrollTop = list.scrollHeight;
  }

  return { refresh: render };
}
