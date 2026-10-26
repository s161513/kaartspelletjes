// "67 Beschaving" in the browser: keeps the latest server state, keeps it
// producing between updates, says who this browser is, and wires the canvas
// world to the panels and the NPC editor.

import {
  advance,
  type IdleClientMsg,
  type IdleEvent,
  type IdleStateMsg,
  type IdleWorld,
} from "@app/shared/idle";
import { session } from "../session";
import { createAvatarEditor, playerKey } from "./avatar";
import { createPanels } from "./panels";
import { createWorld } from "./world";

export interface Town {
  update(msg: IdleStateMsg): void;
  /** World visuals for an event (popups are the counter page's job). */
  event(ev: IdleEvent): void;
  setConnected(open: boolean): void;
  /** A +1 on the counter. */
  cheer(): void;
}

export function createTown(send: (msg: IdleClientMsg) => void): Town {
  let latest: IdleStateMsg | null = null;
  let receivedAt = 0;
  let connected = false;

  const serverNow = () => (latest ? latest.now + (Date.now() - receivedAt) : Date.now());
  const current = (): IdleWorld | null => (latest ? advance(latest.state, serverNow()) : null);

  const world = createWorld({
    canvas: document.getElementById("sx-world") as HTMLCanvasElement,
    onSelect: (b) => panels.inspect(b),
    onVillager: (id) => panels.inspectVillager(id),
    onTile: (x, y, px, py) => panels.tile(x, y, px, py),
    onPaint: (x, y, first) => panels.paint(x, y, first),
  });

  const panels = createPanels({
    send,
    msg: () => latest,
    world: current,
    serverNow,
    connected: () => connected,
    select: (id) => world.select(id),
    selectVillager: (id) => world.selectVillager(id),
    villager: (id) => world.villager(id),
    setGather: (id, g) => world.setGather(id, g),
    setPlacing: (ok) => world.setPlacing(ok),
    mark: (tile) => world.mark(tile),
    setGhost: (action) => world.setGhost(action),
    lookAt: (x, y) => world.lookAt(x, y),
    setPainting: (ok) => world.setPainting(ok),
    setDraft: (draft) => world.setDraft(draft),
    openAvatar: () => avatar.open(),
  });

  const avatar = createAvatarEditor({ send, msg: () => latest, world: current, connected: () => connected });

  window.addEventListener("sx-recenter", () => world.recenter());

  return {
    update(msg) {
      latest = msg;
      receivedAt = Date.now();
      world.setWorld(msg.state);
      world.setPeople(msg.people, msg.me?.id ?? null);
      panels.refresh();
      avatar.refresh();
    },
    event(ev) {
      if (ev.kind === "bought" && ev.building) {
        world.built(ev.building);
      } else if (ev.kind === "era") {
        world.celebrate();
      } else if (ev.kind === "raid") {
        world.raid(ev.stage, ev.damaged);
      }
    },
    setConnected(open) {
      connected = open;
      // Every (re)connect: tell the server who we are, so our NPC shows up.
      if (open) send({ type: "hello", key: playerKey(), name: session.nickname || undefined });
      panels.refresh();
    },
    cheer() {
      world.cheer();
    },
  };
}
