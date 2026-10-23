// The DOM around the town: a compact HUD (resources, villagers, boosts), the
// open votes on the right, the popup on a clicked tile (build there, or upgrade the
// streets), the building inspector (which is the shop window for shops, and
// where buildings are torn down), the "choose a spot" banner for decorations
// and the path-drawing banner. Numbers refresh a few times a second; elements
// are kept, not rebuilt, so buttons never vanish under a click.

import {
  BOOST_MULT,
  ERAS,
  MAX_PATH_TILES,
  MAX_PROPOSALS,
  RESOURCES,
  STORAGE_CAP,
  actionError,
  assignWorkers,
  buildCost,
  buildTypeError,
  buildableTypes,
  buildingName,
  buildingType,
  canAfford,
  capOf,
  decorTypes,
  fullRateOf,
  gatherable,
  gatheringOf,
  housingOf,
  isRiver,
  isRoad,
  itemCost,
  itemError,
  itemLevel,
  itemsOf,
  multiplierAt,
  outfitCost,
  outfitError,
  outfitsFor,
  pathCost,
  FOOD_KINDS,
  foodKindsOf,
  pathError,
  placeError,
  ratesOf,
  refundOf,
  resourceDef,
  roadCost,
  roadName,
  scaleOf,
  shopItem,
  shortfall,
  slotsAt,
  slotsOf,
  sourceLeft,
  sourceShareOf,
  terrainAt,
  tileIndex,
  tileOf,
  tradeQuote,
  tradeRate,
  unlockedResources,
  upgradeCost,
  type Amounts,
  type BuildingType,
  type DecorBehavior,
  type IdleClientMsg,
  type IdleProposalView,
  type IdleStateMsg,
  type IdleWorld,
  type PlacedBuilding,
  type ProposalAction,
  type ShopItem,
  type Terrain,
} from "@app/shared/idle";
import { session } from "../session";
import { NPCS_PER_PLAYER, type Gather, type VillagerInfo } from "./villagers";

const TICK_MS = 300;

