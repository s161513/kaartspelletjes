// The DOM around the town: a compact HUD (resources, villagers, boosts), the
// vote toast, the popup on a clicked tile (build there, or upgrade the
// streets), the building inspector (which is the shop window for shops), and
// the "choose a spot" banner for decorations. Numbers refresh a few times a second; elements are kept, not
// rebuilt, so buttons never vanish under a click.

import {
  BOOST_MULT,
  ERAS,
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
  housingOf,
  isStreet,
  itemCost,
  itemError,
  itemLevel,
  itemsOf,
  multiplierAt,
  outfitCost,
  outfitError,
  outfitsFor,
  placeError,
  ratesOf,
  resourceDef,
  roadCost,
  roadName,
  scaleOf,
  shopItem,
  shortfall,
  slotsAt,
  slotsOf,
  sourceLeft,
  terrainAt,
  tradeQuote,
  tradeRate,
  unlockedResources,
  upgradeCost,
  type Amounts,
  type BuildingType,
  type DecorBehavior,
  type IdleClientMsg,
  type IdleStateMsg,
  type IdleWorld,
  type PlacedBuilding,
  type ProposalAction,
  type ShopItem,
  type Terrain,
} from "@app/shared/idle";
import { session } from "../session";

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
    return `${resourceDef(t.produces)?.emoji} +${fmt(rate)}/s met ${slotsOf(era)} werkers`;
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

const timeLeft = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
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
  error: (w: IdleWorld) => string | null;
  level?: (w: IdleWorld) => string;
  /** Votes block this offer while one runs. */
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
      costs.replaceChildren(...costChips(world, cost));
      const err = opts.error(world);
      missing.textContent = err === "te duur" ? missingText(world, cost) : err ?? "";
      level.textContent = opts.level?.(world) ?? "";
      const blocked = opts.votes && busy;
      btn.disabled = !connected || blocked || !!err;
      btn.title = !connected ? "offline" : blocked ? "er loopt al een stemming" : err ?? "";
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
  setPlacing(ok: ((x: number, y: number) => boolean) | null): void;
  mark(tile: { x: number; y: number } | null): void;
  setGhost(ghost: { type: string; x: number; y: number } | null): void;
  /** Open the editor for your own NPC. */
  openAvatar(): void;
}

export interface Panels {
  inspect(b: PlacedBuilding | null): void;
  /** A tile was clicked (land, or anything while placing). */
  tile(x: number, y: number, px: number, py: number): void;
  refresh(): void;
}

