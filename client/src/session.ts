// Small typed wrapper around browser storage for the current player's identity.
//
// The seat (room, player id, secret, role) is per tab, in sessionStorage: a
// reload keeps it, but a second tab never silently takes over the first tab's
// seat. The last seat is also mirrored to localStorage so a reopened tab or a
// browser restart can offer "rejoin your room" on the start page.

const KEYS = {
  nickname: "cg.nickname",
  roomCode: "cg.roomCode",
  playerId: "cg.playerId",
  secret: "cg.secret",
  role: "cg.role",
} as const;

const SEAT_KEYS = [KEYS.roomCode, KEYS.playerId, KEYS.secret, KEYS.role];

function get(key: string): string {
  return sessionStorage.getItem(key) ?? "";
}

/** Write to this tab and mirror to the shared "last seat". */
function set(key: string, value: string): void {
  sessionStorage.setItem(key, value);
  localStorage.setItem(key, value);
}

export const session = {
  get nickname(): string {
    return localStorage.getItem(KEYS.nickname) ?? "";
  },
  set nickname(v: string) {
    localStorage.setItem(KEYS.nickname, v);
  },

  get roomCode(): string {
    return get(KEYS.roomCode);
  },
  set roomCode(v: string) {
    set(KEYS.roomCode, v);
  },

  get playerId(): string {
    return get(KEYS.playerId);
  },
  set playerId(v: string) {
    set(KEYS.playerId, v);
  },

  /** Private seat token issued in `joined`; echoed back on rejoin. */
  get secret(): string {
    return get(KEYS.secret);
  },
  set secret(v: string) {
    set(KEYS.secret, v);
  },

  /** "spectator" while watching, "player" (default) once seated. */
  get role(): "player" | "spectator" {
    return get(KEYS.role) === "spectator" ? "spectator" : "player";
  },
  set role(v: "player" | "spectator") {
    set(KEYS.role, v);
  },

  /** The last seat any tab held (for "rejoin" on the start page), if any. */
  get lastRoomCode(): string {
    return localStorage.getItem(KEYS.playerId) ? localStorage.getItem(KEYS.roomCode) ?? "" : "";
  },

  /** Adopt the last seat in this tab (the start page's "rejoin" button). */
  resumeLastSeat(): void {
    for (const key of SEAT_KEYS) {
      const v = localStorage.getItem(key);
      if (v !== null) sessionStorage.setItem(key, v);
    }
  },

  /** Forget this tab's seat only (another tab owns it now). */
  forgetTab(): void {
    for (const key of SEAT_KEYS) sessionStorage.removeItem(key);
  },

  /** Another tab took this seat over: stop here and explain on the start page. */
  seatTaken(message: string): void {
    this.forgetTab();
    sessionStorage.setItem("cg.notice", message);
    location.href = "/";
  },

  /** The seat is gone for good (left, or the server no longer knows it). */
  clearRoom(): void {
    // Keep a different, newer seat another tab may have stored meanwhile.
    if (localStorage.getItem(KEYS.playerId) === sessionStorage.getItem(KEYS.playerId)) {
      for (const key of SEAT_KEYS) localStorage.removeItem(key);
    }
    this.forgetTab();
  },
};
