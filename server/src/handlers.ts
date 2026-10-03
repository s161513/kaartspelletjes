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
  /** This socket is a watcher, not a seated player. */
  isSpectator: boolean;
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
    // Seat any committed watcher the new state has dealt in, before projecting.
    const migrated = manager.reconcileJoiners(room);
    manager.sendGame(room, "gameState");
    manager.scheduleGame(room);
    if (migrated.length) sendRoomState(manager, room);
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
  manager.sendRoomState(room);
}

export function attachConnection(ws: WebSocket, manager: RoomManager): void {
  const conn: Conn = {
    ws, roomCode: null, playerId: null, isSpectator: false,
    tokens: BURST, lastRefill: Date.now(),
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
    manager.unwatchRooms(ws);
    if (!conn.roomCode || !conn.playerId) return;
    const room = manager.getRoom(conn.roomCode);
    if (!room) return;
    // A newer socket may already own this seat (page navigation or a reload
    // whose rejoin arrived before this close). Then this close means nothing.
    const seat = conn.isSpectator
      ? room.spectators.get(conn.playerId)
      : room.players.get(conn.playerId);
    if (seat?.ws !== ws) return;
    if (conn.isSpectator) manager.disconnectSpectator(room, conn.playerId);
    else manager.disconnect(room, conn.playerId);
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
      const name = sanitizeText(msg.roomName, 32) ?? `${nickname}'s room`;
      let room: Room;
      try {
        room = manager.createRoom(name, sanitizeText(msg.password, 64));
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
      const room = manager.getRoom(String(msg.roomCode ?? ""));
      if (!room) return err(ws, "no_room", "Room not found");
      if (!manager.checkPassword(room, msg.password)) return err(ws, "bad_password", "Wrong password");
      if (room.runtime) return err(ws, "in_progress", "Game already started");
      bindNewPlayer(conn, manager, room, nickname);
      return;
    }

    case "rejoin": {
      const room = manager.getRoom(String(msg.roomCode ?? ""));
      if (!room) return err(ws, "no_room", "Room not found");

      // A watcher reconnecting: restore their spectator seat, re-send the safe view.
      const spectator = room.spectators.get(msg.playerId);
      if (spectator) {
        if (spectator.secret !== msg.secret) return err(ws, "bad_secret", "No seat to rejoin");
        manager.cancelPrune(room);
        spectator.ws = ws;
        spectator.connected = true;
        conn.roomCode = room.code;
        conn.playerId = spectator.id;
        conn.isSpectator = true;
        send(ws, {
          type: "joined",
          playerId: spectator.id,
          roomCode: room.code,
          ...manager.roomInfo(room),
          players: manager.publicPlayers(room),
          hostId: room.hostId ?? "",
          role: "spectator",
          spectators: manager.publicSpectators(room),
          joinable: manager.joinable(room),
          secret: spectator.secret,
        });
        if (room.runtime || room.lastGame) {
          manager.sendSpectate(room, room.runtime ? "gameStarted" : "gameOver", { only: spectator.id });
        }
        sendRoomState(manager, room);
        return;
      }

      const player = room.players.get(msg.playerId);
      if (!player) return err(ws, "no_seat", "No seat to rejoin");
      // The public playerId is known to everyone in the room; the private secret
      // is not. Require it so a playerId alone cannot hijack someone's seat.
      if (player.secret !== msg.secret) return err(ws, "bad_secret", "No seat to rejoin");
      manager.cancelPrune(room); // recovered before deletion — keep it alive
      player.ws = ws;
      player.connected = true;
      conn.isSpectator = false;
      manager.updateGamePlayers(room);
      if (!room.hostId) room.hostId = player.id;
      conn.roomCode = room.code;
      conn.playerId = player.id;

      send(ws, {
        type: "joined",
        playerId: player.id,
        roomCode: room.code,
        ...manager.roomInfo(room),
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
      const sender = conn.isSpectator
        ? room.spectators.get(conn.playerId!)
        : room.players.get(conn.playerId!);
      const text = String(msg.text ?? "").slice(0, 500).trim();
      if (!sender || !text) return;
      manager.broadcast(room, {
        type: "chat",
        from: conn.isSpectator ? `👀 ${sender.nickname}` : sender.nickname,
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
      if (conn.isSpectator) return err(ws, "spectating", "Spectators cannot make moves");
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
        if (conn.isSpectator) {
          const spec = room.spectators.get(conn.playerId);
          const nickname = spec?.nickname ?? "A watcher";
          // A committed watcher who never got dealt in: drop them from the game's queue.
          if (spec?.wantsPlay && room.runtime?.game.playerLeft) {
            room.runtime.state = room.runtime.game.playerLeft(room.runtime.state, conn.playerId);
            manager.sendGame(room, "gameState");
          }
          manager.removeSpectator(room, conn.playerId);
          if (manager.getRoom(room.code)) {
            manager.broadcast(room, {
              type: "chat",
              from: "👀",
              text: `${nickname} stopped watching`,
              ts: Date.now(),
            });
            sendRoomState(manager, room);
          }
        } else {
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
      }
      conn.roomCode = null;
      conn.playerId = null;
      conn.isSpectator = false;
      return;
    }

    case "spectate": {
      const nickname = sanitizeNick(msg.nickname);
      if (!nickname) return err(ws, "bad_nick", "Nickname required");
      const room = manager.getRoom(String(msg.roomCode ?? ""));
      if (!room) return err(ws, "no_room", "Room not found");
      if (!manager.checkPassword(room, msg.password)) return err(ws, "bad_password", "Wrong password");
      if (!room.runtime) return err(ws, "not_in_progress", "Nothing to watch — join as a player");

      const spectator: Player = { id: randomUUID(), nickname, secret: randomUUID(), ws, connected: true };
      manager.unwatchRooms(ws);
      manager.addSpectator(room, spectator);
      conn.roomCode = room.code;
      conn.playerId = spectator.id;
      conn.isSpectator = true;

      send(ws, {
        type: "joined",
        playerId: spectator.id,
        roomCode: room.code,
        ...manager.roomInfo(room),
        players: manager.publicPlayers(room),
        hostId: room.hostId ?? "",
        role: "spectator",
        spectators: manager.publicSpectators(room),
        joinable: manager.joinable(room),
        secret: spectator.secret,
      });
      // Hand this watcher the current safe snapshot.
      manager.sendSpectate(room, room.runtime ? "gameStarted" : "gameOver", { only: spectator.id });
      sendRoomState(manager, room);
      return;
    }

    case "joinNextRound": {
      const room = requireRoom(conn, manager);
      if (!room) return;
      if (!conn.isSpectator) return err(ws, "not_spectating", "Only watchers can join");
      const spectator = room.spectators.get(conn.playerId!);
      if (!spectator) return err(ws, "no_seat", "No watcher seat");

      // In the lobby (no game running) a watcher simply takes a seat.
      if (!room.runtime) {
        manager.migrateToPlayer(room, spectator.id);
        conn.isSpectator = false;
        const nickname = spectator.nickname;
        manager.broadcast(room, {
          type: "chat", from: "👋", text: `${nickname} joined as a player`, ts: Date.now(),
        });
        sendRoomState(manager, room);
        return;
      }

      // Mid-game: only if the game supports it. Queue them for the next round.
      if (!manager.joinable(room)) return err(ws, "not_joinable", "This game can't be joined mid-game");
      if (spectator.wantsPlay) return; // already committed
      spectator.wantsPlay = true;
      room.runtime.state = room.runtime.game.addPlayer!(room.runtime.state, spectator.id);
      sendRoomState(manager, room);
      return;
    }

    case "endGame": {
      const room = requireRoom(conn, manager);
      if (!room) return;
      if (conn.isSpectator || room.hostId !== conn.playerId)
        return err(ws, "not_host", "Only the host can end the game");
      if (!room.runtime && !room.lastGame) return err(ws, "no_game", "No game to end");

      clearTimeout(room.runtime?.timer);
      room.runtime = null;
      room.lastGame = undefined;
      // Watchers stay watchers in the lobby; a queued "join next round" is moot.
      for (const s of room.spectators.values()) delete s.wantsPlay;

      const by = room.players.get(conn.playerId!)?.nickname ?? "The host";
      manager.broadcast(room, { type: "gameEnded", by });
      manager.broadcast(room, { type: "chat", from: "🛑", text: `${by} ended the game`, ts: Date.now() });
      sendRoomState(manager, room);
      return;
    }

    case "watchRooms": {
      if (conn.roomCode) return; // already in a room — the list is for the landing page
      manager.watchRooms(ws);
      return;
    }

    case "unwatchRooms": {
      manager.unwatchRooms(ws);
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
): void {
  const player: Player = {
    id: randomUUID(),
    nickname,
    secret: randomUUID(),
    ws: conn.ws,
    connected: true,
  };
  manager.unwatchRooms(conn.ws);
  manager.addPlayer(room, player);
  conn.roomCode = room.code;
  conn.playerId = player.id;

  send(conn.ws, {
    type: "joined",
    playerId: player.id,
    roomCode: room.code,
    ...manager.roomInfo(room),
    players: manager.publicPlayers(room),
    hostId: room.hostId ?? "",
    secret: player.secret,
  });
  sendRoomState(manager, room);
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
  const seat = conn.isSpectator
    ? room.spectators.get(conn.playerId)
    : room.players.get(conn.playerId);
  if (seat?.ws !== conn.ws) {
    err(conn.ws, "no_seat", "This connection no longer owns a seat");
    return null;
  }
  return room;
}

function sanitizeNick(raw: unknown): string | null {
  return sanitizeText(raw, 24);
}

/** Trimmed, length-capped text, or null when missing/empty. */
function sanitizeText(raw: unknown, max: number): string | null {
  if (raw === undefined || raw === null) return null;
  // Reject absurd input before coercion, then strip control characters (incl.
  // newlines) so the value stays a single clean line.
  if (typeof raw !== "string" || raw.length > 1000) return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
  return s.length > 0 ? s : null;
}
