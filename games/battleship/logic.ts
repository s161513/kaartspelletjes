import type { Game } from "@app/shared";
import type {
  BattleshipState,
  BattleshipMove,
  BattleshipView,
  PlayerBoard,
  Placed,
  Orient,
  PublicBoard,
  SelfBoard,
  SunkShip,
} from "./types.js";

// Game rules, run authoritatively on the server. Only playerView() crosses the
// wire, so a player never receives the opponent's hidden ship positions.
//   init()          once, when the host starts the game
//   validateMove()  for every move a client sends
//   applyMove()     only for moves that passed validation
//   result()        after each move, to see whether the game is over
//   playerView()    per player, to hide the opponent's fleet

export const SIZE = 10;

/** Standard fleet: one of each. */
export const FLEET: ReadonlyArray<{ name: string; size: number }> = [
  { name: "Carrier", size: 5 },
  { name: "Battleship", size: 4 },
  { name: "Cruiser", size: 3 },
  { name: "Submarine", size: 3 },
  { name: "Destroyer", size: 2 },
];

const idx = (row: number, col: number) => row * SIZE + col;

/** The board cells a ship of `size` occupies from its anchor. */
export function shipCells(p: Placed, size: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < size; k++) {
    const r = p.orient === "h" ? p.row : p.row + k;
    const c = p.orient === "h" ? p.col + k : p.col;
    out.push(idx(r, c));
  }
  return out;
}

/** Is a ship of `size` fully on the board at this anchor/orientation? */
function inBounds(p: Placed, size: number): boolean {
  if (p.row < 0 || p.col < 0) return false;
  const endR = p.orient === "h" ? p.row : p.row + size - 1;
  const endC = p.orient === "h" ? p.col + size - 1 : p.col;
  return endR < SIZE && endC < SIZE;
}

/** All cells occupied by the currently-placed ships on a board. */
function occupied(board: PlayerBoard, exceptSlot = -1): Set<number> {
  const set = new Set<number>();
  board.ships.forEach((ship, slot) => {
    if (ship && slot !== exceptSlot) {
      for (const cell of shipCells(ship, FLEET[slot].size)) set.add(cell);
    }
  });
  return set;
}

function allShipCells(board: PlayerBoard): Set<number> {
  const set = new Set<number>();
  board.ships.forEach((ship, slot) => {
    if (ship) for (const cell of shipCells(ship, FLEET[slot].size)) set.add(cell);
  });
  return set;
}

const emptyBoard = (): PlayerBoard => ({
  ships: FLEET.map(() => null),
  ready: false,
  shots: Array<boolean>(SIZE * SIZE).fill(false),
});

const opponent = (state: BattleshipState, playerId: string): string =>
  state.players.find((id) => id !== playerId)!;

/** Every ship placed and non-overlapping (checked incrementally on place). */
function allPlaced(board: PlayerBoard): boolean {
  return board.ships.every((s) => s !== null);
}

/** True once every cell of every ship on `board` has been shot. */
function fleetSunk(board: PlayerBoard): boolean {
  for (const cell of allShipCells(board)) {
    if (!board.shots[cell]) return false;
  }
  return allPlaced(board); // an unplaced fleet is never "sunk"
}

