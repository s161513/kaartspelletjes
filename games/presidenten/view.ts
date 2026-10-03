import { RANK_VALUES, type Card, type Rank, type GameContext, type GamePage } from "@app/shared";
import { renderCard } from "../_ui/cards.js";
import {
  effectiveRank, hasLegalFollow, REQUEST_RANKS, ROLE_LABEL, sortForDisplay, TURN_MS,
} from "./rules.js";
import type { PresidentenView, Role } from "./types.js";
import html from "./view.html?raw";
import "./style.css";

// Presidenten table — same look as poker/hartenjagen. Layout lives in view.html,
// styling in style.css; this file fills seats, the stacked pile and your hand from
// each projected view, and runs the throw-in / sweep-to-winner / burn animations.

let root: HTMLElement;
const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

let latest: PresidentenView | undefined;
let context: GameContext;
let offset = 0; // serverNow - Date.now(), to sync the countdown to the server clock
let timer: ReturnType<typeof setInterval>;

/** Cards picked to play. */
const selected = new Set<string>();
let selectedVersion = -1;
/** Pile cards already animated this round, so only newly played ones fly in. */
const seenPile = new Set<string>();
/** Which round `seenPile` belongs to — cards are re-dealt with the same ids each round. */
let seenRound = -1;
/** The last swept trick, so each win sweeps once (lastTrick persists across states). */
let shownTrickKey = "";
/** A finished trick stays on show, then sweeps to its winner; the table waits for it. */
let sweepUntil = 0;
let sweepWinner: string | null = null;
let deferredRender: number | undefined;
/** Set once the game is over, so the final banner survives a deferred render. */
let finalWinner: string | "draw" | null = null;

const THROW_MS = 360;
const SHOW_MS = 950;
const SWEEP_MS = 650;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const BAD_ROLES = new Set<Role>(["scum", "vice-scum", "loser"]);
const roleText = (role: Role) => (role === "president" ? `${ROLE_LABEL[role]} 👑` : ROLE_LABEL[role]);

const name = (id: string | null) => (id ? context.nickname(id) : "Player");
const online = (id: string) => context.players?.find((p) => p.id === id)?.connected !== false;

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

function seatRect(id: string): DOMRect | undefined {
  return root
    .querySelector(`.pr-seat[data-player-id="${CSS.escape(id)}"] .pr-plate`)
    ?.getBoundingClientRect();
}