const compact = new Intl.NumberFormat("nl-NL", { notation: "compact", maximumFractionDigits: 1 });
/** 7 · 12,5 · 1,2K · 3,4 mln. — floored so it never shows more than there is. */
export function fmt(n: number): string {
  return compact.format(n < 100 ? Math.floor(n * 10) / 10 : Math.floor(n));
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
export function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = h("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Cost chips; what's missing is red with how much is still needed. */
export function costChips(world: IdleWorld, cost: Amounts): HTMLElement[] {
  const missing = shortfall(world, cost);
  return Object.entries(cost).map(([id, n]) => {
    const short = missing[id];
    const chip = h("span", short ? "sx-cost sx-cost-short" : "sx-cost", `${resourceDef(id)?.emoji ?? id} ${fmt(n)}`);
    chip.title = short ? `nog ${fmt(short)} ${resourceDef(id)?.name ?? id} nodig` : resourceDef(id)?.name ?? id;
    return chip;
  });
}

/** What comes back (tearing down): "+🪵 7" chips. */
function gainChips(gain: Amounts): HTMLElement[] {
  const entries = Object.entries(gain);
  if (!entries.length) return [h("span", "sx-cost", "niets terug")];
  return entries.map(([id, n]) => {
    const chip = h("span", "sx-cost", `+${resourceDef(id)?.emoji ?? id} ${fmt(n)}`);
    chip.title = `${fmt(n)} ${resourceDef(id)?.name ?? id} terug`;
    return chip;
  });
}

function missingText(world: IdleWorld, cost: Amounts): string {
  const m = Object.entries(shortfall(world, cost));
  return m.length ? `nog ${m.map(([id, n]) => `${fmt(Math.ceil(n))} ${resourceDef(id)?.emoji ?? id}`).join(" + ")} nodig` : "";
}

function effectText(world: IdleWorld, t: BuildingType): string {
  const era = world.era;
  if (t.category === "house") return `👥 +${housingOf(era)} inwoners`;
  if (t.category === "storage") return `📦 +${fmt(STORAGE_CAP * scaleOf(era))} opslag per grondstof`;
  if (t.category === "decor") return "✨ puur voor de sier (de inwoners vinden het geweldig)";
  if (t.category === "shop") return `🛒 winkel: ${shopBlurb(t.id)}`;
  if (t.produces) {
    const rate = fullRateOf({ id: 0, type: t.id, level: era, x: 0, y: 0 });
    const kind = t.foodKind ? ` (${foodKindText(t.foodKind)})` : "";
    const less = t.sparesSource ? " · minder als het bos rondom gekapt is" : "";
    return `${resourceDef(t.produces)?.emoji} +${fmt(rate)}/s${kind} met ${slotsOf(era)} werkers${less}`;
  }
  return "";
}

const SHOP_BLURBS: Record<string, string> = {
  shop_market: "grondstoffen ruilen",
  shop_sculptor: "decoraties",
  shop_tavern: "boosts",
  shop_smith: "beter gereedschap",
  shop_bank: "kluis en handelsakkoorden",
  shop_university: "onderzoek",
  shop_lab: "automatisering",
  shop_spaceport: "tijdsprongen",
  shop_tailor: "kleding voor je eigen NPC",
};
const shopBlurb = (id: string) => SHOP_BLURBS[id] ?? "";

const TERRAIN_NAMES: Record<Terrain, string> = {
  grass: "🌱 Gras", sand: "🏖️ Zand", water: "🌊 Water", bridge: "🌉 Brug", forest: "🌲 Bos", rock: "🪨 Rotsen",
  mountain: "⛰️ Berg", bush: "🫐 Bessenstruik", deposit: "💎 Ertsader",
};

const DECOR_BEHAVIOR: Record<DecorBehavior, string> = {
  dance: "💃 de inwoners dansen erbij",
  photo: "📸 de inwoners maken er foto's",
  pose: "🧍 de inwoners poseren erbij",
  sit: "🪑 de inwoners zitten erbij",
};

const SOURCE_NAMES: Record<string, string> = { wood: "🌲 Bos", stone: "🪨 Rotsen" };

const foodKindText = (id: string): string => {
  const k = FOOD_KINDS.find((f) => f.id === id);
  return k ? `${k.emoji} ${k.name}` : id;
};

/** "🌾 graan 1/s · 🥩 vlees 2/s": the food the town makes per second, by kind. */
function menuText(world: IdleWorld): string {
  const kinds = foodKindsOf(world);
  const parts = FOOD_KINDS.filter((k) => kinds[k.id]).map((k) => `${k.emoji} ${k.name} ${fmt(kinds[k.id]!)}/s`);
  return parts.length ? parts.join(" · ") : "niets: bouw een jagerskamp, akker of visserij";
}

const timeLeft = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)} u ${String(Math.floor(s / 60) % 60).padStart(2, "0")}`;
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : `${s} s`;
};

/** One buyable thing: name, effect, cost, what's missing and a button. Refreshed by `update`. */
interface Offer {
  el: HTMLDivElement;
  update(world: IdleWorld, busy: boolean, connected: boolean): void;
}

function offer(opts: {
  emoji: string;
  name: string;
  effect: string;
  action: string;
  now?: boolean;
  onClick: () => void;
  cost: (w: IdleWorld) => Amounts;
  /** Shown instead of the cost when something comes back. */
  gain?: (w: IdleWorld) => Amounts;
  error: (w: IdleWorld) => string | null;
  level?: (w: IdleWorld) => string;
  /** Votes block this offer while there are too many open. */
  votes: boolean;
}): Offer {
  const el = h("div", "sx-offer");
  const top = h("div", "sx-offer-top");
  const level = h("span", "sx-offer-level");
  top.append(h("span", "sx-offer-emoji", opts.emoji), h("span", "", opts.name), level);
  const row = h("div", "sx-offer-row");
  const costs = h("div", "sx-costs");
  const btn = button(opts.now ? "sx-act sx-act-now" : "sx-act", opts.action, opts.onClick);
  row.append(costs, btn);
  const missing = h("div", "sx-missing");
  el.append(top, h("div", "sx-offer-effect", opts.effect), row, missing);
  return {
    el,
    update(world, busy, connected) {
      const cost = opts.cost(world);
      costs.replaceChildren(...(opts.gain ? gainChips(opts.gain(world)) : costChips(world, cost)));
      const err = opts.error(world);
      missing.textContent = err === "te duur" ? missingText(world, cost) : err ?? "";
      level.textContent = opts.level?.(world) ?? "";
      const blocked = opts.votes && busy;
      btn.disabled = !connected || blocked || !!err;
      btn.title = !connected ? "offline" : blocked ? "te veel open stemmingen" : err ?? "";
    },
  };
}

export interface PanelDeps {
  send(msg: IdleClientMsg): void;
  /** The latest server message, or null before the first. */
  msg(): IdleStateMsg | null;
  /** The town produced up to (estimated) server time. */
  world(): IdleWorld | null;
  serverNow(): number;
  connected(): boolean;
  select(id: number | null): void;
  selectVillager(id: string | null): void;
  /** What a villager is up to, or null if they're gone. */
  villager(id: string): VillagerInfo | null;
  /** Show a villager's new task right away (the server confirms it). */
  setGather(id: string, g: Gather | null): void;
  setPlacing(ok: ((x: number, y: number) => boolean) | null): void;
  mark(tile: { x: number; y: number } | null): void;
  setGhost(action: ProposalAction | null): void;
  /** Move the view to a tile. */
  lookAt(x: number, y: number): void;
  setPainting(ok: ((x: number, y: number) => boolean) | null): void;
  setDraft(draft: { tiles: Iterable<number>; erase: boolean } | null): void;
  /** Open the editor for your own NPC. */
  openAvatar(): void;
}

export interface Panels {
  inspect(b: PlacedBuilding | null): void;
  /** Show who this villager is and what they do. */
  inspectVillager(id: string): void;
  /** A tile was clicked (land, or anything while placing). */
  tile(x: number, y: number, px: number, py: number): void;
  /** Drawing paths: the pointer touched a tile. */
  paint(x: number, y: number, first: boolean): void;
  refresh(): void;
}

export function createPanels(deps: PanelDeps): Panels {
  const hud = $<HTMLDivElement>("sx-hud");
  const vote = $<HTMLDivElement>("sx-vote");
  const inspectEl = $<HTMLDivElement>("sx-inspect");
  const placeEl = $<HTMLDivElement>("sx-place");
  const banner = $<HTMLDivElement>("sx-banner");
  const recenterBtn = $<HTMLButtonElement>("sx-recenter");
  const pathsBtn = $<HTMLButtonElement>("sx-paths");

  const propose = (action: ProposalAction) => deps.send({ type: "propose", action, name: session.nickname });
  /** No more proposals can be opened. */
  const busy = () => (deps.msg()?.proposals.length ?? 0) >= MAX_PROPOSALS;

  recenterBtn.addEventListener("click", () => window.dispatchEvent(new CustomEvent("sx-recenter")));
  pathsBtn.addEventListener("click", () => (paths ? stopPaths() : startPaths(false)));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    stopPlacing();
    stopPaths();
    closePlace();
    inspect(null);
  });

  // ---------- HUD ----------

  let hudEra = -1;
  /** Per resource: the chip, its text and the bar showing how full storage is. */
  const hudChips = new Map<string, { chip: HTMLSpanElement; text: HTMLSpanElement; fill: HTMLSpanElement }>();
  const popChip = h("span", "sx-hud-chip sx-hud-pop");
  const boostBox = h("span");
  boostBox.style.display = "contents";

  function renderHud(world: IdleWorld, now: number): void {
    if (hudEra !== world.era) {
      hudEra = world.era;
      hud.replaceChildren();
      hudChips.clear();
      for (const r of RESOURCES.filter((r) => r.era <= world.era)) {
        const chip = h("span", "sx-hud-chip sx-hud-res");
        const text = h("span");
        const bar = h("span", "sx-hud-bar");
        const fill = h("span", "sx-hud-fill");
        bar.append(fill);
        chip.append(text, bar);
        hud.append(chip);
        hudChips.set(r.id, { chip, text, fill });
      }
      hud.append(popChip, boostBox);
    }
    const cap = capOf(world);
    const rates = ratesOf(world);
    for (const [id, { chip, text, fill }] of hudChips) {
      const have = world.resources[id] ?? 0;
      const rate = (rates[id] ?? 0) * multiplierAt(world, id, now);
      text.textContent = `${resourceDef(id)!.emoji} ${fmt(have)}${rate ? ` +${fmt(rate)}/s` : ""}`;
      fill.style.width = `${Math.min(100, (have / cap) * 100)}%`;
      chip.classList.toggle("sx-hud-full", have >= cap);
      chip.title =
        `${resourceDef(id)!.name}: ${fmt(have)} van max ${fmt(cap)}${have >= cap ? " — vol! bouw opslag" : ""}` +
        (id === "food" ? `
