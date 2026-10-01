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

export type ClientMessage =
  | CreateMsg
  | JoinMsg
  | RejoinMsg
  | ChatSendMsg
  | StartGameMsg
  | MoveMsg
  | LeaveMsg;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface JoinedMsg {
  type: "joined";
  playerId: string;
  roomCode: string;
  players: PlayerPublic[];
  hostId: string;
}

export interface RoomStateMsg {
  type: "roomState";
  players: PlayerPublic[];
  hostId: string;
  currentGameId: GameId | null;
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
