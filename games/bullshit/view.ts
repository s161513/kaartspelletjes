import { sortHand, type GameContext, type GamePage } from "@app/shared";
import { renderCard } from "../../client/src/cards/renderer.js";
import { BULLSHIT_WINDOW_MS, type BullshitView } from "./types.js";
import "./style.css";

const selected = new Set<string>();
let current: BullshitView | undefined;
let context: GameContext;
let timer: ReturnType<typeof setInterval>;
let offset = 0;
let players: HTMLUListElement;
let pile: HTMLElement;
let claim: HTMLElement;
let feedback: HTMLElement;
let reveal: HTMLElement;
let hand: HTMLElement;
let play: HTMLButtonElement;
let challenge: HTMLButtonElement;
let progress: HTMLProgressElement;
let countdown: HTMLElement;
let handLabel: HTMLElement;

const name = (id: string | null) => context.players?.find(p => p.id === id)?.nickname
  ?? (current?.players.findIndex(p => p.id === id)! >= 0 ? "Player " + (current!.players.findIndex(p => p.id === id) + 1) : "Player");
const online = (id: string) => context.players?.find(p => p.id === id)?.connected !== false;

function mount(ctx: GameContext): void {
  context = ctx;
  ctx.container.classList.add("bs-game");
  ctx.container.innerHTML = `
    <ul class="players bs-players"></ul>
    <section class="bs-table" aria-label="Playing table">
      <div class="bs-pile"></div>
      <p class="bs-claim"></p>
      <div class="bs-reveal" aria-live="polite"></div>
      <p class="bs-feedback" aria-live="polite"></p>
    </section>
    <div class="bs-challenge">
      <progress max="${BULLSHIT_WINDOW_MS}" value="0" aria-label="Challenge time remaining"></progress>
      <button type="button" class="bs-call">BULLSHIT!</button>
      <span class="bs-countdown"></span>
    </div>
    <div class="row bs-hand-heading">
      <strong class="bs-hand-label">Your hand</strong>
      <button type="button" class="bs-play">Play cards</button>
    </div>
    <div class="bs-hand" aria-label="Your private hand"></div>
    <p class="bs-help">Select one or more cards. You claim the required rank, whatever you actually play.</p>
  `;
  const find = <T extends HTMLElement>(selector: string) => ctx.container.querySelector<T>(selector)!;
  players = find<HTMLUListElement>(".bs-players");
  pile = find(".bs-pile"); claim = find(".bs-claim"); feedback = find(".bs-feedback"); reveal = find(".bs-reveal");
  hand = find(".bs-hand"); play = find<HTMLButtonElement>(".bs-play"); challenge = find<HTMLButtonElement>(".bs-call");
  progress = find<HTMLProgressElement>("progress"); countdown = find(".bs-countdown"); handLabel = find(".bs-hand-label");
  play.addEventListener("click", () => {
    if (!current || !selected.size) return;
    ctx.sendMove({ type: "playCards", cardIds: [...selected], playVersion: current.version, roundId: current.roundId });
  });
  challenge.addEventListener("click", () => {
    if (!current?.lastPlay || current.phase !== "CHALLENGE_WINDOW") return;
    ctx.sendMove({ type: "challenge", playId: current.lastPlay.id, roundId: current.roundId });
  });
  timer = setInterval(updateTimer, 50);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
}

function updateTimer(): void {
  if (!current) return;
  const remaining = Math.max(0, (current.deadline ?? 0) - (Date.now() + offset));
  const open = current.phase === "CHALLENGE_WINDOW";
  progress.hidden = !open;
  progress.value = open ? remaining : 0;
  countdown.textContent = open ? (remaining / 1000).toFixed(1) + "s to challenge" : "";
  challenge.disabled = !open || remaining <= 0 || current.lastPlay?.playerId === context.playerId;
}

