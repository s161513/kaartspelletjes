import { RANK_VALUES, type Rank, type GameContext, type GamePage } from "@app/shared";
import { renderCard } from "../_ui/cards.js";
import { effectiveRank, hasLegalFollow, sortForDisplay, TURN_MS } from "./rules.js";
import type { PresidentenView } from "./types.js";
import "./style.css";

const selected = new Set<string>();
let current: PresidentenView | undefined;
let context: GameContext;
let offset = 0; // serverNow - Date.now(), to sync the countdown to the server clock
let timer: ReturnType<typeof setInterval>;

let players: HTMLUListElement;
let pile: HTMLElement;
let info: HTMLElement;
let countdown: HTMLElement;
let progress: HTMLProgressElement;
let timeText: HTMLElement;
let hand: HTMLElement;
let handLabel: HTMLElement;
let playBtn: HTMLButtonElement;
let passBtn: HTMLButtonElement;

const name = (id: string | null) => (id ? context.nickname(id) : "Player");
const online = (id: string) => context.players?.find((p) => p.id === id)?.connected !== false;

function mount(ctx: GameContext): void {
  context = ctx;
  ctx.container.classList.add("pr-game");
  ctx.container.innerHTML = `
    <ul class="players pr-players"></ul>
    <section class="pr-table" aria-label="Playing table">
      <div class="pr-pile"></div>
      <p class="pr-info" aria-live="polite"></p>
      <div class="pr-countdown">
        <progress max="${TURN_MS}" value="0" aria-label="Time left this turn"></progress>
        <span class="pr-time"></span>
      </div>
    </section>
    <div class="row pr-hand-heading">
      <strong class="pr-hand-label">Your hand</strong>
      <div class="pr-actions">
        <button type="button" class="pr-pass secondary">Pass</button>
        <button type="button" class="pr-play">Play</button>
      </div>
    </div>
    <div class="pr-hand" aria-label="Your private hand"></div>
    <p class="pr-help">A 2 is wild and must be played with another card whose rank it copies.
      Four of a rank in a row burns the pile. You cannot finish on a 2.</p>
  `;
  const find = <T extends HTMLElement>(selector: string) => ctx.container.querySelector<T>(selector)!;
  players = find<HTMLUListElement>(".pr-players");
  pile = find(".pr-pile");
  info = find(".pr-info");
  countdown = find(".pr-countdown");
  progress = find<HTMLProgressElement>("progress");
  timeText = find(".pr-time");
  hand = find(".pr-hand");
  handLabel = find(".pr-hand-label");
  playBtn = find<HTMLButtonElement>(".pr-play");
  passBtn = find<HTMLButtonElement>(".pr-pass");

  playBtn.addEventListener("click", () => {
    if (playBtn.disabled) return;
    ctx.sendMove({ type: "play", cardIds: [...selected] });
  });
  passBtn.addEventListener("click", () => {
    if (passBtn.disabled) return;
    ctx.sendMove({ type: "pass" });
  });
  timer = setInterval(updateTimer, 200);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
}

function updateTimer(): void {
  if (!current || current.phase === "GAME_OVER" || current.deadline === null) {
    countdown.hidden = true;
    return;
  }
  countdown.hidden = false;
  const remaining = Math.max(0, current.deadline - (Date.now() + offset));
  progress.value = remaining;
  const mine = current.turn === context.playerId;
  timeText.textContent = `${Math.ceil(remaining / 1000)}s${mine ? " — your turn" : ""}`;
}

/** Can the current selection be legally played right now? Returns a reason if not. */
function selectionProblem(state: PresidentenView): string | null {
  if (!selected.size) return "Select cards to play";
  const cards = state.myHand.filter((c) => selected.has(c.id));
  const eff = effectiveRank(cards);
  if (!eff.ok) return eff.error;
  if (state.currentCount !== null) {
    if (cards.length < state.currentCount) {
      return `You must play at least ${state.currentCount} card(s)`;
    }
    const minValue = state.currentRank ? RANK_VALUES[state.currentRank as Rank] : 0;
    if (eff.group.value < minValue) return "You must play an equal or higher rank";
  }
  if (cards.length === state.myHand.length && cards.some((c) => c.rank === "2")) {
    return "You cannot finish on a 2";
  }
  return null;
}

