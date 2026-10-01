import type { GameId, GameState } from "@app/shared";

/** Result of validating a raw client move: the typed move, or a reason. */
export type MoveResult<Move> =
  | { ok: true; move: Move }
  | { ok: false; error: string };

/**
 * A game plugs into the room framework by implementing this interface — the
 * *logic* only. Display name and player-count constraints live in the shared
 * `GAMES` catalog (`@app/shared`). Adding a new game = one new file here + an
 * entry in the `games` registry below + a `GAMES` catalog entry.
 *
 * `State` is the serializable state broadcast to clients.
 * `Move` is the validated move type the game acts on.
 */
export interface Game<State extends GameState = GameState, Move = unknown> {
  id: GameId;

  /** Build the initial state for the given seated players. */
  init(playerIds: string[]): State;

  /** Validate a raw client move before it is applied. */
  validateMove(
    state: State,
    playerId: string,
    move: unknown,
  ): MoveResult<Move>;

  /** Apply a validated move, returning the next state. */
  applyMove(state: State, playerId: string, move: Move): State;

  /** Whether the game is over and, if so, who won. */
  result(state: State): { over: boolean; winner?: string | "draw" };
}

import { ticTacToe } from "./tictactoe.js";

/** Registry of all playable games, keyed by id. */
export const games: Record<GameId, Game> = {
  tictactoe: ticTacToe as Game,
};
