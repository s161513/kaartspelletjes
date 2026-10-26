import { createHash } from "node:crypto";
import {
  ERAS,
  MAP_SIZE,
  MAX_ITEM_BOOST_MS,
  MAX_PATH_TILES,
  MAX_PROPOSALS,
  MIN_YES,
  MAX_NAME_LENGTH,
  LUCKY_GOLD_MULT,
  LUCKY_MS,
  MAX_DROPS,
  BIRTH_MS,
  MOVE_MS,
  RAID_MOODS,
  RAID_WARNING_MS,
  STATE_VERSION,
  VOTE_MS,
  WONDER_BUILD_MS,
  WONDER_PHASES,
  actionError,
  actionLabel,
  addDrop,
  advance,
  applyAction,
  applyBoost,
  assignGatherer,
  bedsOf,
  buildingType,
  buyItem,
  buyOutfit,
  canPave,
  defaultLook,
  itemError,
  lookError,
  luckyEvent,
  newIdleState,
  openDrop,
  outfit,
  outfitError,
  patches,
  resourceDef,
  rollLucky,
  shopItem,
  stepBirth,
  stepNewcomer,
  stepRaid,
  isLand,
  voteCounts,
  voteOutcome,
  votesNeeded,
  type ActiveBoost,
  type IdleEvent,
  type IdlePerson,
  type IdlePlayer,
  type IdleProposal,
  type IdleState,
  type IdleStateMsg,
  type PlacedBuilding,
  type NpcLook,
  type ProposalAction,
} from "@app/shared/idle";
import { debouncedSaver, loadJsonFile, saveJsonFile } from "./jsonFile.js";

// "67 Beschaving": the shared town behind the 67 counter (rules in
// shared/idle.ts). This keeps the one authoritative state, persisted to a
// JSON file. Production is computed from timestamps, so nothing needs to run
// while nobody is connected.

const SAVE_DELAY_MS = 500;
/** Players kept; past this the one not seen longest is forgotten. */
const MAX_PLAYERS = 500;
const KEY_RE = /^[A-Za-z0-9-]{16,64}$/;

