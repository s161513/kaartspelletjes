import type { GameMeta } from "@app/shared";

export default {
  id: "liegen", // must equal the folder name
  title: "Liegen",
  minPlayers: 3,
  maxPlayers: 10,
  description: "Multiplayer bluffing dice game.",
} satisfies GameMeta;
