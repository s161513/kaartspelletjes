// Pixel-art icons instead of the system's emoji, everywhere on the counter page
// (update 25): the HUD, the menus, the panels, the popups. Nobody has to change
// how they write text: a MutationObserver finds every emoji that lands on the
// page and wraps it in a <span class="sx-ic"> that shows the icon instead.
//
// The resources have their own hand-drawn icons (world/sprites/pixelicons.py ->
// icons.png). Every other emoji is baked into pixel art here, once per emoji: drawn
// small with the system's emoji font, then hard edges, fewer colors and a dark rim,
// like the town's shapes (world/pixel.ts). The emoji itself stays in the span (not
// shown), so copying text and screen readers still get it.

import iconsUrl from "./world/sprites/icons.png?url";
import iconIndex from "./world/sprites/icons.json";

/** The icon grid, in px. */
const SIZE = 16;
/** Levels per color channel once baked. */
const LEVELS = 6;

/**
 * One emoji: something drawn as an emoji by default, or anything followed by
 * U+FE0F, with skin tones and ZWJ sequences; and keycaps (6️⃣). Plain symbols like
 * ↗ ▸ © stay text.
 */
const EMOJI = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️|[0-9#*]️?⃣)(?:⃣|‍\p{Extended_Pictographic}️?|[\u{1F3FB}-\u{1F3FF}])*/gu;

/** Text in these is left alone (they cannot hold a span, or are not shown). */
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "OPTION", "SELECT", "TITLE", "CANVAS"]);

const keyOf = (emoji: string) => emoji.replace(/️/g, "");

const HAND = new Map(Object.entries(iconIndex as Record<string, number>).map(([e, i]) => [keyOf(e), i]));

/** Emoji -> data URL of its icon. */
const urls = new Map<string, string>();
let sheet: HTMLImageElement | null = null;
const rules = document.createElement("style");

function canvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

/** Hard edges, fewer colors and a dark rim in the color of what it borders. */
function pixelize(g: CanvasRenderingContext2D): void {
  const img = g.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const step = 255 / (LEVELS - 1);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a < 120) {
      d[i + 3] = 0;
      continue;
    }
    // Undo the soft edge's see-through first, so edge pixels keep their color.
    for (let c = 0; c < 3; c++) d[i + c] = Math.round(Math.min(255, (d[i + c] * 255) / a) / step) * step;
    d[i + 3] = 255;
  }
  const out = new Uint8ClampedArray(d);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      if (d[i + 3]) continue;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
        const j = (ny * SIZE + nx) * 4;
        if (!d[j + 3]) continue;
        out[i] = d[j] * 0.35;
        out[i + 1] = d[j + 1] * 0.35;
        out[i + 2] = d[j + 2] * 0.4;
        out[i + 3] = 255;
        break;
      }
    }
  }
  img.data.set(out);
  g.putImageData(img, 0, 0);
}

function bake(emoji: string): string {
  const [c, g] = canvas();
  g.font = `${SIZE - 3}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, SIZE / 2, SIZE / 2 + 1);
  pixelize(g);
  return c.toDataURL();
}

function handDrawn(i: number): string {
  const [c, g] = canvas();
  g.drawImage(sheet!, i * SIZE, 0, SIZE, SIZE, 0, 0, SIZE, SIZE);
  return c.toDataURL();
}

/** The icon of `key`: hand-drawn once the sheet is in, baked otherwise. */
function urlOf(key: string): string {
  let url = urls.get(key);
  if (!url) {
    const i = HAND.get(key);
    url = i !== undefined && sheet ? handDrawn(i) : bake(key);
    urls.set(key, url);
    addRule(key, url);
  }
  return url;
}

function addRule(key: string, url: string): void {
  rules.sheet?.insertRule(`.sx-ic[data-e="${key}"]{background-image:url(${url})}`, rules.sheet.cssRules.length);
}

function wrap(text: Text): void {
  const s = text.data;
  EMOJI.lastIndex = 0;
  if (!EMOJI.test(s)) return;
  EMOJI.lastIndex = 0;
  const parts: (string | Node)[] = [];
  let at = 0;
  for (const m of s.matchAll(EMOJI)) {
    if (m.index > at) parts.push(s.slice(at, m.index));
    const key = keyOf(m[0]);
    urlOf(key);
    const ic = document.createElement("span");
    ic.className = "sx-ic";
    ic.dataset.e = key;
    ic.setAttribute("role", "img");
    ic.setAttribute("aria-label", m[0]);
    const inner = document.createElement("span");
    inner.textContent = m[0];
    inner.setAttribute("aria-hidden", "true");
    ic.append(inner);
    parts.push(ic);
    at = m.index + m[0].length;
  }
  if (at < s.length) parts.push(s.slice(at));
  text.replaceWith(...parts);
}

function skipped(node: Node): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (SKIP.has(el.tagName) || el.classList.contains("sx-ic")) return true;
  }
  return false;
}

function scan(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    if (!skipped(node)) wrap(node as Text);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as Element;
  if (SKIP.has(el.tagName) || el.classList.contains("sx-ic") || skipped(el)) return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => (skipped(t) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  texts.forEach(wrap);
}

/** Turn every emoji in `root`, now and later, into a pixel icon. */
export function startPixelIcons(root: HTMLElement = document.body): void {
  document.head.append(rules);
  const img = new Image();
  img.onload = () => {
    sheet = img;
    // Baked stand-ins for hand-drawn icons from before the sheet was in: swap them.
    for (const key of urls.keys()) {
      const i = HAND.get(key);
      if (i === undefined) continue;
      const url = handDrawn(i);
      urls.set(key, url);
      addRule(key, url);
    }
  };
  img.src = iconsUrl;
  scan(root);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") scan(r.target);
      else r.addedNodes.forEach(scan);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
