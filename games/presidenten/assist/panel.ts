// Browser glue for the adaptive help: keeps the context memory up to date,
// tells view.ts which cards/buttons to highlight and fills the "Help" section
// of the game's settings menu.
//
// Flow per round (only while I am seated; a watcher gets no prediction):
//   exchange      → provisional P(scum) from history + my current hand, used
//                   only for the exchange hints (my hand is still changing)
//   play starts   → history + my hand after the exchange → features.ts →
//                   P(scum) → help level, LOCKED for the rest of the round
//                   (the calculation is logged to the browser console)
//   my turn       → advise() on what I can see → hintFor(level) → highlights
//   I make a move → count "hint shown" / "hint followed"
//   round ends    → append my role + hint stats to the history (localStorage),
//                   if I played that round live (tracker.ts decides)
//
// The level is locked when play starts so the help doesn't flicker on and off
// while cards leave my hand, and so it is decided on exactly the information
// the model was trained on (features before the round, hand after exchange).
// If I (re)load in the middle of a hand, my hand is no longer the starting
// hand, so the prediction then assumes an average hand instead.
//
// Two switches decide whether a hint is shown:
//   - the host's room-wide switch (server state, `view.assistEnabled`)
//   - the player's own switch (settings menu, localStorage)

import { RANK_VALUES, type Card, type GameContext, type Rank } from "@app/shared";
import type { PresidentenMove, PresidentenView } from "../types.js";
import {
  advise, adviseGiveBack, adviseRequest, followsAdvice, hintFor, type Advice, type Hint,
} from "./advisor.js";
import {
  appendRound, demoHistory, LocalStorageStore, MemoryStore, type ContextStore,
} from "./context.js";
import { extractFeatures } from "./features.js";
import { computeHelp, thresholdsAt, type HelpDecision } from "./score.js";
import { notePlay, roundToLog, type PlayedRound } from "./tracker.js";

const PREFS_KEY = "presidenten-assist:prefs";

interface Prefs {
  helpMe: boolean;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return { helpMe: true, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { helpMe: true };
  }
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore: prefs simply don't persist
  }
}

/** What view.ts needs to draw the hint for the current view. */
export interface HintMarks {
  cards: Set<string>; // card ids to highlight
  pass: boolean; // highlight the Pass button
  rank: Rank | null; // exchange: rank to ask for
  reason: string | null; // level 2 explanation
}

const NO_MARKS: HintMarks = { cards: new Set(), pass: false, rank: null, reason: null };

export interface Assist {
  /** `section` is the Help section inside the game's settings menu. */
  mount(section: HTMLElement, ctx: GameContext): void;
  /** Call on every new view, before rendering. */
  update(view: PresidentenView, ctx: GameContext): void;
  /** Highlights for the current view (empty when no hint applies). */
  marks(): HintMarks;
  /** Call right before sending a move, to track whether hints are followed. */
  noteMove(move: PresidentenMove): void;
  /**
   * The P(scum) label under my own name (only I see it), or null when help is
   * switched off. `active` = P is high enough that I get hints this round.
   */
  badge(): { text: string; active: boolean; title: string } | null;
}

// Console output: readable card names instead of ids like "spades-8#0".
const SUIT_SYMBOL: Record<Card["suit"], string> = { clubs: "♣", diamonds: "♦", hearts: "♥", spades: "♠" };
const cardName = (id: string) => {
  const [suit, rest] = id.split("-") as [Card["suit"], string];
  return `${rest.slice(0, rest.indexOf("#"))}${SUIT_SYMBOL[suit]}`;
};
const LEVEL_TEXT = ["no help", "highlight best move", "highlight + explanation"];

