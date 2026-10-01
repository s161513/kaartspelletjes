// Shared WebSocket protocol between client and server.
// All messages are a single JSON object discriminated by `type`.

// Re-export the card library so consumers can `import { deal, type Card } from "@app/shared"`.
export * from "./cards.js";

export type GameId = "tictactoe";

/** A player as visible to everyone in a room (no socket, no secrets). */
export interface PlayerPublic {
  id: string;
  nickname: string;
  connected: boolean;
}

// ---------------------------------------------------------------------------
// Game catalog — single source of truth for display + constraints + routing.
// Both the server (player-count checks) and the client (lobby picker, routing)
// read from here. Adding a game = one entry here + a server logic file + a
// client renderer/page.
// ---------------------------------------------------------------------------

export interface GameMeta {
  id: GameId;
  title: string;
  minPlayers: number;
  maxPlayers: number;
  /** Client page to navigate to when this game starts. */
  page: string;
  description?: string;
}

export const GAMES: Record<GameId, GameMeta> = {
  tictactoe: {
    id: "tictactoe",
    title: "Tic-tac-toe",
    minPlayers: 2,
    maxPlayers: 2,
    page: "/tictactoe.html",
    description: "Classic 3×3. Two players take turns; first to a line wins.",
  },
};

export const GAME_LIST: GameMeta[] = Object.values(GAMES);

// ---------------------------------------------------------------------------
// Game state shapes (sent whole on every update; the client is a pure renderer)
// ---------------------------------------------------------------------------

export type Cell = "X" | "O" | null;

export interface TicTacToeState {
  board: Cell[]; // length 9, index 0..8 (row-major)
  /** playerId whose turn it is, or null when the game is over. */
  turn: string | null;
  /** playerId -> mark */
  marks: Record<string, "X" | "O">;
}

/** Discriminated union of all game states. Extend as games are added. */
export type GameState = TicTacToeState;

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

// ---------------------------------------------------------------------------
// TicTacToe move payload
// ---------------------------------------------------------------------------

export interface TicTacToeMove {
  cell: number; // 0..8
}