/** Unit-circle position of a player around the table; you sit at the bottom. */
function seatVector(view: PresidentenView, id: string): { x: number; y: number } {
  const n = view.players.length;
  const me = Math.max(0, view.players.findIndex((p) => p.id === view.selfId));
  const k = (view.players.findIndex((p) => p.id === id) - me + n) % n;
  const angle = Math.PI / 2 + (k / n) * 2 * Math.PI;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** A stable little offset per card, so the pile looks like a real tossed heap. */
function jitter(id: string): { dx: number; dy: number; rot: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const r = (shift: number, span: number) => (((h >> shift) & 0xff) / 255 - 0.5) * span;
  return { dx: r(0, 34), dy: r(8, 20), rot: r(16, 26) };
}

/** Horizontal gap between the cards of the current top group, as a fraction of card width. */
const TOP_SPREAD = 0.6;

/**
 * Lay a pile out into `container`: older cards tucked into a tight heap in the
 * middle, and the current top group fanned side by side on top so every played
 * card's rank+suit corner stays visible. Returns the built {card, slot} pairs.
 */
function layoutPile(
  container: HTMLElement,
  cards: Card[],
  topIds: Set<string>,
): { card: Card; slot: HTMLElement }[] {
  const topCount = cards.filter((c) => topIds.has(c.id)).length;
  const built: { card: Card; slot: HTMLElement }[] = [];
  let baseIdx = 0;
  let topIdx = 0;
  for (const card of cards) {
    const slot = el("div", "pr-pile-card");
    if (topIds.has(card.id)) {
      const m = topIdx - (topCount - 1) / 2;
      slot.classList.add("is-top");
      slot.style.setProperty("--dx", `calc(${m.toFixed(3)} * var(--ui-card-w) * ${TOP_SPREAD})`);
      slot.style.setProperty("--dy", "0px");
      slot.style.setProperty("--rot", `${(m * 3).toFixed(2)}deg`);
      slot.style.zIndex = String(1000 + topIdx);
      topIdx++;
    } else {
      const j = jitter(card.id);
      slot.style.setProperty("--dx", `${(j.dx * 0.5).toFixed(1)}px`);
      slot.style.setProperty("--dy", `${(j.dy * 0.5).toFixed(1)}px`);
      slot.style.setProperty("--rot", `${(j.rot * 0.7).toFixed(1)}deg`);
      slot.style.zIndex = String(baseIdx + 1);
      baseIdx++;
    }
    slot.append(renderCard(card));
    container.append(slot);
    built.push({ card, slot });
  }
  return built;
}

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

function renderSeats(view: PresidentenView): void {
  const seats = $(".pr-seats");
  seats.innerHTML = "";
  const playing = view.phase === "PLAY";
  for (const p of view.players) {
    const { x, y } = seatVector(view, p.id);
    const node = el("div", "pr-seat");
    node.dataset.playerId = p.id;
    node.style.setProperty("--x", x.toFixed(4));
    node.style.setProperty("--y", y.toFixed(4));
    node.classList.toggle("is-me", p.id === view.selfId);
    node.classList.toggle("is-turn", view.turn === p.id && view.phase !== "GAME_OVER");
    node.classList.toggle("is-passed", playing && p.passed);
    node.classList.toggle("is-winner", sweepWinner === p.id);
    node.classList.toggle("is-gone", !online(p.id));
    node.classList.toggle("is-out", playing && p.finishPlace !== null);

    const nick = name(p.id);
    const plate = el("div", "pr-plate");
    const box = el("div", "pr-info-box");
    box.append(el("div", "pr-name", p.id === view.selfId ? `${nick} (you)` : nick));
    if (p.role) {
      box.append(el("div", `pr-role${BAD_ROLES.has(p.role) ? " is-bad" : ""}`, roleText(p.role)));
    }
    plate.append(el("div", "pr-avatar", nick.charAt(0).toUpperCase()), box);
    node.append(plate);

    const meta = el("div", "pr-seat-meta");
    if (playing && p.finishPlace !== null) {
      meta.append(el("span", "pr-tag is-done", p.finishPlace === 1 ? "First out 👑" : `#${p.finishPlace} out`));
    } else if (p.id !== view.selfId) {
      const backs = el("div", "pr-backs");
      for (let i = 0; i < Math.min(p.cardCount, 5); i++) backs.append(renderCard(null));
      if (p.cardCount > 0) backs.append(el("span", "pr-count", String(p.cardCount)));
      meta.append(backs);
    } else {
      meta.append(el("span", "pr-count", `${p.cardCount} cards`));
    }
    if (playing && p.passed) meta.append(el("span", "pr-tag", "passed"));
    if (!online(p.id)) meta.append(el("span", "pr-tag", "away"));
    node.append(meta);
    seats.append(node);
  }
}

// ---------------------------------------------------------------------------
// Pile (centre), throw-in and the sweep
// ---------------------------------------------------------------------------

/** Fly a freshly played card in from the seat of whoever laid it. */
function throwIn(slot: HTMLElement, card: Card, fromId: string | null): void {
  if (seenPile.has(card.id)) return;
  seenPile.add(card.id);
  if (reducedMotion() || !fromId) return;
  const from = seatRect(fromId);
  if (!from) return;
  const cardEl = slot.firstElementChild as HTMLElement;
  const a = centre(from);
  const b = centre(cardEl.getBoundingClientRect());
  cardEl.animate(
    [
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) rotate(-18deg) scale(0.72)`, opacity: 0.4 },
      { transform: "none", opacity: 1 },
    ],
    { duration: THROW_MS, easing: "cubic-bezier(0.2, 0.8, 0.25, 1)" },
  );
}

function renderPile(view: PresidentenView): void {
  const pileEl = $(".pr-pile");
  pileEl.innerHTML = "";
  if (view.phase !== "PLAY") return;
  if (view.pile.length === 0) {
    pileEl.append(el("div", "pr-pile-empty", "Fresh trick"));
    return;
  }
  const topIds = new Set((view.pileTop ?? []).map((c) => c.id));
  const built = layoutPile(pileEl, view.pile, topIds);
  // Only the just-played top group flies in, from the seat that laid it.
  for (const { card, slot } of built) {
    if (topIds.has(card.id)) throwIn(slot, card, view.topBy);
  }
  pileEl.append(el("div", "pr-pile-badge", `${view.pileCount} on pile`));
}

/**
 * A trick just resolved: show the whole pile (same layout, so nothing jumps),
 * fly in any just-played winning cards, then sweep it all to whoever took it
 * (the winner, or the player who burned it).
 */
function sweepTrick(view: PresidentenView): void {
  const lt = view.lastTrick!;
  const layer = $(".pr-sweep");
  $(".pr-pile").innerHTML = "";
  layer.innerHTML = "";

  const topIds = new Set(lt.cards.map((c) => c.id));
  const built = layoutPile(layer, lt.pile, topIds);
  // A winning play that resolved at once (others auto-passed) has new top cards
  // still to animate in; cards already on the table were seen and stay put.
  for (const { card, slot } of built) {
    if (topIds.has(card.id)) throwIn(slot, card, lt.by);
  }

  const show = reducedMotion() ? 450 : SHOW_MS;
  sweepWinner = lt.by;
  sweepUntil = Date.now() + show + SWEEP_MS;
  // Seats are held back during the sweep, so light up the winner's plate in place.
  for (const seat of root.querySelectorAll<HTMLElement>(".pr-seat")) {
    seat.classList.toggle("is-winner", seat.dataset.playerId === sweepWinner);
    seat.classList.remove("is-turn");
  }

  window.setTimeout(() => {
    if (!reducedMotion()) {
      const target = seatRect(lt.by);
      const t = target ? centre(target) : null;
      built.forEach(({ slot }, i) => {
        const cardEl = slot.firstElementChild as HTMLElement;
        const b = centre(cardEl.getBoundingClientRect());
        if (t) {
          // Glide all the way to the winner's seat and only fade once it arrives.
          const dx = t.x - b.x;
          const dy = t.y - b.y;
          const rot = (i - 1) * 18;
          cardEl.animate(
            [
              { transform: "none", opacity: 1, easing: "cubic-bezier(0.45, 0, 0.25, 1)" },
              { transform: `translate(${dx}px, ${dy}px) scale(0.45) rotate(${rot}deg)`, opacity: 1, offset: 0.8 },
              { transform: `translate(${dx}px, ${dy}px) scale(0.3) rotate(${rot}deg)`, opacity: 0 },
            ],
            { duration: SWEEP_MS - 140, delay: Math.min(i * 22, 120), fill: "forwards" },
          );
        } else {
          const to = `translate(${(i - (built.length - 1) / 2) * 70}px, -60px) scale(0.5) rotate(${(i - 1) * 45}deg)`;
          cardEl.animate(
            [
              { transform: "none", opacity: 1 },
              { transform: to, opacity: 0 },
            ],
            { duration: SWEEP_MS - 140, delay: Math.min(i * 22, 120), easing: "cubic-bezier(0.55, 0, 0.75, 0.2)", fill: "forwards" },
          );
        }
      });
    }
    window.setTimeout(() => (layer.innerHTML = ""), SWEEP_MS);
  }, show);
}

function renderBanner(view: PresidentenView): void {
  const banner = $(".pr-banner");
  banner.innerHTML = "";
  if (finalWinner || view.phase === "GAME_OVER") {
    const who = finalWinner && finalWinner !== "draw" ? finalWinner : view.winner;
    banner.hidden = false;
    banner.append(el("div", "pr-banner-title", who ? `🏆 ${name(who)} wins the game!` : "Game over"));
    banner.append(el("div", "pr-banner-sub", "Not enough players to deal another hand."));
    return;
  }
  const ex = view.exchange;
  if (view.phase === "EXCHANGE" && ex && ex.activeWinner !== view.selfId) {
    banner.hidden = false;
    banner.append(el("div", "pr-banner-title", `Round ${view.round} · card exchange (${ex.done + 1}/${ex.total})`));
    banner.append(el("div", "pr-banner-sub", `${name(ex.activeWinner)} ↔ ${name(ex.loser)}`));
    return;
  }
  banner.hidden = true;
}

/** Seats, pile and banner — held back while a finished trick is being swept away. */
function renderTable(view: PresidentenView): void {
  window.clearTimeout(deferredRender);
  const wait = sweepUntil - Date.now();
  if (wait > 0) {
    deferredRender = window.setTimeout(() => latest && renderTable(latest), wait);
    return;
  }
  sweepWinner = null;
  renderSeats(view);
  renderPile(view);
  renderBanner(view);
}

// ---------------------------------------------------------------------------
// Your hand
// ---------------------------------------------------------------------------

/** Ids of cards that could be part of *some* legal play this turn. */
function playableCardIds(view: PresidentenView): Set<string> {
  const minCount = view.currentCount ?? 1;
  const minValue = view.currentRank ? RANK_VALUES[view.currentRank as Rank] : 0;
  const twos = view.myHand.filter((c) => c.rank === "2").length;
  const byValue = new Map<number, string[]>();
  for (const c of view.myHand) {
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
  if (anyRankUsable) for (const c of view.myHand) if (c.rank === "2") ok.add(c.id);
  return ok;
}

/** A group is one non-2 rank plus wild 2s, so once a rank is picked only it (and 2s) stay open. */
function selectionCompatible(card: Card, selectedCards: Card[]): boolean {
  const pickedRanks = new Set(selectedCards.filter((c) => c.rank !== "2").map((c) => c.rank));
  if (pickedRanks.size === 0) return true;
  if (card.rank === "2") return true;
  return pickedRanks.has(card.rank);
}

function renderHand(view: PresidentenView): void {
  const handEl = $(".pr-hand");
  handEl.innerHTML = "";
  const cards = sortForDisplay(view.myHand);

  const myTurn = view.phase === "PLAY" && view.turn === view.selfId;
  const givingBack = myExchangeStep(view) === "giveBack";
  const playable = myTurn ? playableCardIds(view) : new Set<string>();
  const selectedCards = view.myHand.filter((c) => selected.has(c.id));

  cards.forEach((card, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pr-card";
    button.style.setProperty("--i", String(i - (cards.length - 1) / 2));
    button.setAttribute("aria-label", `${card.rank} ${card.suit}`);
    const isSel = selected.has(card.id);
    const selectable = givingBack
      || (myTurn && (isSel || (playable.has(card.id) && selectionCompatible(card, selectedCards))));
    button.disabled = !selectable;
    button.classList.toggle("is-playable", selectable);
    button.classList.toggle("is-dimmed", myTurn && !selectable);
    button.classList.toggle("is-selected", isSel);
    button.setAttribute("aria-pressed", String(isSel));
    button.append(renderCard(card));
    button.addEventListener("click", () => onCardClick(card));
    handEl.append(button);
  });
  handEl.style.setProperty("--n", String(Math.max(1, cards.length)));

  if (!cards.length) {
    const self = view.players.find((p) => p.id === view.selfId);
    handEl.append(el("p", "pr-hand-empty",
      self?.finishPlace === 1 ? "You are out first — President! 👑"
      : self?.finishPlace ? `You finished #${self.finishPlace}.`
      : "Hand empty."));
  }
}

