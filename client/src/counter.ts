// The 67 counter page: one shared number, synced live over /counter-ws/<key>.
// Only reachable through a secret URL: /counter/<key> (or /counter.html?key=…
// in Vite dev). The server checks the key against its COUNTER_KEY env var.
// Server -> { type: "count", count, delta: -1 | 0 | 1, online }
// Client -> { type: "inc" } | { type: "dec" }
// Animations are driven by incoming messages (delta), so every viewer sees them:
// a +1 makes the whole town do the 67; big fireworks only for a new era (which
// the town earns by building its world wonder; the counter drops crates).
// The counter is a compact bar at the top; the rest of the screen is
// "67 Beschaving", the shared town (world/).

import { ERAS, IDLE_MILESTONE, type IdleClientMsg, type IdleEvent, type IdleStateMsg } from "@app/shared/idle";
import { startPixelIcons } from "./pixelIcons";
import { createTown } from "./world";

interface CountMessage {
  type: "count";
  count: number;
  /** Highest count ever: every new 67 of it drops a crate in town. */
  peak: number;
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

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const EMOJIS = ["🤲", "6️⃣", "7️⃣", "💀", "🔥", "😭", "🗿", "🧠", "💯", "🤯", "😂", "🫃", "🥶", "⚡", "🚨", "👀", "🤑", "🙏"];
const POP_COLORS = ["#ffe82e", "#b6ff2e", "#22f0ff", "#ff2fb3", "#ffffff", "#ff9a2e"];

const MAX_FX_NODES = 140;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

// ---------- background ----------

let shownEra = -1;

/** Theme the page for the town's era (CSS colors around the counter). */
function setEra(era: number): void {
  if (era === shownEra) return;
  document.body.classList.remove(`sx-era-${shownEra}`);
  document.body.classList.add(`sx-era-${era}`);
  shownEra = era;
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

/** A +1: the town does the 67 and the number bumps; no screen-wide fireworks (those are for a new era). */
function onIncrement(): void {
  town.cheer();
  retrigger(countEl, "sx-bump");
}

function onDecrement(): void {
  retrigger(countEl, "sx-drop");
}

// ---------- rendering ----------

let lastCount: number | null = null;

function render(msg: CountMessage): void {
  countEl.textContent = String(msg.count);
  onlineEl.textContent = `👀 ${msg.online} ${msg.online === 1 ? "kijker" : "kijkers"} live`;
  // The next crate comes at the next 67 above the highest count ever.
  const nextDrop = (Math.floor(msg.peak / IDLE_MILESTONE) + 1) * IDLE_MILESTONE;
  nextEl.textContent =
    msg.count > 0 && msg.count % 67 === 0
      ? `🏆 ${msg.count} = 67 × ${msg.count / 67} — absolute cinema`
      : `nog ${nextDrop - msg.count} tot een 📦 supply drop 🎯`;
  decBtn.disabled = !isOpen() || msg.count <= 0;
  lastCount = msg.count;
}

// ---------- town ----------

startPixelIcons();
const town = createTown((msg) => send(msg));

function onIdleEvent(ev: IdleEvent): void {
  town.event(ev);
  switch (ev.kind) {
    case "era": {
      const era = ERAS[ev.era];
      setEra(ev.era);
      // After the ✅ popup for the wonder that brought it.
      window.setTimeout(() => {
        playOverlay(true);
        emojiBurst(80);
        popup(`${era.emoji} ${era.name}!`, { big: true, x: 50, y: 28, color: "#ffe82e" });
        popup("NIEUW TIJDPERK!", { big: true, x: 50, y: 74, color: "#22f0ff" });
      }, 1200);
      return;
    }
    case "proposed":
      popup(`🗳️ ${ev.by}: ${ev.label}?`, { y: rand(55, 80), color: "#22f0ff" });
      return;
    case "bought":
      popup(`✅ ${ev.label}!`, { y: rand(30, 70), color: "#b6ff2e" });
      emojiBurst(12);
      return;
    case "deal":
      popup(`🛒 ${ev.by}: ${ev.label}`, { y: rand(55, 80), color: "#ffe82e" });
      return;
    case "lucky":
      popup(ev.label, { big: true, x: 50, y: 30, color: "#b6ff2e" });
      emojiBurst(24);
      return;
    case "raid":
      popup(ev.label, { big: true, x: 50, y: 30, color: ev.stage === "won" ? "#b6ff2e" : "#ff3b3b" });
      if (ev.stage === "won") emojiBurst(24);
      return;
    case "social":
      popup(ev.label, { y: rand(55, 80), color: "#ff9ad5" });
      return;
    case "rejected":
      popup(`❌ ${ev.label}: ${ev.reason}`, { y: rand(30, 70), color: "#ff3b3b" });
      return;
    case "error":
      popup(`⚠️ ${ev.message}`, { y: rand(40, 70), color: "#ff3b3b" });
      return;
  }
}

// ---------- socket ----------

/** Secret key from /counter/<key>, falling back to ?key=…; null if absent or malformed. */
function readKey(): string | null {
  const m = /^\/counter\/([^/]+)\/?$/.exec(location.pathname);
  let raw = m?.[1] ?? null;
  if (raw !== null) {
    try {
      raw = decodeURIComponent(raw);
    } catch {
      raw = null;
    }
  }
  const key = (raw ?? new URLSearchParams(location.search).get("key") ?? "").trim();
  return key || null;
}

const counterKey = readKey();

let ws: WebSocket | null = null;
let retries = 0;
let reconnectTimer: number | null = null;

const isOpen = () => ws?.readyState === WebSocket.OPEN;

function setConn(state: "connecting" | "online" | "offline" | "denied"): void {
  connEl.dataset.state = state === "denied" ? "offline" : state;
  connText.textContent =
    state === "online"
      ? "live"
      : state === "connecting"
        ? "verbinden…"
        : state === "denied"
          ? "geen toegang — vraag de geheime link"
          : "offline — opnieuw proberen…";
  incBtn.disabled = state !== "online";
  decBtn.disabled = state !== "online" || (lastCount ?? 0) <= 0;
  town.setConnected(state === "online");
  if (state !== "online") onlineEl.textContent = "👀 – kijkers live";
}

function connect(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // No key in the URL: nothing to connect to, so don't start a reconnect loop.
  if (!counterKey) {
    setConn("denied");
    return;
  }
  setConn("connecting");
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${proto}//${location.host}/counter-ws/${encodeURIComponent(counterKey)}`);
  ws = socket;

  socket.onopen = () => {
    retries = 0;
    setConn("online");
  };

  socket.onmessage = (ev) => {
    let msg: CountMessage | IdleStateMsg | { type: "idleEvent"; event: IdleEvent };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg?.type === "idle") {
      setEra(msg.state.era);
      return town.update(msg);
    }
    if (msg?.type === "idleEvent") return onIdleEvent(msg.event);
    if (msg?.type !== "count" || typeof msg.count !== "number") return;
    render(msg);
    if (msg.delta === 1) onIncrement();
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

function send(msg: { type: "inc" | "dec" } | IdleClientMsg): void {
  if (!isOpen()) return;
  if (msg.type === "dec" && (lastCount ?? 0) <= 0) return;
  ws!.send(JSON.stringify(msg));
}

// ---------- input ----------

incBtn.addEventListener("click", () => send({ type: "inc" }));
decBtn.addEventListener("click", () => send({ type: "dec" }));

document.addEventListener("keydown", (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  // Space on a focused button/link keeps its native meaning (e.g. space on "−" = min).
  if (e.key === " " && t?.closest("button, a")) return;
  if (e.key === "+" || e.key === "=" || e.key === " ") {
    e.preventDefault();
    send({ type: "inc" });
  } else if (e.key === "-" || e.key === "_") {
    e.preventDefault();
    send({ type: "dec" });
  }
});

// Reconnect right away when the tab comes back (phones kill sockets in the background).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !ws) connect();
});

connect();
