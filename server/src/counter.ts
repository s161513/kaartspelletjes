import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

// The "67 counter": one shared number, synced live to everyone on /counter.
// Persisted to a JSON file outside dist/ so restarts and rebuilds keep it
// (in Docker: a volume on /app/data, see the Dockerfile).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = process.env.COUNTER_FILE ?? path.resolve(__dirname, "../../data/counter.json");
/** Debounce for disk writes, so a click storm doesn't block the event loop. */
const SAVE_DELAY_MS = 500;
/** Per-socket cap on counted messages per second; extras are dropped. */
const MAX_MSGS_PER_SEC = 10;

function load(): number {
  let text: string;
  try {
    text = readFileSync(FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    // Unreadable but present: refuse to start rather than overwrite it with 0.
    throw err;
  }
  try {
    const n = Number(JSON.parse(text).count);
    if (Number.isInteger(n) && n >= 0) return n;
  } catch {
    // fall through
  }
  const backup = `${FILE}.corrupt-${Date.now()}`;
  renameSync(FILE, backup);
  console.error(`counter: ${FILE} was corrupt, moved to ${backup}; starting at 0`);
  return 0;
}

function save(count: number): void {
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify({ count }), { flush: true });
    renameSync(tmp, FILE);
  } catch (err) {
    console.error("counter: could not save", err);
  }
}

export function createCounterServer(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 });
  let count = load();
  let saved = count;
  let saveTimer: NodeJS.Timeout | null = null;

  const flush = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (count !== saved) {
      save(count);
      saved = count;
    }
  };
  const scheduleSave = () => {
    saveTimer ??= setTimeout(flush, SAVE_DELAY_MS);
  };
  // Don't lose the last half second of clicks on `docker stop` / Ctrl+C.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      flush();
      process.exit(0);
    });
  }

  const broadcast = (delta: number) => {
    const msg = JSON.stringify({ type: "count", count, delta, online: wss.clients.size });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };

  wss.on("connection", (ws) => {
    let windowStart = Date.now();
    let inWindow = 0;

    broadcast(0);
    // Protocol errors (bad frames, oversized messages) must not crash the server.
    ws.on("error", () => ws.terminate());
    ws.on("close", () => broadcast(0));
    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        inWindow = 0;
      }
      if (++inWindow > MAX_MSGS_PER_SEC) return;

      let type: unknown;
      try {
        type = JSON.parse(String(raw))?.type;
      } catch {
        return;
      }
      let delta = 0;
      if (type === "inc") delta = 1;
      else if (type === "dec" && count > 0) delta = -1;
      if (!delta) return;
      count += delta;
      scheduleSave();
      broadcast(delta);
    });
  });

  return wss;
}
