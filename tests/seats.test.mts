import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import type { JoinedMsg, RoomStateMsg, ServerMessage } from "@app/shared";
import { RoomManager } from "../server/src/rooms.ts";
import { attachConnection } from "../server/src/handlers.ts";
import { loadGames } from "../server/src/games/loader.ts";

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
  wait(predicate: (m: ServerMessage) => boolean, timeoutMs = 4000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const i = this.queue.findIndex(predicate);
        if (i >= 0) { const m = this.queue.splice(i, 1)[0]; clearTimeout(timer); this.pending.delete(check); resolve(m); }
      };
      const timer = setTimeout(() => { this.pending.delete(check); reject(Error("Timed out")); }, timeoutMs);
      this.pending.add(check); check();
    });
  }
  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => { this.socket.once("close", () => resolve()); this.socket.close(); });
  }
}

async function setup(goneAfterMs = 300) {
  await loadGames();
  const manager = new RoomManager();
  manager.goneAfterMs = goneAfterMs;
  const http = createServer();
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  wss.on("connection", (ws) => attachConnection(ws, manager));
  await new Promise<void>((r) => http.listen(0, r));
  const url = `ws://localhost:${(http.address() as AddressInfo).port}/ws`;
  const peer = () => new Peer(url).open();
  const stop = async () => {
    manager.dispose();
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((r) => wss.close(() => http.close(() => r())));
  };
  return { manager, peer, stop };
}

const isJoined = (m: ServerMessage): m is JoinedMsg => m.type === "joined";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const roomStateWhere = (pred: (m: RoomStateMsg) => boolean) => (m: ServerMessage) =>
  m.type === "roomState" && pred(m);

test("a second tab taking over a seat closes the first tab's socket with seat_taken", async () => {
  const { peer, stop } = await setup();
  try {
    const host = await peer();
    host.send({ type: "create", nickname: "Host" });
    const hj = (await host.wait(isJoined)) as JoinedMsg;

    const tab1 = await peer();
    tab1.send({ type: "join", nickname: "B", roomCode: hj.roomCode });
    const bj = (await tab1.wait(isJoined)) as JoinedMsg;

    const tab2 = await peer();
    tab2.send({ type: "rejoin", roomCode: hj.roomCode, playerId: bj.playerId, secret: bj.secret });
    await tab2.wait(isJoined);

    const e = await tab1.wait((m) => m.type === "error");
    assert.equal(e.type === "error" && e.code, "seat_taken");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(tab1.closeCode, 4001);

    // The new tab still owns the seat and B is still connected.
    tab2.send({ type: "chat", text: "still here" });
    await host.wait((m) => m.type === "chat" && m.text === "still here");
    const rs = await host.wait(roomStateWhere((m) => m.players.length === 2));
    assert.ok(rs.type === "roomState" && rs.players.every((p) => p.connected));
    for (const p of [host, tab2]) await p.close();
  } finally {
    await stop();
  }
});

test("a player who stays disconnected is removed from the lobby and from the game", async () => {
  const { manager, peer, stop } = await setup();
  try {
    const a = await peer();
    a.send({ type: "create", nickname: "A" });
    const aj = (await a.wait(isJoined)) as JoinedMsg;
    const others = [];
    for (const n of ["B", "C", "D"]) {
      const p = await peer();
      p.send({ type: "join", nickname: n, roomCode: aj.roomCode });
      others.push({ p, j: (await p.wait(isJoined)) as JoinedMsg });
    }
    a.send({ type: "startGame", gameId: "presidenten" });
    await a.wait((m) => m.type === "gameStarted");

    // D's tab dies and never comes back.
    const [b, c, d] = others;
    await d.p.close();
    await a.wait((m) => m.type === "chat" && m.text === "D was disconnected too long", 3000);
    await a.wait(roomStateWhere((m) => m.players.length === 3 && !m.players.some((p) => p.nickname === "D")));
    const room = manager.getRoom(aj.roomCode)!;
    assert.ok(room.runtime, "a game with a playerLeft hook keeps going");

    // A quick reconnect (page navigation) keeps the seat.
    await c.p.close();
    const c2 = await peer();
    c2.send({ type: "rejoin", roomCode: aj.roomCode, playerId: c.j.playerId, secret: c.j.secret });
    await c2.wait(isJoined);
    await sleep(600);
    assert.ok(room.players.get(c.j.playerId)?.connected, "C rejoined in time and keeps the seat");
    for (const p of [a, b.p, c2]) await p.close();
  } finally {
    await stop();
  }
});

