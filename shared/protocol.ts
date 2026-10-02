// Shared WebSocket protocol between client and server.
// All messages are a single JSON object discriminated by `type`.

// Re-export the card library so consumers can `import { deal, type Card } from "@app/shared"`.
export * from "./cards.js";

// Re-export the game contract (Game, GamePage, ...) implemented in games/<id>/.
export * from "./game.js";

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
}

/** Game state as sent over the wire; each game defines its own type in games/<id>/types.ts. */
export type GameState = unknown;

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export interface CreateMsg {
  type: "create";
  nickname: string;
}

export interface JoinMsg {
  type: "join";
  nickname: string;
  roomCode: string;
}

export interface RejoinMsg {
  type: "rejoin";
  playerId: string;
  roomCode: string;
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
  | JoinNextRoundMsg;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface JoinedMsg {
  type: "joined";
  playerId: string;
  roomCode: string;
  players: PlayerPublic[];
  hostId: string;
  /** "spectator" when this client joined to watch; omitted/"player" otherwise. */
  role?: "player" | "spectator";
  spectators?: SpectatorPublic[];
  /** Whether the running game supports joining mid-game (the join switch). */
  joinable?: boolean;
}

export interface RoomStateMsg {
  type: "roomState";
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
  | ErrorMsg;
