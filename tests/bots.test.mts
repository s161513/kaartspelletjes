import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import type { JoinedMsg, RoomStateMsg, ServerMessage } from "@app/shared";
import { RoomManager, BOT_MOVE_DELAY_MS } from "../server/src/rooms.ts";
import { attachConnection } from "../server/src/handlers.ts";
import { loadGames, games } from "../server/src/games/loader.ts";

class Peer {
  socket: WebSocket;
  queue: ServerMessage[] = [];
  pending = new Set<() => void>();
  constructor(url: string, private name = "?") {
    this.socket = new WebSocket(url);
    this.socket.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMessage;
      if ((m as any).code) console.log(`  [${this.name} <-] error ${(m as any).code}`);
      this.queue.push(m);
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
  wait(predicate: (m: ServerMessage) => boolean, timeoutMs = 5000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const i = this.queue.findIndex(predicate);
        if (i >= 0) { const m = this.queue.splice(i, 1)[0]; clearTimeout(timer); this.pending.delete(check); resolve(m); }
      };
      const timer = setTimeout(() => { this.pending.delete(check); reject(Error("Timed out; got " + this.queue.map((m) => m.type).join(","))); }, timeoutMs);
      this.pending.add(check); check();
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
  const peer = async (name = "?") => { const p = await new Peer(url, name).open(); clients.push(p); return p; };
  const stop = async () => {
    await Promise.all(clients.map((c) => c.close()));
    manager.dispose();
    for (const c of wss.clients) c.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve) => http.close(() => resolve()));
  };
  return { manager, peer, stop };
}

test("host can add and remove a bot; only the host can; bots are flagged and never host", async () => {
  const { manager, peer, stop } = await setup();
  try {
    const host = await peer("host");
    host.send({ type: "create", nickname: "Host" });
    const joined = await host.wait((m) => m.type === "joined") as JoinedMsg;
    const guest = await peer("guest");
    guest.send({ type: "join", nickname: "Guest", roomCode: joined.roomCode });
    await guest.wait((m) => m.type === "joined");

    // A non-host cannot add a bot.
    guest.send({ type: "addBot" });
    assert.equal((await guest.wait((m) => m.type === "error") as any).code, "not_host");

    host.send({ type: "addBot", name: "Robo" });
    const rs = await host.wait((m) => m.type === "roomState" && (m as RoomStateMsg).players.some((p) => p.isBot)) as RoomStateMsg;
    const bot = rs.players.find((p) => p.isBot)!;
    assert.equal(bot.nickname, "Robo");
    assert.equal(rs.hostId, joined.playerId, "the bot did not become host");

    // No bots mid-game (presidenten takes 3+ players, so host+guest+bot fits).
    host.send({ type: "startGame", gameId: "presidenten" });
    await host.wait((m) => m.type === "gameStarted");
    host.send({ type: "addBot" });
    assert.equal((await host.wait((m) => m.type === "error") as any).code, "in_progress");
    host.send({ type: "endGame" });
    await host.wait((m) => m.type === "gameEnded");

    // Remove the bot again (host only).
    guest.send({ type: "removeBot", playerId: bot.id });
    assert.equal((await guest.wait((m) => m.type === "error") as any).code, "not_host");
    host.send({ type: "removeBot", playerId: bot.id });
    const rs2 = await host.wait((m) => m.type === "roomState" && (m as RoomStateMsg).players.length === 2) as RoomStateMsg;
    assert.ok(!rs2.players.some((p) => p.isBot));

    const room = manager.getRoom(joined.roomCode)!;
    assert.equal(room.hostId, joined.playerId);
  } finally {
    await stop();
  }
});

test("a bot seat plays automatically: tic-tac-toe human vs bot runs to gameOver", async () => {
  const { manager, peer, stop } = await setup();
  try {
    const host = await peer("host");
    host.send({ type: "create", nickname: "Me" });
    const joined = await host.wait((m) => m.type === "joined") as JoinedMsg;
    host.send({ type: "addBot" });
    await host.wait((m) => m.type === "roomState" && (m as RoomStateMsg).players.some((p) => p.isBot));

    host.send({ type: "startGame", gameId: "tictactoe" });
    const started = await host.wait((m) => m.type === "gameStarted") as any;
    assert.equal(started.state.turn, joined.playerId, "the human (first seat) opens");

    // Play moves until the game ends; after each human move the bot must
    // answer on its own (extra gameState / gameOver without us sending),
    // and not instantly: there is a human-like pause before the bot plays.
    let last: any = started.state;
    let sawBotReply = false;
    let firstSendAt = 0;
    let botReplyAt = 0;
    for (let step = 0; step < 9; step++) {
      const empty = last.board.map((v: any, i: number) => (v === null ? i : -1)).filter((i: number) => i >= 0);
      if (!empty.length) break;
      const marksBefore = last.board.filter(Boolean).length;
      if (!firstSendAt) firstSendAt = Date.now();
      host.send({ type: "move", move: { cell: empty[0] } });
      for (;;) {
        const next = await host.wait(
          (m) => m.type === "gameOver" || (m.type === "gameState" && (m as any).state.board.filter(Boolean).length > marksBefore),
          8000,
        ).catch(() => null);
        if (!next) break;
        if (next.type === "gameOver") { last = null; break; }
        last = next.state;
        if (last.board.filter(Boolean).length > marksBefore + 1) {
          sawBotReply = true;
          if (!botReplyAt) botReplyAt = Date.now();
        }
        if (last.turn === joined.playerId) break; // bot answered, our turn again
      }
      if (!last) break;
    }
    assert.ok(sawBotReply, "the bot answered at least once without being asked");
    assert.ok(
      botReplyAt - firstSendAt >= BOT_MOVE_DELAY_MS - 150,
      `bot paused before playing (${botReplyAt - firstSendAt}ms >= ~${BOT_MOVE_DELAY_MS}ms)`,
    );
    const room = manager.getRoom(joined.roomCode)!;
    assert.equal(room.runtime, null, "the game ended (bot chain finished)");
  } finally {
    await stop();
  }
});

test("every game with a botMove produces valid moves for bot seats", async () => {
  await loadGames();
  for (const [id, entry] of games) {
    const game = entry.logic;
    if (!game.botMove) continue;
    const n = Math.max(entry.meta.minPlayers, 2);
    const humans = "human";
    const bots = Array.from({ length: n - 1 }, (_, i) => `bot${i}`);
    const ids = [humans, ...bots];
    let state = game.init(ids);
    let moved = 0;
    for (let guard = 0; guard < 400 && !game.result(state).over; guard++) {
      let acted = false;
      // Let every seat use botMove (the human seat too) so the game progresses;
      // bots first, so in race games like dobble they get their click in.
      for (const seat of [...bots, humans]) {
        if (game.result(state).over) break;
        const mv = game.botMove!(state, seat);
        if (mv === null || mv === undefined) continue;
        const checked = game.validateMove(state, seat, mv);
        assert.ok(checked.ok, `${id}: move for ${seat} must validate (got ${JSON.stringify(mv)} → ${checked.ok ? "" : checked.error})`);
        if (checked.ok) {
          state = game.applyMove(state, seat, checked.move);
          if (bots.includes(seat)) moved++;
          acted = true;
        }
      }
      if (game.result(state).over) break;
      if (!acted) {
        // Timer-driven games advance on their own schedule.
        if (game.advance && game.nextUpdateIn && game.nextUpdateIn(state) !== null) {
          state = game.advance(state);
        } else break;
      }
    }
    assert.ok(moved > 0, `${id}: the bot should have played at least one move`);
  }
});
