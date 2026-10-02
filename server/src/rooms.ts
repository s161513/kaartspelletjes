import type { WebSocket } from "ws";
import {
  SPECTATOR_VIEW_ID,
  type Game,
  type GameId,
  type GameState,
  type PlayerPublic,
  type ServerMessage,
  type SpectatorPublic,
} from "@app/shared";

export interface Player {
  id: string;
  nickname: string;
  ws: WebSocket | null; // null while disconnected (seat kept for rejoin)
  connected: boolean;
  /** Spectator only: they flipped "join next round" and are queued to be dealt in. */
  wantsPlay?: boolean;
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
  /** Watchers with no seat. Never passed to game logic; see spectatorView. */
  spectators: Map<string, Player>;
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
// the socket — without the room being pruned out from under their rejoin.
const GRACE_MS = 30_000;

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
    const code = this.generateCode();
    const room: Room = {
      code,
      players: new Map(),
      spectators: new Map(),
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

  /** Seat a watcher. Never becomes host and is never passed to game logic. */
  addSpectator(room: Room, spectator: Player): void {
    this.cancelPrune(room);
    room.spectators.set(spectator.id, spectator);
  }

  /** Fully remove a watcher (explicit leave). */
  removeSpectator(room: Room, spectatorId: string): void {
    room.spectators.delete(spectatorId);
    this.pruneIfEmpty(room);
  }

  /** Mark a watcher disconnected; keep them for a possible rejoin. */
  disconnectSpectator(room: Room, spectatorId: string): void {
    const s = room.spectators.get(spectatorId);
    if (!s) return;
    s.connected = false;
    s.ws = null;
    this.pruneIfEmpty(room);
  }

  /** Move a watcher into a real seat (e.g. once the game has dealt them in). */
  migrateToPlayer(room: Room, spectatorId: string): Player | null {
    const s = room.spectators.get(spectatorId);
    if (!s) return null;
    room.spectators.delete(spectatorId);
    delete s.wantsPlay;
    this.addPlayer(room, s);
    return s;
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

  publicSpectators(room: Room): SpectatorPublic[] {
    return [...room.spectators.values()].map((s) => ({
      id: s.id,
      nickname: s.nickname,
      connected: s.connected,
      pendingPlayer: !!s.wantsPlay,
    }));
  }

  currentGameId(room: Room): GameId | null {
    return room.runtime ? room.runtime.gameId : null;
  }

  /** Whether the running game supports a spectator joining mid-game. */
  joinable(room: Room): boolean {
    const game = room.runtime?.game;
    return !!(game?.addPlayer && game?.seatedPlayers);
  }

  /** One projection path for initial state, updates, results and reconnects. */
  gameView(room: Room, playerId: string): GameState {
    const runtime = (room.runtime ?? room.lastGame)!;
    return runtime.game.playerView
      ? runtime.game.playerView(runtime.state, playerId)
      : runtime.state;
  }

  /**
   * The spectator-safe projection. A watcher is never handed a real player's
   * view: an explicit `spectatorView` wins; otherwise a game that hides info is
   * projected as "a player who owns nothing" via SPECTATOR_VIEW_ID; a game with
   * no `playerView` has no secrets, so the full state is fine.
   */
  spectatorView(room: Room): GameState {
    const runtime = (room.runtime ?? room.lastGame)!;
    if (runtime.game.spectatorView) return runtime.game.spectatorView(runtime.state);
    if (runtime.game.playerView) return runtime.game.playerView(runtime.state, SPECTATOR_VIEW_ID);
    return runtime.state;
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
    // A targeted send (rejoin resend) is handled by the caller; otherwise every
    // player-facing game message also reaches the watchers (incl. timer-driven).
    if (!opts.only) this.sendSpectate(room, type, opts);
  }

  /** Send a game message to every connected watcher (or only `opts.only`). */
  sendSpectate(
    room: Room,
    type: "gameStarted" | "gameState" | "gameOver",
    opts: { only?: string; winner?: string } = {},
  ): void {
    const runtime = room.runtime ?? room.lastGame;
    if (!runtime || room.spectators.size === 0) return;
    const state = this.spectatorView(room); // same for all watchers — compute once
    const msg: ServerMessage = type === "gameStarted"
      ? { type, gameId: runtime.gameId, state }
      : type === "gameOver"
        ? { type, gameId: runtime.gameId, winner: opts.winner ?? runtime.game.result(runtime.state).winner ?? "draw", state }
        : { type, state };
    const data = JSON.stringify(msg);
    for (const s of room.spectators.values()) {
      if (opts.only && s.id !== opts.only) continue;
      if (!s.connected || s.ws?.readyState !== 1) continue;
      s.ws.send(data);
    }
  }

  /**
   * After a state change, seat any committed watcher the game has now dealt in:
   * a `wantsPlay` spectator whose id appears in `seatedPlayers` is migrated into
   * a real seat and handed their private view. Returns the migrated players so
   * the caller can refresh the room snapshot.
   */
  reconcileJoiners(room: Room): Player[] {
    const runtime = room.runtime;
    if (!runtime?.game.seatedPlayers) return [];
    if (![...room.spectators.values()].some((s) => s.wantsPlay)) return [];
    const seated = new Set(runtime.game.seatedPlayers(runtime.state));
    const migrated: Player[] = [];
    for (const s of [...room.spectators.values()]) {
      if (!s.wantsPlay || !seated.has(s.id)) continue;
      const player = this.migrateToPlayer(room, s.id);
      if (!player) continue;
      migrated.push(player);
      this.sendGame(room, "gameStarted", { only: player.id }); // their private view
      this.broadcast(room, {
        type: "chat",
        from: "👀",
        text: `${player.nickname} joined the game!`,
        ts: Date.now(),
      });
    }
    return migrated;
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
        this.sendRoomState(room);
      } else {
        const migrated = this.reconcileJoiners(room);
        this.sendGame(room, "gameState");
        this.scheduleGame(room);
        if (migrated.length) this.sendRoomState(room);
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

  /** Broadcast the current room snapshot (players + watchers) to everyone. */
  sendRoomState(room: Room): void {
    this.broadcast(room, {
      type: "roomState",
      players: this.publicPlayers(room),
      hostId: room.hostId ?? "",
      currentGameId: this.currentGameId(room),
      spectators: this.publicSpectators(room),
      joinable: this.joinable(room),
    });
  }

  broadcast(room: Room, msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    const recipients = [...room.players.values(), ...room.spectators.values()];
    for (const p of recipients) {
      if (p.connected && p.ws && p.ws.readyState === 1 /* OPEN */) {
        p.ws.send(data);
      }
    }
  }
}
