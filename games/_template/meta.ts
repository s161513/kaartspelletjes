import type { GameMeta } from "@app/shared";

// Copy this folder to games/<id>/ and set `id` to that folder name.
export default {
  id: "_template", // must equal the folder name
  title: "Hoogste kaart",
  minPlayers: 2,
  maxPlayers: 6,
  description: "Everyone draws one card; the highest card wins.",
} satisfies GameMeta;
