import { RANK_VALUES, type Card, type Rank, type GameContext, type GamePage } from "@app/shared";
import { renderCard } from "../_ui/cards.js";
import {
  effectiveRank, hasLegalFollow, REQUEST_RANKS, ROLE_LABEL, sortForDisplay, TURN_MS,
} from "./rules.js";
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
let lastTrickEl: HTMLElement;
let countdown: HTMLElement;
let progress: HTMLProgressElement;
let timeText: HTMLElement;
let hand: HTMLElement;
let handLabel: HTMLElement;
let playBtn: HTMLButtonElement;
let passBtn: HTMLButtonElement;
let overlay: HTMLElement;
let overlayTitle: HTMLElement;
let overlayMsg: HTMLElement;
let ranks: HTMLElement;
let overlayHand: HTMLElement;

const name = (id: string | null) => (id ? context.nickname(id) : "Player");
const online = (id: string) => context.players?.find((p) => p.id === id)?.connected !== false;

function mount(ctx: GameContext): void {
  context = ctx;
  document.body.classList.add("presidenten-wide");
  ctx.container.classList.add("pr-game");
  ctx.container.innerHTML = `
    <ul class="players pr-players"></ul>
    <section class="pr-table" aria-label="Playing table">
      <aside class="pr-last-trick" aria-label="Last trick" hidden></aside>
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
      Four of a rank in a row burns the pile.</p>
    <div class="pr-overlay" hidden>
      <div class="pr-overlay-panel">
        <p class="pr-overlay-title"></p>
        <p class="pr-overlay-msg"></p>
        <div class="pr-ranks" aria-label="Ranks you can ask for"></div>
        <div class="pr-overlay-hand" aria-label="Your cards"></div>
      </div>
    </div>
  `;
  const find = <T extends HTMLElement>(selector: string) => ctx.container.querySelector<T>(selector)!;
  players = find<HTMLUListElement>(".pr-players");
  pile = find(".pr-pile");
  info = find(".pr-info");
  lastTrickEl = find(".pr-last-trick");
  countdown = find(".pr-countdown");
  progress = find<HTMLProgressElement>("progress");
  timeText = find(".pr-time");
  hand = find(".pr-hand");
  handLabel = find(".pr-hand-label");
  playBtn = find<HTMLButtonElement>(".pr-play");
  passBtn = find<HTMLButtonElement>(".pr-pass");
  overlay = find(".pr-overlay");
  overlayTitle = find(".pr-overlay-title");
  overlayMsg = find(".pr-overlay-msg");
  ranks = find(".pr-ranks");
  overlayHand = find(".pr-overlay-hand");

  // The rank picker is fixed (3 … A, then 2); wire each button once. Each looks
  // like a playing card but shows only the rank — no suit, since you are guessing.
  for (const r of REQUEST_RANKS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pr-rank-btn";
    b.dataset.rank = r;
    b.setAttribute("aria-label", `Ask for a ${r}`);
    const face = document.createElement("div");
    face.className = "ui-card pr-rank-card";
    const rankEl = document.createElement("span");
    rankEl.className = "pr-rank-face";
    rankEl.textContent = r;
    face.append(rankEl);
    b.append(face);
    b.addEventListener("click", () => {
      if (!b.disabled) context.sendMove({ type: "request", rank: r });
    });
    ranks.append(b);
  }

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
  if (!current || current.phase !== "PLAY" || current.deadline === null) {
    countdown.hidden = true;
    return;
  }
  countdown.hidden = false;
  const remaining = Math.max(0, current.deadline - (Date.now() + offset));
  progress.value = remaining;
  const mine = current.turn === context.playerId;
  timeText.textContent = `${Math.ceil(remaining / 1000)}s${mine ? " — your turn" : ""}`;
}

/** A card button, used by the inline hand and the exchange give-back picker. */
function buildCardButton(
  card: Card,
  opts: { disabled?: boolean; selected?: boolean; dim?: boolean; onClick?: () => void },
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pr-card-button" + (opts.dim ? " pr-dim" : "");
  button.setAttribute("aria-label", `${card.rank} ${card.suit}`);
  button.setAttribute("aria-pressed", String(!!opts.selected));
  button.disabled = !!opts.disabled;
  button.append(renderCard(card, { className: opts.selected ? "pr-selected" : "" }));
  if (opts.onClick) button.addEventListener("click", () => { if (!button.disabled) opts.onClick!(); });
  return button;
}