function update(state: BullshitView, ctx: GameContext): void {
  if (current?.roundId !== state.roundId) selected.clear();
  if (current !== state) offset = state.serverNow - Date.now();
  current = state; context = ctx;
  for (const id of selected) if (!state.myHand.some(card => card.id === id)) selected.delete(id);
  const myTurn = state.phase === "TURN" && state.turn === ctx.playerId;
  players.replaceChildren();
  for (const player of state.players) {
    const li = document.createElement("li");
    li.classList.toggle("bs-active", player.id === state.turn && state.phase !== "GAME_OVER");
    const label = document.createElement("span");
    label.textContent = name(player.id) + (player.id === ctx.playerId ? " (you)" : "");
    const count = document.createElement("span");
    count.className = "badge" + (online(player.id) ? "" : " off");
    count.textContent = player.cardCount + " cards" + (online(player.id) ? "" : " · away");
    li.append(label, count); players.append(li);
  }
  if (state.phase !== "GAME_OVER") {
    ctx.setStatus(state.phase === "TURN"
      ? (myTurn ? "Your turn — claim " : name(state.turn) + "'s turn — claim ") + state.claimedRank + (!online(state.turn!) ? " · waiting for reconnect" : "")
      : state.phase === "CHALLENGE_WINDOW" ? "Do you believe " + name(state.lastPlay!.playerId) + "?"
      : "Checking the last play…");
  }
  pile.replaceChildren(renderCard({ hidden: true }));
  const count = document.createElement("strong");
  count.className = "bs-pile-count"; count.textContent = state.pileCount + " cards in pile"; pile.append(count);
  pile.classList.toggle("bs-played", state.phase === "CHALLENGE_WINDOW");
  claim.textContent = state.lastPlay
    ? name(state.lastPlay.playerId) + " played " + state.lastPlay.count + " card(s), claiming " + state.lastPlay.rank
    : "Ranks: A → 2 → 3 → … → K → A";
  reveal.replaceChildren();
  feedback.textContent = "";
  if (state.phase === "RESOLVING_CHALLENGE" && state.reveal) {
    for (const card of state.reveal.cards) reveal.append(renderCard({ card }));
    feedback.textContent = name(state.reveal.challengerId) + " called Bullshit! " +
      (state.reveal.lied ? name(state.lastPlay!.playerId) + " lied. " : "The claim was true. ") +
      name(state.reveal.loserId) + " takes all " + state.reveal.pileCount + " pile cards.";
    feedback.className = "bs-feedback " + (state.reveal.lied ? "bs-lie" : "bs-truth");
  } else if (state.phase === "GAME_OVER") {
    feedback.className = "bs-feedback bs-winner";
    feedback.textContent = name(state.winner) + " wins! Return to the lobby for another round.";
  } else if (state.phase === "CHALLENGE_WINDOW") {
    feedback.textContent = state.lastPlay?.playerId === ctx.playerId
      ? "Keep your poker face. Your last cards only win after the challenge window."
      : "Challenge only the last set — the entire pile goes to whoever is wrong.";
  }
  handLabel.textContent = "Your hand · " + state.myHand.length + " cards · only visible to you";
  hand.replaceChildren();
  for (const card of sortHand(state.myHand)) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "bs-card-button";
    button.setAttribute("aria-label", card.rank + " " + card.suit);
    button.setAttribute("aria-pressed", String(selected.has(card.id)));
    button.disabled = !myTurn;
    button.append(renderCard({ card, selected: selected.has(card.id) }));
    button.addEventListener("click", () => {
      if (selected.has(card.id)) selected.delete(card.id); else selected.add(card.id);
      button.setAttribute("aria-pressed", String(selected.has(card.id)));
      button.firstElementChild!.classList.toggle("selected", selected.has(card.id));
      updatePlayButton(myTurn);
    });
    hand.append(button);
  }
  if (!state.myHand.length) {
    const empty = document.createElement("p");
    empty.textContent = state.phase === "GAME_OVER" ? "No cards left." : "Hand empty — waiting for the challenge result.";
    hand.append(empty);
  }
  challenge.hidden = state.phase !== "CHALLENGE_WINDOW";
  updatePlayButton(myTurn);
  updateTimer();
}

function updatePlayButton(myTurn: boolean): void {
  play.disabled = !myTurn || selected.size === 0;
  play.textContent = "Play " + (selected.size || "") + " card" + (selected.size === 1 ? "" : "s") + " · claim " + (current?.claimedRank ?? "A");
}

export default { mount, update } satisfies GamePage<BullshitView>;
