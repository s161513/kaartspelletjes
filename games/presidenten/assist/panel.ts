// Browser glue for the adaptive help: owns the help panel, keeps the context
// memory up to date and tells view.ts which cards/buttons to highlight.
//
// Flow per round:
//   round starts  → read history → computeHelp() → help level for this round
//   my turn       → advise() on what I can see → hintFor(level) → highlights
//   I make a move → count "hint shown" / "hint followed"
//   round ends    → append my role + hint stats to the history (localStorage)
//
// Three switches decide whether a hint is shown:
//   - the host's room-wide switch (server state, `view.assistEnabled`)
//   - the player's own switch ("Help me", localStorage)
//   - "Use my history": off = everyone gets the same fixed level (no context),
//     which is the context switch used in the demo.

import { RANK_VALUES, type GameContext, type Rank } from "@app/shared";
import type { PresidentenMove, PresidentenView } from "../types.js";
import {
  advise, adviseGiveBack, adviseRequest, followsAdvice, hintFor, type Advice, type Hint,
} from "./advisor.js";
import {
  appendRound, demoHistory, LocalStorageStore, MemoryStore, summarize, type ContextStore,
} from "./context.js";
import { computeHelp, type HelpDecision } from "./score.js";

/** Level everyone gets when "Use my history" is off: same help for all. */
const NO_CONTEXT_LEVEL = 1;
const PREFS_KEY = "presidenten-assist:prefs";

interface Prefs {
  helpMe: boolean;
  useHistory: boolean;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return { helpMe: true, useHistory: true, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { helpMe: true, useHistory: true };
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
  mount(panel: HTMLElement, ctx: GameContext): void;
  /** Call on every new view, before rendering. */
  update(view: PresidentenView, ctx: GameContext): void;
  /** Highlights for the current view (empty when no hint applies). */
  marks(): HintMarks;
  /** Call right before sending a move, to track whether hints are followed. */
  noteMove(move: PresidentenMove): void;
  /** Whether help is active for me this round (for the seat badge). */
  active(): boolean;
}

/** `onChange` re-renders the table after a local switch is flipped. */
export function createAssist(onChange: () => void): Assist {
  let ctx: GameContext;
  let panel: HTMLElement;
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

  const $ = <T extends HTMLElement>(sel: string) => panel.querySelector(sel) as T;

  /** Store per nickname; a demo profile uses a throwaway in-memory history. */
  function getStore(): ContextStore {
    if (!store) {
      store = demo
        ? new MemoryStore(demoHistory(demo, Date.now()))
        : new LocalStorageStore(ctx.nickname(ctx.playerId));
    }
    return store;
  }

  function decide(): HelpDecision {
    const summary = summarize(getStore().load(), Date.now());
    return computeHelp(summary, { useContext: prefs.useHistory, fixedLevel: NO_CONTEXT_LEVEL });
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
      const input = {
        hand: v.myHand,
        currentCount: v.currentCount,
        currentRankValue: v.currentRank ? RANK_VALUES[v.currentRank as Rank] : null,
      };
      const options = advise(input);
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

  function renderPanel(): void {
    if (!panel || !view) return;
    const v = view;
    const d = decision;
    const isHost = ctx.hostId === v.selfId;
    const on = enabled(v);
    const level = d && on ? d.level : 0;

    $(".pr-assist-level").textContent = !v.assistEnabled
      ? "off (host)"
      : !prefs.helpMe ? "off" : `level ${level}`;
    $<HTMLInputElement>(".pr-assist-helpme").checked = prefs.helpMe;
    $<HTMLInputElement>(".pr-assist-history").checked = prefs.useHistory;
    const roomBox = $<HTMLInputElement>(".pr-assist-room");
    roomBox.checked = v.assistEnabled;
    $(".pr-assist-host").hidden = !isHost;
    $(".pr-assist-hostnote").hidden = isHost || v.assistEnabled;

    // Transparency: why this level?
    const why = $(".pr-assist-why");
    why.innerHTML = "";
    if (d && d.usedContext) {
      for (const f of d.factors) {
        const row = document.createElement("tr");
        for (const text of [f.label, f.value, `+${f.contribution.toFixed(2)}`]) {
          const td = document.createElement("td");
          td.textContent = text;
          row.append(td);
        }
        why.append(row);
      }
      const total = document.createElement("tr");
      total.className = "pr-assist-total";
      for (const text of ["Help score", "", d.score.toFixed(2)]) {
        const td = document.createElement("td");
        td.textContent = text;
        total.append(td);
      }
      why.append(total);
    }
    $(".pr-assist-nocontext").hidden = !d || d.usedContext;

    const history = getStore().load();
    const summary = summarize(history, Date.now());
    $(".pr-assist-memory").textContent = demo
      ? `Demo profile "${demo}" (not saved).`
      : `${history.length} round(s) remembered for ${ctx.nickname(v.selfId)}`
        + (summary.hintsShown ? ` · hints followed ${summary.hintsFollowed}/${summary.hintsShown}` : "")
        + ".";
  }

  return {
    mount(el, context) {
      ctx = context;
      panel = el;
      try {
        const q = new URLSearchParams(location.search).get("assistDemo");
        if (q === "weak" || q === "strong") demo = q;
      } catch {
        // no URL access: no demo
      }

      $<HTMLInputElement>(".pr-assist-helpme").addEventListener("change", (e) => {
        prefs = { ...prefs, helpMe: (e.target as HTMLInputElement).checked };
        savePrefs(prefs);
        refresh();
      });
      $<HTMLInputElement>(".pr-assist-history").addEventListener("change", (e) => {
        prefs = { ...prefs, useHistory: (e.target as HTMLInputElement).checked };
        savePrefs(prefs);
        decision = decide(); // takes effect immediately, for the demo
        refresh();
      });
      $<HTMLInputElement>(".pr-assist-room").addEventListener("change", (e) => {
        ctx.sendMove({ type: "setAssist", enabled: (e.target as HTMLInputElement).checked });
      });
      $(".pr-assist-forget").addEventListener("click", () => {
        if (!confirm("Delete your Presidenten history from this browser?")) return;
        getStore().clear();
        decision = decide();
        refresh();
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
        decision = decide();
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
      current = computeMarks(v);
      if (current.hint) shownKeys.add(current.key);
      renderPanel();
    },

    marks: () => current.marks,

    noteMove(move) {
      if (current.best && current.hint && followsAdvice(current.best, move)) followed++;
    },

    active: () => !!view && !!decision && enabled(view) && decision.level > 0,
  };

  /** Re-render after a local switch change (no new server view needed). */
  function refresh(): void {
    if (!view) return;
    current = computeMarks(view);
    if (current.hint) shownKeys.add(current.key);
    renderPanel();
    onChange();
  }
}