/** `onChange` re-renders the table after a local switch is flipped. */
export function createAssist(onChange: () => void): Assist {
  let ctx: GameContext;
  let section: HTMLElement;
  let view: PresidentenView | undefined;
  let store: ContextStore | null = null;
  let demo: "weak" | "strong" | null = null;
  let prefs = loadPrefs();

  let decision: HelpDecision | null = null; // locked when play starts, for the whole round
  let decidedRound = -1;
  let provisional: HelpDecision | null = null; // during the exchange (hand still changing)
  let provisionalRound = -1; // round whose provisional prediction was logged
  let seenRound = -1; // last round observed, to reset per-round hint counters
  let lastVersion = -1; // state version; a drop means a new game started
  let played: PlayedRound | null = null; // the round I was seated in during PLAY (tracker.ts)
  let warned = false; // prediction failure reported once
  let current: { hint: Hint | null; marks: HintMarks; best: Advice | null; key: string } = {
    hint: null, marks: NO_MARKS, best: null, key: "",
  };
  // Per-round hint bookkeeping, written to the history when the round ends.
  let shownKeys = new Set<string>();
  let followed = 0;
  // Exchange: ranks the current loser turned out not to have.
  let missed: Rank[] = [];
  let missedPair = "";

  const $ = <T extends HTMLElement>(sel: string) => section.querySelector(sel) as T;

  /** Store per nickname; a demo profile uses a throwaway in-memory history. */
  function getStore(): ContextStore {
    if (!store) {
      store = demo
        ? new MemoryStore(demoHistory(demo, Date.now()))
        : new LocalStorageStore(ctx.nickname(ctx.playerId));
    }
    return store;
  }

  /** Players dealt into this hand (the table size the prediction is shifted to). */
  const tableSize = (v: PresidentenView) => v.players.length;

  /**
   * Has nobody played a card yet this hand? Then my hand is still the one I
   * started with (after the exchange). A fresh deal clears both the pile and
   * the last trick (logic.ts), and any play or won/burned trick sets one.
   */
  const handIsFresh = (v: PresidentenView) => v.pile.length === 0 && v.lastTrick === null;

  /**
   * Predict P(scum) for this round from my history (rounds before it) and my
   * starting hand — or an average hand when I joined/reloaded mid-hand.
   * `log` = write the calculation to the console. A broken or stale model.ts
   * must never break the game view: on any error there is simply no help.
   */
  function predict(v: PresidentenView, log: string | null): HelpDecision | null {
    try {
      const history = getStore().load();
      const hand = handIsFresh(v) ? v.myHand : undefined;
      const d = computeHelp(extractFeatures(history, Date.now(), hand, tableSize(v)));
      if (log) logDecision(v, log, d, history.length, hand === undefined);
      return d;
    } catch (err) {
      if (!warned) console.warn("[assist] prediction failed, no help this session:", err);
      warned = true;
      return null;
    }
  }

  /** Transparency for the curious (and the report): how P(scum) was built. */
  function logDecision(
    v: PresidentenView, when: string, d: HelpDecision, remembered: number, averageHand: boolean,
  ): void {
    const [t1, t2] = thresholdsAt(tableSize(v));
    const round = v.round;
    console.groupCollapsed(
      `[assist] round ${round} (${when}) · P(scum) ${d.p.toFixed(2)} → level ${d.level} (${LEVEL_TEXT[d.level]})`,
    );
    console.table(Object.fromEntries(d.factors.map((f) => [f.label, {
      value: f.value,
      "log-odds": `${f.contribution >= 0 ? "+" : ""}${f.contribution.toFixed(2)}`,
    }])));
    console.log(
      `rounds remembered: ${remembered}${demo ? ` (demo profile "${demo}")` : ""}`
      + ` · ${tableSize(v)} players · thresholds: P ≥ ${t1.toFixed(2)} highlight, ≥ ${t2.toFixed(2)} explanation`
      + (averageHand ? " · joined mid-hand: average hand assumed" : "")
      + " · model: logistic regression trained on simulated games",
    );
    console.groupEnd();
  }

  /** The decision that applies to this view: locked in play, provisional in the exchange. */
  const active = (v: PresidentenView): HelpDecision | null =>
    v.phase === "EXCHANGE"
      ? (provisionalRound === v.round ? provisional : null)
      : (decidedRound === v.round ? decision : null);

  /** Lock (in play) or refresh (in the exchange) the prediction for this view. */
  function updateDecision(v: PresidentenView): void {
    if (!seated(v)) return; // watching: nothing to predict
    if (v.phase === "PLAY") {
      if (v.round !== decidedRound) {
        decision = predict(v, "play starts");
        decidedRound = v.round;
      }
    } else if (v.phase === "EXCHANGE") {
      // Recomputed on every view (cheap), logged once per round.
      provisional = predict(v, v.round !== provisionalRound ? "exchange, provisional" : null);
      provisionalRound = v.round;
    }
  }

  const seated = (v: PresidentenView) => v.players.some((p) => p.id === v.selfId);
  const enabled = (v: PresidentenView) => v.assistEnabled && prefs.helpMe && seated(v);

  /** The level actually applied in this view (0 when help is switched off). */
  const appliedLevel = (v: PresidentenView) => {
    const d = active(v);
    return d && enabled(v) ? d.level : 0;
  };

  /**
   * Log the round that just ended, if I played it live (tracker.ts: not as a
   * watcher who got dealt in, never twice after a reload), with the help
   * level that was really on during its play.
   */
  function logRound(v: PresidentenView): void {
    const role = v.players.find((p) => p.id === v.selfId)?.role ?? null;
    const outcome = roundToLog(played, { round: v.round, role });
    if (!outcome) return;
    played = null;
    const s = getStore();
    s.save(appendRound(s.load(), {
      ...outcome,
      hintsShown: shownKeys.size,
      hintsFollowed: followed,
    }, Date.now()));
  }

  /** A new game (host restart) begins at round 1 again, version 0: forget the old one. */
  function resetIfNewGame(v: PresidentenView): void {
    if (lastVersion !== -1 && v.version < lastVersion) {
      decision = null;
      decidedRound = -1;
      provisional = null;
      provisionalRound = -1;
      played = null;
      seenRound = -1;
    }
    lastVersion = v.version;
  }

  /** Work out the hint for this exact view (my turn / my exchange step). */
  function computeMarks(v: PresidentenView): typeof current {
    const none = { hint: null, marks: NO_MARKS, best: null, key: "" };
    const d = active(v);
    if (!d || !enabled(v) || d.level === 0) return none;
    const key = `${v.round}:${v.version}`;

    if (v.phase === "PLAY" && v.turn === v.selfId) {
      const options = advise({
        hand: v.myHand,
        currentCount: v.currentCount,
        currentRankValue: v.currentRank ? RANK_VALUES[v.currentRank as Rank] : null,
      });
      const hint = hintFor(d.level, options);
      if (!hint) return none;
      const marks: HintMarks = {
        cards: new Set(hint.best.kind === "play" ? hint.best.cardIds : []),
        pass: hint.best.kind === "pass",
        rank: null,
        reason: hint.reason,
      };
      return { hint, marks, best: options[0], key };
    }

    const ex = v.exchange;
    if (v.phase === "EXCHANGE" && ex && ex.activeWinner === v.selfId) {
      const marks: HintMarks = { cards: new Set(), pass: false, rank: null, reason: null };
      if (ex.step === "request") {
        marks.rank = adviseRequest(v.myHand, missed);
        if (d.level >= 2) marks.reason = "Ask for a strong rank you don't have yet";
      } else {
        const id = adviseGiveBack(v.myHand);
        if (id) marks.cards.add(id);
        if (d.level >= 2) marks.reason = "Give back your weakest loose card";
      }
      return { hint: null, marks, best: null, key: "" };
    }
    return none;
  }

  /** Recompute the hint; log it to the console the first time it appears. */
  function refreshMarks(v: PresidentenView): void {
    current = computeMarks(v);
    if (current.hint && !shownKeys.has(current.key)) {
      shownKeys.add(current.key);
      const best = current.hint.best;
      const move = best.kind === "pass" ? "pass" : `play ${best.cardIds.map(cardName).join(" ")}`;
      console.log(`[assist] hint: ${move} — ${best.reason}`);
    }
  }

  function renderSection(): void {
    if (!section || !view) return;
    const isHost = ctx.hostId === view.selfId;
    $<HTMLInputElement>(".pr-assist-helpme").checked = prefs.helpMe;
    $<HTMLInputElement>(".pr-assist-helpme").disabled = !view.assistEnabled;
    $<HTMLInputElement>(".pr-assist-room").checked = view.assistEnabled;
    $(".pr-assist-host").hidden = !isHost;
    $(".pr-assist-hostnote").hidden = isHost || view.assistEnabled;
    renderWhy();
  }

  /** "Why do I get help?": P(scum) and the top reasons, only for myself. */
  function renderWhy(): void {
    const why = $(".pr-assist-why");
    const v = view;
    const d = v ? active(v) : null;
    why.hidden = !v || !d || !enabled(v);
    if (!v || !d || why.hidden) return;
    const pushes = d.factors.filter((f) => f.contribution > 0).slice(0, 3);
    const reasons = pushes.map((f) => `${f.label.toLowerCase()} ${f.value}`).join(", ");
    const pText = `Your chance of ending last this round: ${Math.round(d.p * 100)}%`;
    const t1 = Math.round(thresholdsAt(tableSize(v))[0] * 100);
    // The top three reasons that push P *up* (reasons pulling it down are left out).
    why.textContent = d.level > 0
      ? `${pText} (help from ${t1}%). Mainly because of: ${reasons || "—"}.`
      : `${pText}, below the ${t1}% where help starts.`
        + (reasons ? ` Pushing it up: ${reasons}.` : "");
  }

  return {
    mount(el, context) {
      ctx = context;
      section = el;
      try {
        const q = new URLSearchParams(location.search).get("assistDemo");
        if (q === "weak" || q === "strong") demo = q;
      } catch {
        // no URL access: no demo
      }

      $<HTMLInputElement>(".pr-assist-helpme").addEventListener("change", (e) => {
        prefs = { ...prefs, helpMe: (e.target as HTMLInputElement).checked };
        savePrefs(prefs);
        if (view) refreshMarks(view);
        renderSection();
        onChange();
      });
      $<HTMLInputElement>(".pr-assist-room").addEventListener("change", (e) => {
        ctx.sendMove({ type: "setAssist", enabled: (e.target as HTMLInputElement).checked });
      });
      $(".pr-assist-forget").addEventListener("click", () => {
        if (!confirm("Delete your Presidenten history from this browser?")) return;
        getStore().clear();
        if (!view) return;
        decidedRound = -1; // re-predict now, with the empty history
        provisionalRound = -1;
        played = null; // the round in progress is not logged into the fresh history
        updateDecision(view);
        refreshMarks(view);
        renderSection();
        onChange();
      });
    },

    update(v, context) {
      ctx = context;
      resetIfNewGame(v);
      logRound(v); // before the counters reset: they belong to the round that ended
      if (v.round !== seenRound) {
        shownKeys = new Set();
        followed = 0;
      }
      seenRound = v.round;
      updateDecision(v);
      if (v.phase === "PLAY" && seated(v)) played = notePlay(played, v.round, appliedLevel(v));
      const pair = v.exchange ? `${v.round}:${v.exchange.done}` : "";
      if (pair !== missedPair) {
        missed = [];
        missedPair = pair;
      }
      const miss = v.exchange?.lastMiss as Rank | null | undefined;
      if (miss && !missed.includes(miss)) missed.push(miss);
      view = v;
      refreshMarks(v);
      renderSection();
    },

    marks: () => current.marks,

    noteMove(move) {
      if (current.best && current.hint && followsAdvice(current.best, move)) followed++;
    },

    badge() {
      const d = view && active(view);
      if (!view || !d || !enabled(view)) return null;
      const on = d.level > 0;
      const provisionalNote = view.phase === "EXCHANGE" ? " (provisional during the exchange)" : "";
      const [t1] = thresholdsAt(tableSize(view));
      return {
        text: `${on ? "💡 " : ""}P(scum) ${d.p.toFixed(2)}`,
        active: on,
        title: (on
          ? `Predicted chance you finish last${provisionalNote}: you get hints this round`
          : `Predicted chance you finish last${provisionalNote}: hints start at ${t1.toFixed(2)}`)
          + " (only you see this; details in the settings menu and the browser console)",
      };
    },
  };
}