function onCardClick(card: Card): void {
  const view = latest;
  if (!view) return;
  if (myExchangeStep(view) === "giveBack") {
    // Exactly one card goes back: clicking another card swaps the pick.
    const was = selected.has(card.id);
    selected.clear();
    if (!was) selected.add(card.id);
  } else if (view.phase === "PLAY" && view.turn === view.selfId) {
    if (selected.has(card.id)) selected.delete(card.id);
    else selected.add(card.id);
  } else {
    return;
  }
  renderHand(view);
  renderActions(view);
}

/** Why the current selection cannot be played yet (or null if it can). */
function selectionProblem(view: PresidentenView): string | null {
  if (!selected.size) return "Select cards to play";
  const picked = view.myHand.filter((c) => selected.has(c.id));
  const eff = effectiveRank(picked);
  if (!eff.ok) return eff.error;
  if (view.currentCount !== null) {
    if (picked.length < view.currentCount) return `Play at least ${view.currentCount} card(s)`;
    const minValue = view.currentRank ? RANK_VALUES[view.currentRank as Rank] : 0;
    if (eff.group.value < minValue) return "Play an equal or higher rank";
  }
  return null;
}

function renderActions(view: PresidentenView): void {
  const playBtn = $<HTMLButtonElement>(".pr-btn-play");
  const passBtn = $<HTMLButtonElement>(".pr-btn-pass");
  const giveBtn = $<HTMLButtonElement>(".pr-btn-give");
  const myTurn = view.phase === "PLAY" && view.turn === view.selfId;
  const givingBack = myExchangeStep(view) === "giveBack";

  // Pass is always available on your turn — a leading pass just rotates the lead.
  playBtn.hidden = !myTurn;
  passBtn.hidden = !myTurn;
  if (myTurn) {
    playBtn.disabled = selectionProblem(view) !== null;
    playBtn.textContent = selected.size ? `Play ${selected.size}` : "Play";
  }
  giveBtn.hidden = !givingBack;
  giveBtn.disabled = selected.size !== 1;
}

