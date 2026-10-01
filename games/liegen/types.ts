export interface LiegenPlayerState {
  id: string;
  strikes: number;
  status: "active" | "eliminated" | "winner";
}

export interface LiegenState {
  turn: string | null;
  players: Record<string, LiegenPlayerState>;
  playerOrder: string[];
  currentClaim: number | null;
  currentAdvice: boolean;
  lastClaimPlayerId: string | null;
  gameState: "WAITING_FOR_FIRST_SHAKE" | "WAITING_FOR_ACTION" | "WAITING_FOR_CLAIM" | "SHOWING_REVEAL";
  logs: string[];
  
  // This value is populated globally but will be filtered by playerView
  secretRoll: number | null;
}

export interface LiegenMove {
  action: "shake" | "claim" | "blind_pass" | "call_bluff";
  value?: number;
  withAdvice?: boolean;
}
