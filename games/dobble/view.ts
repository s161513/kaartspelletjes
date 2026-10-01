import type { GameContext, GamePage } from "@app/shared";
import type { DobbleView } from "./types.js";
import { renderCard } from "./card.js";
import { AVATARS } from "./symbols.js";
import "./style.css";

let root: HTMLDivElement;
let board: HTMLDivElement;
let scores: HTMLDivElement;
let roundText: HTMLSpanElement;
let message: HTMLDivElement;
let network: HTMLDivElement;
let results: HTMLDivElement;
let current: DobbleView | null = null;
let roundId = "";
let lastWinner: string | null = null;
let blockedUntil = 0;
const names = new Map<string, string>();

function nickname(id: string, state: DobbleView): string {
  return names.get(id) ?? `Speler ${state.playerIds.indexOf(id) + 1}`;
}
function avatar(id: string, state: DobbleView): string {
  return AVATARS[state.playerIds.indexOf(id) % AVATARS.length] ?? "👋";
}
function rememberPlayers(ctx: GameContext): void {
  for (const player of ctx.players ?? []) names.set(player.id, player.nickname);
}
function updateAvailability(ctx: GameContext): void {
  if (!current || !board) return;
  const connected = ctx.connected !== false && navigator.onLine;
  network.hidden = connected;
  const disabled = !connected || current.paused || current.round.status !== "active" || Date.now() < blockedUntil;
  for (const button of board.querySelectorAll<HTMLButtonElement>("button")) button.disabled = disabled;
  if (Date.now() >= blockedUntil) board.classList.remove("wrong");
}
function renderScores(state: DobbleView, ctx: GameContext): void {
  scores.replaceChildren();
  const ids = [...state.playerIds].sort((a,b) => state.scores[b] - state.scores[a]);
  for (const id of ids) {
    const chip = document.createElement("div");
    chip.className = `score-chip${id === ctx.playerId ? " my-score" : ""}`;
    const player = ctx.players?.find(p => p.id === id);
    if (player && !player.connected) chip.classList.add("offline-score");
    const icon = document.createElement("span"); icon.textContent = avatar(id,state); icon.setAttribute("aria-hidden","true");
    const label = document.createElement("span"); label.className = "score-name"; label.textContent = nickname(id,state); label.title = label.textContent;
    const score = document.createElement("strong"); score.textContent = String(state.scores[id]);
    chip.append(icon,label,score); scores.appendChild(chip);
  }
}
function renderResults(state: DobbleView, ctx: GameContext): void {
  if (!state.winnerId) return;
  if (lastWinner !== state.winnerId) {
    results.replaceChildren();
    const trophy = document.createElement("div"); trophy.className = "trophy"; trophy.textContent = "🏆";
    const heading = document.createElement("h2"); heading.textContent = `${nickname(state.winnerId,state)} wint!`;
    const subtitle = document.createElement("p"); subtitle.textContent = "Een applaus voor de snelste ogen van de room.";
    const list = document.createElement("div"); list.className = "result-list";
    for (const [i,id] of [...state.playerIds].sort((a,b) => state.scores[b] - state.scores[a]).entries()) {
      const row = document.createElement("div"); row.className = "result-row";
      const label = document.createElement("span"); label.textContent = `${i+1}. ${avatar(id,state)} ${nickname(id,state)}${id === ctx.playerId ? " (jij)" : ""}`;
      const score = document.createElement("strong"); score.textContent = `${state.scores[id]} punten`;
      row.append(label,score); list.appendChild(row);
    }
    const note = document.createElement("p"); note.className = "result-note"; note.textContent = "Terug in de lobby kan de host opnieuw Dobble starten met dezelfde room.";
    const confetti = document.createElement("div"); confetti.className = "confetti"; confetti.setAttribute("aria-hidden","true");
    for(let i=0;i<24;i++) {
      const piece=document.createElement("i"); piece.style.left=`${i*4.2}%`; piece.style.animationDelay=`${i%6*.12}s`; piece.style.background=["#7955d9","#ffbc61","#80cdb0","#ee82a6"][i%4]; confetti.appendChild(piece);
    }
    results.append(confetti,trophy,heading,subtitle,list,note);
    lastWinner=state.winnerId;
  }
  results.hidden=false; board.hidden=true;
}

