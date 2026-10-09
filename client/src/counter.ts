// The 67 counter page: one shared number, synced live over /counter-ws.
// Server -> { type: "count", count, delta: -1 | 0 | 1, online }
// Client -> { type: "inc" } | { type: "dec" }
// Animations are driven by incoming messages (delta), so every viewer sees them.

interface CountMessage {
  type: "count";
  count: number;
  delta: number;
  online: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const countEl = $<HTMLDivElement>("sx-count");
const incBtn = $<HTMLButtonElement>("sx-inc");
const decBtn = $<HTMLButtonElement>("sx-dec");
const connEl = $<HTMLSpanElement>("sx-conn");
const connText = $<HTMLSpanElement>("sx-conn-text");
const onlineEl = $<HTMLSpanElement>("sx-online");
const nextEl = $<HTMLParagraphElement>("sx-next");
const overlay = $<HTMLDivElement>("sx-overlay");
const fx = $<HTMLDivElement>("sx-fx");
const mainEl = document.querySelector<HTMLElement>(".sx-main")!;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const EMOJIS = ["🤲", "6️⃣", "7️⃣", "💀", "🔥", "😭", "🗿", "🧠", "💯", "🤯", "😂", "🫃", "🥶", "⚡", "🚨", "👀", "🤑", "🙏"];
const POPUPS = [
  "67!!",
  "SIX SEVENNN",
  "SKIBIDI",
  "ohio lector",
  "certified 67 moment",
  "no cap fr fr",
  "W lector",
  "aura +6700",
  "gyatt 67",
  "sigma docent",
  "brainrot unlocked",
  "it's giving 67",
  "rizz level: 67",
  "mewing intensifies",
  "bro deed het weer",
  "LMAOOO 67",
  "slay 💅",
  "huhhh 67?!",
  "sheeesh",
  "tentamenstof: 67",
];
const MARQUEE = [
  "🚨 BREAKING: LECTOR DOET 67 🚨",
  "six seven six seven six seven",
  "📈 67-aandelen stijgen",
  "skibidi college",
  "ohio campus moment",
  "fanum tax op je aantekeningen",
  "dit komt NIET op het tentamen (wel 67)",
  "🤲 weeg het af bro 🤲",
  "certified brainrot zone",
  "no cap, alleen 67",
  "aura check: 💯",
  "mewing in de collegezaal",
];
const BG_EMOJIS = ["🤲", "6️⃣", "7️⃣", "💀", "🗿", "🧠", "🔥", "😭", "💯", "🫠"];
const POP_COLORS = ["#ffe82e", "#b6ff2e", "#22f0ff", "#ff2fb3", "#ffffff", "#ff9a2e"];

const MAX_FX_NODES = 140;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ---------- background ----------

function buildBackground(): void {
  const bg = $<HTMLDivElement>("sx-bg");
  const n = window.innerWidth < 600 ? 14 : 24;
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span");
    s.className = "sx-float";
    s.textContent = pick(BG_EMOJIS);
    s.style.left = `${rand(0, 95)}%`;
    s.style.fontSize = `${rand(1.4, 3.6)}rem`;
    s.style.animationDuration = `${rand(12, 28)}s`;
    s.style.animationDelay = `${-rand(0, 28)}s`;
    bg.appendChild(s);
  }

  const track = $<HTMLDivElement>("sx-marquee");
  // Two copies so the strip never runs empty on wide screens.
  for (const text of [...MARQUEE, ...MARQUEE]) {
    const s = document.createElement("span");
    s.textContent = text;
    track.appendChild(s);
  }
}

// ---------- effects ----------

/** Restart a CSS animation class even if it is already applied. */
function retrigger(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth; // force reflow
  el.classList.add(cls);
}

function spawn(el: HTMLElement, lifetimeMs: number): void {
  while (fx.childElementCount >= MAX_FX_NODES) fx.firstElementChild?.remove();
  fx.appendChild(el);
  window.setTimeout(() => el.remove(), lifetimeMs);
}

function emojiBurst(count: number): void {
  if (reducedMotion.matches) return;
  const spread = Math.max(window.innerWidth, window.innerHeight) * 0.75;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = "sx-particle";
    p.textContent = pick(EMOJIS);
    const angle = rand(0, Math.PI * 2);
    const dist = rand(spread * 0.35, spread);
    const dur = rand(0.9, 1.8);
    p.style.setProperty("--sx-dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--sx-dy", `${Math.sin(angle) * dist}px`);
    p.style.setProperty("--sx-rot", `${rand(-720, 720)}deg`);
    p.style.setProperty("--sx-dur", `${dur}s`);
    p.style.fontSize = `${rand(1.6, 4)}rem`;
    spawn(p, dur * 1000 + 100);
  }
}

