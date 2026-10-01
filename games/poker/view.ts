import type { Card, GameContext, GamePage } from "@app/shared";
import { raiseBounds } from "./logic.js";
import type { PokerState, Seat } from "./types.js";
import html from "./view.html?raw";
import "./style.css";

// Poker table renderer. Static layout lives in view.html, all styling in
// style.css; this file fills in the parts that change with every state.

const SUIT_SYMBOL: Record<Card["suit"], string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

let root: HTMLElement;
const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

let latest: PokerState | null = null;
/** Card keys already on screen this hand, so only newly dealt cards animate. */
let seenCards = new Set<string>();
let seenHand = 0;

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function cardEl(card: Card | null, key: string): HTMLElement {
  const node = el("div", "poker-card");
  if (!seenCards.has(key)) {
    node.classList.add("is-new");
    seenCards.add(key);
  }
  if (!card) {
    node.classList.add("is-back");
    return node;
  }
  const symbol = SUIT_SYMBOL[card.suit];
  if (card.suit === "hearts" || card.suit === "diamonds") node.classList.add("is-red");
  const corner = el("span", "poker-card-corner");
  corner.append(el("span", "poker-card-rank", card.rank), el("span", "poker-card-suit", symbol));
  node.append(corner, el("span", "poker-card-pip", symbol));
  return node;
}

function chips(amount: number): string {
  return amount.toLocaleString("en-US");
}

const potSize = (s: PokerState) => s.seats.reduce((sum, seat) => sum + seat.totalBet, 0);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function renderSeats(state: PokerState, ctx: GameContext): void {
  const seatsEl = $(".poker-seats");
  seatsEl.innerHTML = "";

  // Rotate so this player sits at the bottom centre.
  const n = state.seats.length;
  const me = Math.max(0, state.seats.findIndex((s) => s.id === ctx.playerId));
  const winners = new Set(state.lastResult?.pots.flatMap((p) => p.winners) ?? []);

  state.seats.forEach((seat, i) => {
    const angle = Math.PI / 2 + (((i - me + n) % n) / n) * 2 * Math.PI;
    const x = Math.cos(angle);
    const y = Math.sin(angle);

    const node = el("div", "poker-seat");
    node.style.left = `${50 + 46 * x}%`;
    node.style.top = `${50 + 43 * y}%`;
    node.classList.toggle("is-me", seat.id === ctx.playerId);
    node.classList.toggle("is-turn", state.toAct === i);
    node.classList.toggle("is-folded", seat.folded && !seat.out);
    node.classList.toggle("is-out", seat.out);
    node.classList.toggle("is-winner", state.phase === "showdown" && winners.has(seat.id));

    const hole = el("div", "poker-hole");
    seat.hole.forEach((card, k) =>
      hole.append(cardEl(card, `${seat.id}-${k}-${card ? card.id : "back"}`)),
    );

    const name = ctx.nickname(seat.id);
    const plate = el("div", "poker-plate");
    const info = el("div", "poker-info");
    info.append(
      el("div", "poker-name", seat.id === ctx.playerId ? `${name} (you)` : name),
      el("div", "poker-stack", seat.out ? "Out" : chips(seat.chips)),
    );
    plate.append(el("div", "poker-avatar", name.charAt(0).toUpperCase()), info);
    if (i === state.dealer && !seat.out) plate.append(el("span", "poker-dealer", "D"));

    const tag = seatTag(state, seat, i);
    node.append(hole, plate);
    if (tag) node.append(el("div", `poker-tag poker-tag-${tag.kind}`, tag.text));
    seatsEl.append(node);

    if (seat.bet > 0) {
      const bet = el("div", "poker-bet");
      bet.style.left = `${50 + 29 * x}%`;
      bet.style.top = `${50 + 25 * y}%`;
      bet.append(el("span", "poker-chip"), el("span", "poker-bet-amount", chips(seat.bet)));
      seatsEl.append(bet);
    }
  });
}

