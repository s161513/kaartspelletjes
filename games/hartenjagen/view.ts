import { RANK_VALUES, type Card, type GameContext, type GamePage } from "@app/shared";
import { renderCard } from "../_ui/cards.js";
import { PASS_COUNT, legalPlays } from "./rules.js";
import type { HeartsState, PassDirection, Play } from "./types.js";
import html from "./view.html?raw";
import "./style.css";

// Hartenjagen table. Layout in view.html, styling in style.css; this file fills
// in seats, the trick, your hand and the scoreboard from each new state.

let root: HTMLElement;
const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;

let latest: HeartsState | null = null;
/** Cards picked to pass this round. */
let selected = new Set<string>();
let selectedRound = 0;
/** Trick cards already on screen this round, so only newly played ones fly in. */
let seenTrick = new Set<string>();
/** Where your clicked card was in your hand, so it flies in from there. */
let lastPlayedFrom: { id: string; rect: DOMRect } | null = null;
/** A finished trick stays on show, then sweeps to its winner; the table waits for it. */
let sweepUntil = 0;
let sweepWinner: string | null = null;
let deferredRender: number | undefined;
let previous: HeartsState | null = null;
/** Set once the game is over, so the final banner survives a deferred render. */
let finalWinner: string | "draw" | null = null;

const THROW_MS = 380;
const SHOW_MS = 1000;
const SWEEP_MS = 450;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const PASS_LABEL: Record<PassDirection, string> = {
  left: "to the left ←",
  right: "to the right →",
  across: "across ↑",
  none: "",
};