const view: GamePage<DobbleView> = {
  mount(ctx) {
    root=document.createElement("div"); root.className="dobble-game";
    root.innerHTML=`<div class="dobble-heading"><span class="dobble-pill">VIND DE MATCH</span><span class="round-count"></span></div><div class="scoreboard" aria-label="Scorebord"></div><div class="dobble-network" role="status" hidden>Verbinding verloren — opnieuw verbinden…</div><div class="round-message" role="status" aria-live="polite"></div><div class="dobble-board"></div><div class="dobble-results" hidden></div>`;
    ctx.container.appendChild(root);
    scores=root.querySelector(".scoreboard")!; board=root.querySelector(".dobble-board")!;
    roundText=root.querySelector(".round-count")!; message=root.querySelector(".round-message")!;
    network=root.querySelector(".dobble-network")!; results=root.querySelector(".dobble-results")!;
    const monitor=window.setInterval(() => updateAvailability(ctx),100);
    window.addEventListener("pagehide",() => clearInterval(monitor),{once:true});
  },
  update(state,ctx) {
    current=state; rememberPlayers(ctx); renderScores(state,ctx);
    roundText.textContent=`Ronde ${state.round.number} · eerste tot ${state.target}`;
    if (roundId !== state.round.id) {
      roundId=state.round.id; blockedUntil=0; lastWinner=null;
      board.replaceChildren(); board.classList.remove("wrong"); board.hidden=false; results.hidden=true;
      for(const own of [false,true]) {
        const area=document.createElement("section"); area.className=`card-area${own ? " own-area" : ""}`;
        const label=document.createElement("div"); label.className="card-label"; label.textContent=own ? "JOUW KAART" : "CENTRALE KAART";
        const card=renderCard(own ? state.round.own : state.round.center,state.round.id+(own ? ctx.playerId : "center"),own ? id => {
          if (!current || current.round.status !== "active" || current.paused || ctx.connected === false || !navigator.onLine || Date.now()<blockedUntil) return;
          blockedUntil=Date.now()+80;
          ctx.sendMove({type:"symbolClick",roundId:current.round.id,symbolId:id});
          updateAvailability(ctx);
        } : undefined);
        area.append(label,card); board.appendChild(area);
      }
      // Force a new-round animation only when the server issues a new round ID.
      board.classList.remove("round-enter"); void board.offsetWidth; board.classList.add("round-enter");
    }
    for(const symbol of board.querySelectorAll<HTMLElement>("[data-symbol-id]")) symbol.classList.toggle("matched",Number(symbol.dataset.symbolId)===state.round.matchedSymbol);
    message.classList.toggle("success",state.round.status==="completed");
    message.textContent=state.paused ? "⏸ Wachten op een tweede verbonden speler." : state.round.winnerId ? `⭐ ${nickname(state.round.winnerId,state)} vond de match!` : state.round.own.length ? "Tik op het symbool dat op beide kaarten staat." : "Je kijkt mee; je nam niet deel toen deze game begon.";
    if (state.winnerId) renderResults(state,ctx);
    else ctx.setStatus("Vind als eerste het gedeelde symbool.");
    updateAvailability(ctx);
  },
  onRoomState(ctx) { rememberPlayers(ctx); if (current) view.update(current,ctx); },
  onError(error,ctx) {
    if (!board || !current) return;
    blockedUntil=Date.now()+420; board.classList.add("wrong"); message.textContent=error;
    updateAvailability(ctx);
  },
  onGameOver(_winner,state,ctx) { renderResults(state,ctx); updateAvailability(ctx); },
};
export default view;