function seatTag(
  state: PokerState,
  seat: Seat,
  i: number,
): { kind: string; text: string } | null {
  const shown = state.lastResult?.shown[seat.id];
  if (state.phase === "showdown" && shown) return { kind: "hand", text: shown };
  if (seat.out) return null;
  if (seat.folded) return { kind: "fold", text: "Fold" };
  if (seat.allIn) return { kind: "allin", text: "All-in" };
  if (state.phase === "preflop" && !seat.acted) {
    if (i === state.smallBlind) return { kind: "blind", text: "SB" };
    if (i === state.bigBlind) return { kind: "blind", text: "BB" };
  }
  return null;
}

function renderCenter(state: PokerState, ctx: GameContext): void {
  $(".poker-blinds").textContent =
    `Hand #${state.handNumber} · Blinds ${state.blinds.small}/${state.blinds.big}`;

  const board = $(".poker-board");
  board.innerHTML = "";
  for (let k = 0; k < 5; k++) {
    const card = state.board[k];
    board.append(card ? cardEl(card, `board-${card.id}`) : el("div", "poker-card is-slot"));
  }

  const pot = potSize(state);
  $(".poker-pot").hidden = pot === 0;
  $(".poker-pot-amount").textContent = `Pot ${chips(pot)}`;

  const banner = $(".poker-banner");
  const result = state.phase === "showdown" ? state.lastResult : null;
  banner.hidden = !result;
  banner.innerHTML = "";
  for (const pot of result?.pots ?? []) {
    if (!result!.uncontested && !pot.handName) continue; // uncalled bet returned
    const names = pot.winners.map((id) => ctx.nickname(id)).join(" & ");
    const verb = pot.winners.length > 1 ? "split" : "wins";
    const how = pot.handName ? ` with ${pot.handName}` : "";
    banner.append(el("div", "poker-banner-line", `${names} ${verb} ${chips(pot.amount)}${how}`));
  }
}

function renderLog(state: PokerState, ctx: GameContext): void {
  const list = $(".poker-log");
  list.innerHTML = "";
  for (const entry of [...state.log].reverse()) {
    const item = el("li", entry.who ? "" : "poker-log-table");
    if (entry.who) item.append(el("strong", "", `${ctx.nickname(entry.who)} `));
    item.append(entry.text);
    list.append(item);
  }
}

// ---------------------------------------------------------------------------
// Action bar
// ---------------------------------------------------------------------------

function raiseTarget(preset: string, state: PokerState, seat: Seat): number {
  const { min, max } = raiseBounds(state, seat);
  const toCall = state.currentBet - seat.bet;
  const potAfterCall = potSize(state) + toCall;
  const target =
    preset === "half" ? state.currentBet + Math.round(potAfterCall / 2)
    : preset === "pot" ? state.currentBet + potAfterCall
    : preset === "allin" ? max
    : min;
  return Math.max(min, Math.min(max, target));
}

function setRaise(value: number): void {
  const slider = $<HTMLInputElement>(".poker-slider");
  const amount = $<HTMLInputElement>(".poker-amount");
  const clamped = Math.max(Number(slider.min), Math.min(Number(slider.max), Math.round(value)));
  slider.value = String(clamped);
  amount.value = String(clamped);
  const isAllIn = clamped === Number(slider.max);
  const verb = latest && latest.currentBet === 0 ? "Bet" : "Raise to";
  $(".poker-btn-raise").textContent = isAllIn ? `All-in ${chips(clamped)}` : `${verb} ${chips(clamped)}`;
}

