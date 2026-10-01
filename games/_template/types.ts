import type { Card } from "@app/shared";

// The state is sent to every client on each update, so keep it JSON-serializable
// (no Maps, Sets or class instances).
export interface TemplateState {
  /** Shuffled draw pile (top = last element). */
  pile: Card[];
  /** playerId -> the card they drew (missing = not drawn yet). */
  drawn: Record<string, Card>;
  /** Seat order. */
  players: string[];
  /** playerId whose turn it is, or null when the game is over. */
  turn: string | null;
}

/** What the client sends on a move. This game has only one action. */
export interface TemplateMove {
  action: "draw";
}
