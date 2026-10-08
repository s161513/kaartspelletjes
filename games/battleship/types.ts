export type Orient = "h" | "v";

/** A placed ship: top-left anchor + orientation. Size comes from its fleet slot. */
export interface Placed {
  row: number;
  col: number;
  orient: Orient;
}

/** One player's own sea (private — never sent whole to the opponent). */
export interface PlayerBoard {
  /** Placed ships indexed by fleet slot; null until placed. */
  ships: (Placed | null)[];
  /** The player has locked in their placement. */
  ready: boolean;
  /** Cells on THIS sea that have been fired upon (by the opponent). */
  shots: boolean[];
}

export interface BattleshipState {
  /** Within a round: lay out fleets, then fire. */
  stage: "placement" | "firing";
  /** Each player's own sea, keyed by playerId. */
  boards: Record<string, PlayerBoard>;
  /** playerId whose turn it is to fire; null during placement/intermission. */
  turn: string | null;
  /** Seat order [p1, p2]. */
  players: string[];
  /** "playing" a round, or "intermission" between rounds. */
  phase: "playing" | "intermission";
  /** Last finished round's winner (playerId) or null while playing. */
  result: string | null;
  /** Cumulative round wins per player. */
  scores: Record<string, number>;
  /** 1-based round counter. */
  round: number;
  /** Who fires first this round (rotates between rounds). */
  starter: string;
}

/** Place/reposition a ship, lock in, fire, or request the next round. */
export type BattleshipMove =
  | { place: { ship: number; row: number; col: number; orient: Orient } }
  | { ready: true }
  | { fire: { row: number; col: number } }
  | { again: true };

// ---- Wire views (what playerView sends to the browser) --------------------

export interface FleetShip {
  name: string;
  size: number;
}

export interface SunkShip {
  name: string;
  size: number;
  cells: number[];
}

/** An opponent's sea as the viewer is allowed to see it: no hidden ships. */
export interface PublicBoard {
  id: string;
  placed: boolean;
  /** Cells the viewer has fired at on this sea. */
  shots: number[];
  /** Of those shots, the ones that hit a ship. */
  hits: number[];
  /** Ships fully sunk — only now are their cells revealed. */
  sunk: SunkShip[];
}

/** The viewer's own sea: full ship layout plus incoming fire. */
export interface SelfBoard {
  id: string;
  placed: boolean;
  ships: Array<(Placed & { size: number; name: string; cells: number[] }) | null>;
  /** Cells the opponent has fired at on your sea. */
  incoming: number[];
  /** Of those, the ones that hit one of your ships. */
  incomingHits: number[];
}

export interface BattleshipView {
  stage: BattleshipState["stage"];
  phase: BattleshipState["phase"];
  result: string | null;
  scores: Record<string, number>;
  round: number;
  turn: string | null;
  players: string[];
  starter: string;
  size: number;
  fleet: FleetShip[];
  viewerId: string;
  /** Null for spectators (they hold no sea). */
  self: SelfBoard | null;
  /** One board for a player (the opponent), both boards for a spectator. */
  opponents: PublicBoard[];
}
