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
.glass {
    background: rgba(30, 41, 59, 0.7);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
}
.claim-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
    transform: none !important;
}
</style>
<div class="flex flex-col md:flex-row gap-6 w-full h-full text-white">
    <div class="flex flex-col gap-2 w-full md:w-64" id="liegen-players">
    </div>

    <div class="flex-grow flex flex-col gap-4 items-center">
        <div id="cup-container" class="relative group cursor-pointer w-32 h-40">
            <div id="cup" class="w-full h-full bg-gradient-to-b from-red-600 to-red-800 rounded-t-lg rounded-b-3xl border-4 border-red-900 shadow-2xl relative transition-transform duration-500 origin-bottom"></div>
            <div id="secret-roll" class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-5xl font-black text-white drop-shadow-md transition-opacity duration-300 pointer-events-none">??</div>
        </div>

        <div class="mt-4 text-center">
            <p class="text-sm text-slate-400 uppercase font-semibold">Current Claim</p>
            <div id="current-claim" class="text-4xl font-black text-white drop-shadow-[0_0_15px_rgba(34,197,94,0.5)]">--</div>
        </div>

        <div id="actions" class="flex flex-col gap-3 w-full max-w-sm mt-4">
            <button id="btn-shake" class="bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-bold shadow-lg hidden">🎲 Schudden</button>
            <button id="btn-call" class="bg-red-600 hover:bg-red-500 py-3 rounded-xl font-bold shadow-lg hidden">👀 Bluf Callen</button>
            <button id="btn-blind" class="bg-purple-600 hover:bg-purple-500 py-3 rounded-xl font-bold shadow-lg hidden">🙈 Blind Doorgeven</button>
        </div>

        <div id="claim-grid-container" class="hidden flex-col gap-2 w-full max-w-sm mt-4 border-t border-slate-700 pt-4">
            <span class="text-sm font-medium text-slate-300" id="claim-title">Select Claim</span>
            <div id="claim-grid" class="grid grid-cols-5 gap-2"></div>
            <button id="btn-cancel-claim" class="text-slate-400 hover:text-white text-sm mt-2">Cancel</button>
        </div>
    </div>

    <div class="w-full md:w-64 flex flex-col gap-2 font-mono text-xs overflow-y-auto max-h-64 border-l border-slate-700 pl-4" id="liegen-log">
    </div>
</div>
`;

let currentSecret: number | null = null;
let currentPendingAction: "claim" | "blind_pass" | null = null;

const page: GamePage<LiegenState> = {
    mount(ctx) {
        ctx.container.innerHTML = htmlTemplate;

        // Ensure tailwind is loaded globally since we injected it via client/game.html in the old setup
        // But wait, the new setup uses game.html for ALL games. We shouldn't inject Tailwind globally if it breaks others.
        // Tailwind via CDN works fine though. Let's just inject the script programmatically if it doesn't exist.
        if (!document.getElementById("tailwind-script")) {
            const script = document.createElement("script");
            script.id = "tailwind-script";
            script.src = "https://cdn.tailwindcss.com";
            document.head.appendChild(script);
            
            const config = document.createElement("script");
            config.innerHTML = "tailwind.config = { theme: { extend: { colors: { brand: { 400: '#4ade80', 500: '#22c55e', 900: '#14532d' } } } } }";
            document.head.appendChild(config);
        }

        const claimGrid = document.getElementById("claim-grid")!;
        RANKS.forEach(val => {
            const btn = document.createElement("button");
            btn.className = "claim-btn py-2 rounded bg-slate-700/50 hover:bg-slate-600 border border-slate-600 font-bold transition-colors";
            btn.innerText = String(val);
            if (val === 21) btn.classList.add('text-yellow-400', 'border-yellow-600/50');
            else if (val % 11 === 0) btn.classList.add('text-brand-400');
            
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
        
        playersDiv.innerHTML = "";
        state.playerOrder.forEach(pid => {
            const p = state.players[pid];
            const isMe = pid === ctx.playerId;
            const name = isMe ? "You" : ctx.nickname(pid);
            const activeTurn = state.turn === pid;
            
            let bg = p.status === 'eliminated' ? 'bg-red-900/20 opacity-50' : (activeTurn ? 'bg-brand-900/40 border-brand-500' : 'bg-slate-800/50');
            let border = activeTurn ? 'border border-brand-500' : 'border border-transparent';
            
            const strikesHtml = p.status === 'eliminated' ? '💀' : '❌'.repeat(p.strikes) + '⚪'.repeat(3 - p.strikes);

            playersDiv.innerHTML += "<div class='flex items-center justify-between p-2 rounded-lg " + bg + " " + border + "'>" +
                "<span class='font-medium " + (isMe ? 'text-brand-400' : '') + "'>" + name + "</span>" +
                "<span class='text-xs tracking-widest'>" + strikesHtml + "</span>" +
                "</div>";
        });

        document.getElementById("current-claim")!.innerText = state.currentClaim ? String(state.currentClaim) : "--";

        const logDiv = document.getElementById("liegen-log")!;
        logDiv.innerHTML = "";
        [...state.logs].reverse().forEach(l => {
            logDiv.innerHTML += "<div class='bg-slate-800/50 p-1 rounded text-slate-300 border-l-2 border-slate-600'>" + l + "</div>";
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
                btnShake.classList.remove("hidden");
                btnShake.innerText = "🎲 Schudden & Kijken";
                btnCall.classList.remove("hidden");
                btnBlind.classList.remove("hidden");
                actionsContainer.classList.remove("hidden");
                gridContainer.classList.add("hidden");
            } else if (state.gameState === "WAITING_FOR_CLAIM") {
                actionsContainer.classList.add("hidden");
                gridContainer.classList.remove("hidden");
                document.getElementById("claim-title")!.innerText = "Make a Claim";
                currentPendingAction = "claim";
            }
        } else {
            actionsContainer.classList.add("hidden");
            gridContainer.classList.add("hidden");
        }

        if (state.secretRoll) {
            currentSecret = state.secretRoll;
            document.getElementById("secret-roll")!.innerText = String(state.secretRoll);
            document.getElementById("cup")!.style.transform = 'translateY(-40px) rotate(15deg)';
        } else {
            currentSecret = null;
            document.getElementById("secret-roll")!.innerText = "??";
            document.getElementById("cup")!.style.transform = 'translateY(0) rotate(0)';
        }

        const currentRank = state.currentClaim ? getRank(state.currentClaim) : -1;
        claimButtons.forEach(btn => {
            const val = parseInt(btn.innerText);
            btn.disabled = getRank(val) <= currentRank;
        });

        if (state.turn !== null) {
            ctx.setStatus(isMyTurn ? "Your turn!" : "Waiting for other player...");
        }
    },

    onGameOver(winner, state, ctx) {
        document.getElementById("actions")!.classList.add("hidden");
        document.getElementById("claim-grid-container")!.classList.add("hidden");
        ctx.setStatus(winner === "draw" ? "It's a draw!" : (winner === ctx.playerId ? "You won!" : ctx.nickname(winner) + " won!"));
    }
};

export default page;
