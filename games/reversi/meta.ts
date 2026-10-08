import type { GameMeta } from "@app/shared";

export default {
  id: "reversi",
  title: "Reversi",
  minPlayers: 2,
  maxPlayers: 2,
  description: "Flank your opponent's discs on an 8×8 board; most discs wins.",
  icon: "⚪",
} satisfies GameMeta;