test("a lobby-only player timing out does not end a game they were not in", async () => {
  const { manager, peer, stop } = await setup(200);
  try {
    const a = await peer();
    a.send({ type: "create", nickname: "A" });
    const aj = (await a.wait(isJoined)) as JoinedMsg;
    const b = await peer();
    b.send({ type: "join", nickname: "B", roomCode: aj.roomCode });
    await b.wait(isJoined);
    const c = await peer();
    c.send({ type: "join", nickname: "C", roomCode: aj.roomCode });
    await c.wait(isJoined);
    await c.close(); // C's tab closes in the lobby...
    await a.wait(roomStateWhere((m) => m.players.some((p) => p.nickname === "C" && !p.connected)));
    a.send({ type: "startGame", gameId: "tictactoe" }); // ...and A + B start without them
    await a.wait((m) => m.type === "gameStarted");
    await a.wait((m) => m.type === "chat" && m.text === "C was disconnected too long", 3000);
    await sleep(50);
    assert.ok(manager.getRoom(aj.roomCode)!.runtime, "tic-tac-toe is still running");
    assert.ok(!a.queue.some((m) => m.type === "gameOver"));
    for (const p of [a, b]) await p.close();
  } finally {
    await stop();
  }
});

test("a watcher who is dealt in mid-game acts as a player and is cleaned up like one", async () => {
  const { manager, peer, stop } = await setup(200);
  try {
    const a = await peer();
    a.send({ type: "create", nickname: "A" });
    const aj = (await a.wait(isJoined)) as JoinedMsg;
    const b = await peer();
    b.send({ type: "join", nickname: "B", roomCode: aj.roomCode });
    await b.wait(isJoined);
    a.send({ type: "startGame", gameId: "tictactoe" });
    await a.wait((m) => m.type === "gameStarted");

    const w = await peer();
    w.send({ type: "spectate", nickname: "W", roomCode: aj.roomCode });
    const wj = (await w.wait(isJoined)) as JoinedMsg;
    const room = manager.getRoom(aj.roomCode)!;
    manager.migrateToPlayer(room, wj.playerId); // as reconcileJoiners does

    w.send({ type: "chat", text: "dealt in" });
    await a.wait((m) => m.type === "chat" && m.text === "dealt in");
    assert.ok(!w.queue.some((m) => m.type === "error"), "no no_seat for the new player");

    await w.close();
    await a.wait((m) => m.type === "chat" && m.text === "W was disconnected too long", 3000);
    assert.ok(!room.players.has(wj.playerId));
    for (const p of [a, b]) await p.close();
  } finally {
    await stop();
  }
});

test("when everyone is gone, seats wait for the room's own prune timer", async () => {
  const { manager, peer, stop } = await setup(100);
  try {
    const a = await peer();
    a.send({ type: "create", nickname: "A" });
    const aj = (await a.wait(isJoined)) as JoinedMsg;
    const b = await peer();
    b.send({ type: "join", nickname: "B", roomCode: aj.roomCode });
    await b.wait(isJoined);
    await a.close();
    await b.close();
    await sleep(400);
    assert.equal(manager.getRoom(aj.roomCode)!.players.size, 2, "both seats kept during an outage");

    const a2 = await peer();
    a2.send({ type: "rejoin", roomCode: aj.roomCode, playerId: aj.playerId, secret: aj.secret });
    await a2.wait(isJoined);
    await a2.wait((m) => m.type === "chat" && m.text === "B was disconnected too long", 3000);
    await a2.close();
  } finally {
    await stop();
  }
});
