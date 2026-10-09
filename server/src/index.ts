import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { WebSocketServer } from "ws";
import { RoomManager } from "./rooms.js";
import { attachConnection } from "./handlers.js";
import { loadGames } from "./games/loader.js";
import { createCounterServer } from "./counter.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
const httpServer = createServer(app);
const manager = new RoomManager();

// WebSocket endpoints sharing the HTTP server: /ws (games) and /counter-ws.
// Routed by hand: a `{ server, path }` WebSocketServer rejects every other path.
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (ws) => attachConnection(ws, manager));
const counterWss = createCounterServer();

httpServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const target = pathname === "/ws" ? wss : pathname === "/counter-ws" ? counterWss : null;
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
app.use(express.static(clientDist));
app.get("/counter", (_req, res) => {
  res.sendFile(path.join(clientDist, "counter.html"));
});
// SPA-ish fallback: unknown GET -> landing page.
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

await loadGames();

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} (ws at /ws, 67 counter at /counter-ws)`);
});
