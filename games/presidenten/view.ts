import { RANK_VALUES, type Card, type Rank, type GameContext, type GamePage } from "@app/shared";
import { renderCard } from "../_ui/cards.js";
import {
  effectiveRank, hasLegalFollow, REQUEST_RANKS, ROLE_LABEL, sortForDisplay, TURN_MS,
} from "./rules.js";
import type { PresidentenView } from "./types.js";
import "./style.css";

const selected = new Set<string>();
let current: PresidentenView | undefined;
let latest: PresidentenView | undefined; // for deferred re-renders during a sweep
let context: GameContext;
let root: HTMLElement;
let offset = 0; // serverNow - Date.now(), to sync the countdown to the server clock
let timer: ReturnType<typeof setInterval>;

// Animation bookkeeping.
const THROW_MS = 380;
const SHOW_MS = 800;
const SWEEP_MS = 450;
let seenHand = new Set<string>(); // card ids already dealt in, so only new ones animate
let shownTopKey = ""; // the group currently shown on the pile, to fly in only new plays
let shownTrickKey = ""; // the last swept trick, so each win sweeps once
let sweepUntil = 0; // board re-render waits until a sweep has finished
let sweepWinner: string | null = null;
let deferredRender: ReturnType<typeof setTimeout> | undefined;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let seatsEl: HTMLElement;
let trickEl: HTMLElement;
let sweepEl: HTMLElement;
let lastTrickEl: HTMLElement;
let info: HTMLElement;
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

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function mount(ctx: GameContext): void {
  context = ctx;
  document.body.classList.add("presidenten-wide");
  ctx.container.classList.add("pr-game");
  ctx.container.innerHTML = `
    <div class="pr-table-wrap">
      <div class="pr-rail"><div class="pr-felt">
        <div class="pr-seats"></div>
        <div class="pr-trick" aria-hidden="true"></div>
        <div class="pr-sweep" aria-hidden="true"></div>
        <aside class="pr-last-trick" aria-label="Last trick" hidden></aside>
        <p class="pr-info" aria-live="polite"></p>
      </div></div>
    </div>
    <div class="pr-countdown">
      <progress max="${TURN_MS}" value="0" aria-label="Time left this turn"></progress>
      <span class="pr-time"></span>
    </div>
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
  root = ctx.container;
  const find = <T extends HTMLElement>(selector: string) => ctx.container.querySelector<T>(selector)!;
  seatsEl = find(".pr-seats");
  trickEl = find(".pr-trick");
  sweepEl = find(".pr-sweep");
  lastTrickEl = find(".pr-last-trick");
  info = find(".pr-info");
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
    const face = el("div", "ui-card pr-rank-card");
    face.append(el("span", "pr-rank-face", r));
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
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    clearTimeout(deferredRender);
  }, { once: true });
}

// ---------------------------------------------------------------------------
// Seating, the trick, and card motion (adapted from games/hartenjagen)
// ---------------------------------------------------------------------------

/** Unit-circle position of a player around the felt; you sit at the bottom. */
function seatVector(state: PresidentenView, id: string): { x: number; y: number } {
  const ids = state.players.map((p) => p.id);
  const n = ids.length;
  const offset = Math.max(0, ids.indexOf(context.playerId));
  const k = (ids.indexOf(id) - offset + n) % n;
  const angle = Math.PI / 2 + (k / n) * 2 * Math.PI;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const seatRect = (id: string): DOMRect | undefined =>
  root.querySelector(`.pr-seat[data-player-id="${CSS.escape(id)}"] .pr-plate`)?.getBoundingClientRect();

function renderSeats(state: PresidentenView): void {
  seatsEl.replaceChildren();
  for (const p of state.players) {
    const { x, y } = seatVector(state, p.id);
    const seat = el("div", "pr-seat");
    seat.dataset.playerId = p.id;
    seat.style.setProperty("--x", x.toFixed(4));
    seat.style.setProperty("--y", y.toFixed(4));
    seat.classList.toggle("is-me", p.id === context.playerId);
    seat.classList.toggle("is-turn", p.id === state.turn && state.phase !== "GAME_OVER");
    seat.classList.toggle("is-passed", p.passed && state.phase === "PLAY");
    seat.classList.toggle("is-winner", p.id === sweepWinner);
    seat.classList.toggle("away", !online(p.id));

    const plate = el("div", "pr-plate");
    plate.append(el("div", "pr-avatar", name(p.id).charAt(0).toUpperCase()));
    const infoBox = el("div", "pr-seat-info");
    infoBox.append(el("div", "pr-seat-name", name(p.id) + (p.id === context.playerId ? " (you)" : "")));
    const roleTag = p.role ? ROLE_LABEL[p.role] : null;
    const sub = p.finishPlace && state.phase !== "PLAY"
      ? (roleTag ?? `#${p.finishPlace}`)
      : (roleTag ? `${roleTag} · ` : "") + `${p.cardCount} cards`;
    infoBox.append(el("div", "pr-seat-sub", sub));
    plate.append(infoBox);
    seat.append(plate);

    const meta = el("div", "pr-seat-meta");
    if (p.id !== context.playerId && p.cardCount > 0) {
      const backs = el("div", "pr-backs");
      for (let i = 0; i < Math.min(p.cardCount, 4); i++) backs.append(renderCard(null));
      backs.append(el("span", "pr-count", String(p.cardCount)));
      meta.append(backs);
    }
    if (p.passed && state.phase === "PLAY") meta.append(el("span", "pr-seat-tag", "passed"));
    if (!online(p.id)) meta.append(el("span", "pr-seat-tag", "away"));
    seat.append(meta);
    seatsEl.append(seat);
  }
}