export interface IdleGame {
  /** The state for one connection (its own vote included), produced up to `now`. */
  message(clientId: string, count: number, peak: number, online: number, now: number): IdleStateMsg;
  /** Put one villager without a job on a resource (null: let them choose), off `from` if the players put them there. */
  assign(from: unknown, to: unknown, now: number): { error?: string; events: IdleEvent[] };
  /** A +1 on the counter. */
  boost(now: number): void;
  /** A new 67 on the counter: a supply drop lands in town. */
  drop(now: number): IdleEvent[];
  /** A +1 on the counter may bring a lucky event (`rand`: 0..1). */
  lucky(now: number, rand: () => number): IdleEvent[];
  /** Open a supply drop. */
  open(clientId: string, name: unknown, id: unknown, now: number): { error?: string; events: IdleEvent[] };
  /** `error` goes back to the proposer only; `events` to everyone. */
  propose(clientId: string, name: unknown, action: unknown, online: number, now: number): { error?: string; events: IdleEvent[] };
  vote(clientId: string, id: unknown, yes: unknown, online: number, now: number): IdleEvent[];
  /** A small shop item, right away. */
  buy(clientId: string, name: unknown, item: unknown, now: number): { error?: string; events: IdleEvent[] };
  /** This connection is the player with this secret key (created if new). */
  hello(clientId: string, key: unknown, name: unknown, now: number): { error?: string };
  /** New name and NPC look for this connection's player. */
  look(clientId: string, name: unknown, look: unknown): { error?: string };
  /** Buy an outfit for this connection's player, from the town's storage. */
  outfit(clientId: string, item: unknown, now: number): { error?: string; events: IdleEvent[] };
  /** The connection closed: its NPC leaves (unless the player has another tab open). */
  leave(clientId: string, now: number): void;
  /** Settle votes whose outcome became clear (deadline, people leaving, resources arriving), and move raids along (`rand`: 0..1). */
  tick(online: number, now: number, rand?: () => number): IdleEvent[];
  flush(): void;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const tileInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < MAP_SIZE;
const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Boosts that belong to a known item and don't reach absurdly far ahead. */
function parseBoosts(raw: unknown, now: number): ActiveBoost[] {
  if (!Array.isArray(raw)) return [];
  const out: ActiveBoost[] = [];
  for (const b of raw.map(record)) {
    // Lucky events from the counter: they bring their own resource and multiplier.
    // How the town feels after a fight.
    const mood = RAID_MOODS.find((m) => m.id === b.item);
    if (mood && finite(b.until) && !out.some((o) => o.item === mood.id)) {
      out.push({ item: mood.id, resource: null, mult: 1, until: Math.min(b.until, now + mood.ms) });
      continue;
    }
    const lucky = typeof b.item === "string" ? luckyEvent(b.item) : undefined;
    if (lucky && finite(b.until) && finite(b.mult) && (b.resource === null || (typeof b.resource === "string" && !!resourceDef(b.resource)))) {
      out.push({ item: lucky.id, resource: b.resource as string | null, mult: Math.min(Math.max(b.mult, 1), LUCKY_GOLD_MULT), until: Math.min(b.until, now + LUCKY_MS) });
      continue;
    }
    const item = typeof b.item === "string" ? shopItem(b.item) : undefined;
    if (item?.effect.kind !== "boost" || !finite(b.until) || out.some((o) => o.item === item.id)) continue;
    const { resource, mult } = item.effect;
    out.push({ item: item.id, resource, mult, until: Math.min(b.until, now + MAX_ITEM_BOOST_MS) });
  }
  return out;
}

/** The shape of a look; whether it may be worn is lookError's job. */
function parseLook(raw: unknown): NpcLook | null {
  const r = record(raw);
  if (!finite(r.skin) || !finite(r.clothes) || typeof r.hat !== "string" || typeof r.pattern !== "string") return null;
  return { skin: r.skin, clothes: r.clothes, hat: r.hat, pattern: r.pattern };
}

function parsePlayers(raw: unknown): Record<string, IdlePlayer> {
  const out: Record<string, IdlePlayer> = {};
  for (const [id, v] of Object.entries(record(raw))) {
    const r = record(v);
    if (!/^[0-9a-f]{12}$/.test(id) || typeof r.name !== "string") continue;
    const owned = Array.isArray(r.owned) ? [...new Set(r.owned.filter((o): o is string => typeof o === "string" && !!outfit(o)?.cost))] : [];
    let look = parseLook(r.look);
    if (!look || lookError({ owned }, look)) look = defaultLook(parseInt(id, 16));
    out[id] = { name: cleanName(r.name), look, owned, seen: finite(r.seen) ? r.seen : 0 };
  }
  return out;
}

/** Street tiles on free land, once each, sorted. */
function parseRoads(raw: unknown, buildings: readonly PlacedBuilding[]): number[] {
  if (!Array.isArray(raw)) return [];
  const taken = new Set(buildings.map((b) => b.y * MAP_SIZE + b.x));
  const ok = (i: unknown): i is number =>
    Number.isInteger(i) && (i as number) >= 0 && (i as number) < MAP_SIZE * MAP_SIZE && !taken.has(i as number) && canPave((i as number) % MAP_SIZE, Math.floor((i as number) / MAP_SIZE));
  return [...new Set(raw.filter(ok))].sort((a, b) => a - b);
}

/** Open votes with a known action, once each, expiring no later than a day from now. */
function parseProposals(raw: unknown, now: number): IdleProposal[] {
  if (!Array.isArray(raw)) return [];
  const out: IdleProposal[] = [];
  for (const r of raw.map(record)) {
    const action = parseAction(r.action);
    if (!action || !Number.isInteger(r.id) || out.some((p) => p.id === r.id) || typeof r.by !== "string" || !finite(r.deadline)) continue;
    const votes = Object.fromEntries(Object.entries(record(r.votes)).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean>;
    out.push({ id: r.id as number, action, by: cleanName(r.by), votes, deadline: Math.min(r.deadline, now + VOTE_MS) });
  }
  return out.slice(0, MAX_PROPOSALS);
}

/**
 * Keep only known, sane fields. A file from an older version means the town
 * starts over (update 8: eras come from the town now, not the counter; update
 * 12: a new balance and a new start): only the players stay, with their
 * names and looks, but nothing they bought.
 */
function parseIdle(raw: unknown, now: number): IdleState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== STATE_VERSION) return { ...newIdleState(now), players: resetPlayers(parsePlayers(r.players)) };
  const s = newIdleState(now);
  if (Number.isInteger(r.era)) s.era = Math.max(0, Math.min(ERAS.length - 1, r.era as number));
  s.resources = {};
  for (const [id, n] of Object.entries(record(r.resources))) {
    if (resourceDef(id) && finite(n) && n >= 0) s.resources[id] = n;
  }
  if (Array.isArray(r.buildings)) {
    const seen = new Set<string>();
    const ids = new Set<number>();
    const buildings: PlacedBuilding[] = [];
    for (const raw of r.buildings as Record<string, unknown>[]) {
      const b = raw;
      if (!b || typeof b.type !== "string" || !buildingType(b.type)) continue;
      if (!Number.isInteger(b.id) || ids.has(b.id as number) || !tileInt(b.x) || !tileInt(b.y)) continue;
      if (!Number.isInteger(b.level) || (b.level as number) < 0 || (b.level as number) >= ERAS.length) continue;
      // One of each unique type (center, shops).
      if (buildingType(b.type)!.unique && buildings.some((x) => x.type === b.type)) continue;
      const tile = `${b.x},${b.y}`;
      if (seen.has(tile)) continue;
      seen.add(tile);
      ids.add(b.id as number);
      const building: PlacedBuilding = { id: b.id as number, type: b.type as string, level: b.level as number, x: b.x as number, y: b.y as number };
      // A world wonder under construction.
      if (buildingType(b.type)!.category === "wonder" && Number.isInteger(b.stage) && (b.stage as number) > 0 && (b.stage as number) < WONDER_PHASES) {
        building.stage = b.stage as number;
        building.ready = finite(b.ready) ? Math.min(b.ready, now + WONDER_BUILD_MS) : now;
      }
      if (b.damaged === true) building.damaged = true;
      // A mine digging another ore than its type's.
      if (typeof b.ore === "string" && buildingType(b.type)!.ores?.includes(b.ore) && b.ore !== buildingType(b.type)!.produces) building.ore = b.ore;
      buildings.push(building);
    }
    // Keep the fresh campfire only if the file somehow lost its center.
    if (!buildings.some((b) => b.type === "center")) buildings.unshift(s.buildings[0]);
    s.buildings = buildings;
    s.nextBuildingId = Math.max(0, ...buildings.map((b) => b.id)) + 1;
  }
  if (Number.isInteger(r.nextBuildingId)) s.nextBuildingId = Math.max(s.nextBuildingId, r.nextBuildingId as number);
  // A lastTick in the future (clock change) would freeze production; clamp it.
  if (finite(r.lastTick)) s.lastTick = Math.min(r.lastTick, now);
  if (finite(r.boostUntil)) s.boostUntil = r.boostUntil;
  s.boosts = parseBoosts(r.boosts, now);
  for (const [id, n] of Object.entries(record(r.perks))) {
    const e = shopItem(id)?.effect;
    if (e?.kind === "perk" && Number.isInteger(n) && (n as number) > 0) s.perks[id] = Math.min(n as number, e.max);
  }
  for (const [id, n] of Object.entries(record(r.gatherers))) {
    if (resourceDef(id) && Number.isInteger(n) && (n as number) > 0) s.gatherers[id] = n as number;
  }
  const all = patches();
  for (const [id, n] of Object.entries(record(r.nature))) {
    const p = all[Number(id)];
    if (p && String(p.id) === id && finite(n) && n > 0) s.nature[id] = Math.min(n, p.capacity);
  }
  if (Number.isInteger(r.roadLevel)) s.roadLevel = Math.max(0, Math.min(s.era, r.roadLevel as number));
  s.roads = parseRoads(r.roads, s.buildings);
  if (Number.isInteger(r.wallLevel)) s.wallLevel = Math.max(0, Math.min(s.era, r.wallLevel as number));
  // Walls on free land, not on a street.
  const streets = new Set(s.roads);
  s.walls = parseRoads(r.walls, s.buildings).filter((i) => !streets.has(i) && isLand(i % MAP_SIZE, Math.floor(i / MAP_SIZE)));
  if (finite(r.nextRaid) && r.nextRaid > 0) s.nextRaid = r.nextRaid;
  if (finite(r.nextNewcomer) && r.nextNewcomer > 0) s.nextNewcomer = Math.min(r.nextNewcomer, now + MOVE_MS);
  if (finite(r.nextBirth) && r.nextBirth > 0) s.nextBirth = Math.min(r.nextBirth, now + BIRTH_MS * 2);
  const raid = record(r.raid);
  const from = record(raid.from);
  if (finite(raid.at) && finite(raid.strength) && raid.strength >= 0 && tileInt(from.x) && tileInt(from.y)) {
    s.raid = { at: Math.min(raid.at, now + RAID_WARNING_MS), strength: Math.round(raid.strength), from: { x: from.x, y: from.y } };
  }
  const last = record(r.lastRaid);
  if (finite(last.at) && typeof last.won === "boolean" && finite(last.strength) && finite(last.defense) && finite(last.killed)) {
    const stolen: Record<string, number> = {};
    for (const [id, n] of Object.entries(record(last.stolen))) if (resourceDef(id) && finite(n) && n > 0) stolen[id] = n;
    s.lastRaid = {
      at: last.at, won: last.won, strength: last.strength, defense: last.defense, stolen, killed: Math.max(0, Math.round(last.killed)),
      damaged: typeof last.damaged === "string" ? last.damaged.slice(0, 40) : null,
    };
  }
  s.proposals = parseProposals(r.proposals, now);
  s.population = finite(r.population) && r.population >= 0 ? Math.min(r.population, 100_000) : bedsOf(s);
  if (finite(r.happiness)) s.happiness = Math.max(0, Math.min(100, r.happiness));
  if (Array.isArray(r.drops)) {
    for (const d of r.drops.map(record)) {
      if (Number.isInteger(d.id) && tileInt(d.x) && tileInt(d.y) && s.drops.length < MAX_DROPS) s.drops.push({ id: d.id as number, x: d.x as number, y: d.y as number });
    }
  }
  s.nextDropId = Math.max(Number.isInteger(r.nextDropId) ? (r.nextDropId as number) : 1, ...s.drops.map((d) => d.id + 1));
  if (finite(r.lastLucky)) s.lastLucky = Math.min(r.lastLucky, now);
  if (Number.isInteger(r.nextProposalId) && (r.nextProposalId as number) >= 1) s.nextProposalId = r.nextProposalId as number;
  s.nextProposalId = Math.max(s.nextProposalId, ...s.proposals.map((p) => p.id + 1));
  s.players = parsePlayers(r.players);
  return s;
}

