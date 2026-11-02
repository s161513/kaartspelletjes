import { randomInt, timingSafeEqual } from "node:crypto";
import type { WebSocket } from "ws";
import {
  SPECTATOR_VIEW_ID,
  type BotDifficulty,
  type Game,
  type GameId,
  type GameState,
  type PlayerPublic,
  type RoomSummary,
  type ServerMessage,
  type SpectatorPublic,
} from "@app/shared";

export interface Player {
  id: string;
  nickname: string;
  /** Private seat token (never sent to other players); checked on rejoin. */
  secret: string;
  ws: WebSocket | null; // null while disconnected (seat kept for rejoin) or for bots
  connected: boolean;
  /** Bot seat: no socket, never host, driven by the game's `botMove`. */
  isBot?: boolean;
  /** Bot seat: difficulty passed to the game's `botMove`. */
  botDifficulty?: BotDifficulty;
  /** Spectator only: they flipped "join next round" and are queued to be dealt in. */
  wantsPlay?: boolean;
  /** Pending removal while disconnected (see RoomManager.goneAfterMs). */
  goneTimer?: ReturnType<typeof setTimeout>;
}

export interface GameRuntime {
  gameId: GameId;
  game: Game;
  /** Everyone dealt into this game (start + mid-game joiners); absent = all players. */
  playerIds?: string[];
  state: GameState;
  timer?: ReturnType<typeof setTimeout>;
  /** Pending bot move (bots "think" for a moment before playing). */
  botTimer?: ReturnType<typeof setTimeout>;
}

/** How long a bot waits before its move is applied, plus random jitter. */
export const BOT_MOVE_DELAY_MS = 600;
const BOT_MOVE_JITTER_MS = 600;

export interface Room {
  code: string;
  /** Shown in the room list. */
  name: string;
  /** Required to join or watch; null for an open room. Never sent to clients. */
  password: string | null;
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
// the socket — without the room being pruned out from under their rejoin. Kept
// generous so a slow reload or brief network blip still recovers the seat.
// Individual seats have their own, shorter timeout (RoomManager.goneAfterMs),
// which waits while nobody in the room is connected so this one decides.
const GRACE_MS = 120_000;
// Hard cap on simultaneous rooms so a flood of `create` can't exhaust memory.
const MAX_ROOMS = 5_000;

/** Thrown by createRoom when the server is at capacity. */
export class ServerFullError extends Error {}

export class RoomManager {
  /**
   * How long a disconnected player or watcher keeps their seat before they are
   * removed as if they had left (off the table and out of the lobby). Long
   * enough for page navigation, a reload or a phone screen lock.
   */
  goneAfterMs = 60_000;
  private rooms = new Map<string, Room>();
  /** Sockets on the landing page that want the live room list. */
  private roomWatchers = new Set<WebSocket>();
  private listQueued = false;

