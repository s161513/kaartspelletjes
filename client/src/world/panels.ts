// The DOM around the town: a compact HUD (resources, villagers, happiness, boosts), the
// town center's overview (the era's goals and world wonder, the population), the
// open votes on the right, the popup on a clicked tile (build there, or upgrade the
// streets), the building inspector (which is the shop window for shops, and
// where buildings are torn down or repaired), the "choose a spot" banner for decorations
// and the banner for drawing paths and walls. Numbers refresh a few times a second; elements
// are kept, not rebuilt, so buttons never vanish under a click.

import {
  BOOST_MULT,
  DECOR_POINTS,
  ERAS,
  HAPPY_BASE,
  HAPPY_STEP_MS,
  MAX_DECOR_POINTS,
  MOVE_MS,
  WONDER_PHASES,
  MAX_PATH_TILES,
  MAX_PROPOSALS,
  RAID_MOODS,
  RESOURCES,
  TAVERN_POINTS,
  actionError,
  assignWorkers,
  buildCost,
  buildTypeError,
  buildableTypes,
  buildingName,
  buildingType,
  canAfford,
  capOf,
  capPartsOf,
  currentWonder,
  decorTypes,
  defenseOf,
  fortifyCost,
  repairCost,
  wallCost,
  wallError,
  wallName,
  RAID_FROM_ERA,
  RAID_WARNING_MS,
  TOWER_POINTS,
  WALL_POINTS,
  durationText,
  eraGoals,
  fullRateOf,
  gatherable,
  gatheringOf,
  happinessOf,
  housingOf,
  isRiver,
  isRoad,
  itemCost,
  itemError,
  itemLevel,
  itemsOf,
  luckyEvent,
  multiplierAt,
  oresOf,
  producesOf,
  outfitCost,
  outfitError,
  outfitsFor,
  pathCost,
  FOOD_KINDS,
  foodKindsOf,
  pathError,
  placeError,
  populationTarget,
  ratesOf,
  refundOf,
  resourceDef,
  roadCost,
  roadName,
  shopItem,
  shortfall,
  slotsAt,
  slotsOf,
  sourceLeft,
  sourceShareOf,
  storeCap,
  storeTypeOf,
  terrainAt,
  tileIndex,
  tileOf,
  unlockedResources,
  upgradeCost,
  wonderCost,
  wonderType,
  wonderWait,
  type Amounts,
  type BuildingType,
  type GoalStatus,
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

/** A rate per second: like `fmt`, but below 1 with two decimals (a gatherer makes 0,05/s). */
const fmtRate = (n: number): string => (n > 0 && n < 1 ? String(Math.floor(n * 100) / 100).replace(".", ",") : fmt(n));

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
  if (t.category === "house") return `🛏️ +${housingOf(era)} bedden: wie geen bed heeft, slaapt buiten en is ongelukkig`;
  if (t.category === "storage" && t.stores) return `📦 +${fmt(storeCap(era))} opslag voor ${resText(t.stores)}`;
  if (t.category === "decor") return `😊 +${DECOR_POINTS} geluk (alle decoraties samen tot +${MAX_DECOR_POINTS})`;
  if (t.category === "defense") return `🛡️ +${TOWER_POINTS * (1 + era)} verdediging tegen aanvallen`;
  if (t.category === "shop") return `🛒 winkel: ${shopBlurb(t.id)}${t.id === "shop_tavern" ? ` · 😊 +${TAVERN_POINTS} geluk` : ""}`;
  if (t.produces) {
    const rate = fullRateOf({ id: 0, type: t.id, level: era, x: 0, y: 0 });
    const kind = t.foodKind ? ` (${foodKindText(t.foodKind)})` : "";
    const less = t.sparesSource ? " · minder als het bos rondom gekapt is" : "";
    const ores = t.ores ? ` · raakt nooit op · daarna stemmen jullie welk erts: ${oresOf(world, t.id).map((id) => resourceDef(id)?.emoji).join(" ")}` : "";
    const uses = t.consumes ? ` · gebruikt per stuk ${usesText(t.consumes)}` : "";
    return `${resourceDef(t.produces)?.emoji} +${fmtRate(rate)}/s${kind} met ${slotsOf(era)} werkers${less}${ores}${uses}`;
  }
  return "";
}

/** "🪵 hout". */
const resText = (id: string) => `${resourceDef(id)?.emoji ?? ""} ${resourceDef(id)?.name ?? id}`;

/** "⛓️ 1 + ⚫ 1". */
const usesText = (uses: Amounts) => Object.entries(uses).map(([id, n]) => `${resourceDef(id)?.emoji ?? id} ${fmt(n)}`).join(" + ");