/** Players after a reset: same name and colors, the free hat and pattern, nothing bought. */
function resetPlayers(players: Record<string, IdlePlayer>): Record<string, IdlePlayer> {
  const free = (id: string, fallback: string) => (outfit(id)?.cost ? fallback : id);
  return Object.fromEntries(
    Object.entries(players).map(([id, p]) => [id, { ...p, owned: [], look: { ...p.look, hat: free(p.look.hat, "none"), pattern: free(p.look.pattern, "plain") } }]),
  );
}

function parseAction(a: unknown): ProposalAction | null {
  const r = record(a);
  if (r.kind === "build" && typeof r.type === "string" && tileInt(r.x) && tileInt(r.y)) return { kind: "build", type: r.type, x: r.x, y: r.y };
  if (r.kind === "wonder" && Number.isInteger(r.building)) return { kind: "wonder", building: r.building as number };
  if (r.kind === "upgrade" && Number.isInteger(r.building)) return { kind: "upgrade", building: r.building as number };
  if (r.kind === "roads") return { kind: "roads" };
  if (r.kind === "buy" && typeof r.item === "string") return { kind: "buy", item: r.item };
  if (r.kind === "demolish" && Number.isInteger(r.building)) return { kind: "demolish", building: r.building as number };
  if (r.kind === "ore" && Number.isInteger(r.building) && typeof r.ore === "string" && resourceDef(r.ore)) return { kind: "ore", building: r.building as number, ore: r.ore };
  if (r.kind === "fortify") return { kind: "fortify" };
  if (r.kind === "repair" && Number.isInteger(r.building)) return { kind: "repair", building: r.building as number };
  if (r.kind === "newcomer") {
    const who = record(r.who);
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : null);
    const [name, trade, from] = [text(who.name), text(who.trade), text(who.from)];
    if (name && trade && from) return { kind: "newcomer", who: { name, trade, from } };
  }
  if ((r.kind === "paths" || r.kind === "unpave" || r.kind === "walls" || r.kind === "unwall") && Array.isArray(r.tiles) && r.tiles.length <= MAX_PATH_TILES) {
    const tiles = r.tiles.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < MAP_SIZE * MAP_SIZE);
    if (tiles.length === r.tiles.length) return { kind: r.kind, tiles: [...new Set(tiles)] };
  }
  return null;
}

