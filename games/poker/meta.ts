import type { GameMeta } from "@app/shared";

export default {
  id: "poker", // must equal the folder name
  title: "Texas Hold'em",
  minPlayers: 2,
  maxPlayers: 8,
  description: "No-limit poker. Everyone starts with 1000 chips; last player with chips wins.",
} satisfies GameMeta;