function update(state: PresidentenView, ctx: GameContext): void {
  if (current?.version !== state.version) selected.clear();
  current = state;
  context = ctx;
  offset = state.serverNow - Date.now();
  for (const id of [...selected]) if (!state.myHand.some((c) => c.id === id)) selected.delete(id);
  const myTurn = state.phase !== "GAME_OVER" && state.turn === ctx.playerId;
  const minValue = state.currentRank ? RANK_VALUES[state.currentRank as Rank] : 0;
  const stuck = myTurn && state.currentCount !== null
    && !hasLegalFollow(state.myHand, state.currentCount, minValue);

  // Players
  players.replaceChildren();
  for (const p of state.players) {
    const li = document.createElement("li");
    li.classList.toggle("pr-active", p.id === state.turn && state.phase !== "GAME_OVER");
    const label = document.createElement("span");
    label.textContent = name(p.id) + (p.id === ctx.playerId ? " (you)" : "");
    const badge = document.createElement("span");
    badge.className = "badge" + (online(p.id) ? "" : " off");
    badge.textContent = p.finishPlace
      ? (p.finishPlace === 1 ? "President" : `#${p.finishPlace} out`)
      : `${p.cardCount} cards` + (online(p.id) ? "" : " · away");
    li.append(label, badge);
    players.append(li);
  }

  // Pile / current trick
  pile.replaceChildren();
  if (state.pileTop && state.pileTop.length) {
    for (const card of state.pileTop) pile.append(renderCard(card));
  } else {
    pile.append(renderCard(null));
  }
  const count = document.createElement("strong");
  count.className = "pr-pile-count";
  count.textContent = state.pileCount ? `${state.pileCount} cards on the pile` : "Fresh trick";
  pile.append(count);

  // Status + info line
  if (state.phase === "GAME_OVER") {
    info.className = "pr-info pr-winner";
    info.textContent = `${name(state.winner)} is President! Return to the lobby for another round.`;
  } else {
    info.className = "pr-info";
    const need = stuck
      ? "no legal play — pass or you'll be skipped"
      : state.currentCount === null
        ? "lead with any card(s)"
        : `match ${state.currentCount} card(s), beat ${state.currentRank}`;
    info.textContent = myTurn
      ? `Your turn — ${need}.`
      : `${name(state.turn)} is to play` + (online(state.turn!) ? "" : " · waiting for reconnect");
    ctx.setStatus(myTurn ? "Your turn" : `${name(state.turn)} to play`);
  }

  // Hand
  handLabel.textContent = `Your hand · ${state.myHand.length} cards · only visible to you`;
  hand.replaceChildren();
  for (const card of sortForDisplay(state.myHand)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pr-card-button";
    button.setAttribute("aria-label", `${card.rank} ${card.suit}`);
    button.setAttribute("aria-pressed", String(selected.has(card.id)));
    button.disabled = !myTurn;
    button.append(renderCard(card, { className: selected.has(card.id) ? "pr-selected" : "" }));
    button.addEventListener("click", () => {
      if (selected.has(card.id)) selected.delete(card.id);
      else selected.add(card.id);
      button.setAttribute("aria-pressed", String(selected.has(card.id)));
      button.firstElementChild!.classList.toggle("pr-selected", selected.has(card.id));
      refreshActions(myTurn);
    });
    hand.append(button);
  }
  if (!state.myHand.length) {
    const self = state.players.find((p) => p.id === ctx.playerId);
    const empty = document.createElement("p");
    empty.textContent = self?.finishPlace
      ? (self.finishPlace === 1 ? "You are President!" : `You finished #${self.finishPlace}.`)
      : "Hand empty.";
    hand.append(empty);
  }

  refreshActions(myTurn);
  updateTimer();
}

function refreshActions(myTurn: boolean): void {
  if (!current) return;
  const problem = selectionProblem(current);
  playBtn.disabled = !myTurn || problem !== null;
  playBtn.textContent = selected.size ? `Play ${selected.size}` : "Play";
  // Pass is always available on your turn — a leading pass just rotates the lead.
  passBtn.disabled = !myTurn;
}

function onRoomState(ctx: GameContext): void {
  if (current) update(current, ctx);
}

export default { mount, update, onRoomState } satisfies GamePage<PresidentenView>;
