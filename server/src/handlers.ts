import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@app/shared";
import { RoomManager, type Player, type Room } from "./rooms.js";
import { games } from "./games/loader.js";

/** Per-connection state: which room/player this socket is bound to. */
interface Conn {
  ws: WebSocket;
  roomCode: string | null;
  playerId: string | null;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function err(ws: WebSocket, code: string, message: string): void {
  send(ws, { type: "error", code, message });
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
  const conn: Conn = { ws, roomCode: null, playerId: null };

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
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
    if (!room || room.players.get(conn.playerId)?.ws !== ws) return;
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
      const room = manager.createRoom();
      bindNewPlayer(conn, manager, room, nickname);
      return;
    }

    case "join": {
      const nickname = sanitizeNick(msg.nickname);
      if (!nickname) return err(ws, "bad_nick", "Nickname required");
      const room = manager.getRoom(msg.roomCode);
      if (!room) return err(ws, "no_room", "Room not found");
      if (room.runtime) return err(ws, "in_progress", "Game already started");
      bindNewPlayer(conn, manager, room, nickname);
      return;
    }

    case "rejoin": {
      const room = manager.getRoom(msg.roomCode);
      if (!room) return err(ws, "no_room", "Room not found");
      const player = room.players.get(msg.playerId);
      if (!player) return err(ws, "no_seat", "No seat to rejoin");
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
      });
      sendRoomState(manager, room);
      // Re-sync any game in progress for the returning player.
      if (room.runtime) {
        manager.sendGame(room, "gameStarted", player.id);
      }
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
        return err(ws, "bad_move", validated.error);
      }

      const next = game.applyMove(state, conn.playerId!, validated.move);
      room.runtime.state = next;

      const outcome = game.result(next);
      if (outcome.over) {
        clearTimeout(room.runtime.timer);
        manager.sendGame(room, "gameOver");
        room.runtime = null;
        sendRoomState(manager, room);
      } else {
        manager.sendGame(room, "gameState");
        manager.scheduleGame(room);
      }
      return;
    }

    case "leave": {
      const room = manager.getRoom(conn.roomCode ?? "");
      if (room && conn.playerId) {
        manager.removePlayer(room, conn.playerId);
        if (manager.getRoom(room.code)) sendRoomState(manager, room);
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
): void {
  const player: Player = {
    id: randomUUID(),
    nickname,
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
  if (room.players.get(conn.playerId)?.ws !== conn.ws) {
    err(conn.ws, "no_seat", "This connection no longer owns a seat");
    return null;
  }
  return room;
}

function sanitizeNick(raw: unknown): string | null {
  const s = String(raw ?? "").trim().slice(0, 24);
  return s.length > 0 ? s : null;
}
