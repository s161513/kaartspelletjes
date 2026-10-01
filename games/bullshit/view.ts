import { sortHand, type Rank, type GameContext, type GamePage } from "@app/shared";
import { renderCard } from "../_ui/cards.js";
import { BULLSHIT_WINDOW_MS, type BullshitView } from "./types.js";
import "./style.css";

const selected = new Set<string>();
let current: BullshitView | undefined;
let chosenRank: Rank | null = null;
let claimChoices: HTMLElement;
let selectionFeedback: HTMLElement;
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

const name = (id: string | null) => id ? context.nickname(id) : "Player";
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
    <div class="bs-claim-choice">
      <span>Welke rank claim je?</span>
      <div class="bs-claim-options" role="group" aria-label="Kies je claimed rank"></div>
    </div>
    <p class="bs-selection-feedback" aria-live="polite"></p>
    <div class="row bs-hand-heading">
      <strong class="bs-hand-label">Your hand</strong>
      <button type="button" class="bs-play">Play cards</button>
    </div>
    <div class="bs-hand" aria-label="Your private hand"></div>
    <p class="bs-help">Selecteer je echte kaarten en kies je claim. De kaarten mogen afwijken van je claim — bluffen mag.</p>
  `;
  const find = <T extends HTMLElement>(selector: string) => ctx.container.querySelector<T>(selector)!;
  claimChoices = find(".bs-claim-options"); selectionFeedback = find(".bs-selection-feedback");
  players = find<HTMLUListElement>(".bs-players");
  pile = find(".bs-pile"); claim = find(".bs-claim"); feedback = find(".bs-feedback"); reveal = find(".bs-reveal");
  hand = find(".bs-hand"); play = find<HTMLButtonElement>(".bs-play"); challenge = find<HTMLButtonElement>(".bs-call");
  progress = find<HTMLProgressElement>("progress"); countdown = find(".bs-countdown"); handLabel = find(".bs-hand-label");
  play.addEventListener("click", () => {
    if (!current || selected.size < current.minimumPlayCount || !chosenRank || !current.allowedClaimRanks.includes(chosenRank)) return;
    ctx.sendMove({ type: "playCards", cardIds: [...selected], claimedRank: chosenRank, playVersion: current.version, roundId: current.roundId });
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
  if (current?.roundId !== state.roundId || current?.version !== state.version) {
    if (current?.roundId !== state.roundId) selected.clear();
    chosenRank = state.allowedClaimRanks.includes(state.claimedRank) ? state.claimedRank : null;
  }
  if (current !== state) offset = state.serverNow - Date.now();
  current = state; context = ctx;
  for (const id of selected) if (!state.myHand.some(card => card.id === id)) selected.delete(id);
  const myTurn = state.phase === "TURN" && state.turn === ctx.playerId;
  claimChoices.replaceChildren();
  for (const rank of state.allowedClaimRanks) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary bs-rank" + (rank === state.claimedRank ? " bs-previous-rank" : "");
    button.textContent = rank;
    button.setAttribute("aria-label", "Claim " + rank);
    button.setAttribute("aria-pressed", String(chosenRank === rank));
    button.title = rank === state.claimedRank ? "Vorige claim / beginrank" : "Toegestane aangrenzende rank";
    button.disabled = !myTurn;
    button.addEventListener("click", () => {
      chosenRank = rank;
      for (const choice of claimChoices.querySelectorAll("button")) choice.setAttribute("aria-pressed", String(choice === button));
      updatePlayButton(myTurn);
    });
    claimChoices.append(button);
  }
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
      ? (myTurn ? "Jouw beurt" : name(state.turn) + " is aan zet") + " — speel minimaal " + state.minimumPlayCount + " kaart(en), claim " + state.allowedClaimRanks.join(" / ") + (!online(state.turn!) ? " · waiting for reconnect" : "")
      : state.phase === "CHALLENGE_WINDOW" ? "Do you believe " + name(state.lastPlay!.playerId) + "?"
      : "Checking the last play…");
  }
  pile.replaceChildren(renderCard(null));
  const count = document.createElement("strong");
  count.className = "bs-pile-count"; count.textContent = state.pileCount + " cards in pile"; pile.append(count);
  pile.classList.toggle("bs-played", state.phase === "CHALLENGE_WINDOW");
  claim.textContent = state.lastPlay
    ? name(state.lastPlay.playerId) + " played " + state.lastPlay.count + " card(s), claiming " + state.lastPlay.rank
    : "Nieuwe slag — minimaal 1 kaart; claim K, A of 2."
  reveal.replaceChildren();
  feedback.textContent = "";
  if (state.phase === "RESOLVING_CHALLENGE" && state.reveal) {
    for (const card of state.reveal.cards) reveal.append(renderCard(card));
    feedback.textContent = name(state.reveal.challengerId) +
      (state.reveal.automatic ? " riep automatisch Bullshit: te weinig kaarten om de vorige zet te evenaren. " : " called Bullshit! ") +
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
    button.append(renderCard(card, { className: selected.has(card.id) ? "bs-selected" : "" }));
    button.addEventListener("click", () => {
      if (selected.has(card.id)) selected.delete(card.id); else selected.add(card.id);
      button.setAttribute("aria-pressed", String(selected.has(card.id)));
      button.firstElementChild!.classList.toggle("bs-selected", selected.has(card.id));
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
  if (!current) return;
  const enoughCards = selected.size >= current.minimumPlayCount;
  const validClaim = chosenRank !== null && current.allowedClaimRanks.includes(chosenRank);
  play.disabled = !myTurn || !enoughCards || !validClaim;
  play.textContent = "Speel " + (selected.size || "") + " kaart" + (selected.size === 1 ? "" : "en") + " · claim " + (chosenRank ?? "…");
  selectionFeedback.textContent = current.phase === "TURN"
    ? (!myTurn ? "Volgende zet: minimaal " + current.minimumPlayCount + " kaart(en)." : !enoughCards ? "Je moet minstens " + current.minimumPlayCount + " kaart(en) spelen. " + selected.size + " geselecteerd."
      : !validClaim ? "Je kunt alleen " + current.allowedClaimRanks.join(", ") + " claimen."
      : selected.size + " kaarten geselecteerd; je claimt " + chosenRank + ".")
    : "";
}

function onRoomState(ctx: GameContext): void {
  if (current) update(current, ctx);
}

export default { mount, update, onRoomState } satisfies GamePage<BullshitView>;