// ---------------------------------------------------------------------------
// Card exchange (between hands)
// ---------------------------------------------------------------------------

/** Is it this player's turn in the card exchange — and in which step? */
function myExchangeStep(view: PresidentenView): "request" | "giveBack" | null {
  const ex = view.exchange;
  if (view.phase !== "EXCHANGE" || !ex || ex.activeWinner !== view.selfId) return null;
  return ex.step;
}

/**
 * The active exchanger's panel sits on the felt so your own hand stays visible:
 * pick a rank to ask for, then choose the card to give back from your hand below.
 */
function renderExchange(view: PresidentenView): void {
  const panel = $(".pr-exchange");
  const step = myExchangeStep(view);
  panel.hidden = step === null;
  if (step === null) return;
  const ex = view.exchange!;

  $(".pr-exchange-title").textContent =
    `Card exchange — you ↔ ${name(ex.loser)} (${ex.done + 1}/${ex.total})`;
  $(".pr-exchange-msg").textContent = step === "request"
    ? ex.lastMiss
      ? `${name(ex.loser)} has no ${ex.lastMiss} — ask for another rank.`
      : `Ask ${name(ex.loser)} for a rank they might have:`
    : `Got it! Now pick a card from your hand to give back to ${name(ex.loser)}.`;

  const ranks = $(".pr-ranks");
  ranks.hidden = step !== "request";
  for (const b of Array.from(ranks.children) as HTMLButtonElement[]) b.disabled = step !== "request";
}

