import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { IDLE_MILESTONE, type IdleEvent } from "@app/shared/idle";
import { createIdleGame } from "./idle.js";
import { debouncedSaver, loadJsonFile, saveJsonFile } from "./jsonFile.js";

// The "67 counter": one shared number, synced live to everyone on /counter,
// plus "67 Beschaving", the shared idle game (see idle.ts). The counter gives
// the town extras: a boost per +1, a supply drop per new 67, now and then luck. Persisted to JSON files outside dist/ so restarts and rebuilds
// keep them (in Docker: a volume on /app/data, see the Dockerfile).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = process.env.COUNTER_FILE ?? path.resolve(__dirname, "../../data/counter.json");
/** Debounce for disk writes, so a click storm doesn't block the event loop. */
const SAVE_DELAY_MS = 500;
/** Per-socket cap on counted messages per second; extras are dropped. */
const MAX_MSGS_PER_SEC = 10;
/** Settle votes this often while anyone is connected. */
const IDLE_TICK_MS = 1000;
/** Full idle state to everyone at least this often; browsers keep producing in between. */
const IDLE_SYNC_MS = 5000;

/**
 * The developer menu (update 23) is for whoever runs the server, never for
 * players: the server must run with IDLE_DEV=1 (never set in the real
 * environment), and the browser must be on this same computer, straight or
 * through the Vite dev server, not through a proxy or tunnel.
 */
export function isLocal(req: IncomingMessage | undefined): boolean {
  if (!req) return false;
  const addr = req.socket.remoteAddress ?? "";
  const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  return (
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(addr) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(host) &&
    !req.headers["x-forwarded-for"] &&
    !req.headers.forwarded
  );
}

interface CounterData {
  count: number;
  /** Highest count ever: supply drops come for every new 67 of it. */
  peak: number;
}

/** Accepts the old `{ count }` format too. */
function parseCounter(raw: unknown): CounterData | null {
  const r = raw as { count?: unknown; peak?: unknown } | null;
  const count = Number(r?.count);
  if (!Number.isInteger(count) || count < 0) return null;
  const peak = Number(r?.peak);
  return { count, peak: Number.isInteger(peak) && peak > count ? peak : count };
}

export interface CounterServerOptions {
  /** Defaults to $COUNTER_FILE or data/counter.json. */
  file?: string;
  /** Defaults to $IDLE_FILE or idle.json next to the counter file. */
  idleFile?: string;
  /** Allow the developer menu for browsers on this computer; defaults to $IDLE_DEV === "1". */
  dev?: boolean;
}

