import type { GamePage, GameContext } from "@app/shared";
import type { LiegenState } from "./types.js";

const RANKS = [
    31, 32, 41, 42, 43, 51, 52, 53, 54, 61, 62, 63, 64, 65,
    11, 22, 33, 44, 55, 66,
    21
];

function getRank(val: number): number {
    return RANKS.indexOf(val);
}

let claimButtons: HTMLButtonElement[] = [];

const htmlTemplate = `
<style>
.liegen-layout { display: flex; flex-direction: row; gap: 1.5rem; width: 100%; color: white; }
@media (max-width: 768px) { .liegen-layout { flex-direction: column; } }
.liegen-players { display: flex; flex-direction: column; gap: 0.5rem; width: 100%; max-width: 16rem; }
.liegen-center { flex-grow: 1; display: flex; flex-direction: column; gap: 1rem; align-items: center; }
.liegen-log { width: 100%; max-width: 16rem; display: flex; flex-direction: column; gap: 0.5rem; font-family: monospace; font-size: 0.75rem; overflow-y: auto; max-height: 16rem; border-left: 1px solid #334155; padding-left: 1rem; }
.log-item { background: rgba(30, 41, 59, 0.5); padding: 0.25rem; border-radius: 0.25rem; border-left: 2px solid #475569; color: #cbd5e1; }
.player-card { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem; border-radius: 0.5rem; background: rgba(30, 41, 59, 0.5); border: 1px solid transparent; }
.player-card.active-turn { background: rgba(20, 83, 45, 0.5); border-color: #22c55e; }
.player-card.eliminated { background: rgba(127, 29, 29, 0.2); opacity: 0.5; }
#cup-container { position: relative; width: 8rem; height: 10rem; }
#cup { width: 100%; height: 100%; background: linear-gradient(to bottom, #dc2626, #991b1b); border-radius: 0.5rem 0.5rem 1.5rem 1.5rem; border: 4px solid #7f1d1d; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); transition: transform 0.5s; transform-origin: bottom; }
#secret-roll { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 3rem; font-weight: 900; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.5); pointer-events: none; }
.actions-container { display: flex; flex-direction: column; gap: 0.75rem; width: 100%; max-width: 24rem; margin-top: 1rem; }
.action-btn { padding: 0.75rem; border-radius: 0.75rem; font-weight: bold; cursor: pointer; border: none; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); color: white; }
.btn-blue { background: #2563eb; } .btn-blue:hover { background: #3b82f6; }
.btn-red { background: #dc2626; } .btn-red:hover { background: #ef4444; }
.btn-purple { background: #9333ea; } .btn-purple:hover { background: #a855f7; }
.claim-grid-container { display: flex; flex-direction: column; gap: 0.5rem; width: 100%; max-width: 24rem; margin-top: 1rem; border-top: 1px solid #334155; padding-top: 1rem; }
.claim-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.5rem; }
.claim-btn { padding: 0.5rem; border-radius: 0.25rem; background: rgba(51, 65, 85, 0.5); border: 1px solid #475569; font-weight: bold; color: white; cursor: pointer; }
.claim-btn:hover { background: #475569; }
.claim-btn:disabled { opacity: 0.3; cursor: not-allowed; }
.claim-btn.text-yellow { color: #facc15; border-color: rgba(202, 138, 4, 0.5); }
.claim-btn.text-green { color: #4ade80; }
.hidden { display: none !important; }
#turn-banner { font-size: 1.25rem; font-weight: bold; color: #4ade80; margin-bottom: 1rem; text-align: center; background: rgba(20, 83, 45, 0.5); padding: 0.5rem 1rem; border-radius: 0.5rem; border: 1px solid #22c55e; width: 100%; max-width: 24rem; }
.current-claim-box { text-align: center; margin-top: 1rem; }
.current-claim-label { font-size: 0.875rem; color: #94a3b8; text-transform: uppercase; font-weight: bold; }
.current-claim-value { font-size: 2.25rem; font-weight: 900; color: white; text-shadow: 0 0 15px rgba(34,197,94,0.5); }
.cancel-btn { color: #94a3b8; background: transparent; border: none; font-size: 0.875rem; cursor: pointer; margin-top: 0.5rem; }
.cancel-btn:hover { color: white; }
</style>
<div class="liegen-layout">
    <div class="liegen-players" id="liegen-players"></div>

    <div class="liegen-center">
        <div id="turn-banner" class="hidden"></div>
        <div id="cup-container">
            <div id="cup"></div>
            <div id="secret-roll">??</div>
        </div>

        <div class="current-claim-box">
            <p class="current-claim-label">Huidige Claim</p>
            <div id="current-claim" class="current-claim-value">--</div>
        </div>

        <div id="actions" class="actions-container hidden">
            <button id="btn-shake" class="action-btn btn-blue hidden">🎲 Schudden</button>
            <button id="btn-call" class="action-btn btn-red hidden">👀 Bluf Callen</button>
            <button id="btn-blind" class="action-btn btn-purple hidden">🙈 Blind Doorgeven</button>
        </div>

        <div id="claim-grid-container" class="claim-grid-container hidden">
            <span style="font-size: 0.875rem; font-weight: 500; color: #cbd5e1;" id="claim-title">Select Claim</span>
            <div id="claim-grid" class="claim-grid"></div>
            <button id="btn-cancel-claim" class="cancel-btn">Cancel</button>
        </div>
    </div>

    <div class="liegen-log" id="liegen-log"></div>
</div>
`;