// ---------------------------------------------------------------------------
// Prompt, countdown, status
// ---------------------------------------------------------------------------

function renderPrompt(view: PresidentenView): void {
  const prompt = $(".pr-prompt");
  if (view.phase === "GAME_OVER") {
    prompt.textContent = "";
    return;
  }
  if (view.phase === "EXCHANGE") {
    const ex = view.exchange;
    prompt.textContent = !ex
      ? "Card exchange in progress…"
      : ex.activeWinner === view.selfId
        ? ex.step === "request"
          ? "Your exchange — ask for a rank on the table."
          : "Select one card and press Give back."
        : ex.loser === view.selfId
          ? `${name(ex.activeWinner)} is swapping a card with you…`
          : `${name(ex.activeWinner)} is swapping a card with ${name(ex.loser)}…`;
    return;
  }
  const myTurn = view.turn === view.selfId;
  const minValue = view.currentRank ? RANK_VALUES[view.currentRank as Rank] : 0;
  const stuck = myTurn && view.currentCount !== null && !hasLegalFollow(view.myHand, view.currentCount, minValue);
  if (myTurn) {
    prompt.textContent = stuck
      ? "No legal play — pass or you'll be skipped."
      : view.currentCount === null
        ? "Your turn — lead with any card(s)."
        : `Your turn — match ${view.currentCount} card(s), beat ${view.currentRank}.`;
  } else {
    prompt.textContent = `${name(view.turn)} to play` + (view.turn && !online(view.turn) ? " · waiting for reconnect" : "");
  }
}

function updateTimer(): void {
  const countdown = $(".pr-countdown");
  const view = latest;
  if (!view || view.phase !== "PLAY" || view.deadline === null) {
    countdown.hidden = true;
    return;
  }
  countdown.hidden = false;
  const remaining = Math.max(0, view.deadline - (Date.now() + offset));
  $<HTMLProgressElement>(".pr-countdown progress").value = remaining;
  const mine = view.turn === view.selfId;
  $(".pr-time").textContent = `${Math.ceil(remaining / 1000)}s${mine ? " — you" : ""}`;
}