function cleanName(name: unknown): string {
  const s = typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH) : "";
  return s || "iemand";
}

const amountText = (n: number) => (n >= 100 ? String(Math.floor(n)) : String(Math.floor(n * 10) / 10).replace(".", ","));

export function createIdleGame(file: string, now = Date.now()): IdleGame {
  let state = loadJsonFile(file, (raw) => parseIdle(raw, now), () => newIdleState(now), "idle");
  const saver = debouncedSaver(() => saveJsonFile(file, state, "idle"), SAVE_DELAY_MS);
  /** Connection → public player id, for everyone who said hello. */
  const connected = new Map<string, string>();

  const playerOf = (clientId: string): [string, IdlePlayer] | null => {
    const id = connected.get(clientId);
    return id && state.players[id] ? [id, state.players[id]] : null;
  };
  /** The player's own name if known, else what the message said. */
  const nameOf = (clientId: string, name: unknown) => playerOf(clientId)?.[1].name ?? cleanName(name);
  const setPlayer = (id: string, p: IdlePlayer) => {
    state = { ...state, players: { ...state.players, [id]: p } };
    saver.schedule();
  };
  const person = (id: string, p: IdlePlayer): IdlePerson => ({ id, name: p.name, look: p.look });

  /** Whose vote this is: the player's, so a reload or a second tab doesn't vote twice. */
  const voterOf = (clientId: string) => connected.get(clientId) ?? clientId;

  /**
   * Settle every open vote whose outcome is clear, oldest first; returns what
   * happened. One that was voted through but can't be paid for yet waits for
   * the resources until it expires.
   */
  const settle = (online: number, now: number): IdleEvent[] => {
    const events: IdleEvent[] = [];
    for (const p of state.proposals) {
      const outcome = voteOutcome(p, online, now);
      if (outcome === "pending") continue;
      // Resources may have changed (or the era moved on) during the vote: check again now.
      const err = outcome === "pass" ? actionError(advance(state, now), p.action) : null;
      if (err === "te duur" && now < p.deadline) continue;
      state = { ...advance(state, now), proposals: state.proposals.filter((x) => x.id !== p.id) };
      saver.schedule();
      const base = { label: actionLabel(state, p.action), by: p.by };
      if (outcome === "fail") {
        const { yes, no } = voteCounts(p);
        const reason = yes > no && yes < MIN_YES ? `verlopen: minstens ${MIN_YES} keer ja nodig` : "weggestemd";
        events.push({ kind: "rejected", ...base, reason });
      } else if (err) {
        events.push({ kind: "rejected", ...base, reason: err });
      } else {
        const era = state.era;
        const done = applyAction(state, p.action);
        state = done.state;
        events.push(done.building ? { kind: "bought", ...base, building: done.building } : { kind: "bought", ...base });
        if (state.era > era) events.push({ kind: "era", era: state.era });
      }
    }
    return events;
  };

  return {
    message(clientId, count, peak, online, now) {
      const { proposals, nextProposalId: _, players, ...world } = advance(state, now);
      const ids = [...new Set(connected.values())].filter((id) => players[id]);
      const mine = playerOf(clientId);
      return {
        type: "idle",
        state: world,
        proposals: proposals.map((p) => ({
          id: p.id,
          action: p.action,
          label: actionLabel(state, p.action),
          by: p.by,
          ...voteCounts(p),
          needed: votesNeeded(online),
          deadline: p.deadline,
          myVote: p.votes[voterOf(clientId)] ?? null,
          approved: voteOutcome(p, online, now) === "pass",
        })),
        people: ids.map((id) => person(id, players[id])),
        me: mine && { ...person(...mine), owned: mine[1].owned },
        count,
        peak,
        online,
        now,
      };
    },

    assign(from, to, now) {
      const res = (v: unknown) => v === null || (typeof v === "string" && !!resourceDef(v));
      if (!res(from) || !res(to)) return { error: "onbekende grondstof", events: [] };
      const done = assignGatherer(advance(state, now), from as string | null, to as string | null);
      if (typeof done === "string") return { error: done, events: [] };
      state = done;
      saver.schedule();
      return { events: [] };
    },

    boost(now) {
      state = applyBoost(advance(state, now), now);
      saver.schedule();
    },

    drop(now) {
      const before = state.drops.length;
      state = addDrop(advance(state, now), Math.random);
      saver.schedule();
      return state.drops.length > before ? [{ kind: "lucky", label: "📦 Supply drop! Er is een krat in het dorp geland: klik erop" }] : [];
    },

    lucky(now, rand) {
      const done = rollLucky(advance(state, now), rand);
      if (!done) return [];
      state = done.state;
      saver.schedule();
      return [{ kind: "lucky", label: done.label }];
    },

    open(clientId, name, id, now) {
      if (!Number.isInteger(id)) return { error: "onbekende krat", events: [] };
      const done = openDrop(advance(state, now), id as number);
      if (typeof done === "string") return { error: done, events: [] };
      state = done.state;
      saver.schedule();
      const got = Object.entries(done.got).map(([r, n]) => `+${amountText(n)} ${resourceDef(r)!.emoji}`).join(" ");
      return { events: [{ kind: "deal", label: `📦 supply drop: ${got}`, by: nameOf(clientId, name) }] };
    },

    propose(clientId, name, rawAction, online, now) {
      const action = parseAction(rawAction);
      if (!action) return { error: "onbekend voorstel", events: [] };
      if (action.kind === "buy" && shopItem(action.item)?.vote === false) return { error: "dat kan je meteen kopen", events: [] };
      if (action.kind === "newcomer") return { error: "nieuwkomers kloppen zelf aan", events: [] };
      if (state.proposals.length >= MAX_PROPOSALS) return { error: "te veel open stemmingen", events: [] };
      state = advance(state, now);
      // Checked now and again when it passes: things change while it's open.
      const err = actionError(state, action);
      if (err) return { error: err, events: [] };
      const by = nameOf(clientId, name);
      const proposal = { id: state.nextProposalId, action, by, votes: { [voterOf(clientId)]: true }, deadline: now + VOTE_MS };
      state = { ...state, proposals: [...state.proposals, proposal], nextProposalId: state.nextProposalId + 1 };
      saver.schedule();
      return { events: [{ kind: "proposed", label: actionLabel(state, action), by }, ...settle(online, now)] };
    },

    vote(clientId, id, yes, online, now) {
      if (typeof yes !== "boolean" || !state.proposals.some((p) => p.id === id)) return [];
      const voter = voterOf(clientId);
      state = { ...state, proposals: state.proposals.map((p) => (p.id === id ? { ...p, votes: { ...p.votes, [voter]: yes } } : p)) };
      saver.schedule();
      return settle(online, now);
    },

    buy(clientId, name, itemId, now) {
      const item = typeof itemId === "string" ? shopItem(itemId) : undefined;
      if (!item) return { error: "onbekend", events: [] };
      if (item.vote) return { error: "hiervoor is een stemming nodig", events: [] };
      const advanced = advance(state, now);
      const err = itemError(advanced, item.id);
      if (err) return { error: err, events: [] };
      state = buyItem(advanced, item.id);
      saver.schedule();
      return { events: [{ kind: "deal", label: `${item.emoji} ${item.name}`, by: nameOf(clientId, name) }] };
    },

    hello(clientId, key, name, now) {
      if (typeof key !== "string" || !KEY_RE.test(key)) return { error: "ongeldige sleutel" };
      // Only a hash is stored and shown, so nobody can take over someone else's NPC.
      const id = createHash("sha256").update(key).digest("hex").slice(0, 12);
      let p = state.players[id];
      if (!p) {
        const ids = Object.keys(state.players);
        if (ids.length >= MAX_PLAYERS) {
          const oldest = ids.reduce((a, b) => (state.players[a].seen <= state.players[b].seen ? a : b));
          const { [oldest]: _, ...rest } = state.players;
          state = { ...state, players: rest };
        }
        p = { name: cleanName(name), look: defaultLook(parseInt(id, 16)), owned: [], seen: now };
      }
      connected.set(clientId, id);
      setPlayer(id, { ...p, seen: now });
      return {};
    },

    look(clientId, name, rawLook) {
      const mine = playerOf(clientId);
      if (!mine) return { error: "eerst inloggen" };
      const look = parseLook(rawLook);
      const err = look ? lookError(mine[1], look) : "onbekende kleding";
      if (err) return { error: err };
      setPlayer(mine[0], { ...mine[1], name: typeof name === "string" && name.trim() ? cleanName(name) : mine[1].name, look: look! });
      return {};
    },

    outfit(clientId, item, now) {
      const mine = playerOf(clientId);
      if (!mine) return { error: "eerst inloggen", events: [] };
      if (typeof item !== "string") return { error: "onbekend", events: [] };
      const advanced = advance(state, now);
      const err = outfitError(advanced, mine[1], item);
      if (err) return { error: err, events: [] };
      const done = buyOutfit(advanced, mine[1], item);
      state = done.state;
      setPlayer(mine[0], done.player);
      const o = outfit(item)!;
      return { events: [{ kind: "deal", label: `${o.emoji} ${o.name}`, by: mine[1].name }] };
    },

    leave(clientId, now) {
      const mine = playerOf(clientId);
      connected.delete(clientId);
      if (mine) setPlayer(mine[0], { ...mine[1], seen: now });
    },

    tick(online, now, rand = Math.random) {
      const events = settle(online, now);
      const done = stepRaid(advance(state, now), rand);
      if (done) {
        state = done.state;
        saver.schedule();
        if (done.news) events.push({ kind: "raid", ...done.news });
      }
      // Someone knocks on the door, or a couple has a child.
      const steps: ((s: IdleState) => { state: IdleState; label?: string } | null)[] = [(s) => stepNewcomer(s, rand), (s) => stepBirth(s, rand)];
      for (const step of steps) {
        const news = step(advance(state, now));
        if (!news) continue;
        state = news.state;
        saver.schedule();
        if (news.label) events.push({ kind: "lucky", label: news.label });
      }
      return events;
    },

    flush() {
      saver.flush();
    },
  };
}
