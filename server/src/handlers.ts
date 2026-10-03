import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@app/shared";
import { RoomManager, ServerFullError, type Player, type Room } from "./rooms.js";
import { games } from "./games/loader.js";

/** Reject frames larger than this before parsing (guards against memory spikes). */
const MAX_MESSAGE_BYTES = 32_768;
// Token-bucket rate limit per connection: refill RATE tokens/sec, hold up to
// BURST. One message costs one token. Enough for fast play, not for flooding.
const RATE_PER_SEC = 20;
const BURST = 40;

/** Per-connection state: which room/player this socket is bound to. */
interface Conn {
  ws: WebSocket;
  roomCode: string | null;
  playerId: string | null;
  /** Token-bucket state for rate limiting. */
  tokens: number;
  lastRefill: number;
}

/** Refill the bucket and try to spend one token. Returns false if rate-limited. */
function allowMessage(conn: Conn): boolean {
  const now = Date.now();
  const elapsed = (now - conn.lastRefill) / 1000;
  conn.tokens = Math.min(BURST, conn.tokens + elapsed * RATE_PER_SEC);
  conn.lastRefill = now;
  if (conn.tokens < 1) return false;
  conn.tokens -= 1;
  return true;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function err(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: "error", code, message });
}

/** Store a new game state and send it out, ending the game if it is over. */
function publish(manager: RoomManager, room: Room, next: unknown): void {
  const runtime = room.runtime!;
  runtime.state = next;
  if (runtime.game.result(next).over) {
    clearTimeout(runtime.timer);
    manager.sendGame(room, "gameOver");
    room.lastGame = runtime;
    room.runtime = null;
    sendRoomState(manager, room);
  } else {
    manager.sendGame(room, "gameState");
    manager.scheduleGame(room);
  }
}

/**
 * A player left mid-game. `playerLeft` decides what happens to the game; a game
 * with only `playersChanged` already heard about it via removePlayer. A game
 * with neither cannot continue: end it, and a lone remaining player wins.
 */
function playerLeftGame(manager: RoomManager, room: Room, playerId: string): void {
  const runtime = room.runtime!;
  if (runtime.game.playerLeft) {
    return publish(manager, room, runtime.game.playerLeft(runtime.state, playerId));
  }
  if (runtime.game.playersChanged) return;

  const remaining = [...room.players.values()].filter((p) => p.connected);
  clearTimeout(runtime.timer);
  manager.sendGame(room, "gameOver", {
    winner: remaining.length === 1 ? remaining[0].id : "draw",
  });
  room.runtime = null;
}

/** Broadcast the current room snapshot to everyone in it. */
function sendRoomState(manager: RoomManager, room: Room): void {
  manager.broadcast(room, {
    type: "roomState",
    players: manager.publicPlayers(room),
    hostId: room.hostId ?? "",
    currentGameId: manager.currentGameId(room),
  });
}

export function attachConnection(ws: WebSocket, manager: RoomManager): void {
  const conn: Conn = {
    ws,
    roomCode: null,
    playerId: null,
    tokens: BURST,
    lastRefill: Date.now(),
  };

  ws.on("message", (raw) => {
    const text = raw.toString();
    if (text.length > MAX_MESSAGE_BYTES) {
      return err(ws, "too_large", "Message too large");
    }
    if (!allowMessage(conn)) {
      return err(ws, "rate_limited", "Slow down");
    }
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      return err(ws, "bad_json", "Could not parse message");
    }
    if (!msg || typeof (msg as ClientMessage).type !== "string") {
      return err(ws, "bad_shape", "Message missing type");
    }

    try {
      handle(conn, manager, msg);
    } catch (e) {
      err(ws, "internal", "Server error handling message");
      console.error("handler error:", e);
    }
  });

  ws.on("close", () => {
    if (!conn.roomCode || !conn.playerId) return;
    const room = manager.getRoom(conn.roomCode);
    if (!room) return;
    // A newer socket may already own this seat (page navigation or a reload
    // whose rejoin arrived before this close). Then this close means nothing.
    if (room.players.get(conn.playerId)?.ws !== ws) return;
    manager.disconnect(room, conn.playerId);
    // Room may have been pruned; only broadcast if it still exists.
    if (manager.getRoom(conn.roomCode)) sendRoomState(manager, room);
  });
}

