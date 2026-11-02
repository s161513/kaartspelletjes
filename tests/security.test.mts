import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import type { JoinedMsg, ServerMessage } from "@app/shared";
import { shuffle, secureRandom } from "@app/shared";
import { RoomManager } from "../server/src/rooms.ts";
import { attachConnection } from "../server/src/handlers.ts";
import { loadGames } from "../server/src/games/loader.ts";
import { securityHeaders } from "../server/src/securityHeaders.ts";

class Peer {
  socket: WebSocket;
  queue: ServerMessage[] = [];
  pending = new Set<() => void>();
  closeCode: number | null = null;
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("message", (raw) => {
      this.queue.push(JSON.parse(raw.toString()) as ServerMessage);
      for (const check of [...this.pending]) check();
    });
    this.socket.on("close", (code) => { this.closeCode = code; });
  }
  async open() {
    await new Promise<void>((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    return this;
  }
  send(msg: object) { this.socket.send(JSON.stringify(msg)); }
  sendRaw(text: string) { this.socket.send(text); }
  wait(predicate: (m: ServerMessage) => boolean, timeoutMs = 4000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const i = this.queue.findIndex(predicate);
        if (i >= 0) { const m = this.queue.splice(i, 1)[0]; clearTimeout(timer); this.pending.delete(check); resolve(m); }
      };
      const timer = setTimeout(() => { this.pending.delete(check); reject(Error("Timed out; got " + this.queue.map((m) => m.type).join(","))); }, timeoutMs);
      this.pending.add(check); check();
    });
  }
  async waitClosed(timeoutMs = 4000): Promise<number> {
    if (this.closeCode !== null) return this.closeCode;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("socket did not close")), timeoutMs);
      this.socket.once("close", (code) => { clearTimeout(timer); resolve(code); });
    });
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => { this.socket.once("close", () => resolve()); this.socket.close(); });
  }
}

async function setup() {
  await loadGames();
  const manager = new RoomManager();
  const http = createServer();
  const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 32_768 });
  wss.on("connection", (ws, req) => attachConnection(ws, manager, req));
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const url = "ws://127.0.0.1:" + (http.address() as AddressInfo).port + "/ws";
  const clients: Peer[] = [];
  const peer = async () => { const p = await new Peer(url).open(); clients.push(p); return p; };
  const stop = async () => {
    await Promise.all(clients.map((c) => c.close()));
    manager.dispose();
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  };
  return { manager, peer, stop };
}

test("an oversized ws frame is rejected by the socket (close 1009), never parsed", async () => {
  const { peer, stop } = await setup();
  try {
    const p = await peer();
    p.send({ type: "create", nickname: "A" });
    await p.wait((m) => m.type === "joined");
    // > 32 KB frame: ws must refuse it at the protocol level.
    p.sendRaw(JSON.stringify({ type: "chat", text: "x".repeat(40_000) }));
    assert.equal(await p.waitClosed(), 1009, "frame bigger than maxPayload closes with 1009");
  } finally {
    await stop();
  }
});

test("room password brute force is throttled per IP", async () => {
  const { peer, stop } = await setup();
  try {
    const owner = await peer();
    owner.send({ type: "create", nickname: "Owner", password: "pw" });
    const joined = await owner.wait((m) => m.type === "joined") as JoinedMsg;

    const attacker = await peer();
    for (let i = 0; i < 10; i++) {
      attacker.send({ type: "join", nickname: "Evil", roomCode: joined.roomCode, password: "wrong" });
      const e = await attacker.wait((m) => m.type === "error") as any;
      assert.equal(e.code, "bad_password");
    }
    // The 11th attempt is refused even with the correct password.
    attacker.send({ type: "join", nickname: "Evil", roomCode: joined.roomCode, password: "pw" });
    const e = await attacker.wait((m) => m.type === "error") as any;
    assert.equal(e.code, "rate_limited");
  } finally {
    await stop();
  }
});

test("checkPassword accepts only the exact password, open rooms accept anything", () => {
  const manager = new RoomManager();
  const open = manager.createRoom("open", null);
  const locked = manager.createRoom("locked", "hunter2");
  assert.equal(manager.checkPassword(open, undefined), true);
  assert.equal(manager.checkPassword(open, "anything"), true);
  assert.equal(manager.checkPassword(locked, "hunter2"), true);
  assert.equal(manager.checkPassword(locked, " hunter2 "), true, "attempt is trimmed");
  assert.equal(manager.checkPassword(locked, "hunter3"), false);
  assert.equal(manager.checkPassword(locked, "hunter22"), false, "length mismatch is rejected");
  assert.equal(manager.checkPassword(locked, 42 as any), false, "non-strings are rejected");
  assert.equal(manager.checkPassword(locked, undefined), false);
  manager.dispose();
});

test("securityHeaders sets a strict CSP and nosniff", () => {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as any;
  let called = false;
  securityHeaders({} as any, res, () => { called = true; });
  assert.ok(called, "next() is called");
  const csp = headers["Content-Security-Policy"];
  assert.ok(csp, "CSP header set");
  assert.match(csp, /script-src 'self'/);
  assert.ok(!csp.includes("unsafe-inline'; script"), "no inline scripts allowed");
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self' ws: wss:/, "websockets to own host allowed");
  assert.match(csp, /img-src 'self' data:/, "pixel-icon data URLs allowed");
  assert.match(csp, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/, "google fonts stylesheet allowed");
  assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/, "google fonts files allowed");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
});

test("shuffle defaults to the crypto RNG and still returns a permutation", () => {
  for (let i = 0; i < 100; i++) {
    const v = secureRandom();
    assert.ok(v >= 0 && v < 1, `secureRandom in [0,1): ${v}`);
  }
  const input = Array.from({ length: 52 }, (_, i) => i);
  const out = shuffle(input); // default rng = secureRandom
  assert.deepEqual([...out].sort((a, b) => a - b), input, "shuffle is a permutation");
  assert.notEqual(out, input, "returns a new array");
});