/** Ids of cards that could be part of *some* legal play this turn. */
function playableCardIds(state: PresidentenView): Set<string> {
  const minCount = state.currentCount ?? 1;
  const minValue = state.currentRank ? RANK_VALUES[state.currentRank as Rank] : 0;
  const twos = state.myHand.filter((c) => c.rank === "2").length;
  const byValue = new Map<number, string[]>();
  for (const c of state.myHand) {
    if (c.rank === "2") continue;
    const v = RANK_VALUES[c.rank];
    const list = byValue.get(v) ?? byValue.set(v, []).get(v)!;
    list.push(c.id);
  }
  const ok = new Set<string>();
  let anyRankUsable = false;
  for (const [v, ids] of byValue) {
    if (v < minValue) continue; // too low to beat the table
    if (ids.length + twos < minCount) continue; // can't reach the required count
    for (const cid of ids) ok.add(cid);
    anyRankUsable = true;
  }
  // Wild 2s are only useful if there is a real rank to pair them with.
  if (anyRankUsable) for (const c of state.myHand) if (c.rank === "2") ok.add(c.id);
  return ok;
}

/** A group is one non-2 rank plus wild 2s, so once a rank is picked only it (and 2s) stay open. */
function selectionCompatible(card: Card, selectedCards: Card[]): boolean {
  const pickedRanks = new Set(selectedCards.filter((c) => c.rank !== "2").map((c) => c.rank));
  if (pickedRanks.size === 0) return true;
  if (card.rank === "2") return true;
  return pickedRanks.has(card.rank);
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
  return null;
}

/** Draw the inline hand: interactive with grey-out on your turn, read-only otherwise. */
function renderHand(state: PresidentenView, myTurn: boolean): void {
  const playable = myTurn ? playableCardIds(state) : null;
  const selectedCards = state.myHand.filter((c) => selected.has(c.id));
  hand.replaceChildren();
  for (const card of sortForDisplay(state.myHand)) {
    if (myTurn) {
      const isSel = selected.has(card.id);
      const enabled = isSel || (playable!.has(card.id) && selectionCompatible(card, selectedCards));
      hand.append(buildCardButton(card, {
        disabled: !enabled,
        selected: isSel,
        dim: !enabled,
        onClick: () => {
          if (selected.has(card.id)) selected.delete(card.id);
          else selected.add(card.id);
          renderHand(state, true);
          refreshActions(true);
        },
      }));
    } else {
      hand.append(buildCardButton(card, { disabled: true }));
    }
  }
  if (!state.myHand.length) {
    const self = state.players.find((p) => p.id === context.playerId);
    const empty = document.createElement("p");
    empty.textContent = self?.finishPlace
      ? (self.finishPlace === 1 ? "You are out first — President!" : `You finished #${self.finishPlace}.`)
      : "Hand empty.";
    hand.append(empty);
  }
}