let currentSecret: number | null = null;
let currentPendingAction: "claim" | "blind_pass" | null = null;

const page: GamePage<LiegenState> = {
    mount(ctx) {
        ctx.container.innerHTML = htmlTemplate;

        const claimGrid = document.getElementById("claim-grid")!;
        RANKS.forEach(val => {
            const btn = document.createElement("button");
            btn.className = "claim-btn";
            btn.innerText = String(val);
            if (val === 21) btn.classList.add('text-yellow');
            else if (val % 11 === 0) btn.classList.add('text-green');
            
            btn.onclick = () => {
                if (currentPendingAction) {
                    ctx.sendMove({ action: currentPendingAction, value: val });
                    document.getElementById("claim-grid-container")!.classList.add("hidden");
                    document.getElementById("actions")!.classList.remove("hidden");
                    currentPendingAction = null;
                }
            };
            claimButtons.push(btn);
            claimGrid.appendChild(btn);
        });

        document.getElementById("btn-shake")!.onclick = () => {
            ctx.sendMove({ action: "shake" });
        };

        document.getElementById("btn-call")!.onclick = () => {
            ctx.sendMove({ action: "call_bluff" });
        };

        document.getElementById("btn-blind")!.onclick = () => {
            currentPendingAction = "blind_pass";
            document.getElementById("actions")!.classList.add("hidden");
            document.getElementById("claim-grid-container")!.classList.remove("hidden");
            document.getElementById("claim-title")!.innerText = "Blind Claim";
            document.getElementById("btn-cancel-claim")!.classList.remove("hidden");
        };

        document.getElementById("btn-cancel-claim")!.onclick = () => {
            currentPendingAction = null;
            document.getElementById("claim-grid-container")!.classList.add("hidden");
            document.getElementById("actions")!.classList.remove("hidden");
        };
    },

    update(state, ctx) {
        const isMyTurn = state.turn === ctx.playerId;
        const playersDiv = document.getElementById("liegen-players")!;
        const banner = document.getElementById("turn-banner")!;
        
        if (state.turn) {
            banner.classList.remove("hidden");
            banner.innerText = isMyTurn ? "Jij bent aan de beurt!" : ctx.nickname(state.turn) + " is aan de beurt";
            if (isMyTurn) {
                banner.style.color = "white";
                banner.style.background = "#22c55e";
            } else {
                banner.style.color = "#4ade80";
                banner.style.background = "rgba(20, 83, 45, 0.5)";
            }
        } else {
            banner.classList.add("hidden");
        }
        
        playersDiv.innerHTML = "";
        state.playerOrder.forEach(pid => {
            const p = state.players[pid];
            const isMe = pid === ctx.playerId;
            const name = isMe ? "You" : ctx.nickname(pid);
            const activeTurn = state.turn === pid;
            
            let pClass = "player-card";
            if (p.status === "eliminated") pClass += " eliminated";
            else if (activeTurn) pClass += " active-turn";
            
            const strikesHtml = p.status === 'eliminated' ? '💀' : '❌'.repeat(p.strikes) + '⚪'.repeat(3 - p.strikes);

            playersDiv.innerHTML += "<div class='" + pClass + "'>" +
                "<span style='font-weight: 500; " + (isMe ? "color: #4ade80;" : "") + "'>" + name + "</span>" +
                "<span style='font-size: 0.75rem; letter-spacing: 0.1em;'>" + strikesHtml + "</span>" +
                "</div>";
        });

        document.getElementById("current-claim")!.innerText = state.currentClaim ? String(state.currentClaim) : "--";

        const logDiv = document.getElementById("liegen-log")!;
        logDiv.innerHTML = "";
        [...state.logs].reverse().forEach(l => {
            logDiv.innerHTML += "<div class='log-item'>" + l + "</div>";
        });

        const btnShake = document.getElementById("btn-shake")!;
        const btnCall = document.getElementById("btn-call")!;
        const btnBlind = document.getElementById("btn-blind")!;
        const actionsContainer = document.getElementById("actions")!;
        const gridContainer = document.getElementById("claim-grid-container")!;

        btnShake.classList.add("hidden");
        btnCall.classList.add("hidden");
        btnBlind.classList.add("hidden");

        if (isMyTurn) {
            if (state.gameState === "WAITING_FOR_FIRST_SHAKE") {
                btnShake.classList.remove("hidden");
                btnShake.innerText = "🎲 Schudden";
                actionsContainer.classList.remove("hidden");
                gridContainer.classList.add("hidden");
            } else if (state.gameState === "WAITING_FOR_ACTION") {
                if (state.currentClaim === 21) {
                    btnCall.classList.remove("hidden");
                    actionsContainer.classList.remove("hidden");
                    gridContainer.classList.add("hidden");
                } else {
                    btnShake.classList.remove("hidden");
                    btnShake.innerText = "🎲 Schudden";
                    btnCall.classList.remove("hidden");
                    btnBlind.classList.remove("hidden");
                    actionsContainer.classList.remove("hidden");
                    gridContainer.classList.add("hidden");
                }
            } else if (state.gameState === "WAITING_FOR_CLAIM") {
                actionsContainer.classList.add("hidden");
                gridContainer.classList.remove("hidden");
                document.getElementById("claim-title")!.innerText = "Maak een Claim";
                currentPendingAction = "claim";
                document.getElementById("btn-cancel-claim")!.classList.add("hidden");
            }
        } else {
            actionsContainer.classList.add("hidden");
            gridContainer.classList.add("hidden");
        }

        if (state.secretRoll) {
            document.getElementById("secret-roll")!.innerText = String(state.secretRoll);
            document.getElementById("cup")!.style.transform = 'translateY(-40px) rotate(15deg)';
        } else {
            document.getElementById("secret-roll")!.innerText = "??";
            document.getElementById("cup")!.style.transform = 'translateY(0) rotate(0)';
        }

        const currentRank = state.currentClaim ? getRank(state.currentClaim) : -1;
        claimButtons.forEach(btn => {
            const val = parseInt(btn.innerText);
            btn.disabled = getRank(val) <= currentRank;
        });

        if (state.turn !== null) {
            ctx.setStatus(isMyTurn ? "Jij bent aan de beurt!" : "Wachten op " + ctx.nickname(state.turn) + "...");
        }
    },

    onGameOver(winner, state, ctx) {
        document.getElementById("actions")!.classList.add("hidden");
        document.getElementById("claim-grid-container")!.classList.add("hidden");
        const msg = winner === "draw" ? "Gelijkspel!" : (winner === ctx.playerId ? "Jij hebt gewonnen!" : ctx.nickname(winner) + " heeft gewonnen!");
        ctx.setStatus(msg);
        
        const banner = document.getElementById("turn-banner")!;
        banner.classList.remove("hidden");
        banner.innerText = msg;
        banner.style.background = "#2563eb";
        banner.style.color = "white";
        banner.style.borderColor = "#1d4ed8";
    }
};

export default page;