const SHOP_BLURBS: Record<string, string> = {
  shop_sculptor: "decoraties",
  shop_tavern: "boosts",
  shop_smith: "beter gereedschap",
  shop_bank: "een grotere kluis",
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
  const parts = FOOD_KINDS.filter((k) => kinds[k.id]).map((k) => `${k.emoji} ${k.name} ${fmtRate(kinds[k.id]!)}/s`);
  return parts.length ? parts.join(" · ") : "niets: bouw een jagerskamp, akker of visserij";
}

const moodEmoji = (level: number) => (level < 35 ? "😠" : level < 50 ? "😕" : level < 70 ? "🙂" : "😄");
const multText = (mult: number) => `×${mult.toFixed(2).replace(".", ",")}`;

/** "😊 62% geluk, gaat naar 70% · werken ×1,05": how happy the town is, where it's heading, and how hard they work for it. */
function happyText(world: IdleWorld, now: number): string {
  const h = happinessOf(world, now);
  const level = Math.round(h.level);
  const heading = h.target === level ? "" : `, gaat naar ${h.target}% (1 punt per ${HAPPY_STEP_MS / 60_000} min)`;
  return `${moodEmoji(h.level)} ${level}% geluk${heading} · werken ${multText(h.mult)}`;
}

/** What makes the town happy, one line each: "🍽️ 3 soorten voedsel +10". */
function happyLines(world: IdleWorld, now: number): string[] {
  const h = happinessOf(world, now);
  return [
    `🙂 basis ${HAPPY_BASE}`,
    ...h.parts.map((p) => `${p.emoji} ${p.label} ${p.points >= 0 ? "+" : "−"}${Math.abs(p.points)}`),
  ];
}

/** "🏃 er komen er 2 bij" / "🧳 er vertrekken er 3" / "" while the town has as many as it draws. */
function trendText(world: IdleWorld, now: number): string {
  const diff = Math.round(populationTarget(world, now) - world.population);
  const pace = `1 per ${MOVE_MS / 60_000} min`;
  if (diff > 0) return `🏃 er ${diff === 1 ? "komt er 1" : `komen er ${diff}`} bij (${pace})`;
  if (diff < 0) return `🧳 er ${diff === -1 ? "vertrekt er 1" : `vertrekken er ${-diff}`} (${pace})`;
  return "";
}

const outside = (n: number) => (n === 1 ? "1 slaapt buiten" : `${n} slapen buiten`);