function popup(text: string, opts: { big?: boolean; x?: number; y?: number; color?: string } = {}): void {
  const el = document.createElement("div");
  el.className = opts.big ? "sx-pop sx-pop-big" : "sx-pop";
  el.textContent = text;
  el.style.left = `${opts.x ?? rand(20, 80)}%`;
  el.style.top = `${opts.y ?? rand(15, 85)}%`;
  el.style.setProperty("--sx-rot", `${rand(-14, 14)}deg`);
  el.style.setProperty("--sx-pop-bg", opts.color ?? pick(POP_COLORS));
  spawn(el, opts.big ? 3100 : 1700);
}

function playOverlay(mega: boolean): void {
  overlay.classList.toggle("sx-mega", mega);
  retrigger(overlay, "sx-play");
  retrigger(document.body, "sx-flash");
}

function onIncrement(count: number): void {
  const mega = count > 0 && count % 67 === 0;
  playOverlay(mega);
  retrigger(countEl, "sx-bump");
  emojiBurst(mega ? 70 : 24);
  const pops = mega ? 6 : 2;
  for (let i = 0; i < pops; i++) {
    window.setTimeout(() => popup(pick(POPUPS)), i * 150);
  }
  if (mega) {
    const times = count / 67;
    popup(`67 × ${times} = ${count} 🤯`, { big: true, x: 50, y: 22, color: "#b6ff2e" });
    popup("LEGENDARY 67 MOMENT", { big: true, x: 50, y: 78, color: "#ff2fb3" });
    window.setTimeout(() => emojiBurst(50), 700);
  } else if (String(count).includes("67")) {
    popup(`${count} bevat 67 👀`, { big: true, x: 50, y: 25, color: "#22f0ff" });
    emojiBurst(20);
  }
}

function onDecrement(): void {
  retrigger(mainEl, "sx-shake");
  retrigger(countEl, "sx-drop");
  popup("💀 nee toch", { x: 50, y: rand(30, 60), color: "#ff3b3b" });
}

// ---------- rendering ----------

let lastCount: number | null = null;

function render(msg: CountMessage): void {
  countEl.textContent = String(msg.count);
  onlineEl.textContent = `👀 ${msg.online} ${msg.online === 1 ? "kijker" : "kijkers"} live`;
  const toNext = 67 - (msg.count % 67);
  nextEl.textContent =
    msg.count > 0 && msg.count % 67 === 0
      ? `🏆 ${msg.count} = 67 × ${msg.count / 67} — absolute cinema`
      : `nog ${toNext} tot de volgende 67-mijlpaal 🎯`;
  decBtn.disabled = !isOpen() || msg.count <= 0;
  lastCount = msg.count;
}

// ---------- socket ----------

let ws: WebSocket | null = null;
let retries = 0;
let reconnectTimer: number | null = null;

const isOpen = () => ws?.readyState === WebSocket.OPEN;

function setConn(state: "connecting" | "online" | "offline"): void {
  connEl.dataset.state = state;
  connText.textContent =
    state === "online" ? "live" : state === "connecting" ? "verbinden…" : "offline — opnieuw proberen…";
  incBtn.disabled = state !== "online";
  decBtn.disabled = state !== "online" || (lastCount ?? 0) <= 0;
  if (state !== "online") onlineEl.textContent = "👀 – kijkers live";
}

function connect(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  setConn("connecting");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${location.host}/counter-ws`);
  ws = socket;

  socket.onopen = () => {
    retries = 0;
    setConn("online");
  };

  socket.onmessage = (ev) => {
    let msg: CountMessage;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg?.type !== "count" || typeof msg.count !== "number") return;
    render(msg);
    if (msg.delta === 1) onIncrement(msg.count);
    else if (msg.delta === -1) onDecrement();
  };

  socket.onclose = () => {
    if (ws !== socket) return;
    ws = null;
    setConn("offline");
    const delay = Math.min(10_000, 500 * 2 ** retries) + rand(0, 300);
    retries++;
    reconnectTimer = window.setTimeout(connect, delay);
  };

  socket.onerror = () => socket.close();
}

function send(type: "inc" | "dec"): void {
  if (!isOpen()) return;
  if (type === "dec" && (lastCount ?? 0) <= 0) return;
  ws!.send(JSON.stringify({ type }));
}

// ---------- input ----------

incBtn.addEventListener("click", () => send("inc"));
decBtn.addEventListener("click", () => send("dec"));

document.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  // Space on a focused button/link keeps its native meaning (e.g. space on "−" = min).
  if (e.key === " " && t?.closest("button, a")) return;
  if (e.key === "+" || e.key === "=" || e.key === " ") {
    e.preventDefault();
    send("inc");
  } else if (e.key === "-" || e.key === "_") {
    e.preventDefault();
    send("dec");
  }
});

// Reconnect right away when the tab comes back (phones kill sockets in the background).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !ws) connect();
});

buildBackground();
connect();
