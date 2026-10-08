import type { GameMeta } from "@app/shared";

export default {
  id: "battleship",
  title: "Battleship",
  minPlayers: 2,
  maxPlayers: 2,
  description: "Hide your fleet, then take turns firing — sink the enemy first.",
  icon: "🚢",
} satisfies GameMeta;
