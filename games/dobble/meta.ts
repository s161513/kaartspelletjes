import type { GameMeta } from "@app/shared";

export default {
  id: "dobble",
  title: "Dobble",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Vind als eerste het gedeelde symbool. Ieder een eigen kaart, eerste tot 10 punten wint.",
} satisfies GameMeta;
