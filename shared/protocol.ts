// Shared WebSocket protocol between client and server.
// All messages are a single JSON object discriminated by `type`.

// Re-export the card library so consumers can `import { deal, type Card } from "@app/shared"`.
export * from "./cards.js";

// Re-export the game contract (Game, GamePage, ...) implemented in games/<id>/.
export * from "./game.js";

/**
 * WebSocket close code: this seat was taken over by another tab/window. The
 * client must not reconnect (it would take the seat straight back).
 */
export const SEAT_TAKEN_CLOSE = 4001;

/** A game's id — equal to its folder name under games/. */
export type GameId = string;

/** A player as visible to everyone in a room (no socket, no secrets). */
export interface PlayerPublic {
  id: string;
  nickname: string;
  connected: boolean;
}

/** A spectator as visible to everyone — a player who has committed to join next. */
export interface SpectatorPublic extends PlayerPublic {
  /** They flipped "join next round" and are queued to be dealt in. */
  pendingPlayer?: boolean;
}

/**
 * Game metadata — default export of games/<id>/meta.ts. Read by the server
 * (player-count checks) and the client (lobby picker, page title).
 */
export interface GameMeta {
  /** Must equal the game's folder name. */
  id: GameId;
  title: string;
  minPlayers: number;
  maxPlayers: number;
  description?: string;
  /**
   * Optional icon for the lobby and room list: inline SVG markup (use
   * `currentColor`, 48×48 viewBox) or an emoji. Without it the framework shows
   * its built-in icon for this id, or a generic card.
   */
  icon?: string;
}

/** Game state as sent over the wire; each game defines its own type in games/<id>/types.ts. */
export type GameState = unknown;

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export interface CreateMsg {
  type: "create";
  nickname: string;
  /** Shown in the room list; defaults to "<nickname>'s room". */
  roomName?: string;
  /** Optional: joining and watching then require this password. */
  password?: string;
}

export interface JoinMsg {
  type: "join";
  nickname: string;
  roomCode: string;
  password?: string;
}

export interface RejoinMsg {
  type: "rejoin";
  playerId: string;
  roomCode: string;
  /** Private seat token issued in `joined`; proves ownership of the seat. */
  secret?: string;
}

export interface ChatSendMsg {
  type: "chat";
  text: string;
}

export interface StartGameMsg {
  type: "startGame";
  gameId: GameId;
}

export interface MoveMsg {
  type: "move";
  move: unknown; // game-specific payload, validated server-side by the game
}

export interface LeaveMsg {
  type: "leave";
}

/** Watch an already-running room without taking a seat. */
export interface SpectateMsg {
  type: "spectate";
  nickname: string;
  roomCode: string;
  password?: string;
}

/**
 * Subscribe to the open-room list (landing page). The server replies with a
 * `roomList` now and again whenever a room changes, until this socket joins a
 * room or sends `unwatchRooms`.
 */
/** Host only: stop the running (or finished) game and send everyone back to the lobby. */
export interface EndGameMsg {
  type: "endGame";
}

export interface WatchRoomsMsg {
  type: "watchRooms";
}

export interface UnwatchRoomsMsg {
  type: "unwatchRooms";
}

/**
 * A spectator opts to become a player. Mid-game this queues them to be dealt in
 * at the next round; in the lobby (no game running) it seats them immediately.
 */
export interface JoinNextRoundMsg {
  type: "joinNextRound";
}

export type ClientMessage =
  | CreateMsg
  | JoinMsg
  | RejoinMsg
  | ChatSendMsg
  | StartGameMsg
  | MoveMsg
  | LeaveMsg
  | SpectateMsg
  | JoinNextRoundMsg
  | EndGameMsg
  | WatchRoomsMsg
  | UnwatchRoomsMsg;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface JoinedMsg {
  type: "joined";
  playerId: string;
  roomCode: string;
  roomName?: string;
  locked?: boolean;
  players: PlayerPublic[];
  hostId: string;
  /** "spectator" when this client joined to watch; omitted/"player" otherwise. */
  role?: "player" | "spectator";
  spectators?: SpectatorPublic[];
  /** Whether the running game supports joining mid-game (the join switch). */
  joinable?: boolean;
  /**
   * Private seat token, sent only to the owning client. Must be echoed back in
   * `rejoin` to reclaim this seat, so a public `playerId` alone cannot be used
   * to hijack another player's (or watcher's) seat.
   */
  secret: string;
}

export interface RoomStateMsg {
  type: "roomState";
  roomName?: string;
  locked?: boolean;
  players: PlayerPublic[];
  hostId: string;
  currentGameId: GameId | null;
  spectators?: SpectatorPublic[];
  /** Whether the running game supports joining mid-game (the join switch). */
  joinable?: boolean;
}

export interface ChatRecvMsg {
  type: "chat";
  from: string; // nickname
  text: string;
  ts: number;
}

export interface GameStartedMsg {
  type: "gameStarted";
  gameId: GameId;
  state: GameState;
}

export interface GameStateMsg {
  type: "gameState";
  state: GameState;
}

export interface GameOverMsg {
  type: "gameOver";
  /** Optional for older servers; identifies retained finished snapshots on rejoin. */
  gameId?: GameId;
  winner: string | "draw"; // playerId of the winner, or "draw"
  state: GameState;
}

/** One entry of the open-room list — never includes the password. */
export interface RoomSummary {
  code: string;
  name: string;
  hostName: string | null;
  /** Connected seated players. */
  players: number;
  spectators: number;
  /** A password is needed to join or watch. */
  locked: boolean;
  /** The game being played, or null while the room is in its lobby. */
  gameId: GameId | null;
}

export interface RoomListMsg {
  type: "roomList";
  rooms: RoomSummary[];
}

/** The host ended the game; every client returns to the room's lobby. */
export interface GameEndedMsg {
  type: "gameEnded";
  /** Nickname of the host who ended it. */
  by: string;
}

export interface ErrorMsg {
  type: "error";
  code: string;
  message: string;
}

export type ServerMessage =
  | JoinedMsg
  | RoomStateMsg
  | ChatRecvMsg
  | GameStartedMsg
  | GameStateMsg
  | GameOverMsg
  | RoomListMsg
  | GameEndedMsg
  | ErrorMsg;