const timeLeft = durationText;

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
  pathsBtn.addEventListener("click", () => (paths ? stopPaths() : startPaths("paths")));
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
  const popChip = h("span", "sx-hud-chip sx-hud-pop sx-hud-click");
  const happyChip = h("span", "sx-hud-chip sx-hud-pop sx-hud-click");
  const boostBox = h("span");
  boostBox.style.display = "contents";
  const raidChip = h("span", "sx-hud-chip sx-hud-raid sx-hud-click");

  /** Tooltips that change every tick flicker away under the mouse: only set them when the text really changes. */
  const setTitle = (el: HTMLElement, text: string) => {
    if (el.title !== text) el.title = text;
  };
  /** Click a HUD chip: the building with the details (the storage of that resource, else the center). */
  const showAt = (pick: (w: IdleWorld) => PlacedBuilding | undefined) => () => {
    const w = deps.world();
    const b = w && (pick(w) ?? w.buildings.find((x) => x.type === "center"));
    if (!b) return;
    inspect(b);
    deps.lookAt(b.x, b.y);
  };
  const centerOf = (w: IdleWorld) => w.buildings.find((b) => b.type === "center");
  popChip.addEventListener("click", showAt(centerOf));
  happyChip.addEventListener("click", showAt(centerOf));
  raidChip.addEventListener("click", showAt(centerOf));

  function renderHud(world: IdleWorld, now: number): void {
    if (hudEra !== world.era) {
      hudEra = world.era;
      hud.replaceChildren();
      hudChips.clear();
      for (const r of RESOURCES.filter((r) => r.era <= world.era)) {
        const chip = h("span", "sx-hud-chip sx-hud-res sx-hud-click");
        const text = h("span");
        const bar = h("span", "sx-hud-bar");
        const fill = h("span", "sx-hud-fill");
        bar.append(fill);
        chip.append(text, bar);
        chip.addEventListener("click", showAt((w) => w.buildings.find((b) => buildingType(b.type)?.stores === r.id && !b.damaged)));
        hud.append(chip);
        hudChips.set(r.id, { chip, text, fill });
      }
      hud.append(popChip, happyChip, raidChip, boostBox);
    }
    const rates = ratesOf(world);
    const center = buildingName("center", world.era);
    for (const [id, { chip, text, fill }] of hudChips) {
      const have = world.resources[id] ?? 0;
      const cap = capOf(world, id);
      const full = have >= cap;
      const rate = (rates[id] ?? 0) * multiplierAt(world, id, now);
      text.textContent = `${resourceDef(id)!.emoji} ${fmt(have)}${full ? " vol" : rate ? ` ${rate > 0 ? "+" : "−"}${fmtRate(Math.abs(rate))}/s` : ""}`;
      fill.style.width = `${Math.min(100, (have / cap) * 100)}%`;
      chip.classList.toggle("sx-hud-full", full);
      const store = buildingName(storeTypeOf(id) ?? "storage", world.era);
      setTitle(chip, `${resourceDef(id)!.name}${full ? ": vol, bouw een " + store : ""} · klik voor de opslag`);
    }
    const wf = assignWorkers(world);
    popChip.textContent = `👥 ${wf.population} · 🛏️ ${wf.beds}${wf.homeless ? ` · ⛺ ${wf.homeless}` : ""}`;
    popChip.classList.toggle("sx-hud-full", wf.homeless > 0);
    setTitle(popChip, `inwoners · bedden${wf.homeless ? " · slapen buiten: bouw huizen" : ""} · klik voor het overzicht bij het ${center}`);
    const mood = happinessOf(world, now);
    const arrow = mood.target > Math.round(mood.level) ? " ↗" : mood.target < Math.round(mood.level) ? " ↘" : "";
    happyChip.textContent = `${moodEmoji(mood.level)} ${Math.round(mood.level)}%${arrow}${arrow ? ` ${mood.target}%` : ""}`;
    happyChip.classList.toggle("sx-hud-full", mood.level < 35);
    setTitle(happyChip, `geluk${arrow ? ", en waar het heen gaat" : ""} · klik voor wat het dorp blij maakt, bij het ${center}`);

    const raid = world.raid;
    raidChip.hidden = !raid;
    if (raid) {
      const def = defenseOf(world).total;
      raidChip.textContent = raid.at > now ? `⚔️ aanval over ${timeLeft(raid.at - now)} · ⚔️ ${raid.strength} vs 🛡️ ${def}` : "⚔️ de aanval is bezig!";
      raidChip.classList.toggle("sx-hud-full", def < raid.strength);
      setTitle(raidChip, `vijanden in aantocht: hun kracht tegen onze verdediging · klik voor de verdediging bij het ${center}`);
    }

    const boosts: string[] = [];
    if (world.boostUntil > now) boosts.push(`⚡ ×${BOOST_MULT} ${timeLeft(world.boostUntil - now)}`);
    for (const b of world.boosts) {
      if (b.until <= now) continue;
      const mood = RAID_MOODS.find((m) => m.id === b.item);
      if (mood) {
        boosts.push(`${mood.emoji} ${mood.name} ${mood.points > 0 ? "+" : "−"}${Math.abs(mood.points)} geluk ${timeLeft(b.until - now)}`);
        continue;
      }
      const lucky = luckyEvent(b.item);
      if (lucky) {
        const what = b.resource ? ` ${resourceDef(b.resource)?.emoji ?? ""} ×${b.mult}` : "";
        boosts.push(`${lucky.emoji} ${lucky.name}${what} ${timeLeft(b.until - now)}`);
        continue;
      }
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
    if (a.kind === "paths" || a.kind === "unpave" || a.kind === "walls" || a.kind === "unwall") return a.tiles.length ? tileOf(a.tiles[0]) : null;
    if (a.kind === "upgrade" || a.kind === "demolish" || a.kind === "wonder" || a.kind === "ore" || a.kind === "repair") return deps.world()?.buildings.find((b) => b.id === a.building) ?? null;
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
      return !!w && !placeError(w.buildings, w.roads, t.id, x, y, w.walls);
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
    const err = placeError(world.buildings, world.roads, placing.id, x, y, world.walls);
    if (err) {
      bannerText.textContent = `❌ ${err} — probeer een andere plek (Esc = stoppen)`;
      return;
    }
    propose({ kind: "build", type: placing.id, x, y });
    stopPlacing();
  }

  // ---------- drawing paths and walls ----------
  // Drag over tiles to draw (or pick paths or walls to remove), then propose it all at once.

  type DrawMode = "paths" | "unpave" | "walls" | "unwall";
  const ERASING: Record<DrawMode, boolean> = { paths: false, unpave: true, walls: false, unwall: true };
  const DRAW_TEXT: Record<DrawMode, string> = {
    paths: "🛤️ Sleep over tegels: een pad, dwars door de natuur of als brug over de rivier",
    unpave: "⛏️ Sleep over paden om ze weg te halen",
    walls: "🧱 Sleep over tegels: een muur rond het dorp houdt vijanden tegen",
    unwall: "⛏️ Sleep over muren om ze weg te halen",
  };

  /** The drawing under way; `adding` is whether the current stroke adds tiles or takes them off again. */
  let paths: { mode: DrawMode; erase: boolean; tiles: Set<number>; adding: boolean } | null = null;
  const pathsText = h("span");
  /** Switching tools starts a new drawing. */
  const tool = (mode: DrawMode) => () => {
    if (paths?.mode !== mode) startPaths(mode);
  };
  const toolBtns: [DrawMode, HTMLButtonElement][] = [
    ["paths", button("sx-act", "🛤️ pad", tool("paths"))],
    ["walls", button("sx-act", "🧱 muur", tool("walls"))],
    ["unpave", button("sx-act", "⛏️ pad weg", tool("unpave"))],
    ["unwall", button("sx-act", "⛏️ muur weg", tool("unwall"))],
  ];
  const pathsCosts = h("div", "sx-costs");
  const pathsMissing = h("span", "sx-missing");
  const pathsGo = button("sx-act sx-act-now", "🗳️ voorstellen", () => proposePaths());
  const pathsParts = [pathsText, ...toolBtns.map(([, b]) => b), pathsCosts, pathsMissing, pathsGo, button("sx-act", "✕ stoppen", () => stopPaths())];

  /** Can this tile be drawn on in this mode? */
  const paintable = (w: IdleWorld, mode: DrawMode, x: number, y: number) =>
    mode === "unpave" ? isRoad(w.roads, x, y)
    : mode === "unwall" ? isRoad(w.walls, x, y)
    : mode === "walls" ? !wallError(w.buildings, w.roads, w.walls, x, y)
    : !pathError(w.buildings, w.roads, x, y, w.walls);

  const pathsAction = (): ProposalAction | null => paths && { kind: paths.mode, tiles: [...paths.tiles] };

  /** Start drawing (or switch tools, which starts over), optionally from a tile. */
  function startPaths(mode: DrawMode, from?: { x: number; y: number }): void {
    stopPlacing();
    inspect(null);
    closePlace();
    const erase = ERASING[mode];
    paths = { mode, erase, tiles: new Set(), adding: true };
    const w = deps.world();
    if (from && w && paintable(w, mode, from.x, from.y)) paths.tiles.add(tileIndex(from.x, from.y));
    pathsText.textContent = DRAW_TEXT[mode];
    for (const [m, b] of toolBtns) b.setAttribute("aria-pressed", String(m === mode));
    banner.className = "sx-banner sx-banner-paths";
    banner.replaceChildren(...pathsParts);
    banner.hidden = false;
    pathsBtn.setAttribute("aria-pressed", "true");
    deps.setPainting((x, y) => {
      const w = deps.world();
      return !!w && paintable(w, mode, x, y);
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
    else if (paths.tiles.size < MAX_PATH_TILES && paintable(w, paths.mode, x, y)) paths.tiles.add(i);
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
    const walls = paths.mode === "walls" || paths.mode === "unwall";
    const bridges = walls ? 0 : tiles.filter((i) => isRiver(tileOf(i).x, tileOf(i).y)).length;
    const count = `${n === 1 ? "1 tegel" : `${n} tegels`}${n >= MAX_PATH_TILES ? " (max)" : ""}${bridges ? `, waarvan ${bridges} brug` : ""}:`;
    const cost = walls ? wallCost(w, tiles) : pathCost(w, tiles);
    pathsCosts.replaceChildren(
      ...(!n
        ? [h("span", "sx-cost", paths.erase ? `nog geen ${walls ? "muren" : "paden"} gekozen` : "nog geen tegels")]
        : [h("span", "sx-cost", count), ...(paths.erase ? gainChips(refundOf(w, action)) : costChips(w, cost))]),
    );
    const err = n ? actionError(w, action) : null;
    pathsMissing.textContent = err === "te duur" ? missingText(w, cost) : err ?? "";
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
    const sig = `${x},${y}|${world.era}|${world.buildings.length}|${world.roadLevel}|${world.roads.length}|${world.wallLevel}|${world.walls.length}`;
    if (sig !== placeSig) {
      placeSig = sig;
      placeOffers = [];
      placeTitle.textContent = `${TERRAIN_NAMES[terrainAt(x, y)]} (${x}, ${y})`;
      placeBody.replaceChildren();
      if (isRoad(world.roads, x, y)) {
        placeTitle.textContent = isRiver(x, y) ? `🌉 Brug (${roadName(world.roadLevel).toLowerCase()})` : `🛣️ ${roadName(world.roadLevel)}`;
        placeSub.textContent = "De straten van het hele dorp gaan samen omhoog.";
        placeBody.append(
          button("sx-act sx-act-now", "⛏️ Paden weghalen", () => startPaths("unpave", { x, y })),
          button("sx-act", "🛤️ Paden tekenen", () => startPaths("paths")),
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
      } else if (isRoad(world.walls, x, y)) {
        placeTitle.textContent = `🧱 ${wallName(world.wallLevel)}`;
        placeSub.textContent = `De hele muur gaat samen omhoog. Elke tegel geeft 🛡️ ${fmt(WALL_POINTS * (1 + world.wallLevel))} verdediging.`;
        placeBody.append(
          button("sx-act sx-act-now", "⛏️ Muren weghalen", () => startPaths("unwall", { x, y })),
          button("sx-act", "🧱 Muren tekenen", () => startPaths("walls")),
        );
        if (world.wallLevel < world.era) {
          const o = offer({
            emoji: "⬆️",
            name: `Upgrade naar ${wallName(world.era).toLowerCase()}`,
            effect: `${ERAS[world.era].emoji} ${ERAS[world.era].name} · de hele muur in één keer · 🛡️ ${fmt(WALL_POINTS * (1 + world.era))} per tegel`,
            action: "🗳️ voorstellen",
            votes: true,
            onClick: () => {
              propose({ kind: "fortify" });
              closePlace();
            },
            cost: (w) => fortifyCost(w),
            error: (w) => actionError(w, { kind: "fortify" }),
          });
          placeBody.append(o.el);
          placeOffers.push(o);
        } else {
          placeBody.append(h("p", "sx-note", "✓ De muur is helemaal bij voor dit tijdperk."));
        }
      } else {
        const fits: BuildingType[] = [];
        const elsewhere: string[] = [];
        for (const t of buildableTypes(world)) {
          const err = placeError(world.buildings, world.roads, t.id, x, y, world.walls);
          if (err) elsewhere.push(`${t.emoji} ${buildingName(t.id, world.era)}: ${err}`);
          else fits.push(t);
        }
        placeSub.textContent = fits.length ? "Wat bouwen we hier? Iedereen stemt mee." : "Hier past niets.";
        if (!pathError(world.buildings, world.roads, x, y, world.walls)) {
          placeBody.append(button("sx-act", "🛤️ Pad tekenen vanaf hier", () => startPaths("paths", { x, y })));
        }
        if (!wallError(world.buildings, world.roads, world.walls, x, y)) {
          placeBody.append(button("sx-act", "🧱 Muur tekenen vanaf hier", () => startPaths("walls", { x, y })));
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
          v.home ? `🏠 woont in: ${v.home}` : "⛺ geen bed: slaapt buiten, en dat maakt het dorp ongelukkig",
          `⏱️ nu: ${v.doing}`,
        ];
    insInfo.replaceChildren(...lines.map((l) => h("div", "", l)));
    for (const { id, btn } of gatherBtns) {
      const on = id === null ? !v.gather?.chosen : !!v.gather?.chosen && v.gather.resource === id;
      btn.setAttribute("aria-pressed", String(on));
      btn.disabled = !deps.connected();
    }
  }

  /** The next phase of a wonder under construction, as an offer (hidden when there's none). */
  function wonderPhaseOffer(): Offer {
    const next = (w: IdleWorld): ProposalAction | null => {
      const b = currentWonder(w);
      return b && b.stage !== undefined ? { kind: "wonder", building: b.id } : null;
    };
    const o = offer({
      emoji: "🏗️",
      name: "Verder bouwen",
      effect: `De volgende fase. Na fase ${WONDER_PHASES} is het wonder af en begint het volgende tijdperk.`,
      action: "🗳️ voorstellen",
      votes: true,
      onClick: () => {
        const a = deps.world() && next(deps.world()!);
        if (a) propose(a);
      },
      cost: (w) => wonderCost(w, currentWonder(w)?.stage ?? 0),
      error: (w) => (next(w) ? actionError(w, next(w)!) : "nog niet begonnen"),
      level: (w) => `fase ${(currentWonder(w)?.stage ?? 0) + 1}/${WONDER_PHASES}`,
    });
    return o;
  }

  /** "🚧 fase 1/3 af · de bouwers zijn klaar over 5 u 12" for a wonder under construction. */
  function wonderProgress(w: IdleWorld, b: PlacedBuilding): string {
    if (b.stage === undefined) return `✅ Af: een monument uit de ${ERAS[b.level].name}`;
    const wait = wonderWait(w, b);
    return `🚧 fase ${b.stage}/${WONDER_PHASES} af · ${wait === null ? "de bouwers zijn klaar voor de volgende fase" : `de bouwers zijn klaar over ${durationText(wait)}`}`;
  }

  /** A block with an icon, a name, a value and a bar: a goal, or the wonder's phases. */
  function meter(icon: string, name: string, value: string, share: number, done: boolean): HTMLElement {
    const el = h("div", done ? "sx-goal sx-goal-done" : "sx-goal");
    const text = h("div", "sx-goal-text");
    const top = h("div", "sx-goal-top");
    top.append(h("span", "sx-goal-name", name), h("span", "sx-goal-value", done ? "✅" : value));
    const bar = h("span", "sx-store-bar");
    const fill = h("span", "sx-store-fill");
    fill.style.width = `${Math.max(0, Math.min(1, share)) * 100}%`;
    bar.append(fill);
    text.append(top, bar);
    el.append(h("span", "sx-goal-icon", icon), text);
    return el;
  }

  /** "👥 15 inwoners" → a block with 👥, the text and how far the town is. */
  function goalCard(g: GoalStatus): HTMLElement {
    const [icon, ...rest] = g.label.split(" ");
    return meter(icon, rest.join(" "), g.need > 1 ? `${fmt(g.have)}/${fmt(g.need)}` : "nog niet", g.need ? g.have / g.need : 1, g.done);
  }

  /** The town center: the goals for the next era and its world wonder. */
  function eraPanel(world: IdleWorld): () => void {
    const next = ERAS[world.era + 1];
    const typeId = wonderType(world.era);
    if (!next || !typeId) {
      insActions.append(h("h4", "sx-h", `${ERAS[world.era].emoji} Het laatste tijdperk`), h("p", "sx-note", "Verder dan dit gaat de geschiedenis niet. Bouw maar mooie dingen!"));
      return () => {};
    }
    const t = buildingType(typeId)!;
    const goals = h("div", "sx-goals");
    const count = h("span", "sx-era-count");
    const progress = h("div", "sx-wonder");
    const start = offer({
      emoji: t.emoji,
      name: `${buildingName(typeId, world.era)} bouwen`,
      effect: `Het wereldwonder van de ${ERAS[world.era].name}, in ${WONDER_PHASES} fases (elk een eigen stemming). Kan pas als alle doelen gehaald zijn.`,
      action: "📍 kies plek",
      votes: true,
      onClick: () => startPlacing(t),
      cost: (w) => wonderCost(w, 0),
      error: (w) =>
        !eraGoals(w).every((g) => g.done) ? "eerst de doelen van dit tijdperk halen" : canAfford(w, wonderCost(w, 0)) ? null : "te duur",
    });
    const phase = wonderPhaseOffer();
    const head = h("div", "sx-era-head");
    head.append(
      h("span", "sx-era-from", `${ERAS[world.era].emoji} ${ERAS[world.era].name}`),
      h("span", "sx-era-arrow", "→"),
      h("span", "sx-era-to", `${next.emoji} ${next.name}`),
      count,
    );
    insActions.append(
      h("h4", "sx-h", "🏛️ Het volgende tijdperk"),
      head,
      h("p", "sx-note", "Haal deze doelen en bouw het wereldwonder: dan begint het volgende tijdperk."),
      goals,
      progress,
      start.el,
      phase.el,
    );
    insOffers.push(start, phase);
    return () => {
      const w = deps.world();
      if (!w) return;
      const all = eraGoals(w);
      count.textContent = `${all.filter((g) => g.done).length}/${all.length} doelen`;
      goals.replaceChildren(...all.map(goalCard));
      const b = currentWonder(w);
      if (b) {
        const wait = wonderWait(w, b);
        progress.replaceChildren(
          meter(t.emoji, buildingName(typeId, w.era), `fase ${b.stage ?? WONDER_PHASES}/${WONDER_PHASES}`, (b.stage ?? WONDER_PHASES) / WONDER_PHASES, b.stage === undefined),
          h("div", "sx-store-sub", wait === null ? "🔨 de bouwers zijn klaar voor de volgende fase" : `⏳ de bouwers zijn klaar over ${durationText(wait)}`),
        );
      }
      progress.hidden = !b;
      start.el.hidden = !!b;
      phase.el.hidden = !b;
    };
  }

  /** The town center: how well the town is defended, and the raids. */
  function defensePanel(world: IdleWorld): () => void {
    const head = h("h4", "sx-h", "🛡️ Verdediging");
    const total = h("div", "sx-note");
    const parts = h("div", "sx-note");
    const raid = h("div", "sx-note");
    const last = h("div", "sx-note");
    insActions.append(
      head,
      total,
      parts,
      raid,
      last,
      h(
        "p",
        "sx-note",
        `Vanaf de ${ERAS[RAID_FROM_ERA].name} valt er zo'n keer per dag een vijand aan, overdag en ${durationText(RAID_WARNING_MS)} van tevoren te zien. ` +
          "Muren (tekenen zoals paden), torens, inwoners en wachters met wapens en harnassen houden ze tegen. " +
          "Is de vijand sterker, dan stelen ze, vallen er doden en steken ze een gebouw in brand.",
      ),
    );
    return () => {
      const w = deps.world();
      if (!w) return;
      const now = deps.serverNow();
      const d = defenseOf(w);
      total.textContent = `🛡️ ${d.total} verdediging`;
      parts.replaceChildren(...d.parts.map((p) => h("div", "sx-happy-part", `${p.emoji} ${p.label} +${fmt(p.points)}`)));
      raid.textContent = w.raid
        ? `⚔️ Vijanden in aantocht: kracht ${w.raid.strength}, ${w.raid.at > now ? `over ${durationText(w.raid.at - now)}` : "ze zijn er!"}${d.total >= w.raid.strength ? " · we houden ze tegen 💪" : ` · nog ${w.raid.strength - d.total} verdediging nodig!`}`
        : w.era < RAID_FROM_ERA
          ? `😌 Nog geen vijanden: die komen pas in de ${ERAS[RAID_FROM_ERA].name}.`
          : "😌 Geen vijanden te zien.";
      raid.classList.toggle("sx-alert", !!w.raid && d.total < w.raid.strength);
      const r = w.lastRaid;
      last.hidden = !r;
      if (r) {
        const ago = durationText(Math.max(0, now - r.at));
        last.textContent = r.won
          ? `Vorige aanval (${ago} geleden): afgeslagen, 🛡️ ${r.defense} tegen ⚔️ ${r.strength}`
          : `Vorige aanval (${ago} geleden): verloren, 🛡️ ${r.defense} tegen ⚔️ ${r.strength} · ${r.killed} doden${r.damaged ? ` · ${r.damaged} in brand` : ""}`;
      }
    };
  }

  /**
   * Storage, one bar per resource: how full, how fast it fills, and what the
   * limit is made of. The center shows every resource, a storage building its own.
   */
  function storagePanel(world: IdleWorld, only?: string): () => void {
    const ids = only ? [only] : unlockedResources(world.era);
    const rows = ids.map((id) => {
      const fill = h("span", "sx-store-fill");
      const bar = h("span", "sx-store-bar");
      bar.append(fill);
      const amount = h("span", "sx-store-amount");
      const sub = h("div", "sx-store-sub");
      const el = h("div", "sx-store");
      const top = h("div", "sx-store-top");
      top.append(h("span", "sx-store-name", resText(id)), amount);
      el.append(top, bar, sub);
      return { id, el, fill, amount, sub };
    });
    const parts = h("div", "sx-note");
    insActions.append(
      h("h4", "sx-h", only ? `📦 Opslag voor ${resText(only)}` : "📦 Opslag"),
      ...rows.map((r) => r.el),
      ...(only ? [parts] : [h("p", "sx-note", "Elke grondstof heeft een eigen opslag. Is die vol, dan stoppen de werkers ervan en gaan ze bij het vuur zitten. Klik op een grondstof bovenaan om naar de opslag te gaan.")]),
    );
    return () => {
      const w = deps.world();
      if (!w) return;
      const now = deps.serverNow();
      const rates = ratesOf(w);
      for (const r of rows) {
        const have = w.resources[r.id] ?? 0;
        const cap = capOf(w, r.id);
        const rate = (rates[r.id] ?? 0) * multiplierAt(w, r.id, now);
        const full = have >= cap;
        r.fill.style.width = `${Math.min(100, (have / cap) * 100)}%`;
        r.el.classList.toggle("sx-store-full", full);
        r.amount.textContent = `${fmt(have)} / ${fmt(cap)}`;
        r.sub.textContent = full
          ? `⚠️ vol: de werkers stoppen · bouw een ${buildingName(storeTypeOf(r.id) ?? "storage", w.era)}`
          : rate > 0 ? `+${fmtRate(rate)}/s · vol over ${durationText(((cap - have) / rate) * 1000)}`
          : rate < 0 ? `−${fmtRate(-rate)}/s · op over ${durationText((have / -rate) * 1000)}`
          : "komt er nu niet bij";
      }
      if (only) parts.replaceChildren(...capPartsOf(w, only).map((p) => h("div", "sx-happy-part", `${p.emoji} ${p.label} +${fmt(p.amount)}`)));
    };
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
    const census = h("div", "sx-note");
    const mood = h("div", "sx-note");
    const summary = h("div", "sx-note");
    const menu = h("div", "sx-note");
    insActions.append(
      h("h4", "sx-h", "📊 Bevolking"),
      census,
      mood,
      h("p", "sx-note", `Een gelukkig dorp trekt nieuwkomers, ook als er geen bed meer vrij is; uit een ongelukkig dorp vertrekken mensen. Gelukkige mensen werken harder. Op de kaart lopen er ${NPCS_PER_PLAYER} per speler online rond.`),
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
      const now = deps.serverNow();
      const trend = trendText(w, now);
      census.textContent =
        `👥 ${wf.population} inwoners · 🛏️ ${wf.beds} bedden` +
        (wf.homeless ? ` · ⛺ ${outside(wf.homeless)}` : wf.beds > wf.population ? ` · ${wf.beds - wf.population} vrij` : "") +
        (trend ? ` · ${trend}` : "");
      mood.replaceChildren(h("div", "", happyText(w, now)), ...happyLines(w, now).map((l) => h("div", "sx-happy-part", l)));
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
    const sig = `${b.id}:${b.level}:${world.era}:${!!b.damaged}`;
    if (sig !== inspectSig) {
      inspectSig = sig;
      insTitle.textContent = `${t.emoji} ${buildingName(b.type, b.level)}`;
      insActions.replaceChildren();
      insOffers = [];
      insLive = null;
      if (t.category === "center") {
        const era = eraPanel(world);
        const work = workPanel(world);
        const store = storagePanel(world);
        const defense = defensePanel(world);
        insLive = () => {
          era();
          work();
          store();
          defense();
        };
      }
      if (t.category === "storage" && t.stores) insLive = storagePanel(world, t.stores);
      if (t.category === "wonder" && b.stage !== undefined && b.type === wonderType(world.era)) {
        const o = wonderPhaseOffer();
        insActions.append(o.el);
        insOffers.push(o);
      }
      if (t.ores) {
        insActions.append(h("h4", "sx-h", "⛏️ Wat delft de mijn?"), h("p", "sx-note", `Een steengroeve of een mijn bij de ertsader levert ${Math.round(1 / (t.oreShare ?? 1))}× zoveel op, maar deze mijn raakt nooit op. Omschakelen kost niets, wel een stemming.`));
        for (const ore of oresOf(world, b.type)) {
          const action: ProposalAction = { kind: "ore", building: b.id, ore };
          const o = offer({
            emoji: resourceDef(ore)!.emoji,
            name: resourceDef(ore)!.name,
            effect: `+${fmtRate(fullRateOf({ ...b, ore }))}/s met alle werkers (zonder bonussen)`,
            action: "🗳️ voorstellen",
            votes: true,
            onClick: () => propose(action),
            cost: () => ({}),
            error: (w) => {
              const err = actionError(w, action);
              return err === "die delft dat al" ? "✓ die delft dit nu" : err;
            },
          });
          insActions.append(o.el);
          insOffers.push(o);
        }
      }
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
      if (b.damaged) {
        const repair: ProposalAction = { kind: "repair", building: b.id };
        const o = offer({
          emoji: "🔧",
          name: "Herstellen",
          effect: "Daarna werkt het weer zoals eerst.",
          action: "🗳️ voorstellen",
          votes: true,
          onClick: () => propose(repair),
          cost: (w) => repairCost(w, b),
          error: (w) => actionError(w, repair),
        });
        insActions.append(o.el);
        insOffers.push(o);
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
      if (t.category !== "center" && t.category !== "wonder") {
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
    if (b.damaged) lines.push("🔥 In brand gestoken door vijanden: het doet niets tot het hersteld is");
    if (t.category === "defense") lines.push(`🛡️ +${TOWER_POINTS * (1 + b.level)} verdediging tegen aanvallen`);
    if (t.category === "house") lines.push(`🛏️ ${housingOf(b.level)} bedden`);
    const made = producesOf(b);
    if (t.category === "work" && made) {
      const w = assignWorkers(world).workers[b.id] ?? 0;
      const slots = slotsAt(world, b);
      lines.push(`👷 ${w}/${slots} werkers`);
      const share = t.sparesSource ? sourceShareOf(world, b) : 1;
      const kind = t.foodKind ? ` ${foodKindText(t.foodKind)}` : "";
      const rate = ((fullRateOf(b) * w) / slotsOf(b.level)) * share;
      lines.push(`${resourceDef(made)?.emoji}${kind} ${fmtRate(rate)}/s (zonder bonussen)${w < slots ? " — meer inwoners = meer werkers" : ""}`);
      if ((world.resources[made] ?? 0) >= capOf(world, made)) {
        lines.push(`⚠️ De opslag voor ${resText(made)} is vol: de werkers zitten bij het vuur. Bouw een ${buildingName(storeTypeOf(made) ?? "storage", world.era)}.`);
      }
      if (t.ores) lines.push(`⛰️ in de berg: raakt nooit op`);
      if (t.consumes) {
        const out = Object.keys(t.consumes).filter((id) => (world.resources[id] ?? 0) < 1);
        lines.push(`🔥 gebruikt ${Object.entries(t.consumes).map(([id, n]) => `${resourceDef(id)?.emoji ?? id} ${fmtRate(rate * n)}/s`).join(" + ")}`);
        if (out.length) lines.push(`⚠️ Geen ${out.map((id) => resourceDef(id)?.name ?? id).join(" en ")} meer: bouw een mijn die dat delft.`);
      }
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
    if (t.category === "storage" && t.stores) lines.push(`📦 +${fmt(storeCap(b.level))} opslag voor ${resText(t.stores)}`);
    if (t.category === "shop") lines.push(`🛒 ${shopBlurb(t.id)}`);
    if (b.type === "shop_tavern") lines.push(`😊 +${TAVERN_POINTS} geluk voor het hele dorp, en een dorpsfeest geeft er tijdelijk nog meer bij`);
    if (t.category === "wonder") lines.push(`🏛️ Wereldwonder van de ${ERAS[b.level].name}`, wonderProgress(world, b));
    if (t.category === "decor") lines.push(`😊 +${DECOR_POINTS} geluk (alle decoraties samen tot +${MAX_DECOR_POINTS}). De inwoners komen er graag kijken.`);
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
      // A supply drop: open it.
      const drop = deps.world()?.drops.find((d) => d.x === x && d.y === y);
      if (drop) return deps.send({ type: "open", id: drop.id, name: session.nickname });
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
