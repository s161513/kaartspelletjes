import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import type { JoinedMsg, RoomListMsg, ServerMessage } from "@app/shared";
import { RoomManager } from "../server/src/rooms.ts";
import { attachConnection } from "../server/src/handlers.ts";
import { loadGames } from "../server/src/games/loader.ts";

class Peer {
  socket: WebSocket;
  queue: ServerMessage[] = [];
  pending = new Set<() => void>();
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("message", (raw) => {
      this.queue.push(JSON.parse(raw.toString()) as ServerMessage);
      for (const check of [...this.pending]) check();
    });
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
    await new Promise<void>((resolve) => { this.socket.once("close", resolve); this.socket.close(); });
  }
}

const isList = (m: ServerMessage): m is RoomListMsg => m.type === "roomList";

test("room list: live updates, names, password-protected join and watch", async () => {
  await loadGames();
  const manager = new RoomManager();
  const http = createServer();
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  wss.on("connection", (ws) => attachConnection(ws, manager));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const url = "ws://127.0.0.1:" + (http.address() as AddressInfo).port + "/ws";
  const clients: Peer[] = [];
  const connect = async () => { const p = await new Peer(url).open(); clients.push(p); return p; };

  try {
    // A landing-page visitor subscribes and sees an empty list.
    const visitor = await connect();
    visitor.send({ type: "watchRooms" });
    assert.deepEqual((await visitor.wait(isList) as RoomListMsg).rooms, []);

    // An open room with a default name, and a locked room with a custom name.
    const anna = await connect();
    anna.send({ type: "create", nickname: "Anna" });
    const annaJoined = await anna.wait((m) => m.type === "joined") as JoinedMsg;
    assert.equal(annaJoined.roomName, "Anna's room");
    assert.equal(annaJoined.locked, false);

    const bob = await connect();
    bob.send({ type: "create", nickname: "Bob", roomName: "  Secret club ", password: " hunter2 " });
    const bobJoined = await bob.wait((m) => m.type === "joined") as JoinedMsg;
    assert.equal(bobJoined.roomName, "Secret club");
    assert.equal(bobJoined.locked, true);

    // The visitor gets pushed updates; the password itself is never listed.
    const list = await visitor.wait((m) => isList(m) && m.rooms.length === 2) as RoomListMsg;
    assert.deepEqual(
      list.rooms.map((r) => [r.name, r.hostName, r.players, r.locked, r.gameId]),
      [["Anna's room", "Anna", 1, false, null], ["Secret club", "Bob", 1, true, null]],
    );
    assert.ok(!JSON.stringify(list).includes("hunter2"), "password must not be sent");

    // Joining the locked room needs the right password (surrounding spaces are fine).
    const cas = await connect();
    cas.send({ type: "join", nickname: "Cas", roomCode: bobJoined.roomCode });
    assert.equal((await cas.wait((m) => m.type === "error") as any).code, "bad_password");
    cas.send({ type: "join", nickname: "Cas", roomCode: bobJoined.roomCode, password: "wrong" });
    assert.equal((await cas.wait((m) => m.type === "error") as any).code, "bad_password");
    cas.send({ type: "join", nickname: "Cas", roomCode: bobJoined.roomCode, password: "hunter2 " });
    const casJoined = await cas.wait((m) => m.type === "joined") as JoinedMsg;
    assert.equal(casJoined.roomCode, bobJoined.roomCode);

    // The open room needs no password at all.
    const dirk = await connect();
    dirk.send({ type: "join", nickname: "Dirk", roomCode: annaJoined.roomCode });
    await dirk.wait((m) => m.type === "joined");

    const counts = await visitor.wait((m) => isList(m) && m.rooms.every((r) => r.players === 2)) as RoomListMsg;
    assert.equal(counts.rooms.length, 2);

    // Once a game runs, the list shows it — and watching a locked room also needs the password.
    bob.send({ type: "startGame", gameId: "tictactoe" });
    await bob.wait((m) => m.type === "gameStarted");
    const playing = await visitor.wait((m) => isList(m) && m.rooms.some((r) => r.gameId === "tictactoe")) as RoomListMsg;
    assert.equal(playing.rooms[0].name, "Anna's room", "joinable rooms are listed first");

    const eve = await connect();
    eve.send({ type: "spectate", nickname: "Eve", roomCode: bobJoined.roomCode });
    assert.equal((await eve.wait((m) => m.type === "error") as any).code, "bad_password");
    eve.send({ type: "spectate", nickname: "Eve", roomCode: bobJoined.roomCode, password: "hunter2" });
    const eveJoined = await eve.wait((m) => m.type === "joined") as JoinedMsg;
    assert.equal(eveJoined.role, "spectator");

    // A room whose players all left disappears from the list.
    for (const p of [anna, dirk]) p.send({ type: "leave" });
    await visitor.wait((m) => isList(m) && m.rooms.length === 1);
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    manager.dispose();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});

test("host can end a game: everyone gets gameEnded, the room returns to its lobby", async () => {
  await loadGames();
  const manager = new RoomManager();
  const http = createServer();
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  wss.on("connection", (ws) => attachConnection(ws, manager));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const url = "ws://127.0.0.1:" + (http.address() as AddressInfo).port + "/ws";
  const clients: Peer[] = [];
  const connect = async () => { const p = await new Peer(url).open(); clients.push(p); return p; };

  try {
    const host = await connect();
    host.send({ type: "create", nickname: "Host" });
    const joined = await host.wait((m) => m.type === "joined") as JoinedMsg;
    const guest = await connect();
    guest.send({ type: "join", nickname: "Guest", roomCode: joined.roomCode });
    await guest.wait((m) => m.type === "joined");

    // Nothing to end yet.
    host.send({ type: "endGame" });
    assert.equal((await host.wait((m) => m.type === "error") as any).code, "no_game");

    host.send({ type: "startGame", gameId: "tictactoe" });
    await Promise.all([host, guest].map((p) => p.wait((m) => m.type === "gameStarted")));
    const watcher = await connect();
    watcher.send({ type: "spectate", nickname: "Watcher", roomCode: joined.roomCode });
    await watcher.wait((m) => m.type === "joined");

    // Only the host may end it.
    guest.send({ type: "endGame" });
    assert.equal((await guest.wait((m) => m.type === "error") as any).code, "not_host");
    watcher.send({ type: "endGame" });
    assert.equal((await watcher.wait((m) => m.type === "error") as any).code, "not_host");

    host.send({ type: "endGame" });
    for (const p of [host, guest, watcher]) {
      const ended = await p.wait((m) => m.type === "gameEnded") as any;
      assert.equal(ended.by, "Host");
      await p.wait((m) => m.type === "roomState" && (m as any).currentGameId === null);
    }
    const room = manager.getRoom(joined.roomCode)!;
    assert.equal(room.runtime, null);
    assert.equal(room.lastGame, undefined);
    assert.equal(room.players.size, 2, "everyone keeps their seat");

    // Same room, straight into a new game.
    host.send({ type: "startGame", gameId: "tictactoe" });
    await Promise.all([host, guest].map((p) => p.wait((m) => m.type === "gameStarted")));
  } finally {
    await Promise.all(clients.map((c) => c.close()));
    manager.dispose();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
