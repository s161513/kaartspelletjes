import type { WebSocket } from "ws";
import type {
  Game,
  GameId,
  GameState,
  PlayerPublic,
  ServerMessage,
} from "@app/shared";

export interface Player {
  id: string;
  nickname: string;
  /** Private seat token (never sent to other players); checked on rejoin. */
  secret: string;
  ws: WebSocket | null; // null while disconnected (seat kept for rejoin)
  connected: boolean;
}

export interface GameRuntime {
  gameId: GameId;
  game: Game;
  state: GameState;
  timer?: ReturnType<typeof setTimeout>;
}

export interface Room {
  code: string;
  players: Map<string, Player>;
  hostId: string | null;
  runtime: GameRuntime | null;
  /** Finished state retained for reconnect, cleared on the next start. */
  lastGame?: GameRuntime;
  /** Pending deletion timer while the room sits empty (see GRACE_MS). */
  pruneTimer: ReturnType<typeof setTimeout> | null;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no easily-confused chars
const CODE_LEN = 4;
// How long an empty room survives before deletion. This window lets a player
// navigate between pages (landing -> lobby -> game) — which drops and reopens
// the socket — without the room being pruned out from under their rejoin. Kept
// generous so a slow reload or brief network blip still recovers the seat.
const GRACE_MS = 120_000;
// Hard cap on simultaneous rooms so a flood of `create` can't exhaust memory.
// 4-char codes from a 32-char alphabet give ~1M possibilities, so this is tiny
// by comparison and purely a safety valve.
const MAX_ROOMS = 5_000;

/** Thrown by createRoom when the server is at capacity. */
export class ServerFullError extends Error {}

export class RoomManager {
  private rooms = new Map<string, Room>();

  private generateCode(): string {
    let code: string;
    do {
      code = Array.from(
        { length: CODE_LEN },
        () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
      ).join("");
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(): Room {
    if (this.rooms.size >= MAX_ROOMS) throw new ServerFullError("server full");
    const code = this.generateCode();
    const room: Room = {
      code,
      players: new Map(),
      hostId: null,
      runtime: null,
      pruneTimer: null,
    };
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  addPlayer(room: Room, player: Player): void {
    this.cancelPrune(room);
    room.players.set(player.id, player);
    if (!room.hostId) room.hostId = player.id;
  }

  /** Cancel a pending deletion — call whenever someone (re)joins a room. */
  cancelPrune(room: Room): void {
    if (room.pruneTimer) {
      clearTimeout(room.pruneTimer);
      room.pruneTimer = null;
    }
  }

  /** Mark a player disconnected; keep the seat for a possible rejoin. */
  disconnect(room: Room, playerId: string): void {
    const p = room.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.ws = null;
    this.updateGamePlayers(room);

    // Reassign host to another connected player if the host dropped.
    if (room.hostId === playerId) {
      const next = [...room.players.values()].find((x) => x.connected);
      room.hostId = next ? next.id : room.hostId;
    }

    this.pruneIfEmpty(room);
  }

  /** Fully remove a player (explicit leave). */
  removePlayer(room: Room, playerId: string): void {
    room.players.delete(playerId);
    this.updateGamePlayers(room);
    if (room.hostId === playerId) {
      const next = [...room.players.values()].find((x) => x.connected);
      room.hostId = next ? next.id : null;
    }
    this.pruneIfEmpty(room);
  }

  private pruneIfEmpty(room: Room): void {
    const anyConnected = [...room.players.values()].some((x) => x.connected);
    if (anyConnected) return;
    // Delay deletion so navigation/reconnect (a brief socket drop) can recover
    // the room via `rejoin` before it disappears.
    if (room.pruneTimer) return;
    room.pruneTimer = setTimeout(() => {
      const stillEmpty = ![...room.players.values()].some((x) => x.connected);
      if (stillEmpty) {
        clearTimeout(room.runtime?.timer);
        this.rooms.delete(room.code);
      }
    }, GRACE_MS);
  }

  publicPlayers(room: Room): PlayerPublic[] {
    return [...room.players.values()].map((p) => ({
      id: p.id,
      nickname: p.nickname,
      connected: p.connected,
    }));
  }

  currentGameId(room: Room): GameId | null {
    return room.runtime ? room.runtime.gameId : null;
  }

  /** One projection path for initial state, updates, results and reconnects. */
  gameView(room: Room, playerId: string): GameState {
    const runtime = (room.runtime ?? room.lastGame)!;
    return runtime.game.playerView
      ? runtime.game.playerView(runtime.state, playerId)
      : runtime.state;
  }

  /**
   * Send a game message to every connected player (or only `opts.only`), each
   * with their own view of the state. `opts.winner` overrides the game result
   * for a game that ends because a player left.
   */
  sendGame(
    room: Room,
    type: "gameStarted" | "gameState" | "gameOver",
    opts: { only?: string; winner?: string } = {},
  ): void {
    const runtime = room.runtime ?? room.lastGame;
    if (!runtime) return;
    for (const player of room.players.values()) {
      if (opts.only && player.id !== opts.only) continue;
      if (!player.connected || player.ws?.readyState !== 1) continue;
      const state = this.gameView(room, player.id);
      const msg: ServerMessage = type === "gameStarted"
        ? { type, gameId: runtime.gameId, state }
        : type === "gameOver"
          ? { type, gameId: runtime.gameId, winner: opts.winner ?? runtime.game.result(runtime.state).winner ?? "draw", state }
          : { type, state };
      player.ws.send(JSON.stringify(msg));
    }
  }

  updateGamePlayers(room: Room): void {
    const runtime = room.runtime;
    if (!runtime?.game.playersChanged) return;
    runtime.state = runtime.game.playersChanged(runtime.state,
      [...room.players.values()].filter(p => p.connected).map(p => p.id), [...room.players.keys()]);
    this.sendGame(room, "gameState");
    this.scheduleGame(room);
  }

  /** Games without timed transitions retain the original request/response flow. */
  scheduleGame(room: Room): void {
    const runtime = room.runtime;
    if (!runtime) return;
    clearTimeout(runtime.timer);
    runtime.timer = undefined;
    const delay = runtime.game.nextUpdateIn?.(runtime.state);
    if (delay === null || delay === undefined || !runtime.game.advance) return;
    runtime.timer = setTimeout(() => {
      if (room.runtime !== runtime) return;
      runtime.timer = undefined;
      runtime.state = runtime.game.advance!(runtime.state);
      if (runtime.game.result(runtime.state).over) {
        this.sendGame(room, "gameOver");
        room.lastGame = runtime;
        room.runtime = null;
        this.broadcast(room, {
          type: "roomState", players: this.publicPlayers(room),
          hostId: room.hostId ?? "", currentGameId: this.currentGameId(room),
        });
      } else {
        this.sendGame(room, "gameState");
        this.scheduleGame(room);
      }
    }, Math.max(0, delay));
  }

  /** Test/server shutdown cleanup, with no change to normal room semantics. */
  dispose(): void {
    for (const room of this.rooms.values()) {
      clearTimeout(room.pruneTimer ?? undefined);
      clearTimeout(room.runtime?.timer);
    }
  }

  broadcast(room: Room, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const p of room.players.values()) {
      if (p.connected && p.ws && p.ws.readyState === 1 /* OPEN */) {
        p.ws.send(data);
      }
    }
  }
}