function update(state: PresidentenView, ctx: GameContext): void {
  if (current?.version !== state.version) selected.clear();
  current = state;
  context = ctx;
  offset = state.serverNow - Date.now();
  for (const id of [...selected]) if (!state.myHand.some((c) => c.id === id)) selected.delete(id);

  const ex = state.exchange;
  const inExchange = state.phase === "EXCHANGE" && ex !== null;
  const myExchange = inExchange && ex!.activeWinner === ctx.playerId;
  const myTurn = state.phase === "PLAY" && state.turn === ctx.playerId;
  const minValue = state.currentRank ? RANK_VALUES[state.currentRank as Rank] : 0;
  const stuck = myTurn && state.currentCount !== null
    && !hasLegalFollow(state.myHand, state.currentCount, minValue);

  // Last trick (top-right corner)
  if (state.lastTrick && state.lastTrick.cards.length) {
    lastTrickEl.hidden = false;
    lastTrickEl.replaceChildren();
    const title = document.createElement("div");
    title.className = "pr-lt-title";
    title.textContent = "Last trick";
    const who = document.createElement("div");
    who.className = "pr-lt-who";
    who.textContent = `${name(state.lastTrick.by)} won with`;
    const row = document.createElement("div");
    row.className = "pr-lt-cards";
    for (const card of state.lastTrick.cards) row.append(renderCard(card));
    lastTrickEl.append(title, who, row);
  } else {
    lastTrickEl.hidden = true;
    lastTrickEl.replaceChildren();
  }

  // Players
  players.replaceChildren();
  for (const p of state.players) {
    const li = document.createElement("li");
    li.classList.toggle("pr-active", p.id === state.turn && state.phase !== "GAME_OVER");
    const label = document.createElement("span");
    label.textContent = name(p.id) + (p.id === ctx.playerId ? " (you)" : "");
    const badge = document.createElement("span");
    badge.className = "badge" + (online(p.id) ? "" : " off");
    const roleTag = p.role ? ROLE_LABEL[p.role] : null;
    if (state.phase !== "PLAY" && p.finishPlace) {
      badge.textContent = roleTag ?? `#${p.finishPlace}`;
    } else {
      badge.textContent = (roleTag ? `${roleTag} · ` : "") + `${p.cardCount} cards`
        + (online(p.id) ? "" : " · away");
    }
    li.append(label, badge);
    players.append(li);
  }

  // Pile / current trick (hidden during the exchange)
  pile.replaceChildren();
  if (!inExchange) {
    if (state.pileTop && state.pileTop.length) {
      for (const card of state.pileTop) pile.append(renderCard(card));
    } else {
      pile.append(renderCard(null));
    }
    const count = document.createElement("strong");
    count.className = "pr-pile-count";
    count.textContent = state.pileCount ? `${state.pileCount} cards on the pile` : "Fresh trick";
    pile.append(count);
  }

  // Status + info line
  if (state.phase === "GAME_OVER") {
    info.className = "pr-info pr-winner";
    info.textContent = `${name(state.winner)} wins! Not enough players to deal another hand.`;
    ctx.setStatus("Game over");
  } else if (inExchange) {
    info.className = "pr-info";
    info.textContent =
      `Card exchange — ${name(ex!.activeWinner)} ↔ ${name(ex!.loser)} (${ex!.done + 1}/${ex!.total})`;
    ctx.setStatus(myExchange ? "Your exchange" : "Card exchange");
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

  // Exchange popup (shown to everyone; the board dims behind it)
  overlay.hidden = !inExchange;
  if (inExchange) {
    const activeRequest = myExchange && ex!.step === "request";
    const activeGiveBack = myExchange && ex!.step === "giveBack";
    overlayTitle.textContent =
      `Card exchange — ${name(ex!.activeWinner)} ↔ ${name(ex!.loser)} (${ex!.done + 1}/${ex!.total})`;
    if (activeRequest) {
      overlayMsg.textContent = ex!.lastMiss
        ? `${name(ex!.loser)} has no ${ex!.lastMiss} — ask for another rank.`
        : `Ask ${name(ex!.loser)} for a rank they might have:`;
    } else if (activeGiveBack) {
      overlayMsg.textContent = `Pick one of your cards to give back to ${name(ex!.loser)}.`;
    } else {
      overlayMsg.textContent = `${name(ex!.activeWinner)} is swapping a card with ${name(ex!.loser)}…`;
    }
    ranks.hidden = !activeRequest;
    for (const b of Array.from(ranks.children) as HTMLButtonElement[]) b.disabled = !activeRequest;
    overlayHand.hidden = !activeGiveBack;
    overlayHand.replaceChildren();
    if (activeGiveBack) {
      for (const card of sortForDisplay(state.myHand)) {
        overlayHand.append(buildCardButton(card, {
          onClick: () => context.sendMove({ type: "giveBack", cardId: card.id }),
        }));
      }
    }
  }

  // Inline hand + actions (normal play)
  handLabel.textContent = `Your hand · ${state.myHand.length} cards · only visible to you`;
  renderHand(state, myTurn);
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
