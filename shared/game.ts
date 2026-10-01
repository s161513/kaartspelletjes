// The contract every game implements. A game lives in its own folder
// (games/<id>/) and provides a logic module (server) and a view (client).

/** Result of validating a raw client move: the typed move, or a reason. */
export type MoveResult<Move> =
  | { ok: true; move: Move }
  | { ok: false; error: string };

/**
 * Game rules, run authoritatively on the server (games/<id>/logic.ts).
 *
 * `State` is the serializable state broadcast to clients.
 * `Move` is the validated move type the game acts on.
 */
export interface Game<State = unknown, Move = unknown> {
  /** Build the initial state for the given seated players. */
  init(playerIds: string[]): State;

  /** Validate a raw client move before it is applied. */
  validateMove(state: State, playerId: string, move: unknown): MoveResult<Move>;

  /** Apply a validated move, returning the next state. */
  applyMove(state: State, playerId: string, move: Move): State;

  /** Whether the game is over and, if so, who won. */
  result(state: State): { over: boolean; winner?: string | "draw" };
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
}
