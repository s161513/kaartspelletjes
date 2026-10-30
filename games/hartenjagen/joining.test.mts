import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import type { Card, JoinedMsg, ServerMessage } from "@app/shared";
import { RoomManager } from "../../server/src/rooms.ts";
import { attachConnection } from "../../server/src/handlers.ts";
import { loadGames } from "../../server/src/games/loader.ts";
import type { HeartsState } from "./types.ts";

class Peer {
  socket: WebSocket;
  queue: ServerMessage[] = [];
  pending = new Set<() => void>();
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("message", (raw) => {
      this.queue.push(JSON.parse(raw.toString()));
      for (const check of [...this.pending]) check();
    });
  }
  async open() {
    await new Promise<void>((resolve, reject) => { this.socket.once("open", resolve); this.socket.once("error", reject); });
    return this;
  }
  send(message: object) { this.socket.send(JSON.stringify(message)); }
  wait(predicate: (m: ServerMessage) => boolean): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const i = this.queue.findIndex(predicate);
        if (i >= 0) { const m = this.queue.splice(i, 1)[0]; clearTimeout(timer); this.pending.delete(check); resolve(m); }
      };
      const timer = setTimeout(() => { this.pending.delete(check); reject(Error("Timed out waiting for message")); }, 6000);
      this.pending.add(check); check();
    });
  }
}

const card = (rank: Card["rank"]): Card => ({ rank, suit: "clubs", deck: 0, id: `clubs-${rank}#0` });
const stateOf = (message: ServerMessage): HeartsState => { assert.ok("state" in message); return message.state as HeartsState; };

test("Hearts spectators queue, leave, and take the next available seat with the completed score", async () => {
  await loadGames();
  const manager = new RoomManager();
  const http = createServer();
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  wss.on("connection", (ws) => attachConnection(ws, manager));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/ws`;
  const clients: Peer[] = [];
  const connect = async () => { const p = await new Peer(url).open(); clients.push(p); return p; };
  try {
    const seats: Peer[] = [];
    const sessions: JoinedMsg[] = [];
    for (let i = 0; i < 5; i++) {
      const p = await connect(); seats.push(p);
      p.send(i === 0 ? { type: "create", nickname: `P${i}` } : { type: "join", nickname: `P${i}`, roomCode: sessions[0].roomCode });
      sessions.push(await p.wait((m) => m.type === "joined") as JoinedMsg);
    }
    const room = manager.getRoom(sessions[0].roomCode)!;
    seats[0].send({ type: "startGame", gameId: "hartenjagen" });
    await Promise.all(seats.map((p) => p.wait((m) => m.type === "gameStarted")));
    const watchers: Peer[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await connect(); watchers.push(p);
      p.send({ type: "spectate", nickname: `W${i}`, roomCode: room.code });
      const joined = await p.wait((m) => m.type === "joined") as JoinedMsg;
      assert.equal(joined.joinable, true);
      ids.push(joined.playerId);
      const view = stateOf(await p.wait((m) => m.type === "gameStarted"));
      assert.ok(Object.values(view.hands).every((h) => h.every((c) => c === null)));
      p.send({ type: "joinNextRound" });
      await p.wait((m) => m.type === "roomState" && !!(m as any).spectators?.find((s: any) => s.id === joined.playerId && s.pendingPlayer));
    }
    watchers[1].send({ type: "leave" });
    await seats[0].wait((m) => m.type === "roomState" && !(m as any).spectators?.some((s: any) => s.id === ids[1]) && (m as any).spectators?.some((s: any) => s.id === ids[2]));
    const state = room.runtime!.state as HeartsState;
    assert.deepEqual(state.joining, [ids[0], ids[2]]);
    const [a, b, c, d, e] = sessions.map((s) => s.playerId);
    state.scores = Object.fromEntries(state.players.map((id) => [id, 10]));
    state.taken = { [a]: 13, [b]: 13, [c]: 0, [d]: 0, [e]: 0 };
    state.phase = "playing"; state.tricksPlayed = 9; state.toPlay = e;
    state.hands = { [a]: [], [b]: [], [c]: [], [d]: [], [e]: [card("6")] };
    state.trick = [a, b, c, d].map((id, i) => ({ playerId: id, card: card((["2", "3", "4", "5"] as const)[i]) }));
    seats[4].send({ type: "move", move: { type: "play", card: card("6").id } });
    await seats[0].wait((m) => m.type === "gameState" && stateOf(m).phase === "roundEnd");
    const highest = Math.max(...Object.values((room.runtime!.state as HeartsState).scores));
    assert.equal(highest, 23);
    seats[0].send({ type: "move", move: { type: "nextRound" } });
    const mine = stateOf(await watchers[0].wait((m) => m.type === "gameStarted" && stateOf(m).roundNumber === 2));
    assert.equal(mine.scores[ids[0]], highest);
    assert.ok(mine.hands[ids[0]].every((c) => c !== null));
    assert.ok(mine.hands[a].every((c) => c === null));
    assert.ok(room.players.has(ids[0]));
    assert.ok(room.spectators.has(ids[2]));
    assert.deepEqual((room.runtime!.state as HeartsState).joining, [ids[2]]);
  } finally {
    for (const p of clients) p.socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    manager.dispose();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
