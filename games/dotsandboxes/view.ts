import type { GameContext, GamePage } from "@app/shared";
import type { DotsState } from "./types.js";
import { boxCounts } from "./logic.js";
import "./style.css";

// Dots and Boxes renderer. The host (client/src/gameHost.ts) owns the socket,
// chat, status line, back button and the host "End game" control; this file
// draws the lattice of dots/lines/boxes and shows the between-rounds banner.

let boardEl: HTMLDivElement;
let bannerEl: HTMLDivElement;
let resultEl: HTMLParagraphElement;
let scoreEl: HTMLParagraphElement;
let againBtn: HTMLButtonElement;

const hButtons: HTMLButtonElement[] = [];
const vButtons: HTMLButtonElement[] = [];
const boxDivs: HTMLDivElement[] = [];

/** Stable colour per seat, reused by edges/boxes and the status text. */
function seatColour(state: DotsState, id: string): string {
  return state.players[0] === id ? "var(--gold, #e2b350)" : "var(--red, #e0533f)";
}

function mount(ctx: GameContext, state?: DotsState): void {
  hButtons.length = 0;
  vButtons.length = 0;
  boxDivs.length = 0;

  const rows = state?.rows ?? 5;
  const cols = state?.cols ?? 5;

  boardEl = document.createElement("div");
  boardEl.className = "dots-board";
  boardEl.style.setProperty(
    "grid-template-columns",
    `var(--dots-dot) repeat(${cols}, var(--dots-cell) var(--dots-dot))`,
  );
  boardEl.style.setProperty(
    "grid-template-rows",
    `var(--dots-dot) repeat(${rows}, var(--dots-cell) var(--dots-dot))`,
  );

  for (let gr = 0; gr <= 2 * rows; gr++) {
    for (let gc = 0; gc <= 2 * cols; gc++) {
      const evenR = gr % 2 === 0;
      const evenC = gc % 2 === 0;
      let el: HTMLElement;

      if (evenR && evenC) {
        el = document.createElement("div");
        el.className = "dots-dot";
      } else if (evenR && !evenC) {
        const r = gr / 2;
        const c = (gc - 1) / 2;
        const i = r * cols + c;
        const btn = document.createElement("button");
        btn.className = "dots-edge dots-edge-h";
        btn.addEventListener("click", () => ctx.sendMove({ line: "h", i }));
        hButtons[i] = btn;
        el = btn;
      } else if (!evenR && evenC) {
        const r = (gr - 1) / 2;
        const c = gc / 2;
        const i = r * (cols + 1) + c;
        const btn = document.createElement("button");
        btn.className = "dots-edge dots-edge-v";
        btn.addEventListener("click", () => ctx.sendMove({ line: "v", i }));
        vButtons[i] = btn;
        el = btn;
      } else {
        const r = (gr - 1) / 2;
        const c = (gc - 1) / 2;
        const i = r * cols + c;
        const div = document.createElement("div");
        div.className = "dots-box";
        boxDivs[i] = div;
        el = div;
      }

      el.style.gridRow = String(gr + 1);
      el.style.gridColumn = String(gc + 1);
      boardEl.appendChild(el);
    }
  }

  bannerEl = document.createElement("div");
  bannerEl.className = "dots-banner";
  bannerEl.hidden = true;
  resultEl = document.createElement("p");
  resultEl.className = "dots-result";
  scoreEl = document.createElement("p");
  scoreEl.className = "dots-score";
  againBtn = document.createElement("button");
  againBtn.className = "dots-again";
  againBtn.textContent = "Play again";
  againBtn.addEventListener("click", () => ctx.sendMove({ again: true }));
  bannerEl.append(resultEl, scoreEl);
  if (!ctx.isSpectator) bannerEl.appendChild(againBtn);

  ctx.container.append(boardEl, bannerEl);
}

let built = false;

function update(state: DotsState, ctx: GameContext): void {
  // Build the lattice lazily once we know the board dimensions.
  if (!built) {
    mount(ctx, state);
    built = true;
  }

  const playing = state.phase === "playing";
  const myTurn = playing && state.turn === ctx.playerId;

  const paintEdge = (btn: HTMLButtonElement, claimer: string | null): void => {
    const claimed = claimer !== null;
    btn.classList.toggle("claimed", claimed);
    if (claimed) btn.style.setProperty("--dots-edge-color", seatColour(state, claimer));
    else btn.style.removeProperty("--dots-edge-color");
    btn.disabled = !myTurn || claimed;
  };
  for (let i = 0; i < state.h.length; i++) paintEdge(hButtons[i], state.h[i]);
  for (let i = 0; i < state.v.length; i++) paintEdge(vButtons[i], state.v[i]);
  for (let i = 0; i < state.owners.length; i++) {
    const owner = state.owners[i];
    const div = boxDivs[i];
    if (owner === null) {
      div.classList.remove("owned");
      div.style.removeProperty("--dots-owner");
      div.textContent = "";
    } else {
      div.classList.add("owned");
      div.style.setProperty("--dots-owner", seatColour(state, owner));
      div.textContent = owner === ctx.playerId ? "You" : ctx.nickname(owner).charAt(0).toUpperCase();
    }
  }

  boardEl.classList.toggle("is-your-turn", myTurn);

  if (playing) {
    bannerEl.hidden = true;
    const tally = boxCounts(state);
    const me = ctx.playerId;
    const opp = state.players.find((id) => id !== me);
    const mine = tally[me] ?? 0;
    const theirs = opp ? (tally[opp] ?? 0) : 0;
    ctx.setStatus(
      (myTurn ? "Your turn" : "Opponent's turn") +
        ` · boxes ${mine}–${theirs}` +
        (myTurn ? " — complete a box to go again" : ""),
    );
  } else {
    showIntermission(state, ctx);
  }
}

function showIntermission(state: DotsState, ctx: GameContext): void {
  const me = ctx.playerId;
  const isPlayer = state.players.includes(me);
  const opp = state.players.find((id) => id !== me);
  const tally = boxCounts(state);

  let msg: string;
  if (state.result === "draw") {
    msg = "It's a draw!";
  } else if (isPlayer && state.result === me) {
    msg = "You won! 🎉";
  } else {
    msg = `${ctx.nickname(state.result ?? "")} won!`;
  }
  resultEl.textContent = msg;

  const boxLine =
    isPlayer && opp
      ? `boxes: You ${tally[me] ?? 0} — ${ctx.nickname(opp)} ${tally[opp] ?? 0}`
      : `boxes: ${state.players.map((id) => `${ctx.nickname(id)} ${tally[id] ?? 0}`).join(" — ")}`;
  const roundLine =
    isPlayer && opp
      ? `rounds: You ${state.scores[me] ?? 0} — ${ctx.nickname(opp)} ${state.scores[opp] ?? 0}`
      : `rounds: ${state.players.map((id) => `${ctx.nickname(id)} ${state.scores[id] ?? 0}`).join(" — ")}`;
  scoreEl.textContent = `${boxLine} · ${roundLine}`;
  if (state.draws > 0) {
    scoreEl.textContent += ` · ${state.draws} draw${state.draws === 1 ? "" : "s"}`;
  }

  bannerEl.hidden = false;
  ctx.setStatus(`${msg} — play again or let the host end the game.`);
}

export default {
  mount() {
    // Real build is deferred to the first update(), when board dimensions are
    // known from the server state.
    built = false;
  },
  update,
} satisfies GamePage<DotsState>;