function handle(conn: Conn, manager: RoomManager, msg: ClientMessage): void {
  const { ws } = conn;

  switch (msg.type) {
    case "create": {
      const nickname = sanitizeNick(msg.nickname);
      if (!nickname) return err(ws, "bad_nick", "Nickname required");
      let room: Room;
      try {
        room = manager.createRoom();
      } catch (e) {
        if (e instanceof ServerFullError)
          return err(ws, "server_full", "Server is at capacity, try later");
        throw e;
      }
      bindNewPlayer(conn, manager, room, nickname);
      return;
    }

    case "join": {
      const nickname = sanitizeNick(msg.nickname);
      if (!nickname) return err(ws, "bad_nick", "Nickname required");
      const room = manager.getRoom(msg.roomCode);
      if (!room) return err(ws, "no_room", "Room not found");
      // Late-join: a game in progress accepts newcomers as spectators (they are
      // dealt in at the next round via the game's playersChanged hook), up to
      // the running game's max player count.
      if (room.runtime) {
        const max = games.get(room.runtime.gameId)?.meta.maxPlayers ?? Infinity;
        if (room.players.size >= max)
          return err(ws, "room_full", "This game is full");
      }
      const player = bindNewPlayer(conn, manager, room, nickname);
      // Fold the newcomer into the live game and hand them the current snapshot
      // so their client navigates straight onto the board as a spectator.
      if (room.runtime) {
        manager.updateGamePlayers(room);
        manager.sendGame(room, "gameStarted", { only: player.id });
      }
      return;
    }

    case "rejoin": {
      const room = manager.getRoom(msg.roomCode);
      if (!room) return err(ws, "no_room", "Room not found");
      const player = room.players.get(msg.playerId);
      if (!player) return err(ws, "no_seat", "No seat to rejoin");
      // The public playerId is known to everyone in the room; the private secret
      // is not. Require it so a playerId alone cannot hijack someone's seat.
      if (player.secret !== msg.secret)
        return err(ws, "bad_secret", "No seat to rejoin");
      manager.cancelPrune(room); // recovered before deletion — keep it alive
      player.ws = ws;
      player.connected = true;
      manager.updateGamePlayers(room);
      if (!room.hostId) room.hostId = player.id;
      conn.roomCode = room.code;
      conn.playerId = player.id;

      send(ws, {
        type: "joined",
        playerId: player.id,
        roomCode: room.code,
        players: manager.publicPlayers(room),
        hostId: room.hostId ?? "",
        secret: player.secret,
      });
      // Restore the private snapshot before the room can redirect the client.
      if (room.runtime || room.lastGame) {
        manager.sendGame(room, room.runtime ? "gameStarted" : "gameOver", { only: player.id });
      }
      sendRoomState(manager, room);
      return;
    }

    case "chat": {
      const room = requireRoom(conn, manager);
      if (!room) return;
      const player = room.players.get(conn.playerId!);
      const text = String(msg.text ?? "").slice(0, 500).trim();
      if (!player || !text) return;
      manager.broadcast(room, {
        type: "chat",
        from: player.nickname,
        text,
        ts: Date.now(),
      });
      return;
    }

    case "startGame": {
      const room = requireRoom(conn, manager);
      if (!room) return;
      if (room.hostId !== conn.playerId)
        return err(ws, "not_host", "Only the host can start the game");
      if (room.runtime) return err(ws, "already", "A game is already running");

      const entry = games.get(msg.gameId);
      if (!entry) return err(ws, "no_game", "Unknown game");
      const { meta, logic: game } = entry;

      const seated = [...room.players.values()].filter((p) => p.connected);
      if (seated.length < meta.minPlayers)
        return err(ws, "too_few", `Need at least ${meta.minPlayers} players`);
      if (seated.length > meta.maxPlayers)
        return err(ws, "too_many", `At most ${meta.maxPlayers} players`);

      const playerIds = seated.map((p) => p.id);
      room.lastGame = undefined;
      room.runtime = { gameId: meta.id, game, state: game.init(playerIds) };

      manager.sendGame(room, "gameStarted");
      manager.scheduleGame(room);
      sendRoomState(manager, room);
      return;
    }

    case "move": {
      const room = requireRoom(conn, manager);
      if (!room) return;
      if (!room.runtime) return err(ws, "no_game", "No game in progress");

      const { game, state } = room.runtime;
      const validated = game.validateMove(state, conn.playerId!, msg.move);
      if (!validated.ok) {
        // Let the game record private penalty state (e.g. a wrong-guess
        // cooldown) without validateMove mutating its input. Not broadcast.
        if (game.onInvalidMove) {
          room.runtime.state = game.onInvalidMove(state, conn.playerId!, msg.move);
        }
        return err(ws, "bad_move", validated.error);
      }

      publish(manager, room, game.applyMove(state, conn.playerId!, validated.move));
      return;
    }

    case "leave": {
      const room = manager.getRoom(conn.roomCode ?? "");
      if (room && conn.playerId) {
        const nickname = room.players.get(conn.playerId)?.nickname ?? "A player";
        manager.removePlayer(room, conn.playerId);
        if (manager.getRoom(room.code)) {
          manager.broadcast(room, {
            type: "chat",
            from: "🚪",
            text: `${nickname} left the room`,
            ts: Date.now(),
          });
          if (room.runtime) playerLeftGame(manager, room, conn.playerId);
          sendRoomState(manager, room);
        }
      }
      conn.roomCode = null;
      conn.playerId = null;
      return;
    }

    default:
      return err(ws, "unknown_type", "Unknown message type");
  }
}

function bindNewPlayer(
  conn: Conn,
  manager: RoomManager,
  room: Room,
  nickname: string,
): Player {
  const player: Player = {
    id: randomUUID(),
    nickname,
    secret: randomUUID(),
    ws: conn.ws,
    connected: true,
  };
  manager.addPlayer(room, player);
  conn.roomCode = room.code;
  conn.playerId = player.id;

  send(conn.ws, {
    type: "joined",
    playerId: player.id,
    roomCode: room.code,
    players: manager.publicPlayers(room),
    hostId: room.hostId ?? "",
    secret: player.secret,
  });
  sendRoomState(manager, room);
  return player;
}

function requireRoom(conn: Conn, manager: RoomManager): Room | null {
  if (!conn.roomCode || !conn.playerId) {
    err(conn.ws, "no_room", "Join a room first");
    return null;
  }
  const room = manager.getRoom(conn.roomCode);
  if (!room) {
    err(conn.ws, "no_room", "Room no longer exists");
    return null;
  }
  if (room.players.get(conn.playerId)?.ws !== conn.ws) {
    err(conn.ws, "no_seat", "This connection no longer owns a seat");
    return null;
  }
  return room;
}

function sanitizeNick(raw: unknown): string | null {
  // Reject non-strings and absurd lengths before any coercion, then strip
  // control characters (incl. newlines) so a nickname stays a single clean line.
  if (typeof raw !== "string" || raw.length > 1000) return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 24);
  return s.length > 0 ? s : null;
}
