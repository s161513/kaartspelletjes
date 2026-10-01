import type { ServerMessage } from "@app/shared";
import { RoomManager, type Room, type GameRuntime } from "./rooms.js";

const timers = new WeakMap<Room, ReturnType<typeof setTimeout>>();

export function gameView(runtime: GameRuntime, playerId: string): unknown {
  return runtime.game.getViewForPlayer
    ? runtime.game.getViewForPlayer(runtime.state, playerId)
    : runtime.state;
}

export function sendRoomState(manager: RoomManager, room: Room): void {
  manager.broadcast(room, {
    type: "roomState", players: manager.publicPlayers(room),
    hostId: room.hostId ?? "", currentGameId: manager.currentGameId(room),
  });
}

/** All start/update/end payloads use the same per-recipient projection. */
export function publishGame(manager: RoomManager, room: Room, started = false): void {
  const runtime = room.runtime;
  if (!runtime) return;
  const outcome = runtime.game.result(runtime.state);
  manager.broadcast(room, playerId => {
    const state = gameView(runtime, playerId);
    if (outcome.over) return { type: "gameOver", gameId: runtime.gameId, winner: outcome.winner ?? "draw", state };
    return started
      ? { type: "gameStarted", gameId: runtime.gameId, state }
      : { type: "gameState", state };
  });
  cancelTimer(room);
  if (outcome.over) {
    room.lastGame = runtime;
    room.runtime = null;
    sendRoomState(manager, room);
    return;
  }
  schedule(manager, room);
}

function cancelTimer(room: Room): void {
  const timer = timers.get(room);
  if (timer) clearTimeout(timer);
  timers.delete(room);
}

function schedule(manager: RoomManager, room: Room): void {
  const runtime = room.runtime;
  if (!runtime?.game.tick) return;
  const deadline = runtime.game.nextDeadline?.(runtime.state);
  if (deadline === undefined || deadline === null) return;
  const timer = setTimeout(() => {
    if (manager.getRoom(room.code) !== room || room.runtime !== runtime) return;
    const before = runtime.state;
    advanceGame(manager, room);
    // Re-arm early timers without emitting duplicate states.
    if (room.runtime === runtime && runtime.state === before) schedule(manager, room);
  }, Math.max(1, deadline - Date.now()));
  timer.unref();
  timers.set(room, timer);
}

export function advanceGame(manager: RoomManager, room: Room, now = Date.now()): void {
  const runtime = room.runtime;
  if (!runtime?.game.tick) return;
  const next = runtime.game.tick(runtime.state, now);
  if (next === runtime.state) return;
  runtime.state = next;
  publishGame(manager, room);
}

export function syncGame(manager: RoomManager, room: Room, playerId: string): ServerMessage | null {
  advanceGame(manager, room);
  const runtime = room.runtime ?? room.lastGame;
  if (!runtime) return null;
  const state = gameView(runtime, playerId);
  const outcome = runtime.game.result(runtime.state);
  return outcome.over
    ? { type: "gameOver", gameId: runtime.gameId, winner: outcome.winner ?? "draw", state }
    : { type: "gameStarted", gameId: runtime.gameId, state };
}
