// Small typed wrapper around sessionStorage for the current player's identity.

const KEYS = {
  nickname: "cg.nickname",
  roomCode: "cg.roomCode",
  playerId: "cg.playerId",
  role: "cg.role",
} as const;

export const session = {
  get nickname(): string {
    return sessionStorage.getItem(KEYS.nickname) ?? "";
  },
  set nickname(v: string) {
    sessionStorage.setItem(KEYS.nickname, v);
  },

  get roomCode(): string {
    return sessionStorage.getItem(KEYS.roomCode) ?? "";
  },
  set roomCode(v: string) {
    sessionStorage.setItem(KEYS.roomCode, v);
  },

  get playerId(): string {
    return sessionStorage.getItem(KEYS.playerId) ?? "";
  },
  set playerId(v: string) {
    sessionStorage.setItem(KEYS.playerId, v);
  },

  /** "spectator" while watching, "player" (default) once seated. */
  get role(): "player" | "spectator" {
    return sessionStorage.getItem(KEYS.role) === "spectator" ? "spectator" : "player";
  },
  set role(v: "player" | "spectator") {
    sessionStorage.setItem(KEYS.role, v);
  },

  clearRoom(): void {
    sessionStorage.removeItem(KEYS.roomCode);
    sessionStorage.removeItem(KEYS.playerId);
    sessionStorage.removeItem(KEYS.role);
  },
};
