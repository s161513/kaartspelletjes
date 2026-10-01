import type { Game } from "@app/shared";
import type { LiegenState, LiegenMove } from "./types.js";

const RANKS = [
    31, 32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65,
    11, 22, 33, 44, 55, 66,
    21
];

function getRank(val: number): number {
    return RANKS.indexOf(val);
}

function nextTurn(state: LiegenState): string | null {
    const active = state.playerOrder.filter(id => state.players[id].status === "active");
    if (active.length <= 1) return null;
    
    const currentIdx = state.playerOrder.indexOf(state.turn!);
    
    for (let i = 1; i < state.playerOrder.length; i++) {
        const idx = (currentIdx + i) % state.playerOrder.length;
        const pId = state.playerOrder[idx];
        if (state.players[pId].status === "active") {
            return pId;
        }
    }
    return null;
}

const logic: Game<LiegenState, LiegenMove> = {
    init(playerIds) {
        const players: Record<string, any> = {};
        for (const pid of playerIds) {
            players[pid] = { id: pid, strikes: 0, status: "active" };
        }
        return {
            turn: playerIds[Math.floor(Math.random() * playerIds.length)],
            players,
            playerOrder: [...playerIds],
            currentClaim: null,
            lastClaimPlayerId: null,
            gameState: "WAITING_FOR_FIRST_SHAKE",
            logs: ["Game started!"],
            secretRoll: null
        };
    },
    
    validateMove(state, playerId, move) {
        if (state.turn !== playerId) return { ok: false, error: "Not your turn" };
        const m = move as LiegenMove;
        if (!m || !m.action) return { ok: false, error: "Invalid move" };
        
        if (m.action === "shake") {
            if (state.gameState === "WAITING_FOR_CLAIM") return { ok: false, error: "Must claim" };
            if (state.currentClaim === 21) return { ok: false, error: "Cannot shake on 21 (Mex), must call" };
        } else if (m.action === "claim") {
            if (state.gameState !== "WAITING_FOR_CLAIM") return { ok: false, error: "Cannot claim now" };
            if (m.value === undefined || getRank(m.value) === -1) return { ok: false, error: "Invalid claim value" };
            if (state.currentClaim !== null && getRank(m.value) <= getRank(state.currentClaim)) {
                return { ok: false, error: "Claim must be higher" };
            }
        } else if (m.action === "blind_pass") {
            if (state.gameState !== "WAITING_FOR_ACTION" || state.currentClaim === null) return { ok: false, error: "Cannot blind pass" };
            if (state.currentClaim === 21) return { ok: false, error: "Cannot pass on 21 (Mex)" };
            if (m.value === undefined || getRank(m.value) === -1) return { ok: false, error: "Invalid claim value" };
            if (getRank(m.value) <= getRank(state.currentClaim)) {
                return { ok: false, error: "Claim must be higher" };
            }
        } else if (m.action === "call_bluff") {
            if (state.gameState !== "WAITING_FOR_ACTION" || state.currentClaim === null) return { ok: false, error: "Cannot call bluff" };
        } else {
            return { ok: false, error: "Unknown action" };
        }
        
        return { ok: true, move: m };
    },
    
    applyMove(state, playerId, move) {
        const next: LiegenState = JSON.parse(JSON.stringify(state));
        
        function addLog(msg: string) {
            next.logs.push(msg);
            if (next.logs.length > 50) next.logs.shift();
        }

        if (move.action === "shake") {
            const d1 = Math.floor(Math.random() * 6) + 1;
            const d2 = Math.floor(Math.random() * 6) + 1;
            next.secretRoll = Math.max(d1, d2) * 10 + Math.min(d1, d2);
            next.gameState = "WAITING_FOR_CLAIM";
            addLog(`Cup shaken.`);
        } else if (move.action === "claim") {
            next.currentClaim = move.value!;
            next.lastClaimPlayerId = playerId;
            next.gameState = "WAITING_FOR_ACTION";
            addLog(`Claim made: ${move.value}`);
            const nt = nextTurn(next);
            if (nt) next.turn = nt;
        } else if (move.action === "blind_pass") {
            next.currentClaim = move.value!;
            next.lastClaimPlayerId = playerId;
            addLog(`Blind pass with claim: ${move.value}`);
            const nt = nextTurn(next);
            if (nt) next.turn = nt;
        } else if (move.action === "call_bluff") {
            addLog(`Bluff called! Cup revealed: ${next.secretRoll}`);
            let loserId = "";
            if (getRank(next.secretRoll!) < getRank(next.currentClaim!)) {
                loserId = next.lastClaimPlayerId!;
                addLog(`The claim was a bluff!`);
            } else {
                loserId = playerId;
                addLog(`The claim was true!`);
            }
            
            const loser = next.players[loserId];
            loser.strikes += 1;
            if (loser.strikes >= 3) {
                loser.status = "eliminated";
                addLog(`A player was eliminated!`);
            }
            
            next.gameState = "SHOWING_REVEAL";
            
            if (loser.status !== "eliminated") {
                next.turn = loser.id;
            } else {
                next.turn = loser.id;
                const nt = nextTurn(next);
                next.turn = nt;
            }
            
            const active = next.playerOrder.filter(id => next.players[id].status === "active");
            if (active.length === 1) {
                next.players[active[0]].status = "winner";
                addLog(`We have a winner!`);
                next.turn = null;
            } else if (active.length === 0) {
                next.turn = null;
            }
        }
        
        return next;
    },

    nextUpdateIn(state) {
        if (state.gameState === "SHOWING_REVEAL") return 5000;
        return null;
    },

    advance(state) {
        if (state.gameState === "SHOWING_REVEAL") {
            const next = { ...state, players: { ...state.players }, playerOrder: [...state.playerOrder], logs: [...state.logs] };
            next.currentClaim = null;
            next.secretRoll = null;
            
            if (state.turn !== null) {
                next.gameState = "WAITING_FOR_FIRST_SHAKE";
            }
            return next;
        }
        return state;
    },
    
    result(state) {
        const active = state.playerOrder.filter(id => state.players[id].status === "active");
        if (active.length === 1) {
            return { over: true, winner: active[0] };
        } else if (active.length === 0) {
            return { over: true, winner: "draw" };
        }
        return { over: false };
    },
    
    playerView(state, playerId) {
        const next = { ...state };
        if (state.gameState === "SHOWING_REVEAL") {
            // Keep it visible for everyone
        } else {
            // Only the first player of the round can see the roll (currentClaim is null)
            const canSee = state.turn === playerId && 
                           state.gameState === "WAITING_FOR_CLAIM" && 
                           state.currentClaim === null;
            if (!canSee) {
                next.secretRoll = null;
            }
        }
        return next;
    }
};

export default logic;