function renderActions(state: PokerState, ctx: GameContext): void {
  const actions = $(".poker-actions");
  const seatIndex = state.seats.findIndex((s) => s.id === ctx.playerId);
  const seat = state.seats[seatIndex];
  const showdown = state.phase === "showdown";
  const myTurn = !showdown && seat !== undefined && state.toAct === seatIndex;

  $(".poker-btn-next").hidden = !showdown;
  $(".poker-buttons").hidden = showdown;
  $(".poker-raise").hidden = true;
  actions.classList.toggle("is-active", myTurn || showdown);
  if (showdown || !seat) return;

  const toCall = state.currentBet - seat.bet;
  const callBtn = $<HTMLButtonElement>(".poker-btn-call");
  callBtn.textContent =
    toCall <= 0 ? "Check"
    : toCall >= seat.chips ? `Call ${chips(seat.chips)} · all-in`
    : `Call ${chips(toCall)}`;

  const { min, max } = raiseBounds(state, seat);
  const canRaise = myTurn && !seat.acted && max > state.currentBet;
  for (const btn of actions.querySelectorAll<HTMLButtonElement>(".poker-buttons button")) {
    btn.disabled = !myTurn;
  }
  const raiseBtn = $<HTMLButtonElement>(".poker-btn-raise");
  raiseBtn.disabled = !canRaise;
  if (!canRaise) {
    raiseBtn.textContent = state.currentBet === 0 ? "Bet" : "Raise";
    return;
  }

  $(".poker-raise").hidden = false;
  const slider = $<HTMLInputElement>(".poker-slider");
  slider.min = String(min);
  slider.max = String(max);
  slider.step = "1"; // any amount, so the slider can always reach all-in exactly
  setRaise(min);
}

function wireActions(ctx: GameContext): void {
  const send = (move: object) => ctx.sendMove(move);
  $(".poker-btn-fold").addEventListener("click", () => send({ type: "fold" }));
  $(".poker-btn-call").addEventListener("click", () => {
    if (!latest) return;
    const seat = latest.seats.find((s) => s.id === ctx.playerId);
    send({ type: seat && latest.currentBet > seat.bet ? "call" : "check" });
  });
  $(".poker-btn-raise").addEventListener("click", () => {
    send({ type: "raise", to: Number($<HTMLInputElement>(".poker-amount").value) });
  });
  $(".poker-btn-next").addEventListener("click", () => send({ type: "nextHand" }));

  const slider = $<HTMLInputElement>(".poker-slider");
  slider.addEventListener("input", () => setRaise(Number(slider.value)));
  const amount = $<HTMLInputElement>(".poker-amount");
  amount.addEventListener("change", () => setRaise(Number(amount.value)));

  for (const btn of root.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    btn.addEventListener("click", () => {
      const seat = latest?.seats.find((s) => s.id === ctx.playerId);
      if (latest && seat) setRaise(raiseTarget(btn.dataset.preset!, latest, seat));
    });
  }
}

// ---------------------------------------------------------------------------
// GamePage
// ---------------------------------------------------------------------------

function mount(ctx: GameContext): void {
  document.body.classList.add("poker-wide");
  ctx.container.innerHTML = html;
  root = ctx.container.querySelector(".poker")!;
  wireActions(ctx);
}

function update(state: PokerState, ctx: GameContext): void {
  latest = state;
  if (state.handNumber !== seenHand) {
    seenHand = state.handNumber;
    seenCards = new Set();
  }
  renderSeats(state, ctx);
  renderCenter(state, ctx);
  renderActions(state, ctx);
  renderLog(state, ctx);

  const turn = state.toAct === null ? null : state.seats[state.toAct];
  if (state.phase === "showdown") ctx.setStatus("Hand finished — deal the next one when ready");
  else if (turn?.id === ctx.playerId) ctx.setStatus("Your turn");
  else if (turn) ctx.setStatus(`Waiting for ${ctx.nickname(turn.id)}…`);
}

function onGameOver(winner: string | "draw", _state: PokerState, ctx: GameContext): void {
  $(".poker-actions").hidden = true;
  const banner = $(".poker-banner");
  banner.hidden = false;
  banner.prepend(el("div", "poker-banner-title", `🏆 ${ctx.nickname(winner)} wins the game!`));
}

export default { mount, update, onGameOver } satisfies GamePage<PokerState>;