// Hand order alternates colours: ♣ ♦ ♠ ♥, low to high.
const SUIT_ORDER = { clubs: 0, diamonds: 1, spades: 2, hearts: 3 };
const byHandOrder = (a: Card, b: Card) =>
  SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || RANK_VALUES[a.rank] - RANK_VALUES[b.rank];

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Unit-circle position of a player around the table; you are at the bottom. */
function seatVector(state: HeartsState, id: string, me: string): { x: number; y: number } {
  const n = state.players.length;
  const offset = Math.max(0, state.players.indexOf(me));
  const k = (state.players.indexOf(id) - offset + n) % n;
  const angle = Math.PI / 2 + (k / n) * 2 * Math.PI;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

const myHand = (state: HeartsState, ctx: GameContext) =>
  (state.hands[ctx.playerId] ?? []).filter((c): c is Card => c !== null);

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function renderSeats(state: HeartsState, ctx: GameContext): void {
  const seats = $(".hearts-seats");
  seats.innerHTML = "";

  for (const id of state.players) {
    const { x, y } = seatVector(state, id, ctx.playerId);
    const node = el("div", "hearts-seat");
    node.dataset.playerId = id;
    node.style.setProperty("--x", x.toFixed(4));
    node.style.setProperty("--y", y.toFixed(4));
    node.classList.toggle("is-me", id === ctx.playerId);
    node.classList.toggle("is-turn", state.toPlay === id);
    node.classList.toggle("is-winner", sweepWinner === id);
    node.classList.toggle("is-gone", state.left.includes(id));

    const name = ctx.nickname(id);
    const plate = el("div", "hearts-plate");
    const info = el("div", "hearts-info");
    info.append(
      el("div", "hearts-name", id === ctx.playerId ? `${name} (you)` : name),
      el("div", "hearts-score", `${state.scores[id]} pts`),
    );
    plate.append(el("div", "hearts-avatar", name.charAt(0).toUpperCase()), info);

    const meta = el("div", "hearts-seat-meta");
    if (id !== ctx.playerId) {
      const count = state.hands[id]?.length ?? 0;
      const backs = el("div", "hearts-backs");
      for (let i = 0; i < Math.min(count, 4); i++) backs.append(renderCard(null));
      if (count > 0) backs.append(el("span", "hearts-count", String(count)));
      meta.append(backs);
    }
    if (state.phase === "passing") {
      meta.append(el("span", `hearts-tag ${state.passed[id] ? "is-done" : ""}`, state.passed[id] ? "✓ passed" : "choosing…"));
    } else if (state.taken[id] > 0) {
      meta.append(el("span", "hearts-tag is-points", `♥ ${state.taken[id]}`));
    }

    node.append(plate, meta);
    seats.append(node);
  }
}

const centre = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

function seatRect(id: string): DOMRect | undefined {
  return root
    .querySelector(`.hearts-seat[data-player-id="${CSS.escape(id)}"] .hearts-plate`)
    ?.getBoundingClientRect();
}

/** A played card, lying in front of the player who played it. */
function playedSlot(state: HeartsState, play: Play, order: number, ctx: GameContext): HTMLElement {
  const { x, y } = seatVector(state, play.playerId, ctx.playerId);
  const slot = el("div", "hearts-played");
  slot.style.setProperty("--x", x.toFixed(4));
  slot.style.setProperty("--y", y.toFixed(4));
  slot.style.setProperty("--tilt", `${((order * 37) % 13) - 6}deg`);
  slot.style.zIndex = String(order + 1);
  slot.append(renderCard(play.card));
  return slot;
}

/** Fly a newly played card in from its player's seat (or from your hand). */
function throwIn(slot: HTMLElement, play: Play, state: HeartsState): void {
  const key = `${state.roundNumber}:${play.card.id}`;
  if (seenTrick.has(key)) return;
  seenTrick.add(key);
  if (reducedMotion()) return;

  const from = lastPlayedFrom?.id === play.card.id ? lastPlayedFrom.rect : seatRect(play.playerId);
  const card = slot.firstElementChild as HTMLElement;
  if (!from) return;
  const a = centre(from);
  const b = centre(card.getBoundingClientRect());
  card.animate(
    [
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) rotate(-30deg) scale(0.7)`, opacity: 0.5 },
      { transform: "none", opacity: 1 },
    ],
    { duration: THROW_MS, easing: "cubic-bezier(0.2, 0.8, 0.25, 1)" },
  );
}

function renderTrick(state: HeartsState, ctx: GameContext): void {
  const area = $(".hearts-trick");
  area.innerHTML = "";
  state.trick.forEach((play, order) => {
    const slot = playedSlot(state, play, order, ctx);
    area.append(slot);
    throwIn(slot, play, state);
  });
  $(".hearts-broken").hidden = !(state.heartsBroken && state.phase === "playing");
}

/** A trick just finished: show it complete for a moment, then sweep it to the winner. */
function sweepTrick(state: HeartsState, ctx: GameContext): void {
  const { plays, winner } = state.lastTrick!;
  const layer = $(".hearts-sweep");
  $(".hearts-trick").innerHTML = "";
  layer.innerHTML = "";

  const slots = plays.map((play, order) => {
    const slot = playedSlot(state, play, order, ctx);
    layer.append(slot);
    throwIn(slot, play, state);
    if (play.playerId === winner) slot.classList.add("is-winning");
    return slot;
  });

  const show = reducedMotion() ? 700 : SHOW_MS;
  sweepWinner = winner;
  sweepUntil = Date.now() + show + SWEEP_MS;

  window.setTimeout(() => {
    const target = seatRect(winner);
    if (!reducedMotion() && target) {
      const t = centre(target);
      slots.forEach((slot, i) => {
        const card = slot.firstElementChild as HTMLElement;
        const b = centre(card.getBoundingClientRect());
        card.animate(
          [
            { transform: "none", opacity: 1 },
            { transform: `translate(${t.x - b.x}px, ${t.y - b.y}px) scale(0.35) rotate(${(i - 1) * 20}deg)`, opacity: 0 },
          ],
          { duration: SWEEP_MS - 60, delay: i * 20, easing: "cubic-bezier(0.55, 0, 0.75, 0.2)", fill: "forwards" },
        );
      });
    }
    window.setTimeout(() => (layer.innerHTML = ""), SWEEP_MS);
  }, show);
}

/** Trick, banner and seat highlights; waits while a finished trick is being swept away. */
function renderTable(state: HeartsState, ctx: GameContext): void {
  window.clearTimeout(deferredRender);
  const wait = sweepUntil - Date.now();
  if (wait > 0) {
    deferredRender = window.setTimeout(() => latest && renderTable(latest, ctx), wait);
    return;
  }
  sweepWinner = null;
  renderSeats(state, ctx);
  renderTrick(state, ctx);
  renderBanner(state, ctx);
}

function renderBanner(state: HeartsState, ctx: GameContext): void {
  const banner = $(".hearts-banner");
  const round = state.phase === "roundEnd" ? state.history[state.history.length - 1] : null;
  banner.hidden = !round && !finalWinner;
  banner.innerHTML = "";
  if (finalWinner) {
    const title =
      finalWinner === "draw"
        ? "🤝 It's a draw!"
        : `🏆 ${ctx.nickname(finalWinner)} wins with ${state.scores[finalWinner]} points!`;
    banner.append(el("div", "hearts-banner-title hearts-final", title));
    if (state.left.length) {
      banner.append(el("div", "hearts-moon", `${state.left.map((id) => ctx.nickname(id)).join(", ")} left the game`));
    }
  }
  if (!round) return;

  banner.append(el("div", "hearts-banner-title", `Round ${round.round}`));
  if (round.moon) {
    banner.append(el("div", "hearts-moon", `🌙 ${ctx.nickname(round.moon)} shot the moon!`));
  }
  const list = el("div", "hearts-banner-list");
  for (const id of [...state.players].sort((a, b) => round.points[a] - round.points[b])) {
    const row = el("div", "hearts-banner-row");
    row.append(el("span", "", ctx.nickname(id)), el("strong", "", `+${round.points[id]}`));
    list.append(row);
  }
  banner.append(list);
}

function renderScores(state: HeartsState, ctx: GameContext): void {
  const table = $<HTMLTableElement>(".hearts-scores");
  table.innerHTML = "";
  const head = table.createTHead().insertRow();
  head.append(el("th", "", "Round"));
  for (const id of state.players) head.append(el("th", "", ctx.nickname(id)));
  const body = table.createTBody();
  for (const round of state.history) {
    const row = body.insertRow();
    row.append(el("td", "", round.moon ? `${round.round} 🌙` : String(round.round)));
    for (const id of state.players) row.append(el("td", "", String(round.points[id])));
  }
  const total = table.createTFoot().insertRow();
  total.append(el("td", "", "Total"));
  for (const id of state.players) total.append(el("td", "", String(state.scores[id])));
}

// ---------------------------------------------------------------------------
// Your hand
// ---------------------------------------------------------------------------

function renderHand(state: HeartsState, ctx: GameContext): void {
  const handEl = $(".hearts-hand");
  handEl.innerHTML = "";
  const cards = myHand(state, ctx).sort(byHandOrder);
  const passing = state.phase === "passing" && !state.passed[ctx.playerId];
  const myTurn = state.phase === "playing" && state.toPlay === ctx.playerId;
  const legal = myTurn
    ? new Set(legalPlays(cards, state.trick, state.tricksPlayed === 0, state.heartsBroken).map((c) => c.id))
    : new Set<string>();
  const received = new Set(state.tricksPlayed === 0 ? state.received[ctx.playerId] ?? [] : []);

  cards.forEach((card, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hearts-card";
    button.style.setProperty("--i", String(i - (cards.length - 1) / 2));
    const playable = passing || legal.has(card.id);
    button.disabled = !playable;
    button.classList.toggle("is-playable", playable);
    button.classList.toggle("is-selected", passing && selected.has(card.id));
    button.classList.toggle("is-received", received.has(card.id));
    button.append(renderCard(card));
    button.addEventListener("click", () => onCardClick(card, ctx));
    handEl.append(button);
  });
  handEl.style.setProperty("--n", String(cards.length));
}

function onCardClick(card: Card, ctx: GameContext): void {
  const state = latest;
  if (!state) return;
  if (state.phase === "passing") {
    if (selected.has(card.id)) selected.delete(card.id);
    else if (selected.size < PASS_COUNT) selected.add(card.id);
    renderHand(state, ctx);
    renderActions(state, ctx);
  } else if (state.toPlay === ctx.playerId) {
    const button = root.querySelector(`.hearts-hand [data-card-id="${CSS.escape(card.id)}"]`);
    if (button) lastPlayedFrom = { id: card.id, rect: button.getBoundingClientRect() };
    ctx.sendMove({ type: "play", card: card.id });
  }
}

function renderActions(state: HeartsState, ctx: GameContext): void {
  const passBtn = $<HTMLButtonElement>(".hearts-btn-pass");
  const nextBtn = $<HTMLButtonElement>(".hearts-btn-next");
  const prompt = $(".hearts-prompt");
  const iPassed = state.passed[ctx.playerId];

  passBtn.hidden = state.phase !== "passing" || iPassed;
  passBtn.disabled = selected.size !== PASS_COUNT;
  passBtn.textContent = `Pass ${PASS_COUNT} ${PASS_LABEL[state.passDirection]}`;
  nextBtn.hidden = state.phase !== "roundEnd";

  if (state.phase === "passing") {
    prompt.textContent = iPassed
      ? "Waiting for the others to pass…"
      : `Pick ${PASS_COUNT} cards to pass ${PASS_LABEL[state.passDirection]} (${selected.size}/${PASS_COUNT})`;
  } else if (state.phase === "playing") {
    const lead = state.tricksPlayed === 0 && state.trick.length === 0;
    prompt.textContent =
      state.toPlay !== ctx.playerId ? ""
      : lead ? "You have ♣2 — lead it to start"
      : "Your turn — play a card";
  } else {
    prompt.textContent = "";
  }
}

function wireActions(ctx: GameContext): void {
  $(".hearts-btn-pass").addEventListener("click", () => {
    if (selected.size === PASS_COUNT) ctx.sendMove({ type: "pass", cards: [...selected] });
  });
  $(".hearts-btn-next").addEventListener("click", () => ctx.sendMove({ type: "nextRound" }));
}

// ---------------------------------------------------------------------------
// GamePage
// ---------------------------------------------------------------------------

function mount(ctx: GameContext): void {
  document.body.classList.add("hearts-wide");
  ctx.container.innerHTML = html;
  root = ctx.container.querySelector(".hearts")!;
  wireActions(ctx);
}

function update(state: HeartsState, ctx: GameContext): void {
  latest = state;
  if (state.roundNumber !== selectedRound) {
    selectedRound = state.roundNumber;
    selected = new Set();
    seenTrick = new Set();
  }
  // Drop picks that are no longer in hand (e.g. after a reconnect).
  const inHand = new Set(myHand(state, ctx).map((c) => c.id));
  for (const id of selected) if (!inHand.has(id)) selected.delete(id);

  const trickJustFinished =
    previous !== null &&
    state.lastTrick !== null &&
    state.roundNumber === previous.roundNumber &&
    state.tricksPlayed > previous.tricksPlayed;
  previous = state;

  // Sweep first: it measures the seats still on screen and sets the winner highlight.
  if (trickJustFinished) sweepTrick(state, ctx);
  renderSeats(state, ctx);
  renderTable(state, ctx);
  renderHand(state, ctx);
  renderActions(state, ctx);
  renderScores(state, ctx);

  const round = `Round ${state.roundNumber}`;
  if (state.phase === "passing") {
    const dir = state.passDirection;
    ctx.setStatus(`${round} · Pass ${PASS_LABEL[dir]}`);
  } else if (state.phase === "roundEnd") {
    ctx.setStatus(`${round} · Finished`);
  } else if (state.toPlay === ctx.playerId) {
    ctx.setStatus(`${round} · Your turn`);
  } else if (state.toPlay) {
    ctx.setStatus(`${round} · Waiting for ${ctx.nickname(state.toPlay)}…`);
  }
}

function onGameOver(winner: string | "draw", state: HeartsState, ctx: GameContext): void {
  finalWinner = winner;
  $(".hearts-actions").hidden = true;
  $(".hearts-scores-wrap").setAttribute("open", "");
  renderTable(state, ctx);
}

export default { mount, update, onGameOver } satisfies GamePage<HeartsState>;