${menuText(world)}` : "");
    }
    const wf = assignWorkers(world);
    popChip.textContent = `👥 ${wf.population} (${wf.population - wf.idle} werken)`;
    popChip.title =
      `${wf.population} inwoners, ${wf.idle} zonder werk · opslag max ${fmt(cap)} per grondstof` +
      ` · op de kaart lopen er ${NPCS_PER_PLAYER} per speler online rond`;

    const boosts: string[] = [];
    if (world.boostUntil > now) boosts.push(`⚡ ×${BOOST_MULT} ${timeLeft(world.boostUntil - now)}`);
    for (const b of world.boosts) {
      if (b.until <= now) continue;
      const item = shopItem(b.item);
      boosts.push(`${item?.emoji ?? "✨"} ${b.resource ? resourceDef(b.resource)?.emoji ?? "" : "alles"} ×${b.mult} ${timeLeft(b.until - now)}`);
    }
    if (boostBox.childElementCount !== boosts.length) {
      boostBox.replaceChildren(...boosts.map(() => h("span", "sx-hud-chip sx-hud-boost")));
    }
    boosts.forEach((text, i) => (boostBox.children[i].textContent = text));
  }

  // ---------- open votes, on the right (and the ghost of what one would do) ----------

  /** Where a proposal happens, to look at it; null for town-wide things. */
  function spotOf(p: IdleProposalView): { x: number; y: number } | null {
    const a = p.action;
    if (a.kind === "build") return a;
    if (a.kind === "paths" || a.kind === "unpave") return a.tiles.length ? tileOf(a.tiles[0]) : null;
    if (a.kind === "upgrade" || a.kind === "demolish") return deps.world()?.buildings.find((b) => b.id === a.building) ?? null;
    return null;
  }

  interface VoteRow {
    el: HTMLLIElement;
    label: HTMLButtonElement;
    sub: HTMLDivElement;
    yes: HTMLButtonElement;
    no: HTMLButtonElement;
    count: HTMLSpanElement;
  }

  const voteHead = button("sx-votes-head", "", () => {
    votesOpen = !votesOpen;
    renderVotes(deps.serverNow());
  });
  const voteList = h("ul", "sx-votes-list");
  vote.append(voteHead, voteList);
  const rows = new Map<number, VoteRow>();
  /** Collapsed by default on small screens, where the list would cover the town. */
  let votesOpen = !window.matchMedia("(max-width: 640px)").matches;
  /** The vote whose ghost shows: picked by clicking it, or hovered. */
  let picked: number | null = null;
  let hovered: number | null = null;

  function voteRow(id: number): VoteRow {
    const el = h("li", "sx-votes-item");
    const label = button("sx-votes-label", "", () => {
      picked = picked === id ? null : id;
      const p = deps.msg()?.proposals.find((x) => x.id === id);
      const spot = p && picked === id ? spotOf(p) : null;
      if (spot) deps.lookAt(spot.x, spot.y);
      renderVotes(deps.serverNow());
    });
    label.title = "laat zien waar";
    const sub = h("div", "sx-votes-sub");
    const row = h("div", "sx-vote-row");
    const yes = button("sx-vote-btn", "👍 ja", () => deps.send({ type: "vote", id, yes: true }));
    const no = button("sx-vote-btn sx-vote-no", "👎 nee", () => deps.send({ type: "vote", id, yes: false }));
    const count = h("span", "sx-vote-count");
    row.append(yes, count, no);
    el.append(label, sub, row);
    el.addEventListener("pointerenter", () => (hovered = id));
    el.addEventListener("pointerleave", () => hovered === id && (hovered = null));
    return { el, label, sub, yes, no, count };
  }

  function renderVotes(now: number): void {
    const list = deps.msg()?.proposals ?? [];
    vote.hidden = !list.length;
    // Below the counter bar (and a banner, when one shows), above the round buttons.
    const top = Math.round((document.querySelector(".sx-topstack") as HTMLElement).getBoundingClientRect().bottom + 8);
    vote.style.top = `${top}px`;
    vote.style.maxHeight = `calc(100vh - ${top}px - 90px)`;
    const ids = new Set(list.map((p) => p.id));
    for (const [id, r] of rows) {
      if (ids.has(id)) continue;
      r.el.remove();
      rows.delete(id);
    }
    if (picked !== null && !ids.has(picked)) picked = null;
    const shown = list.find((p) => p.id === (hovered ?? picked)) ?? (list.length === 1 ? list[0] : null);
    deps.setGhost(shown?.action ?? null);
    voteHead.textContent = `🗳️ Stemmingen (${list.length}) ${votesOpen ? "▾" : "▸"}`;
    voteHead.setAttribute("aria-expanded", String(votesOpen));
    voteList.hidden = !votesOpen;
    list.forEach((p, i) => {
      let r = rows.get(p.id);
      if (!r) rows.set(p.id, (r = voteRow(p.id)));
      // The server's order, oldest first; only moved when needed, so a click never lands on a moving row.
      if (voteList.children[i] !== r.el) voteList.insertBefore(r.el, voteList.children[i] ?? null);
      r.el.classList.toggle("sx-votes-picked", p.id === picked);
      r.label.textContent = p.label;
      r.sub.textContent = p.approved
        ? `${p.by} · ✅ aangenomen, wacht op grondstoffen · nog ${timeLeft(p.deadline - now)}`
        : `${p.by} · nog ${timeLeft(p.deadline - now)}`;
      r.count.textContent = `👍 ${p.yes} · 👎 ${p.no} · nodig ${p.needed}`;
      r.yes.setAttribute("aria-pressed", String(p.myVote === true));
      r.no.setAttribute("aria-pressed", String(p.myVote === false));
      r.yes.disabled = r.no.disabled = !deps.connected();
    });
  }

  // ---------- placing a decoration ----------

  let placing: BuildingType | null = null;
  const bannerText = h("span");
  const placingParts = [bannerText, button("sx-act", "✕ stoppen", () => stopPlacing())];

  function startPlacing(t: BuildingType): void {
    const world = deps.world();
    if (!world) return;
    stopPaths();
    placing = t;
    inspect(null);
    closePlace();
    banner.className = "sx-banner";
    banner.replaceChildren(...placingParts);
    bannerText.textContent = `📍 Klik op een plek voor ${t.emoji} ${buildingName(t.id, world.era)} · Esc = stoppen`;
    banner.hidden = false;
    deps.setPlacing((x, y) => {
      const w = deps.world();
      return !!w && !placeError(w.buildings, w.roads, t.id, x, y);
    });
  }

  function stopPlacing(): void {
    if (!placing) return;
    placing = null;
    banner.hidden = true;
    deps.setPlacing(null);
  }

  function placeAt(x: number, y: number): void {
    const world = deps.world();
    if (!world || !placing) return;
    const err = placeError(world.buildings, world.roads, placing.id, x, y);
    if (err) {
      bannerText.textContent = `❌ ${err} — probeer een andere plek (Esc = stoppen)`;
      return;
    }
    propose({ kind: "build", type: placing.id, x, y });
    stopPlacing();
  }

  // ---------- drawing paths ----------
  // Drag over tiles to draw (or pick paths to remove), then propose it all at once.

  /** The drawing under way; `adding` is whether the current stroke adds tiles or takes them off again. */
  let paths: { erase: boolean; tiles: Set<number>; adding: boolean } | null = null;
  const pathsText = h("span");
  /** Switching between laying and removing starts a new drawing. */
  const tool = (erase: boolean) => () => {
    if (paths?.erase !== erase) startPaths(erase);
  };
  const layBtn = button("sx-act", "🛤️ leggen", tool(false));
  const eraseBtn = button("sx-act", "⛏️ weghalen", tool(true));
  const pathsCosts = h("div", "sx-costs");
  const pathsMissing = h("span", "sx-missing");
  const pathsGo = button("sx-act sx-act-now", "🗳️ voorstellen", () => proposePaths());
  const pathsParts = [pathsText, layBtn, eraseBtn, pathsCosts, pathsMissing, pathsGo, button("sx-act", "✕ stoppen", () => stopPaths())];

  /** Can this tile be drawn on in the current mode? */
  const paintable = (w: IdleWorld, erase: boolean, x: number, y: number) =>
    erase ? isRoad(w.roads, x, y) : !pathError(w.buildings, w.roads, x, y);

  const pathsAction = (): ProposalAction | null =>
    paths && { kind: paths.erase ? "unpave" : "paths", tiles: [...paths.tiles] };

  /** Start drawing (or switch between laying and removing, which starts over), optionally from a tile. */
  function startPaths(erase: boolean, from?: { x: number; y: number }): void {
    stopPlacing();
    inspect(null);
    closePlace();
    paths = { erase, tiles: new Set(), adding: true };
    const w = deps.world();
    if (from && w && paintable(w, erase, from.x, from.y)) paths.tiles.add(tileIndex(from.x, from.y));
    pathsText.textContent = erase
      ? "⛏️ Sleep over paden om ze weg te halen"
      : "🛤️ Sleep over tegels: een pad, dwars door de natuur of als brug over de rivier";
    layBtn.setAttribute("aria-pressed", String(!erase));
    eraseBtn.setAttribute("aria-pressed", String(erase));
    banner.className = "sx-banner sx-banner-paths";
    banner.replaceChildren(...pathsParts);
    banner.hidden = false;
    pathsBtn.setAttribute("aria-pressed", "true");
    deps.setPainting((x, y) => {
      const w = deps.world();
      return !!w && paintable(w, erase, x, y);
    });
    deps.setDraft({ tiles: paths.tiles, erase });
    renderPaths();
  }

  function stopPaths(): void {
    if (!paths) return;
    paths = null;
    banner.hidden = true;
    pathsBtn.setAttribute("aria-pressed", "false");
    deps.setPainting(null);
    deps.setDraft(null);
  }

  function paint(x: number, y: number, first: boolean): void {
    const w = deps.world();
    if (!w || !paths) return;
    const i = tileIndex(x, y);
    // A stroke that starts on a drawn tile takes tiles off the drawing again.
    if (first) paths.adding = !paths.tiles.has(i);
    if (!paths.adding) paths.tiles.delete(i);
    else if (paths.tiles.size < MAX_PATH_TILES && paintable(w, paths.erase, x, y)) paths.tiles.add(i);
    renderPaths();
  }

  function proposePaths(): void {
    const action = pathsAction();
    if (!action) return;
    propose(action);
    stopPaths();
  }

  function renderPaths(): void {
    const w = deps.world();
    const action = pathsAction();
    if (!w || !paths || !action) return;
    const tiles = [...paths.tiles];
    const n = tiles.length;
    const bridges = tiles.filter((i) => isRiver(tileOf(i).x, tileOf(i).y)).length;
    const count = `${n === 1 ? "1 tegel" : `${n} tegels`}${n >= MAX_PATH_TILES ? " (max)" : ""}${bridges ? `, waarvan ${bridges} brug` : ""}:`;
    pathsCosts.replaceChildren(
      ...(!n
        ? [h("span", "sx-cost", paths.erase ? "nog geen paden gekozen" : "nog geen tegels")]
        : [h("span", "sx-cost", count), ...(paths.erase ? gainChips(refundOf(w, action)) : costChips(w, pathCost(w, tiles)))]),
    );
    const err = n ? actionError(w, action) : null;
    pathsMissing.textContent = err === "te duur" ? missingText(w, pathCost(w, tiles)) : err ?? "";
    const blocked = busy();
    pathsGo.disabled = !deps.connected() || blocked || !n || !!err;
    pathsGo.title = !deps.connected() ? "offline" : blocked ? "te veel open stemmingen" : !n ? "teken eerst een paar tegels" : err ?? "";
  }

  // ---------- build popup on a free tile ----------

  let placeTile: { x: number; y: number } | null = null;
  let placeSig = "";
  let placeOffers: Offer[] = [];
  const placeTitle = h("h3", "sx-panel-title");
  const placeSub = h("p", "sx-panel-sub");
  const placeBody = h("div", "sx-ins-actions");
  placeEl.append(button("sx-x", "✕", () => closePlace()), placeTitle, placeSub, placeBody);
  placeEl.querySelector(".sx-x")!.setAttribute("aria-label", "sluiten");

  function openPlace(x: number, y: number, px: number, py: number): void {
    placeTile = { x, y };
    placeSig = "";
    deps.mark(placeTile);
    placeEl.hidden = false;
    renderPlace();
    // Next to the click, inside the screen and below the counter bar.
    const top = (document.querySelector(".sx-topstack") as HTMLElement).getBoundingClientRect().bottom + 8;
    const w = placeEl.offsetWidth;
    const hgt = placeEl.offsetHeight;
    placeEl.style.left = `${Math.max(8, Math.min(px + 16, window.innerWidth - w - 8))}px`;
    placeEl.style.top = `${Math.max(top, Math.min(py - hgt / 2, window.innerHeight - hgt - 8))}px`;
  }

  function closePlace(): void {
    placeTile = null;
    placeEl.hidden = true;
    deps.mark(null);
  }

  function renderPlace(): void {
    const world = deps.world();
    if (!world || !placeTile) return;
    const { x, y } = placeTile;
    const sig = `${x},${y}|${world.era}|${world.buildings.length}|${world.roadLevel}|${world.roads.length}`;
    if (sig !== placeSig) {
      placeSig = sig;
      placeOffers = [];
      placeTitle.textContent = `${TERRAIN_NAMES[terrainAt(x, y)]} (${x}, ${y})`;
      placeBody.replaceChildren();
      if (isRoad(world.roads, x, y)) {
        placeTitle.textContent = isRiver(x, y) ? `🌉 Brug (${roadName(world.roadLevel).toLowerCase()})` : `🛣️ ${roadName(world.roadLevel)}`;
        placeSub.textContent = "De straten van het hele dorp gaan samen omhoog.";
        placeBody.append(
          button("sx-act sx-act-now", "⛏️ Paden weghalen", () => startPaths(true, { x, y })),
          button("sx-act", "🛤️ Paden tekenen", () => startPaths(false)),
        );
        if (world.roadLevel < world.era) {
          const o = offer({
            emoji: "⬆️",
            name: `Upgrade naar ${roadName(world.era).toLowerCase()}`,
            effect: `${ERAS[world.era].emoji} ${ERAS[world.era].name} · alle straten in één keer`,
            action: "🗳️ voorstellen",
            votes: true,
            onClick: () => {
              propose({ kind: "roads" });
              closePlace();
            },
            cost: (w) => roadCost(w),
            error: (w) => actionError(w, { kind: "roads" }),
          });
          placeBody.append(o.el);
          placeOffers.push(o);
        } else {
          placeBody.append(h("p", "sx-note", "✓ De straten zijn helemaal bij voor dit tijdperk."));
        }
      } else {
        const fits: BuildingType[] = [];
        const elsewhere: string[] = [];
        for (const t of buildableTypes(world)) {
          const err = placeError(world.buildings, world.roads, t.id, x, y);
          if (err) elsewhere.push(`${t.emoji} ${buildingName(t.id, world.era)}: ${err}`);
          else fits.push(t);
        }
        placeSub.textContent = fits.length ? "Wat bouwen we hier? Iedereen stemt mee." : "Hier past niets.";
        if (!pathError(world.buildings, world.roads, x, y)) {
          placeBody.append(button("sx-act", "🛤️ Pad tekenen vanaf hier", () => startPaths(false, { x, y })));
        }
        for (const t of fits) {
          const o = offer({
            emoji: t.emoji,
            name: buildingName(t.id, world.era),
            effect: effectText(world, t),
            action: "🗳️ voorstellen",
            votes: true,
            onClick: () => {
              propose({ kind: "build", type: t.id, x, y });
              closePlace();
            },
            cost: (w) => buildCost(w, t.id)!,
            error: (w) => actionError(w, { kind: "build", type: t.id, x, y }),
          });
          placeBody.append(o.el);
          placeOffers.push(o);
        }
        if (elsewhere.length) {
          const note = h("details", "sx-note");
          note.append(h("summary", "", `Niet hier (${elsewhere.length})`), ...elsewhere.map((t) => h("div", "", t)));
          placeBody.append(note);
        }
      }
    }
    for (const o of placeOffers) o.update(world, busy(), deps.connected());
  }

  // ---------- inspector / shop window ----------

  let inspected: number | null = null;
  let inspectSig = "";
  const insTitle = h("h3", "sx-panel-title");
  const insInfo = h("div", "sx-ins-info");
  const insActions = h("div", "sx-ins-actions");
  const insClose = button("sx-x", "✕", () => inspect(null));
  insClose.setAttribute("aria-label", "sluiten");
  inspectEl.append(insClose, insTitle, insInfo, insActions);
  let insOffers: Offer[] = [];
  let insLive: (() => void) | null = null;

  let villagerId: string | null = null;

  function inspect(b: PlacedBuilding | null): void {
    inspected = b?.id ?? null;
    inspectSig = "";
    villagerId = null;
    deps.selectVillager(null);
    if (b) {
      closePlace();
      stopPlacing();
      stopPaths();
    }
    deps.select(inspected);
    renderInspector();
  }

  /** The market: pick what to give and what to get, trade a share of what we have. */
  function marketPanel(world: IdleWorld): () => void {
    const ids = unlockedResources(world.era);
    const select = (value: string) => {
      const s = h("select", "sx-select");
      for (const id of ids) {
        const o = h("option", "", `${resourceDef(id)!.emoji} ${resourceDef(id)!.name}`);
        o.value = id;
        s.append(o);
      }
      s.value = value;
      return s;
    };
    const from = select("wood");
    const to = select("stone");
    from.setAttribute("aria-label", "geef");
    to.setAttribute("aria-label", "krijg");
    const row = h("div", "sx-trade");
    row.append(from, h("span", "", "→"), to);
    const rate = h("div", "sx-trade-rate");
    const btns = h("div", "sx-trade-btns");
    const shares = [0.1, 0.5, 1] as const;
    const shareBtns = shares.map((share) =>
      button("sx-act sx-act-now", share === 1 ? "alles" : `${share * 100}%`, () => {
        const w = deps.world();
        if (!w) return;
        deps.send({ type: "trade", from: from.value, to: to.value, amount: (w.resources[from.value] ?? 0) * share, name: session.nickname });
      }),
    );
    btns.append(...shareBtns);
    insActions.append(h("h4", "sx-h", "🔁 Ruilen (meteen)"), row, rate, btns, h("p", "sx-note", "Wat veel gekocht wordt, wordt even duurder."));
    return () => {
      const w = deps.world();
      if (!w) return;
      const r = tradeRate(w, from.value, to.value);
      const all = tradeQuote(w, from.value, to.value, w.resources[from.value] ?? 0);
      rate.textContent =
        from.value === to.value
          ? "kies twee verschillende grondstoffen"
          : `1 ${resourceDef(from.value)!.emoji} → ${r.toFixed(2).replace(".", ",")} ${resourceDef(to.value)!.emoji}` +
            (typeof all === "string" ? ` · ${all}` : ` · alles: ${fmt(all.give)} → ${fmt(all.get)}`);
      shares.forEach((share, i) => {
        const q = tradeQuote(w, from.value, to.value, (w.resources[from.value] ?? 0) * share);
        shareBtns[i].disabled = !deps.connected() || typeof q === "string";
        shareBtns[i].title = typeof q === "string" ? q : `${fmt(q.give)} ${resourceDef(from.value)!.emoji} → ${fmt(q.get)} ${resourceDef(to.value)!.emoji}`;
      });
    };
  }

  function itemOffer(item: ShopItem): Offer {
    const e = item.effect;
    return offer({
      emoji: item.emoji,
      name: item.name,
      effect: item.desc,
      action: item.vote ? "🗳️ voorstellen" : "kopen",
      now: !item.vote,
      votes: item.vote,
      onClick: () =>
        item.vote ? propose({ kind: "buy", item: item.id }) : deps.send({ type: "buy", item: item.id, name: session.nickname }),
      cost: (w) => itemCost(w, item),
      error: (w) => itemError(w, item.id),
      level: e.kind === "perk" ? (w) => `${itemLevel(w, item)}/${e.max}` : undefined,
    });
  }

  function inspectVillager(id: string): void {
    inspect(null);
    closePlace();
    stopPlacing();
    stopPaths();
    villagerId = id;
    deps.selectVillager(id);
    renderInspector();
  }

  /** Put the villager in the panel on a resource (null: let them choose). */
  function chooseGather(to: string | null): void {
    const id = villagerId;
    const cur = id === null ? null : deps.villager(id)?.gather;
    if (id === null || !cur || !deps.connected()) return;
    if (to === null ? !cur.chosen : cur.chosen && cur.resource === to) return;
    deps.setGather(id, { resource: to ?? cur.resource, chosen: to !== null });
    deps.send({ type: "assign", from: cur.chosen ? cur.resource : null, to });
  }

  let gatherBtns: { id: string | null; btn: HTMLButtonElement }[] = [];

  function renderVillager(v: VillagerInfo): void {
    const world = deps.world();
    const options = v.gather && world ? gatherable(world.era) : [];
    const sig = `v:${villagerId}:${options.join(",")}`;
    if (sig !== inspectSig) {
      inspectSig = sig;
      insTitle.textContent = `🧍 ${v.name}`;
      insActions.replaceChildren();
      insOffers = [];
      insLive = null;
      gatherBtns = [];
      if (options.length) {
        const row = h("div", "sx-gather-btns");
        for (const id of [...options, null]) {
          const label = id ? `${resourceDef(id)!.emoji} ${resourceDef(id)!.name}` : "🎲 zelf laten kiezen";
          const btn = button("sx-act", label, () => chooseGather(id));
          gatherBtns.push({ id, btn });
          row.append(btn);
        }
        insActions.append(h("h4", "sx-h", "🧺 Wat gaat die verzamelen?"), row, h("p", "sx-note", "Wie geen werk heeft, verzamelt uit de natuur rond het dorp. Een baan levert veel meer op."));
      }
    }
    const lines = v.player
      ? [`🎮 ${v.player}`, v.doing]
      : [
          v.job
            ? `👷 werkt bij: ${v.job}`
            : v.gather
              ? `🧺 geen baan, verzamelt ${resourceDef(v.gather.resource)?.emoji ?? ""} ${resourceDef(v.gather.resource)?.name ?? ""} (${v.gather.chosen ? "gekozen" : "kiest zelf"})`
              : "😴 werkloos: bouw een werkgebouw met plek vrij",
          `🏠 woont in: ${v.home ?? "—"}`,
          `⏱️ nu: ${v.doing}`,
        ];
    insInfo.replaceChildren(...lines.map((l) => h("div", "", l)));
    for (const { id, btn } of gatherBtns) {
      const on = id === null ? !v.gather?.chosen : !!v.gather?.chosen && v.gather.resource === id;
      btn.setAttribute("aria-pressed", String(on));
      btn.disabled = !deps.connected();
    }
  }

  /** The campfire: who works, who gathers what, and choosing that for the whole town. */
  function workPanel(world: IdleWorld): () => void {
    const rows = gatherable(world.era).map((id) => {
      const text = h("span", "sx-gather-text");
      const less = button("sx-act", "−", () => deps.send({ type: "assign", from: id, to: null }));
      const more = button("sx-act", "+", () => deps.send({ type: "assign", from: null, to: id }));
      less.setAttribute("aria-label", `een ${resourceDef(id)!.name}-verzamelaar minder`);
      more.setAttribute("aria-label", `een ${resourceDef(id)!.name}-verzamelaar meer`);
      const row = h("div", "sx-gather-row");
      row.append(text, less, more);
      return { id, text, less, more, row };
    });
    const summary = h("div", "sx-note");
    const menu = h("div", "sx-note");
    insActions.append(
      h("h4", "sx-h", "👥 Wie doet wat"),
      summary,
      menu,
      ...rows.map((r) => r.row),
      h("p", "sx-note", "Met + zet je iemand zonder werk op die grondstof, met − laat je die weer zelf kiezen. Banen krijg je door werkgebouwen te bouwen."),
    );
    return () => {
      const w = deps.world();
      if (!w) return;
      const wf = assignWorkers(w);
      const { chosen, auto } = gatheringOf(w);
      const picked = Object.values(chosen).reduce((a, n) => a + n, 0);
      summary.textContent = `👷 ${wf.population - wf.idle} met een baan · 🧺 ${wf.idle} zonder baan, die verzamelen`;
      menu.textContent = `🍽️ Op het menu: ${menuText(w)}`;
      for (const r of rows) {
        const c = chosen[r.id] ?? 0;
        const n = c + (auto[r.id] ?? 0);
        const name = r.id === "food" ? `${resourceDef(r.id)!.name} (${foodKindText("berries")})` : resourceDef(r.id)!.name;
        r.text.textContent = `${resourceDef(r.id)!.emoji} ${name}: ${n}${c ? ` (${c} gekozen)` : ""}`;
        r.less.disabled = !deps.connected() || c === 0;
        r.more.disabled = !deps.connected() || picked >= wf.idle;
      }
    };
  }

  function renderInspector(): void {
    if (villagerId !== null) {
      const v = deps.villager(villagerId);
      inspectEl.hidden = !v;
      if (v) return renderVillager(v);
      villagerId = null;
      deps.selectVillager(null);
    }
    const world = deps.world();
    const b = world?.buildings.find((x) => x.id === inspected);
    inspectEl.hidden = !b;
    if (!world || !b) return;
    const t = buildingType(b.type)!;
    const sig = `${b.id}:${b.level}:${world.era}`;
    if (sig !== inspectSig) {
      inspectSig = sig;
      insTitle.textContent = `${t.emoji} ${buildingName(b.type, b.level)}`;
      insActions.replaceChildren();
      insOffers = [];
      insLive = null;
      if (b.type === "shop_market") insLive = marketPanel(world);
      if (t.category === "center") insLive = workPanel(world);
      if (b.type === "shop_tailor") {
        insActions.append(
          h("h4", "sx-h", "🧍 Jouw NPC"),
          button("sx-act sx-act-now", "Pas je NPC aan", () => deps.openAvatar()),
          h("h4", "sx-h", "👕 Te koop (voor jezelf)"),
        );
        for (const o of outfitsFor(world.era).filter((o) => o.cost)) {
          const off = offer({
            emoji: o.emoji,
            name: o.name,
            effect: o.kind === "hat" ? "hoofddeksel" : "patroon voor je kleren",
            action: "kopen",
            now: true,
            votes: false,
            onClick: () => deps.send({ type: "outfit", item: o.id }),
            cost: (w) => outfitCost(w, o),
            error: (w) => {
              const me = deps.msg()?.me;
              return me ? outfitError(w, me, o.id) : "eerst inloggen";
            },
          });
          insActions.append(off.el);
          insOffers.push(off);
        }
      }
      if (b.type === "shop_sculptor") {
        insActions.append(h("h4", "sx-h", "🗿 Decoraties"), h("p", "sx-note", "Kies er een, klik dan op een plek in het dorp. Daarna stemt iedereen."));
        for (const d of decorTypes(world.era)) {
          const o = offer({
            emoji: d.emoji,
            name: buildingName(d.id, world.era),
            effect: d.decor ? DECOR_BEHAVIOR[d.decor.behavior] : "",
            action: "📍 kies plek",
            votes: true,
            onClick: () => startPlacing(d),
            cost: (w) => buildCost(w, d.id)!,
            error: (w) => buildTypeError(w, d.id) ?? (canAfford(w, buildCost(w, d.id)!) ? null : "te duur"),
          });
          insActions.append(o.el);
          insOffers.push(o);
        }
      }
      const items = itemsOf(b.type, world.era);
      if (items.length) {
        insActions.append(h("h4", "sx-h", "🛒 Te koop"));
        for (const item of items) {
          const o = itemOffer(item);
          insActions.append(o.el);
          insOffers.push(o);
        }
      }
      if (!t.noUpgrade) {
        if (b.level < world.era) {
          const o = offer({
            emoji: "⬆️",
            name: `Upgrade naar ${buildingName(b.type, world.era)}`,
            effect: `${ERAS[world.era].emoji} ${ERAS[world.era].name}`,
            action: "🗳️ voorstellen",
            votes: true,
            onClick: () => propose({ kind: "upgrade", building: b.id }),
            cost: (w) => upgradeCost(w, b),
            error: (w) => actionError(w, { kind: "upgrade", building: b.id }),
          });
          insActions.append(o.el);
          insOffers.push(o);
        } else {
          insActions.append(h("p", "sx-note", "✓ Helemaal bij voor dit tijdperk."));
        }
      }
      if (t.category !== "center") {
        const demolish: ProposalAction = { kind: "demolish", building: b.id };
        const o = offer({
          emoji: "🧨",
          name: "Afbreken",
          effect: "Weg is weg; je krijgt een deel van de bouwkosten terug.",
          action: "🗳️ voorstellen",
          votes: true,
          onClick: () => propose(demolish),
          cost: () => ({}),
          gain: (w) => refundOf(w, demolish),
          error: (w) => actionError(w, demolish),
        });
        insActions.append(o.el);
        insOffers.push(o);
      }
    }
    // Live info.
    const lines: string[] = [`${ERAS[b.level].emoji} ${ERAS[b.level].name}`];
    if (t.category === "house") lines.push(`👥 ${housingOf(b.level)} inwoners`);
    if (t.category === "work" && t.produces) {
      const w = assignWorkers(world).workers[b.id] ?? 0;
      const slots = slotsAt(world, b);
      lines.push(`👷 ${w}/${slots} werkers`);
      const share = t.sparesSource ? sourceShareOf(world, b) : 1;
      const kind = t.foodKind ? ` ${foodKindText(t.foodKind)}` : "";
      lines.push(`${resourceDef(t.produces)?.emoji}${kind} ${fmt(((fullRateOf(b) * w) / slotsOf(b.level)) * share)}/s (zonder bonussen)${w < slots ? " — meer huizen = meer werkers" : ""}`);
      const src = sourceLeft(world, b);
      const from = t.source === undefined ? t.produces : t.source;
      if (src && t.sparesSource) {
        lines.push(
          share > 0.001
            ? `${SOURCE_NAMES[from ?? ""] ?? "🌲 Bos"} in de buurt: nog ${Math.round(share * 100)}%, dus zoveel wild om op te jagen`
            : "⚠️ Het bos rondom is gekapt: geen wild meer. Wacht tot het teruggroeit, of bouw er een bij een ander bos.",
        );
      } else if (src) {
        const pct = src.total ? Math.round((src.left / src.total) * 100) : 0;
        lines.push(src.left > 0.01 ? `${SOURCE_NAMES[from ?? ""] ?? "⛏️ Ertsader"} in de buurt: nog ${pct}%` : "⚠️ Niets meer in de buurt: wacht tot het teruggroeit, of bouw er een bij een andere plek.");
      }
    }
    if (t.category === "storage") lines.push(`📦 +${fmt(STORAGE_CAP * scaleOf(b.level))} opslag`);
    if (t.category === "center") lines.push(`📦 opslag max ${fmt(capOf(world))} per grondstof`);
    if (t.category === "shop") lines.push(`🛒 ${shopBlurb(t.id)}`);
    if (t.category === "decor") lines.push("✨ Puur voor de sier. De inwoners komen er graag kijken.");
    insInfo.replaceChildren(...lines.map((l) => h("div", "", l)));
    for (const o of insOffers) o.update(world, busy(), deps.connected());
    insLive?.();
  }

  // ---------- render ----------

  function render(): void {
    const msg = deps.msg();
    const world = deps.world();
    if (!msg || !world) return;
    const now = deps.serverNow();
    renderHud(world, now);
    hud.hidden = false;
    renderVotes(now);
    renderInspector();
    renderPlace();
    renderPaths();
  }

  window.setInterval(render, TICK_MS);
  return {
    inspect,
    inspectVillager,
    tile(x, y, px, py) {
      if (placing) return placeAt(x, y);
      // Clicking the same tile again, or water/mountains (unless a path or bridge is there), just closes the popup.
      const w = deps.world();
      const land = ["grass", "sand"].includes(terrainAt(x, y)) || (!!w && isRoad(w.roads, x, y));
      if ((placeTile && placeTile.x === x && placeTile.y === y) || !land) return closePlace();
      openPlace(x, y, px, py);
    },
    paint,
    refresh: render,
  };
}
