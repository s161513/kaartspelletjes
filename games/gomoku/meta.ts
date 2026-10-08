import type { GameMeta } from "@app/shared";

export default {
  id: "gomoku",
  title: "Gomoku",
  minPlayers: 2,
  maxPlayers: 2,
  description: "Place stones on a 15×15 board; first to five in a row wins.",
  icon: "⚫",
} satisfies GameMeta;