export function createCounterServer(opts: CounterServerOptions = {}): WebSocketServer {
  const file = opts.file ?? DEFAULT_FILE;
  const idleFile = opts.idleFile ?? process.env.IDLE_FILE ?? path.join(path.dirname(file), "idle.json");

  // Room for a path proposal of MAX_PATH_TILES tiles; everything else is tiny.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });
  let { count, peak } = loadJsonFile(file, parseCounter, () => ({ count: 0, peak: 0 }), "counter");
  const saver = debouncedSaver(() => saveJsonFile(file, { count, peak }, "counter"), SAVE_DELAY_MS);
  const idle = createIdleGame(idleFile);
  const clientIds = new WeakMap<WebSocket, string>();
  const devAllowed = opts.dev ?? process.env.IDLE_DEV === "1";
  if (devAllowed) console.log("67 Beschaving: developer menu on for browsers on this computer (IDLE_DEV=1)");
  /** Connections with the developer menu, and whether free mode is on for them. */
  const devs = new Map<string, { free: boolean }>();

  // Don't lose the last half second of clicks on `docker stop` / Ctrl+C.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      saver.flush();
      idle.flush();
      process.exit(0);
    });
  }

  const sendAll = (msg: object) => {
    const text = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(text);
    }
  };
  const broadcast = (delta: number) => {
    sendAll({ type: "count", count, peak, delta, online: wss.clients.size });
  };
  const sendIdle = (client: WebSocket, now: number) => {
    const id = clientIds.get(client);
    if (id && client.readyState === WebSocket.OPEN) {
      const dev = devs.get(id);
      client.send(JSON.stringify({ ...idle.message(id, count, peak, wss.clients.size, now), ...(dev ? { dev: { ...dev } } : {}) }));
    }
  };
  const broadcastIdle = (events: IdleEvent[] = []) => {
    for (const event of events) sendAll({ type: "idleEvent", event });
    const now = Date.now();
    for (const client of wss.clients) sendIdle(client, now);
    lastSync = now;
  };
  let lastSync = 0;

  // Only tick while someone watches; production is caught up from timestamps anyway.
  let ticker: NodeJS.Timeout | null = null;
  const updateTicker = () => {
    if (wss.clients.size > 0 && !ticker) {
      ticker = setInterval(() => {
        const now = Date.now();
        const events = idle.tick(wss.clients.size, now);
        if (events.length || now - lastSync >= IDLE_SYNC_MS) broadcastIdle(events);
      }, IDLE_TICK_MS);
      ticker.unref();
    } else if (wss.clients.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };

  wss.on("connection", (ws, req?: IncomingMessage) => {
    const clientId = randomUUID();
    clientIds.set(ws, clientId);
    const dev = devAllowed && isLocal(req) ? { free: false } : null;
    if (dev) devs.set(clientId, dev);
    let windowStart = Date.now();
    let inWindow = 0;

    broadcast(0);
    sendIdle(ws, Date.now());
    updateTicker();
    // Protocol errors (bad frames, oversized messages) must not crash the server.
    ws.on("error", () => ws.terminate());
    ws.on("close", () => {
      idle.leave(clientId, Date.now());
      devs.delete(clientId);
      broadcast(0);
      broadcastIdle();
      updateTicker();
    });
    ws.on("message", (raw, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - windowStart >= 1000) {
        windowStart = now;
        inWindow = 0;
      }
      if (++inWindow > MAX_MSGS_PER_SEC) return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      const online = wss.clients.size;
      /** An error goes back to this connection only; otherwise everyone gets the events and the new state. */
      const reply = ({ error, events }: { error?: string; events: IdleEvent[] }) => {
        if (error) ws.send(JSON.stringify({ type: "idleEvent", event: { kind: "error", message: error } }));
        else broadcastIdle(events);
      };

      switch (msg.type) {
        case "inc": {
          count += 1;
          const before = peak;
          peak = Math.max(peak, count);
          saver.schedule();
          broadcast(1);
          idle.boost(now);
          const drop = Math.floor(peak / IDLE_MILESTONE) > Math.floor(before / IDLE_MILESTONE) ? idle.drop(now) : [];
          broadcastIdle([...drop, ...idle.lucky(now, Math.random)]);
          return;
        }
        case "dec":
          if (count <= 0) return;
          count -= 1;
          saver.schedule();
          broadcast(-1);
          return;
        case "assign":
          return reply(idle.assign(msg.from, msg.to, now));
        case "propose":
          if (dev?.free) return reply(idle.devDo(clientId, msg.name, msg.action, now));
          return reply(idle.propose(clientId, msg.name, msg.action, online, now));
        case "buy":
          if (dev?.free) return reply(idle.devDo(clientId, msg.name, { kind: "buy", item: msg.item }, now));
          return reply(idle.buy(clientId, msg.name, msg.item, now));
        // The developer menu: ignored unless this connection may use it.
        case "dev":
          if (!dev) return;
          if (msg.cmd === "free") {
            dev.free = !dev.free;
            return sendIdle(ws, now);
          }
          return reply(idle.devCommand(clientId, msg.name, msg.cmd, now));
        case "open":
          return reply(idle.open(clientId, msg.name, msg.id, now));
        case "forge":
          return reply(idle.forge(clientId, msg.name, msg.building, msg.score, now));
        case "outfit":
          return reply(idle.outfit(clientId, msg.item, now));
        // Who's who: their NPC shows up for everyone.
        case "hello":
          return reply({ ...idle.hello(clientId, msg.key, msg.name, now), events: [] });
        case "look":
          return reply({ ...idle.look(clientId, msg.name, msg.look), events: [] });
        case "vote": {
          broadcastIdle(idle.vote(clientId, msg.id, msg.yes, online, now));
          return;
        }
      }
    });
  });

  return wss;
}