/** The current top group, laid towards the player who played it; new plays fly in. */
function renderTrick(state: PresidentenView): void {
  trickEl.replaceChildren();
  const top = state.phase === "PLAY" && state.pileTop && state.pileTop.length ? state.pileTop : null;
  if (!top) { shownTopKey = ""; return; }

  const v = state.topBy ? seatVector(state, state.topBy) : { x: 0, y: 0 };
  const group = el("div", "pr-played");
  group.style.setProperty("--x", v.x.toFixed(4));
  group.style.setProperty("--y", v.y.toFixed(4));
  for (const card of top) group.append(renderCard(card));
  trickEl.append(group);

  const key = top.map((c) => c.id).join(",");
  if (key !== shownTopKey) {
    const fly = !reducedMotion() && state.topBy ? seatRect(state.topBy) : undefined;
    if (fly) {
      const a = centre(fly);
      const b = centre(group.getBoundingClientRect());
      group.animate(
        [
          { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(0.6) rotate(-16deg)`, opacity: 0.4 },
          { transform: "none", opacity: 1 },
        ],
        { duration: THROW_MS, easing: "cubic-bezier(0.2, 0.8, 0.25, 1)" },
      );
    }
    shownTopKey = key;
  }
}

/** A trick just resolved: show the winning cards, then sweep them to the winner. */
function sweepTrick(state: PresidentenView): void {
  const lt = state.lastTrick;
  if (!lt) return;
  trickEl.replaceChildren();
  sweepEl.replaceChildren();

  const v = seatVector(state, lt.by);
  const group = el("div", "pr-played is-winning");
  group.style.setProperty("--x", v.x.toFixed(4));
  group.style.setProperty("--y", v.y.toFixed(4));
  for (const card of lt.cards) group.append(renderCard(card));
  sweepEl.append(group);

  const show = reducedMotion() ? 500 : SHOW_MS;
  sweepWinner = lt.by;
  sweepUntil = Date.now() + show + SWEEP_MS;
  window.setTimeout(() => {
    const target = seatRect(lt.by);
    if (!reducedMotion() && target) {
      const t = centre(target);
      const b = centre(group.getBoundingClientRect());
      group.animate(
        [
          { transform: "none", opacity: 1 },
          { transform: `translate(${t.x - b.x}px, ${t.y - b.y}px) scale(0.3)`, opacity: 0 },
        ],
        { duration: SWEEP_MS - 60, easing: "cubic-bezier(0.55, 0, 0.75, 0.2)", fill: "forwards" },
      );
    }
    window.setTimeout(() => sweepEl.replaceChildren(), SWEEP_MS);
  }, show);
}

/** Seats + trick; waits while a finished trick is still sweeping to its winner. */
function renderBoard(state: PresidentenView): void {
  clearTimeout(deferredRender);
  const wait = sweepUntil - Date.now();
  if (wait > 0) {
    deferredRender = setTimeout(() => latest && renderBoard(latest), wait);
    return;
  }
  sweepWinner = null;
  renderSeats(state);
  renderTrick(state);
}

function renderLastTrickCorner(state: PresidentenView): void {
  if (state.lastTrick && state.lastTrick.cards.length) {
    lastTrickEl.hidden = false;
    lastTrickEl.replaceChildren();
    lastTrickEl.append(el("div", "pr-lt-title", "Last trick"));
    lastTrickEl.append(el("div", "pr-lt-who", `${name(state.lastTrick.by)} won with`));
    const row = el("div", "pr-lt-cards");
    for (const card of state.lastTrick.cards) row.append(renderCard(card));
    lastTrickEl.append(row);
  } else {
    lastTrickEl.hidden = true;
    lastTrickEl.replaceChildren();
  }
}

// ---------------------------------------------------------------------------
// Your hand + actions
// ---------------------------------------------------------------------------

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
  opts: { disabled?: boolean; selected?: boolean; dim?: boolean; isNew?: boolean; onClick?: () => void },
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pr-card-button" + (opts.dim ? " pr-dim" : "");
  button.setAttribute("aria-label", `${card.rank} ${card.suit}`);
  button.setAttribute("aria-pressed", String(!!opts.selected));
  button.disabled = !!opts.disabled;
  button.append(renderCard(card, { className: opts.selected ? "pr-selected" : "", isNew: opts.isNew }));
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
    const isNew = !seenHand.has(card.id);
    seenHand.add(card.id);
    if (myTurn) {
      const isSel = selected.has(card.id);
      const enabled = isSel || (playable!.has(card.id) && selectionCompatible(card, selectedCards));
      hand.append(buildCardButton(card, {
        disabled: !enabled,
        selected: isSel,
        dim: !enabled,
        isNew,
        onClick: () => {
          if (selected.has(card.id)) selected.delete(card.id);
          else selected.add(card.id);
          renderHand(state, true);
          refreshActions(true);
        },
      }));
    } else {
      hand.append(buildCardButton(card, { disabled: true, isNew }));
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

function renderOverlay(state: PresidentenView, inExchange: boolean, myExchange: boolean): void {
  overlay.hidden = !inExchange;
  if (!inExchange) return;
  const ex = state.exchange!;
  const activeRequest = myExchange && ex.step === "request";
  const activeGiveBack = myExchange && ex.step === "giveBack";
  overlayTitle.textContent =
    `Card exchange — ${name(ex.activeWinner)} ↔ ${name(ex.loser)} (${ex.done + 1}/${ex.total})`;
  if (activeRequest) {
    overlayMsg.textContent = ex.lastMiss
      ? `${name(ex.loser)} has no ${ex.lastMiss} — ask for another rank.`
      : `Ask ${name(ex.loser)} for a rank they might have:`;
  } else if (activeGiveBack) {
    overlayMsg.textContent = `Pick one of your cards to give back to ${name(ex.loser)}.`;
  } else {
    overlayMsg.textContent = `${name(ex.activeWinner)} is swapping a card with ${name(ex.loser)}…`;
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

function update(state: PresidentenView, ctx: GameContext): void {
  const roundChanged = current?.round !== state.round;
  const firstRender = current === undefined;
  if (current?.version !== state.version) selected.clear();
  current = state;
  latest = state;
  context = ctx;
  offset = state.serverNow - Date.now();
  for (const id of [...selected]) if (!state.myHand.some((c) => c.id === id)) selected.delete(id);
  if (roundChanged) { seenHand = new Set(); shownTopKey = ""; }

  const ex = state.exchange;
  const inExchange = state.phase === "EXCHANGE" && ex !== null;
  const myExchange = inExchange && ex!.activeWinner === ctx.playerId;
  const myTurn = state.phase === "PLAY" && state.turn === ctx.playerId;
  const minValue = state.currentRank ? RANK_VALUES[state.currentRank as Rank] : 0;
  const stuck = myTurn && state.currentCount !== null
    && !hasLegalFollow(state.myHand, state.currentCount, minValue);

  // A trick just resolved → sweep its cards to the winner before the board updates.
  const trickKey = state.lastTrick
    ? `${state.lastTrick.by}:${state.lastTrick.cards.map((c) => c.id).join(",")}`
    : "";
  if (!firstRender && !roundChanged && trickKey && trickKey !== shownTrickKey) {
    sweepTrick(state);
  }
  shownTrickKey = trickKey;

  renderBoard(state);
  renderLastTrickCorner(state);

  // Centre info line + host status
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
      : `${name(state.turn)} is to play` + (state.turn && !online(state.turn) ? " · waiting for reconnect" : "");
    ctx.setStatus(myTurn ? "Your turn" : `${name(state.turn)} to play`);
  }

  renderOverlay(state, inExchange, myExchange);

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
