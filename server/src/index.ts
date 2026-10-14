import "./env.js";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { RoomManager } from "./rooms.js";
import { attachConnection } from "./handlers.js";
import { loadGames } from "./games/loader.js";
import { createCounterServer } from "./counter.js";

const PORT = Number(process.env.PORT ?? 3000);

// The 67 counter is only reachable through a secret URL (/counter/<key>,
// socket at /counter-ws/<key>). The key comes from the environment because the
// repo is public; without it the counter is disabled. Never log the key.
const COUNTER_KEY = process.env.COUNTER_KEY?.trim() || null;
const COUNTER_KEY_BUF = COUNTER_KEY ? Buffer.from(COUNTER_KEY, "utf8") : null;

function counterKeyMatches(candidate: string): boolean {
  if (!COUNTER_KEY_BUF) return false;
  const given = Buffer.from(candidate, "utf8");
  // timingSafeEqual needs equal lengths; the length check itself leaks only the length.
  return given.length === COUNTER_KEY_BUF.length && timingSafeEqual(given, COUNTER_KEY_BUF);
}

/** decodeURIComponent, but null instead of throwing on malformed input. */
function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

const app = express();
const httpServer = createServer(app);
const manager = new RoomManager();

// WebSocket endpoints sharing the HTTP server: /ws (games) and /counter-ws/<key>.
// Routed by hand: a `{ server, path }` WebSocketServer rejects every other path.
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (ws) => attachConnection(ws, manager));
const counterWss = createCounterServer();

// Heartbeat: a phone that loses its network often never sends a close, so the
// server would think it is still connected. Ping every 30s; a socket that has
// not answered the previous ping is terminated, which runs the normal close
// handling (seat marked away, removed later if it doesn't come back).
const HEARTBEAT_MS = 30_000;
const alive = new WeakSet<WebSocket>();
for (const server of [wss, counterWss]) {
  server.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
  });
}
setInterval(() => {
  for (const ws of [...wss.clients, ...counterWss.clients]) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, HEARTBEAT_MS).unref();

httpServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  let target: WebSocketServer | null = null;
  if (pathname === "/ws") {
    target = wss;
  } else if (pathname.startsWith("/counter-ws/")) {
    const key = safeDecode(pathname.slice("/counter-ws/".length));
    if (key !== null && counterKeyMatches(key)) target = counterWss;
  }
  if (!target) {
    socket.destroy();
    return;
  }
  target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// In production, serve the built client (client/dist). In dev, Vite serves it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");
// The built counter page must not be reachable by its file name. Compare the
// decoded, normalized path the way express.static resolves it, so tricks like
// /%63ounter.html or /x/../counter.html don't slip past.
app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const decoded = safeDecode(req.path);
  const normalized = decoded === null ? null : path.posix.normalize(decoded).toLowerCase();
  if (normalized === "/counter.html" || normalized === "/counter.html/") {
    res.sendFile(path.join(clientDist, "index.html"));
    return;
  }
  next();
});
app.use(express.static(clientDist));
app.get("/counter/:key", (req, res, next) => {
  if (!counterKeyMatches(req.params.key)) return next();
  res.sendFile(path.join(clientDist, "counter.html"));
});
// SPA-ish fallback: unknown GET -> landing page.
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

await loadGames();

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} (ws at /ws)`);
  if (COUNTER_KEY) {
    console.log("67 counter enabled at /counter/<COUNTER_KEY>");
  } else {
    console.log("67 counter disabled; set COUNTER_KEY=<secret> to enable it at /counter/<secret>");
  }
});
