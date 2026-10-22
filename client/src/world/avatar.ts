// Your own NPC: who you are (a secret key in this browser, plus a name) and
// how your NPC looks. The editor shows a live preview; hats and patterns you
// don't own yet can be bought here too, if the town has a tailor.

import {
  CLOTHES_COLORS,
  MAX_NAME_LENGTH,
  OUTFITS,
  SKIN_TONES,
  outfitCost,
  outfitError,
  ownsOutfit,
  type IdleClientMsg,
  type IdleStateMsg,
  type IdleWorld,
  type NpcLook,
  type Outfit,
} from "@app/shared/idle";
import { session } from "../session";
import { drawVillager } from "./draw";
import { button, costChips, h } from "./panels";

const KEY_STORAGE = "sx.playerKey";

/** This browser's secret player key; made once and kept. */
export function playerKey(): string {
  try {
    let key = localStorage.getItem(KEY_STORAGE);
    if (!key) {
      key = crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(KEY_STORAGE, key);
    }
    return key;
  } catch {
    // No storage (private mode): a key for this visit only.
    return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}

export interface AvatarDeps {
  send(msg: IdleClientMsg): void;
  msg(): IdleStateMsg | null;
  world(): IdleWorld | null;
  connected(): boolean;
}

export interface AvatarEditor {
  open(): void;
  /** New state from the server: the top-bar button, first-visit prompt, owned outfits. */
  refresh(): void;
}

export function createAvatarEditor(deps: AvatarDeps): AvatarEditor {
  const panel = document.getElementById("sx-avatar") as HTMLDivElement;
  const meBtn = document.getElementById("sx-me") as HTMLButtonElement;
  let draft: NpcLook | null = null;
  let asked = false;

  const nameInput = h("input", "sx-input");
  nameInput.maxLength = MAX_NAME_LENGTH;
  nameInput.placeholder = "jouw naam";
  nameInput.setAttribute("aria-label", "jouw naam");
  const preview = h("canvas", "sx-preview");
  preview.width = 96;
  preview.height = 112;
  const skins = h("div", "sx-swatches");
  const colors = h("div", "sx-swatches");
  const hats = h("div", "sx-outfits");
  const patterns = h("div", "sx-outfits");
  const status = h("p", "sx-note");
  const save = button("sx-act sx-act-now", "💾 Opslaan", () => {
    const name = nameInput.value.trim();
    if (!name || !draft) {
      status.textContent = "Kies eerst een naam.";
      nameInput.focus();
      return;
    }
    session.nickname = name;
    deps.send({ type: "look", name, look: draft });
    status.textContent = "Opgeslagen! Je NPC loopt nu zo rond.";
  });
  const close = button("sx-x", "✕", () => (panel.hidden = true));
  close.setAttribute("aria-label", "sluiten");
  const top = h("div", "sx-avatar-top");
  const fields = h("div", "sx-avatar-fields");
  fields.append(h("label", "sx-h", "Naam"), nameInput);
  top.append(preview, fields);
  panel.append(
    close,
    h("h3", "sx-panel-title", "🧍 Jouw NPC"),
    top,
    h("h4", "sx-h", "Huid"),
    skins,
    h("h4", "sx-h", "Kleren"),
    colors,
    h("h4", "sx-h", "Hoofd"),
    hats,
    h("h4", "sx-h", "Patroon"),
    patterns,
    status,
    save,
  );

  const swatch = (color: string, onClick: () => void) => {
    const b = button("sx-swatch", "", onClick);
    b.style.background = color;
    return b;
  };
  SKIN_TONES.forEach((c, i) => skins.append(swatch(c, () => pick({ skin: i }))));
  CLOTHES_COLORS.forEach((c, i) => colors.append(swatch(c, () => pick({ clothes: i }))));

  /** One outfit tile: wear it if owned, else its price and a buy button. */
  const tiles = new Map<string, { el: HTMLDivElement; wear: HTMLButtonElement; buy: HTMLButtonElement; cost: HTMLDivElement }>();
  const tile = (o: Outfit) => {
    const el = h("div", "sx-outfit");
    const wear = button("sx-outfit-wear", `${o.emoji} ${o.name}`, () => pick(o.kind === "hat" ? { hat: o.id } : { pattern: o.id }));
    const cost = h("div", "sx-costs");
    const buy = button("sx-act sx-act-now", "kopen", () => deps.send({ type: "outfit", item: o.id }));
    el.append(wear, cost, buy);
    tiles.set(o.id, { el, wear, buy, cost });
    return el;
  };
  for (const o of OUTFITS) (o.kind === "hat" ? hats : patterns).append(tile(o));

  function pick(change: Partial<NpcLook>): void {
    if (!draft) return;
    draft = { ...draft, ...change };
    status.textContent = "";
    render();
  }

  function drawPreview(): void {
    const g = preview.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, preview.width, preview.height);
    if (!draft) return;
    g.setTransform(4, 0, 0, 4, 48, 104);
    drawVillager(g, 0, 0, {
      clothes: CLOTHES_COLORS[draft.clothes], skin: SKIN_TONES[draft.skin], level: 0, walking: false,
      phase: performance.now(), action: "pose", tool: "none", carry: null, jump: 0, hat: draft.hat, pattern: draft.pattern,
    });
  }

  function render(): void {
    const me = deps.msg()?.me;
    const world = deps.world();
    if (!me || !world || !draft) return;
    [...skins.children].forEach((b, i) => b.setAttribute("aria-pressed", String(i === draft!.skin)));
    [...colors.children].forEach((b, i) => b.setAttribute("aria-pressed", String(i === draft!.clothes)));
    for (const o of OUTFITS) {
      const t = tiles.get(o.id)!;
      const owned = ownsOutfit(me, o.id);
      t.el.hidden = !owned && o.minEra > world.era;
      t.wear.disabled = !owned;
      t.wear.setAttribute("aria-pressed", String(draft.hat === o.id || draft.pattern === o.id));
      t.buy.hidden = owned;
      t.cost.hidden = owned;
      if (!owned) {
        t.cost.replaceChildren(...costChips(world, outfitCost(world, o)));
        const err = outfitError(world, me, o.id);
        t.buy.disabled = !deps.connected() || !!err;
        t.buy.title = err ?? "";
      }
    }
    save.disabled = !deps.connected();
    drawPreview();
  }

  function open(): void {
    const me = deps.msg()?.me;
    if (!me) return;
    draft = { ...me.look };
    nameInput.value = session.nickname || me.name;
    status.textContent = "";
    panel.hidden = false;
    render();
  }

  meBtn.addEventListener("click", () => (panel.hidden ? open() : (panel.hidden = true)));
  window.setInterval(() => !panel.hidden && render(), 300);

  return {
    open,
    refresh() {
      const me = deps.msg()?.me;
      meBtn.hidden = !me;
      if (!me) return;
      meBtn.textContent = `🧍 ${me.name}`;
      // First time here: ask for a name and a look.
      if (!asked && !session.nickname) {
        asked = true;
        open();
        status.textContent = "Welkom! Kies een naam en hoe je NPC eruitziet.";
      }
    },
  };
}
