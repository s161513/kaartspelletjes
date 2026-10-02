import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import type { Card, JoinedMsg, ServerMessage } from "@app/shared";
import { RoomManager } from "../server/src/rooms.ts";
import { attachConnection } from "../server/src/handlers.ts";
import { loadGames, games } from "../server/src/games/loader.ts";
import type { PresidentenState, PresidentenView } from "../games/presidenten/types.ts";

// Minimal re-use of the platform harness.
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
  wait(predicate: (m: ServerMessage) => boolean, timeoutMs = 6000): Promise<ServerMessage> {
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

const card = (suit: string, rank: string): Card => ({ rank: rank as Card["rank"], suit: suit as Card["suit"], deck: 0, id: `${suit}-${rank}#0` });
const viewOf = (m: ServerMessage): PresidentenView => { assert.ok("state" in m); return m.state as PresidentenView; };

/** No seated player's hand card id may appear in a watcher's payload. */
function assertNoHandLeak(authoritative: PresidentenState, watcherPayload: PresidentenView) {
  assert.deepEqual(watcherPayload.myHand, [], "watcher must hold no cards");
  const wire = JSON.stringify(watcherPayload);
  for (const pid of authoritative.players) {
    for (const c of authoritative.hands[pid] ?? []) {
      assert.ok(!wire.includes(c.id), `hand card ${c.id} leaked to watcher`);
    }
  }
}

test("spectator: watch a running game safely, chat, join mid-game as a citizen", async () => {
  await loadGames();
  assert.ok(games.has("presidenten"));
  const manager = new RoomManager();
  const http = createServer();
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  wss.on("connection", (ws) => attachConnection(ws, manager));
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const url = "ws://127.0.0.1:" + (http.address() as AddressInfo).port + "/ws";
  const clients: Peer[] = [];
  const connect = async () => { const p = await new Peer(url).open(); clients.push(p); return p; };

  try {
    // Three seated players start presidenten.
    const seats: Peer[] = [];
    const sessions: JoinedMsg[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await connect(); seats.push(p);
      p.send(i === 0 ? { type: "create", nickname: "P0" } : { type: "join", nickname: "P" + i, roomCode: sessions[0].roomCode });
      sessions.push(await p.wait((m) => m.type === "joined") as JoinedMsg);
    }
    const room = manager.getRoom(sessions[0].roomCode)!;

    // Cannot watch before a game is running.
    const early = await connect();
    early.send({ type: "spectate", nickname: "Early", roomCode: room.code });
    assert.equal((await early.wait((m) => m.type === "error") as any).code, "not_in_progress");
    await early.close();

    seats[0].send({ type: "startGame", gameId: "presidenten" });
    await Promise.all(seats.map((p) => p.wait((m) => m.type === "gameStarted")));

    // A watcher joins mid-game.
    const watcher = await connect();
    watcher.send({ type: "spectate", nickname: "Watcher", roomCode: room.code });
    const joined = await watcher.wait((m) => m.type === "joined") as JoinedMsg;
    assert.equal(joined.role, "spectator");
    assert.equal(joined.joinable, true, "presidenten supports mid-game join");
    const watcherId = joined.playerId;

    // Their snapshot leaks no hands.
    const snap = viewOf(await watcher.wait((m) => m.type === "gameStarted"));
    assertNoHandLeak(room.runtime!.state as PresidentenState, snap);

    // Player count is unaffected; roomState lists the watcher.
    const rs = await seats[0].wait((m) => m.type === "roomState" && !!(m as any).spectators?.length) as any;
    assert.equal(rs.players.length, 3);
    assert.equal(rs.spectators.length, 1);
    assert.equal(rs.spectators[0].nickname, "Watcher");
    assert.equal(rs.spectators[0].pendingPlayer, false);

    // A watcher cannot move.
    watcher.send({ type: "move", move: { type: "pass" } });
    assert.equal((await watcher.wait((m) => m.type === "error") as any).code, "spectating");

    // Watcher chat is prefixed and reaches players.
    watcher.send({ type: "chat", text: "hi all" });
    const chat = await seats[1].wait((m) => m.type === "chat" && (m as any).text === "hi all") as any;
    assert.ok(chat.from.startsWith("👀"));

    // Disconnect + rejoin restores the watcher seat and a safe snapshot.
    await watcher.close();
    const back = await connect();
    back.send({ type: "rejoin", playerId: watcherId, roomCode: room.code });
    const rejoined = await back.wait((m) => m.type === "joined") as JoinedMsg;
    assert.equal(rejoined.role, "spectator");
    assertNoHandLeak(room.runtime!.state as PresidentenState, viewOf(await back.wait((m) => m.type === "gameStarted")));

    // Commit to join next round → marked pending, still a watcher for now.
    back.send({ type: "joinNextRound" });
    const pending = await seats[0].wait((m) => m.type === "roomState" && !!(m as any).spectators?.[0]?.pendingPlayer) as any;
    assert.equal(pending.players.length, 3, "not seated until the next deal");
    assert.ok((room.runtime!.state as PresidentenState).joining.includes(watcherId));

    // Force the current hand to its final card so a new hand is dealt.
    const [a, b, c] = sessions.map((s) => s.playerId);
    const st = room.runtime!.state as PresidentenState;
    st.players = [a, b, c];
    st.hands = { [a]: [], [b]: [], [c]: [card("spades", "5")] };
    st.finished = [a, b];
    st.phase = "PLAY";
    st.turnIndex = 2;
    st.currentCount = null; st.currentRankValue = null; st.runRankValue = null; st.runCount = 0;
    st.lastPlayerId = null; st.passedThisTrick = []; st.top = null; st.pile = [];
    st.exchange = null; st.lastTrick = null; st.winner = null;

    const dealt = back.wait((m) => m.type === "gameStarted"); // watcher gets their private view
    seats[2].send({ type: "move", move: { type: "play", cardIds: ["spades-5#0"] } });

    // The watcher is now a seated citizen holding real cards.
    const mine = viewOf(await dealt);
    assert.ok(mine.myHand.length > 0, "newly dealt citizen holds cards");
    const self = mine.players.find((p) => p.id === watcherId)!;
    assert.equal(self.role, "citizen", "joined as a burger/citizen");
    assert.ok(room.players.has(watcherId), "migrated into a real seat");
    assert.equal(room.spectators.has(watcherId), false);
    assert.equal(room.players.size, 4);
  } finally {
    for (const c of clients) c.socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    manager.dispose();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  }
});
