import type { GameMeta } from "@app/shared";

export default {
  id: "tictactoe", // must equal the folder name
  title: "Tic-tac-toe",
  minPlayers: 2,
  maxPlayers: 2,
  description: "Classic 3×3. Two players take turns; first to a line wins.",
} satisfies GameMeta;