function updateStatus(view: PresidentenView, ctx: GameContext): void {
  const round = `Round ${view.round}`;
  if (view.spectating && view.phase !== "GAME_OVER") {
    ctx.setStatus(`${round} · spectating — you'll be dealt in next hand 👀`);
    return;
  }
  if (view.phase === "GAME_OVER") ctx.setStatus("Game over");
  else if (view.phase === "EXCHANGE") {
    ctx.setStatus(view.exchange?.activeWinner === ctx.playerId ? `${round} · your exchange` : `${round} · card exchange`);
  } else if (view.turn === ctx.playerId) ctx.setStatus(`${round} · your turn`);
  else ctx.setStatus(`${round} · ${name(view.turn)} to play`);
}

// ---------------------------------------------------------------------------
// GamePage
// ---------------------------------------------------------------------------

function mount(ctx: GameContext): void {
  context = ctx;
  document.body.classList.add("pr-wide");
  ctx.container.innerHTML = html;
  root = ctx.container.querySelector(".pr")!;
  $<HTMLProgressElement>(".pr-countdown progress").max = TURN_MS;

  // The rank picker is fixed (3 … A, then 2); wire each button once. Each looks
  // like a playing card but shows only the rank — no suit, since you are guessing.
  const ranks = $(".pr-ranks");
  for (const r of REQUEST_RANKS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pr-rank-btn";
    b.setAttribute("aria-label", `Ask for a ${r}`);
    const face = el("div", "ui-card pr-rank-card");
    face.append(el("span", "pr-rank-face", r));
    b.append(face);
    b.addEventListener("click", () => {
      if (!b.disabled) context.sendMove({ type: "request", rank: r });
    });
    ranks.append(b);
  }

  $(".pr-btn-play").addEventListener("click", () => {
    if (($(".pr-btn-play") as HTMLButtonElement).disabled) return;
    ctx.sendMove({ type: "play", cardIds: [...selected] });
  });
  $(".pr-btn-give").addEventListener("click", () => {
    if (($(".pr-btn-give") as HTMLButtonElement).disabled) return;
    const [cardId] = selected;
    if (cardId) ctx.sendMove({ type: "giveBack", cardId });
  });
  $(".pr-btn-pass").addEventListener("click", () => {
    if (($(".pr-btn-pass") as HTMLButtonElement).hidden) return;
    ctx.sendMove({ type: "pass" });
  });

  timer = setInterval(updateTimer, 200);
  window.addEventListener("pagehide", () => {
    clearInterval(timer);
    window.clearTimeout(deferredRender);
  }, { once: true });
}

function update(view: PresidentenView, ctx: GameContext): void {
  context = ctx;
  offset = view.serverNow - Date.now();
  if (selectedVersion !== view.version) {
    selected.clear();
    selectedVersion = view.version;
  }
  for (const id of [...selected]) if (!view.myHand.some((c) => c.id === id)) selected.delete(id);

  const firstRender = latest === undefined;
  const roundChanged = view.round !== seenRound;
  // lastTrick stays set until the next trick resolves, so sweep only when it changes.
  const trickKey = view.lastTrick
    ? `${view.lastTrick.by}:${view.lastTrick.pile.map((c) => c.id).join(",")}`
    : "";
  if (!firstRender && !roundChanged && trickKey && trickKey !== shownTrickKey) sweepTrick(view);
  shownTrickKey = trickKey;
  // A new round re-deals the same card ids, so forget which cards have flown in.
  if (roundChanged) {
    seenPile.clear();
    seenRound = view.round;
  }
  latest = view;

  renderTable(view);
  renderHand(view);
  renderActions(view);
  renderExchange(view);
  renderPrompt(view);
  updateStatus(view, ctx);
  updateTimer();
}

function onGameOver(winner: string | "draw", view: PresidentenView, ctx: GameContext): void {
  context = ctx;
  finalWinner = winner;
  latest = view;
  renderTable(view);
  renderExchange(view);
  renderPrompt(view);
  updateTimer();
}

function onRoomState(ctx: GameContext): void {
  if (latest) update(latest, ctx);
}

export default { mount, update, onGameOver, onRoomState } satisfies GamePage<PresidentenView>;
