// The contract every game implements. A game lives in its own folder
// (games/<id>/) and provides a logic module (server) and a view (client).
import type { PlayerPublic } from "./protocol.js";

/** Result of validating a raw client move: the typed move, or a reason. */
export type MoveResult<Move> =
  | { ok: true; move: Move }
  | { ok: false; error: string };

/**
 * The id used to project a spectator-safe view through an existing `playerView`.
 * It is namespaced so it can never collide with a real player id (those are
 * `randomUUID()`s), so `playerView(state, SPECTATOR_VIEW_ID)` reveals no private
 * hand — a spectator is "a player who owns nothing". See `Game.spectatorView`.
 */
export const SPECTATOR_VIEW_ID = "spectator:00000000-0000-0000-0000-000000000000";

/**
 * Game rules, run authoritatively on the server (games/<id>/logic.ts).
 *
 * `State` is internal; private games provide playerView for wire payloads.
 * `Move` is the validated move type the game acts on.
 */
export interface Game<State = unknown, Move = unknown> {
  /** Build the initial state for the given seated players. */
  init(playerIds: string[]): State;

  /** Validate a raw client move before it is applied. */
  validateMove(state: State, playerId: string, move: unknown): MoveResult<Move>;

  /**
   * Optional: move `type`s only the room host may send (e.g. a room-wide
   * setting). The server rejects them from anyone else before `validateMove`.
   */
  hostOnlyMoves?: readonly string[];

  /** Apply a validated move, returning the next state. */
  applyMove(state: State, playerId: string, move: Move): State;

  /**
   * Optional: a move was *rejected* by validateMove. Lets a game persist private
   * penalty bookkeeping (e.g. a brief per-player cooldown after a wrong guess)
   * without validateMove mutating its input. Return the new state; it is stored
   * but not broadcast (the player still receives the validation error). Keep it
   * side-effect-only on private fields — it must never change public/game state.
   */
  onInvalidMove?(state: State, playerId: string, move: unknown): State;

  /** Whether the game is over and, if so, who won. */
  result(state: State): { over: boolean; winner?: string | "draw" };

  /**
   * Optional: what `playerId` is allowed to see (e.g. hide other players'
   * cards and the deck). Without it every player receives the full state.
   */
  playerView?(state: State, playerId: string): unknown;

  /**
   * Optional: the state shown to spectators (who hold no seat and no cards).
   * Without it, the server falls back to `playerView(state, SPECTATOR_VIEW_ID)`
   * for games that hide info, or the full state for games that don't.
   */
  spectatorView?(state: State): unknown;

  /**
   * Optional: accept a new player mid-game (e.g. queue them to be dealt in at
   * the next round). Return the new state. A game supports mid-game join only if
   * it implements BOTH `addPlayer` and `seatedPlayers`; the server watches
   * `seatedPlayers` to learn when a queued joiner has actually been seated.
   */
  addPlayer?(state: State, playerId: string): State;

  /** Optional: ids the game currently treats as seated players. */
  seatedPlayers?(state: State): string[];

  /**
   * Optional: a player left the room mid-game (e.g. fold their hand and drop
   * them). Return the new state; `result` is checked afterwards. Without it the
   * game ends, and if only one player remains they win.
   */
  playerLeft?(state: State, playerId: string): State;

  /**
   * Optional: server-driven transitions (e.g. deal the next round after a
   * pause). `nextUpdateIn` returns a delay in ms, or null for no timer; when it
   * fires the server calls `advance` and sends the new state to everyone.
   */
  nextUpdateIn?(state: State): number | null;
  advance?(state: State): State;

  /**
   * Optional: room members connected, disconnected or left. `connectedIds` are
   * online now, `memberIds` are still in the room (e.g. pause while fewer than
   * two players are online). Called alongside `playerLeft` when someone leaves.
   */
  playersChanged?(state: State, connectedIds: string[], memberIds: string[]): State;
}

/**
 * What a game view receives to render itself. The host page owns the socket,
 * chat, status line and navigation; the game only draws its board and sends moves.
 */
export interface GameContext {
  /** Element the game renders its board into. */
  container: HTMLElement;
  /** This client's player id. */
  playerId: string;
  /** Nickname of a player in the room (falls back to "Player"). */
  nickname(playerId: string): string;
  /** Current host of the room, when known. `onRoomState` fires when it changes. */
  readonly hostId?: string;
  /** Players in the room (with online status), supplied by the host page. */
  players?: readonly PlayerPublic[];
  /** Whether this client is watching, not seated. `sendMove` is a no-op then. */
  readonly isSpectator?: boolean;
  /** Spectators watching the room (with online status), supplied by the host page. */
  readonly spectators?: readonly PlayerPublic[];
  /** Whether the socket is currently open. */
  connected?: boolean;
  /** Send a move payload (validated server-side). */
  sendMove(move: unknown): void;
  /** Set the status line text (turn indicator, etc.). */
  setStatus(text: string): void;
}

/** Game renderer, run in the browser (games/<id>/view.ts). */
export interface GamePage<State = unknown> {
  /** Build the board DOM once. Called before the first `update`. */
  mount(ctx: GameContext): void;
  /** Render a fresh state. */
  update(state: State, ctx: GameContext): void;
  /** Optional hook when the game ends (e.g. freeze the board). */
  onGameOver?(winner: string | "draw", state: State, ctx: GameContext): void;
  onRoomState?(ctx: GameContext): void;
  onError?(message: string, ctx: GameContext): void;
}
