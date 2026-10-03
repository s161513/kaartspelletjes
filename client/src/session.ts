// Small typed wrapper around localStorage for the current player's identity.
// localStorage (not sessionStorage) so a reload, a new tab, or a browser
// restart all keep the seat and can auto-rejoin.

const KEYS = {
  nickname: "cg.nickname",
  roomCode: "cg.roomCode",
  playerId: "cg.playerId",
  secret: "cg.secret",
  role: "cg.role",
} as const;

export const session = {
  get nickname(): string {
    return localStorage.getItem(KEYS.nickname) ?? "";
  },
  set nickname(v: string) {
    localStorage.setItem(KEYS.nickname, v);
  },

  get roomCode(): string {
    return localStorage.getItem(KEYS.roomCode) ?? "";
  },
  set roomCode(v: string) {
    localStorage.setItem(KEYS.roomCode, v);
  },

  get playerId(): string {
    return localStorage.getItem(KEYS.playerId) ?? "";
  },
  set playerId(v: string) {
    localStorage.setItem(KEYS.playerId, v);
  },

  /** Private seat token issued in `joined`; echoed back on rejoin. */
  get secret(): string {
    return localStorage.getItem(KEYS.secret) ?? "";
  },
  set secret(v: string) {
    localStorage.setItem(KEYS.secret, v);
  },

  /** "spectator" while watching, "player" (default) once seated. */
  get role(): "player" | "spectator" {
    return localStorage.getItem(KEYS.role) === "spectator" ? "spectator" : "player";
  },
  set role(v: "player" | "spectator") {
    localStorage.setItem(KEYS.role, v);
  },

  clearRoom(): void {
    localStorage.removeItem(KEYS.roomCode);
    localStorage.removeItem(KEYS.playerId);
    localStorage.removeItem(KEYS.secret);
    localStorage.removeItem(KEYS.role);
  },
};
