import type { GameMeta } from "@app/shared";

export default {
  id: "hartenjagen", // must equal the folder name
  title: "Hartenjagen",
  minPlayers: 3,
  maxPlayers: 6,
  description: "Avoid hearts and the queen of spades. First to 100 ends the game; lowest score wins.",
} satisfies GameMeta;