  private generateCode(): string {
    let code: string;
    do {
      // Crypto RNG: Math.random() is predictable (xorshift128+).
      code = Array.from({ length: CODE_LEN }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(name = "Room", password: string | null = null): Room {
    if (this.rooms.size >= MAX_ROOMS) throw new ServerFullError("server full");
    const code = this.generateCode();
    const room: Room = {
      code,
      name,
      password,
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

  /** Does `attempt` open this room? Open rooms accept anything. */
  checkPassword(room: Room, attempt: unknown): boolean {
    if (room.password === null) return true;
    // Timing-safe compare; the length check itself only leaks the length.
    const given = Buffer.from(String(attempt ?? "").trim(), "utf8");
    const want = Buffer.from(room.password, "utf8");
    return given.length === want.length && timingSafeEqual(given, want);
  }

  /** Name + lock flag, spread into every joined/roomState message. */
  roomInfo(room: Room): { roomName: string; locked: boolean } {
    return { roomName: room.name, locked: room.password !== null };
  }

  /** Rooms worth listing: someone is actually connected (not just in the grace window). */
  roomList(): RoomSummary[] {
    const list: RoomSummary[] = [];
    for (const room of this.rooms.values()) {
      const players = [...room.players.values()].filter((p) => p.connected).length;
      if (players === 0) continue;
      list.push({
        code: room.code,
        name: room.name,
        hostName: (room.hostId && room.players.get(room.hostId)?.nickname) || null,
        players,
        spectators: [...room.spectators.values()].filter((s) => s.connected).length,
        locked: room.password !== null,
        gameId: this.currentGameId(room),
      });
    }
    // Waiting rooms first (you can join those), then by name.
    return list.sort((a, b) => Number(a.gameId !== null) - Number(b.gameId !== null) || a.name.localeCompare(b.name));
  }

  watchRooms(ws: WebSocket): void {
    this.roomWatchers.add(ws);
    this.sendRoomList(ws);
  }

  unwatchRooms(ws: WebSocket): void {
    this.roomWatchers.delete(ws);
  }

  private sendRoomList(ws: WebSocket): void {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: "roomList", rooms: this.roomList() } satisfies ServerMessage));
  }

  /** Push the list to every watcher; coalesced so one change sends one update. */
  notifyRoomWatchers(): void {
    if (this.listQueued || this.roomWatchers.size === 0) return;
    this.listQueued = true;
    queueMicrotask(() => {
      this.listQueued = false;
      for (const ws of this.roomWatchers) {
        if (ws.readyState > 1) this.roomWatchers.delete(ws); // closing/closed
        else this.sendRoomList(ws);
      }
    });
  }

  addPlayer(room: Room, player: Player): void {
    this.cancelPrune(room);
    room.players.set(player.id, player);
    // A bot never becomes host.
    if (!room.hostId && !player.isBot) room.hostId = player.id;
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

  /** Find someone's seat, wherever it is now (a watcher may have been dealt in). */
  findSeat(room: Room, id: string): { seat: Player; isSpectator: boolean } | null {
    const player = room.players.get(id);
    if (player) return { seat: player, isSpectator: false };
    const spectator = room.spectators.get(id);
    return spectator ? { seat: spectator, isSpectator: true } : null;
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

    // Reassign host to another connected human player if the host dropped.
    if (room.hostId === playerId) {
      const next = [...room.players.values()].find((x) => x.connected && !x.isBot);
      room.hostId = next ? next.id : room.hostId;
    }

    this.pruneIfEmpty(room);
  }

  /** Fully remove a player (explicit leave). */
  removePlayer(room: Room, playerId: string): void {
    room.players.delete(playerId);
    this.updateGamePlayers(room);
    if (room.hostId === playerId) {
      const next = [...room.players.values()].find((x) => x.connected && !x.isBot);
      room.hostId = next ? next.id : null;
    }
    this.pruneIfEmpty(room);
  }

  /** A room counts as empty when no human is connected (bots alone don't keep it alive). */
  private anyHumanConnected(room: Room): boolean {
    return [...room.players.values()].some((x) => x.connected && !x.isBot);
  }

  private pruneIfEmpty(room: Room): void {
    if (this.anyHumanConnected(room)) return;
    // Delay deletion so navigation/reconnect (a brief socket drop) can recover
    // the room via `rejoin` before it disappears.
    if (room.pruneTimer) return;
    room.pruneTimer = setTimeout(() => {
      const stillEmpty = !this.anyHumanConnected(room);
      if (stillEmpty) {
        clearTimeout(room.runtime?.timer);
        clearTimeout(room.runtime?.botTimer);
        this.rooms.delete(room.code);
        this.notifyRoomWatchers();
      }
    }, GRACE_MS);
  }

  publicPlayers(room: Room): PlayerPublic[] {
    return [...room.players.values()].map((p) => ({
      id: p.id,
      nickname: p.nickname,
      connected: p.connected,
      isBot: !!p.isBot,
      botDifficulty: p.botDifficulty,
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
      runtime.playerIds?.push(player.id);
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
    this.driveBots(room);
  }

  /**
   * Store a new game state and send it out, ending the game if it is over —
   * then let any bot seats act. `depth` caps the bot-move chain.
   */
  publish(room: Room, next: unknown, depth = 0): void {
    const runtime = room.runtime!;
    runtime.state = next;
    if (runtime.game.result(next).over) {
      clearTimeout(runtime.timer);
      clearTimeout(runtime.botTimer);
      this.sendGame(room, "gameOver");
      room.lastGame = runtime;
      room.runtime = null;
      this.sendRoomState(room);
    } else {
      // Seat any committed watcher the new state has dealt in, before projecting.
      const migrated = this.reconcileJoiners(room);
      this.sendGame(room, "gameState");
      this.scheduleGame(room);
      if (migrated.length) this.sendRoomState(room);
    }
    this.driveBots(room, depth);
  }

  /**
   * Let bot seats act: find the first bot with a valid move (`botMove`) and
   * schedule it after a short human-like pause. When it fires, `publish`
   * re-enters `driveBots` for the next bot, until no bot acts or the game ends.
   */
  driveBots(room: Room, depth = 0): void {
    const runtime = room.runtime;
    if (!runtime?.game.botMove || depth > 100) return;
    for (const p of room.players.values()) {
      if (!p.isBot || !p.connected) continue;
      if (runtime.playerIds && !runtime.playerIds.includes(p.id)) continue;
      const raw = runtime.game.botMove(runtime.state, p.id, p.botDifficulty ?? "normal");
      if (raw === null || raw === undefined) continue;
      const checked = runtime.game.validateMove(runtime.state, p.id, raw);
      if (!checked.ok) continue;
      this.scheduleBotMove(room, p.id, checked.move, depth);
      return;
    }
  }

  /** Apply a bot's move after a short delay; re-validate at fire time. */
  private scheduleBotMove(room: Room, playerId: string, move: unknown, depth: number): void {
    const runtime = room.runtime;
    if (!runtime) return;
    clearTimeout(runtime.botTimer);
    const delay = BOT_MOVE_DELAY_MS + randomInt(BOT_MOVE_JITTER_MS);
    runtime.botTimer = setTimeout(() => {
      runtime.botTimer = undefined;
      // The game may have ended or been replaced, or the bot removed, meanwhile.
      if (room.runtime !== runtime) return;
      const seat = room.players.get(playerId);
      if (!seat?.isBot || !seat.connected) return;
      // Timers may have changed the state since scheduling: re-validate.
      const checked = runtime.game.validateMove(runtime.state, playerId, move);
      if (!checked.ok) {
        this.driveBots(room, depth);
        return;
      }
      this.publish(room, runtime.game.applyMove(runtime.state, playerId, checked.move), depth + 1);
    }, delay);
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
      this.driveBots(room);
    }, Math.max(0, delay));
  }

  /** Test/server shutdown cleanup, with no change to normal room semantics. */
  dispose(): void {
    for (const room of this.rooms.values()) {
      for (const p of [...room.players.values(), ...room.spectators.values()]) clearTimeout(p.goneTimer);
      clearTimeout(room.pruneTimer ?? undefined);
      clearTimeout(room.runtime?.timer);
      clearTimeout(room.runtime?.botTimer);
    }
  }

  /** Broadcast the current room snapshot (players + watchers) to everyone. */
  sendRoomState(room: Room): void {
    this.broadcast(room, {
      type: "roomState",
      ...this.roomInfo(room),
      players: this.publicPlayers(room),
      hostId: room.hostId ?? "",
      currentGameId: this.currentGameId(room),
      spectators: this.publicSpectators(room),
      joinable: this.joinable(room),
    });
    this.notifyRoomWatchers();
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
