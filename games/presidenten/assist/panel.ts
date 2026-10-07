// Browser glue for the adaptive help: keeps the context memory up to date,
// tells view.ts which cards/buttons to highlight and fills the "Help" section
// of the game's settings menu.
//
// Flow per round:
//   round starts  → read history → computeHelp() → help level for this round
//                   (the calculation is logged to the browser console)
//   my turn       → advise() on what I can see → hintFor(level) → highlights
//   I make a move → count "hint shown" / "hint followed"
//   round ends    → append my role + hint stats to the history (localStorage)
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
  appendRound, demoHistory, LocalStorageStore, MemoryStore, summarize, type ContextStore,
} from "./context.js";
import { computeHelp, THRESHOLDS, type HelpDecision } from "./score.js";

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
   * The score label under my own name, or null when help is switched off.
   * `active` = the score is high enough that I get hints this round.
   */
  badge(): { text: string; active: boolean } | null;
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

  let decision: HelpDecision | null = null; // fixed for the whole round
  let decidedRound = -1;
  let seenRound = -1; // last round observed live, for logging
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

  function decide(round: number): HelpDecision {
    const history = getStore().load();
    const d = computeHelp(summarize(history, Date.now()));
    logDecision(round, d, history.length);
    return d;
  }

  /** Transparency for the curious (and the report): how the score was built. */
  function logDecision(round: number, d: HelpDecision, remembered: number): void {
    console.groupCollapsed(
      `[assist] round ${round} · score ${d.score.toFixed(2)} → level ${d.level} (${LEVEL_TEXT[d.level]})`,
    );
    console.table(Object.fromEntries(d.factors.map((f) => [f.label, {
      value: f.value,
      contribution: `+${f.contribution.toFixed(2)}`,
    }])));
    console.log(
      `rounds remembered: ${remembered}${demo ? ` (demo profile "${demo}")` : ""}`
      + ` · thresholds: ${THRESHOLDS[0]} highlight, ${THRESHOLDS[1]} explanation`,
    );
    console.groupEnd();
  }

  const seated = (v: PresidentenView) => v.players.some((p) => p.id === v.selfId);
  const enabled = (v: PresidentenView) => v.assistEnabled && prefs.helpMe && seated(v);

  /** Log the round that just ended (seen live, so reloads never double-count). */
  function logRound(v: PresidentenView): void {
    const role = v.players.find((p) => p.id === v.selfId)?.role;
    if (!role || !decision) return;
    const s = getStore();
    s.save(appendRound(s.load(), {
      role,
      helpLevel: enabled(v) ? decision.level : 0,
      hintsShown: shownKeys.size,
      hintsFollowed: followed,
    }, Date.now()));
  }

  /** Work out the hint for this exact view (my turn / my exchange step). */
  function computeMarks(v: PresidentenView): typeof current {
    const none = { hint: null, marks: NO_MARKS, best: null, key: "" };
    if (!decision || !enabled(v) || decision.level === 0) return none;
    const key = `${v.round}:${v.version}`;

    if (v.phase === "PLAY" && v.turn === v.selfId) {
      const options = advise({
        hand: v.myHand,
        currentCount: v.currentCount,
        currentRankValue: v.currentRank ? RANK_VALUES[v.currentRank as Rank] : null,
      });
      const hint = hintFor(decision.level, options);
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
        if (decision.level >= 2) marks.reason = "Ask for a strong rank you don't have yet";
      } else {
        const id = adviseGiveBack(v.myHand);
        if (id) marks.cards.add(id);
        if (decision.level >= 2) marks.reason = "Give back your weakest loose card";
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
        decision = decide(view.round);
        refreshMarks(view);
        onChange();
      });
    },

    update(v, context) {
      ctx = context;
      if (seenRound !== -1 && v.round === seenRound + 1) logRound(v);
      if (v.round !== seenRound) {
        shownKeys = new Set();
        followed = 0;
      }
      seenRound = v.round;
      if (v.round !== decidedRound) {
        decision = decide(v.round);
        decidedRound = v.round;
      }
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
      if (!view || !decision || !enabled(view)) return null;
      const active = decision.level > 0;
      return { text: `${active ? "💡 " : ""}${decision.score.toFixed(2)}`, active };
    },
  };
}