const battleship: Game<BattleshipState, BattleshipMove> = {
  init(playerIds) {
    const [p1, p2] = playerIds;
    return {
      stage: "placement",
      boards: { [p1]: emptyBoard(), [p2]: emptyBoard() },
      turn: null,
      players: [p1, p2],
      phase: "playing",
      result: null,
      scores: { [p1]: 0, [p2]: 0 },
      round: 1,
      starter: p1,
    };
  },

  validateMove(state, playerId, move) {
    if (!state.players.includes(playerId)) {
      return { ok: false, error: "Not a player" };
    }
    if (typeof move !== "object" || move === null) {
      return { ok: false, error: "Malformed move" };
    }
    const m = move as Record<string, unknown>;

    if (state.phase === "intermission") {
      if (m.again !== true) return { ok: false, error: "Round is over — play again" };
      return { ok: true, move: { again: true } };
    }

    if (state.stage === "placement") {
      const board = state.boards[playerId];
      if (board.ready) return { ok: false, error: "You have already locked in" };

      if (m.ready === true) {
        if (!allPlaced(board)) return { ok: false, error: "Place all your ships first" };
        return { ok: true, move: { ready: true } };
      }

      const place = m.place as Record<string, unknown> | undefined;
      if (!place || typeof place !== "object") {
        return { ok: false, error: "Place a ship or lock in" };
      }
      const ship = place.ship;
      const row = place.row;
      const col = place.col;
      const orient = place.orient;
      if (
        typeof ship !== "number" ||
        !Number.isInteger(ship) ||
        ship < 0 ||
        ship >= FLEET.length
      ) {
        return { ok: false, error: "Unknown ship" };
      }
      if (
        typeof row !== "number" ||
        typeof col !== "number" ||
        !Number.isInteger(row) ||
        !Number.isInteger(col) ||
        (orient !== "h" && orient !== "v")
      ) {
        return { ok: false, error: "Malformed placement" };
      }
      const p: Placed = { row, col, orient: orient as Orient };
      if (!inBounds(p, FLEET[ship].size)) {
        return { ok: false, error: "Ship would run off the board" };
      }
      const taken = occupied(board, ship); // ignore this ship's own old cells
      for (const cell of shipCells(p, FLEET[ship].size)) {
        if (taken.has(cell)) return { ok: false, error: "Ships may not overlap" };
      }
      return { ok: true, move: { place: { ship, row, col, orient: orient as Orient } } };
    }

    // stage === "firing"
    if (state.turn !== playerId) return { ok: false, error: "Not your turn" };
    const fire = m.fire as Record<string, unknown> | undefined;
    if (!fire || typeof fire !== "object") {
      return { ok: false, error: "Fire at the enemy sea" };
    }
    const row = fire.row;
    const col = fire.col;
    if (
      typeof row !== "number" ||
      typeof col !== "number" ||
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      row >= SIZE ||
      col < 0 ||
      col >= SIZE
    ) {
      return { ok: false, error: "Shot off the board" };
    }
    const enemy = state.boards[opponent(state, playerId)];
    if (enemy.shots[idx(row, col)]) {
      return { ok: false, error: "Already fired there" };
    }
    return { ok: true, move: { fire: { row, col } } };
  },

  applyMove(state, playerId, move) {
    // Start the next round: fresh seas, the loser fires first.
    if ("again" in move) {
      const [p1, p2] = state.players;
      const starter = state.result ? opponent(state, state.result) : state.starter;
      return {
        ...state,
        stage: "placement",
        boards: { [p1]: emptyBoard(), [p2]: emptyBoard() },
        turn: null,
        phase: "playing",
        result: null,
        round: state.round + 1,
        starter,
      };
    }

    if ("place" in move) {
      const { ship, row, col, orient } = move.place;
      const board = state.boards[playerId];
      const ships = board.ships.slice();
      ships[ship] = { row, col, orient };
      return {
        ...state,
        boards: { ...state.boards, [playerId]: { ...board, ships } },
      };
    }

    if ("ready" in move) {
      const board = state.boards[playerId];
      const boards = { ...state.boards, [playerId]: { ...board, ready: true } };
      const bothReady = state.players.every((id) => boards[id].ready);
      return {
        ...state,
        boards,
        stage: bothReady ? "firing" : "placement",
        turn: bothReady ? state.starter : null,
      };
    }

    // move is a shot.
    const { row, col } = move.fire;
    const enemyId = opponent(state, playerId);
    const enemy = state.boards[enemyId];
    const shots = enemy.shots.slice();
    shots[idx(row, col)] = true;
    const nextEnemy: PlayerBoard = { ...enemy, shots };
    const boards = { ...state.boards, [enemyId]: nextEnemy };

    if (fleetSunk(nextEnemy)) {
      const scores = { ...state.scores, [playerId]: (state.scores[playerId] ?? 0) + 1 };
      return {
        ...state,
        boards,
        turn: null,
        phase: "intermission",
        result: playerId,
        scores,
      };
    }

    // Classic rules: the turn passes after every shot, hit or miss.
    return { ...state, boards, turn: enemyId };
  },

  result() {
    return { over: false };
  },

  playerView(state, viewerId): BattleshipView {
    const base = {
      stage: state.stage,
      phase: state.phase,
      result: state.result,
      scores: { ...state.scores },
      round: state.round,
      turn: state.turn,
      players: [...state.players],
      starter: state.starter,
      size: SIZE,
      fleet: FLEET.map((f) => ({ ...f })),
      viewerId,
    };

    const cellsWithShot = (b: PlayerBoard): number[] => {
      const out: number[] = [];
      b.shots.forEach((hit, i) => {
        if (hit) out.push(i);
      });
      return out;
    };

    // What an onlooker may see of a sea: shots, which were hits, and sunk ships.
    const publicBoard = (id: string): PublicBoard => {
      const b = state.boards[id];
      const ships = allShipCells(b);
      const shots = cellsWithShot(b);
      const hits = shots.filter((c) => ships.has(c));
      const sunk: SunkShip[] = [];
      b.ships.forEach((ship, slot) => {
        if (!ship) return;
        const cells = shipCells(ship, FLEET[slot].size);
        if (cells.every((c) => b.shots[c])) {
          sunk.push({ name: FLEET[slot].name, size: FLEET[slot].size, cells });
        }
      });
      return { id, placed: b.ready, shots, hits, sunk };
    };

    // The viewer's own sea: full layout plus incoming fire.
    const selfBoard = (id: string): SelfBoard => {
      const b = state.boards[id];
      const incoming = cellsWithShot(b);
      const own = allShipCells(b);
      return {
        id,
        placed: b.ready,
        ships: b.ships.map((ship, slot) =>
          ship
            ? {
                ...ship,
                size: FLEET[slot].size,
                name: FLEET[slot].name,
                cells: shipCells(ship, FLEET[slot].size),
              }
            : null,
        ),
        incoming,
        incomingHits: incoming.filter((c) => own.has(c)),
      };
    };

    if (state.players.includes(viewerId)) {
      return {
        ...base,
        self: selfBoard(viewerId),
        opponents: [publicBoard(opponent(state, viewerId))],
      };
    }
    // Spectator: no own sea, both boards shown publicly (no hidden ships).
    return { ...base, self: null, opponents: state.players.map(publicBoard) };
  },
};

export default battleship;
