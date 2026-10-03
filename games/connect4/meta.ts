import type { GameMeta } from "@app/shared";

export default {
  id: "connect4", // must equal the folder name
  title: "Connect Four",
  minPlayers: 2,
  maxPlayers: 2,
  description: "Drop discs into a 7×6 grid; first to four in a row wins.",
  icon: "🔴",
} satisfies GameMeta;