export function createPanels(deps: PanelDeps): Panels {
  const hud = $<HTMLDivElement>("sx-hud");
  const vote = $<HTMLDivElement>("sx-vote");
  const inspectEl = $<HTMLDivElement>("sx-inspect");
  const placeEl = $<HTMLDivElement>("sx-place");
  const banner = $<HTMLDivElement>("sx-banner");
  const recenterBtn = $<HTMLButtonElement>("sx-recenter");

  const propose = (action: ProposalAction) => deps.send({ type: "propose", action, name: session.nickname });
  const busy = () => !!deps.msg()?.proposal;

  recenterBtn.addEventListener("click", () => window.dispatchEvent(new CustomEvent("sx-recenter")));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    stopPlacing();
    closePlace();
    inspect(null);
  });

  // ---------- HUD ----------

  let hudEra = -1;
  const hudChips = new Map<string, HTMLSpanElement>();
  const popChip = h("span", "sx-hud-chip sx-hud-pop");
  const boostBox = h("span");
  boostBox.style.display = "contents";

  function renderHud(world: IdleWorld, now: number): void {
    if (hudEra !== world.era) {
      hudEra = world.era;
      hud.replaceChildren();
      hudChips.clear();
      for (const r of RESOURCES.filter((r) => r.era <= world.era)) {
        const chip = h("span", "sx-hud-chip");
        hud.append(chip);
        hudChips.set(r.id, chip);
      }
      hud.append(popChip, boostBox);
    }
    const cap = capOf(world);
    const rates = ratesOf(world);
    for (const [id, chip] of hudChips) {
      const have = world.resources[id] ?? 0;
      const rate = (rates[id] ?? 0) * multiplierAt(world, id, now);
      chip.textContent = `${resourceDef(id)!.emoji} ${fmt(have)}${rate ? ` +${fmt(rate)}/s` : ""}`;
      chip.classList.toggle("sx-hud-full", have >= cap);
      chip.title = `${resourceDef(id)!.name}: ${fmt(have)} van max ${fmt(cap)}${have >= cap ? " — vol! bouw opslag" : ""}`;
    }
    const wf = assignWorkers(world);
    popChip.textContent = `👥 ${wf.population} (${wf.population - wf.idle} werken)`;
    popChip.title = `${wf.population} inwoners, ${wf.idle} zonder werk · opslag max ${fmt(cap)} per grondstof`;

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

  // ---------- vote toast (and the ghost of what it would build) ----------

  const voteText = h("p", "sx-vote-text");
  const voteRow = h("div", "sx-vote-row");
  const castVote = (yes: boolean) => {
    const p = deps.msg()?.proposal;
    if (p) deps.send({ type: "vote", id: p.id, yes });
  };
  const yesBtn = button("sx-vote-btn", "👍 ja", () => castVote(true));
  const noBtn = button("sx-vote-btn sx-vote-no", "👎 nee", () => castVote(false));
  const voteCount = h("span", "sx-vote-count");
  voteRow.append(yesBtn, voteCount, noBtn);
  vote.append(voteText, voteRow);

  function renderVote(now: number): void {
    const p = deps.msg()?.proposal ?? null;
    vote.hidden = !p;
    deps.setGhost(p?.action.kind === "build" ? p.action : null);
    if (!p) return;
    voteText.textContent = `🗳️ ${p.by} stelt voor: ${p.label}`;
    voteCount.textContent = `👍 ${p.yes} · 👎 ${p.no} · nodig ${p.needed} · ${Math.max(0, Math.ceil((p.deadline - now) / 1000))} s`;
    yesBtn.setAttribute("aria-pressed", String(p.myVote === true));
    noBtn.setAttribute("aria-pressed", String(p.myVote === false));
    yesBtn.disabled = noBtn.disabled = !deps.connected();
  }

  // ---------- placing a decoration ----------

  let placing: BuildingType | null = null;
  const bannerText = h("span");
  banner.append(bannerText, button("sx-act", "✕ stoppen", () => stopPlacing()));

  function startPlacing(t: BuildingType): void {
    const world = deps.world();
    if (!world) return;
    placing = t;
    inspect(null);
    closePlace();
    bannerText.textContent = `📍 Klik op een plek voor ${t.emoji} ${buildingName(t.id, world.era)} · Esc = stoppen`;
    banner.hidden = false;
    deps.setPlacing((x, y) => {
      const w = deps.world();
      return !!w && !placeError(w.buildings, t.id, x, y);
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
    const err = placeError(world.buildings, placing.id, x, y);
    if (err) {
      bannerText.textContent = `❌ ${err} — probeer een andere plek (Esc = stoppen)`;
      return;
    }
    propose({ kind: "build", type: placing.id, x, y });
    stopPlacing();
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
    const sig = `${x},${y}|${world.era}|${world.buildings.length}|${world.roadLevel}`;
    if (sig !== placeSig) {
      placeSig = sig;
      placeOffers = [];
      placeTitle.textContent = `${TERRAIN_NAMES[terrainAt(x, y)]} (${x}, ${y})`;
      placeBody.replaceChildren();
      if (isStreet(world.buildings, x, y)) {
        placeTitle.textContent = `🛣️ ${roadName(world.roadLevel)}`;
        placeSub.textContent = "De straten van het hele dorp gaan samen omhoog.";
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
          const err = placeError(world.buildings, t.id, x, y);
          if (err) elsewhere.push(`${t.emoji} ${buildingName(t.id, world.era)}: ${err}`);
          else fits.push(t);
        }
        placeSub.textContent = fits.length ? "Wat bouwen we hier? Iedereen stemt mee." : "Hier past niets.";
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

  function inspect(b: PlacedBuilding | null): void {
    inspected = b?.id ?? null;
    inspectSig = "";
    if (b) {
      closePlace();
      stopPlacing();
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

  function renderInspector(): void {
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
    }
    // Live info.
    const lines: string[] = [`${ERAS[b.level].emoji} ${ERAS[b.level].name}`];
    if (t.category === "house") lines.push(`👥 ${housingOf(b.level)} inwoners`);
    if (t.category === "work" && t.produces) {
      const w = assignWorkers(world).workers[b.id] ?? 0;
      const slots = slotsAt(world, b);
      lines.push(`👷 ${w}/${slots} werkers`);
      lines.push(`${resourceDef(t.produces)?.emoji} ${fmt((fullRateOf(b) * w) / slotsOf(b.level))}/s (zonder bonussen)${w < slots ? " — meer huizen = meer werkers" : ""}`);
      const src = sourceLeft(world, b);
      if (src) {
        const pct = src.total ? Math.round((src.left / src.total) * 100) : 0;
        lines.push(src.left > 0.01 ? `${SOURCE_NAMES[t.produces] ?? "⛏️ Ertsader"} in de buurt: nog ${pct}%` : "⚠️ Niets meer in de buurt: wacht tot het teruggroeit, of bouw er een bij een andere plek.");
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
    renderVote(now);
    renderInspector();
    renderPlace();
  }

  window.setInterval(render, TICK_MS);
  return {
    inspect,
    tile(x, y, px, py) {
      if (placing) return placeAt(x, y);
      // Clicking the same tile again, or water/mountains, just closes the popup.
      if ((placeTile && placeTile.x === x && placeTile.y === y) || !["grass", "sand"].includes(terrainAt(x, y))) return closePlace();
      openPlace(x, y, px, py);
    },
    refresh: render,
  };
}
