import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { WebSocketServer } from "ws";
import { RoomManager } from "./rooms.js";
import { attachConnection } from "./handlers.js";
import { loadGames } from "./games/loader.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
const httpServer = createServer(app);
const manager = new RoomManager();

// WebSocket endpoint at /ws, sharing the HTTP server.
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
wss.on("connection", (ws) => attachConnection(ws, manager));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// In production, serve the built client (client/dist). In dev, Vite serves it.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
// SPA-ish fallback: unknown GET -> landing page.
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

await loadGames();

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT} (ws at /ws)`);
});
