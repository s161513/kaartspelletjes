// Content for "67 Beschaving": resources, eras, building types and the balance
// table. Pure data (plus tiny lookups); the rules are in idle.ts and the map in
// idleMap.ts. Tweak the numbers here — everything else derives from them.

export type ResourceId = string;
export type Amounts = Record<ResourceId, number>;

export interface ResourceDef {
  id: ResourceId;
  name: string;
  emoji: string;
  /** Era in which it unlocks. */
  era: number;
}

/** The three base resources exist from the start; every later era adds one special. */
export const RESOURCES: readonly ResourceDef[] = [
  { id: "food", name: "voedsel", emoji: "🍖", era: 0 },
  { id: "wood", name: "hout", emoji: "🪵", era: 0 },
  { id: "stone", name: "steen", emoji: "🪨", era: 0 },
  { id: "bronze", name: "brons", emoji: "🥉", era: 1 },
  { id: "iron", name: "ijzer", emoji: "⛓️", era: 2 },
  { id: "gold", name: "goud", emoji: "🪙", era: 3 },
  { id: "wool", name: "wol", emoji: "🧶", era: 4 },
  { id: "knowledge", name: "kennis", emoji: "📜", era: 5 },
  { id: "coal", name: "kolen", emoji: "⚫", era: 6 },
  { id: "oil", name: "olie", emoji: "🛢️", era: 7 },
  { id: "data", name: "data", emoji: "💾", era: 8 },
  { id: "titanium", name: "titanium", emoji: "🔷", era: 9 },
  { id: "antimatter", name: "antimaterie", emoji: "⚛️", era: 10 },
];

/** Colors for drawing an era: buildings, ground and the villagers' clothes. */
export interface EraStyle {
  wall: string;
  roof: string;
  roofType: "cone" | "gable" | "flat" | "dome";
  /** Window color; empty = no windows. */
  window: string;
  /** Lit-up accents (neon, force fields). */
  glow?: string;
  grass: string;
  clothes: string[];
}

export interface EraDef {
  name: string;
  emoji: string;
  /** Resource that unlocks in this era (none in the Stone Age). */
  special: ResourceId | null;
  style: EraStyle;
}

export const ERAS: readonly EraDef[] = [
  {
    name: "Steentijd", emoji: "🪨", special: null,
    style: { wall: "#8a6a44", roof: "#c9a65a", roofType: "cone", window: "", grass: "#6aa84f", clothes: ["#8b5a2b", "#a0522d", "#6b4423"] },
  },
  {
    name: "Bronstijd", emoji: "🥉", special: "bronze",
    style: { wall: "#c19a6b", roof: "#d8b66a", roofType: "cone", window: "#3b2a1a", grass: "#74ad52", clothes: ["#c8a165", "#b5651d", "#e0c08a"] },
  },
  {
    name: "IJzertijd", emoji: "⚔️", special: "iron",
    style: { wall: "#7a5532", roof: "#5b4a3a", roofType: "gable", window: "#2a1d12", grass: "#6c9f4c", clothes: ["#6d4c41", "#556b2f", "#8d6e63"] },
  },
  {
    name: "Oudheid", emoji: "🏛️", special: "gold",
    style: { wall: "#efe6d4", roof: "#c0603a", roofType: "gable", window: "#4a3b2a", grass: "#7fb05a", clothes: ["#f5f0e1", "#b22222", "#4169e1"] },
  },
  {
    name: "Middeleeuwen", emoji: "🏰", special: "wool",
    style: { wall: "#e8dcc0", roof: "#7a3b2a", roofType: "gable", window: "#3a2e22", grass: "#5f9447", clothes: ["#2e5e2e", "#7b1e1e", "#4b3a6b"] },
  },
  {
    name: "Renaissance", emoji: "🎨", special: "knowledge",
    style: { wall: "#a9553a", roof: "#3d3d4a", roofType: "gable", window: "#f0e6b0", grass: "#6aa84f", clothes: ["#6a0dad", "#b8860b", "#8b0000"] },
  },
  {
    name: "Industriële revolutie", emoji: "🏭", special: "coal",
    style: { wall: "#8b3a2a", roof: "#3a3a3a", roofType: "flat", window: "#f6d77a", grass: "#6b8a4e", clothes: ["#3b3b3b", "#5a4632", "#2f4f4f"] },
  },
  {
    name: "Moderne tijd", emoji: "💡", special: "oil",
    style: { wall: "#cfc8bc", roof: "#55595e", roofType: "flat", window: "#9fd3ff", grass: "#79b35a", clothes: ["#1e3a8a", "#d97706", "#374151"] },
  },
  {
    name: "Digitale tijd", emoji: "💻", special: "data",
    style: { wall: "#e6edf3", roof: "#2b3a4a", roofType: "flat", window: "#22f0ff", glow: "#22f0ff", grass: "#64b864", clothes: ["#111827", "#22c55e", "#ec4899"] },
  },
  {
    name: "Ruimtetijdperk", emoji: "🚀", special: "titanium",
    style: { wall: "#c0c8d0", roof: "#eef2f7", roofType: "dome", window: "#7dd3fc", glow: "#7dd3fc", grass: "#5aa67a", clothes: ["#f1f5f9", "#fb923c", "#94a3b8"] },
  },
  {
    name: "Sci-fi-toekomst", emoji: "🌌", special: "antimatter",
    style: { wall: "#2a2440", roof: "#7b5cff", roofType: "dome", window: "#e879f9", glow: "#b06bff", grass: "#5b6fd6", clothes: ["#a855f7", "#22d3ee", "#f472b6"] },
  },
];

export type Category = "center" | "house" | "work" | "storage" | "shop" | "decor";

/** How idle villagers react to a decoration. */
export type DecorBehavior = "dance" | "photo" | "pose" | "sit";

export type DecorShape =
  | "statue67" | "flowers" | "totem" | "menhir" | "statue" | "fountain"
  | "tower" | "neon" | "hologram" | "monument67";

export interface BuildingType {
  id: string;
  category: Category;
  /** Name per level (= era); a type without an entry for a level can't be at that level. */
  names: readonly string[];
  emoji: string;
  /** First era it can be built in. */
  minEra: number;
  /** Work buildings: what they make. */
  produces?: ResourceId;
  /** Level-0 cost, multiplied by the balance table for higher levels. */
  baseCost: Amounts;
  /** Plus this much of the building's level's special resource (from era 1). */
  specialCost?: number;
  /** Only one can exist (the center, every shop). */
  unique?: boolean;
  /** Decorations don't level up. */
  noUpgrade?: boolean;
  decor?: { shape: DecorShape; behavior: DecorBehavior; color: string };
}

const sameName = (name: string) => Array.from({ length: 11 }, () => name);
/** Names from `minEra` on; earlier levels repeat the first (they never occur). */
const fromEra = (minEra: number, names: readonly string[]) => [...Array.from({ length: minEra }, () => names[0]), ...names];

export const BUILDING_TYPES: readonly BuildingType[] = [
  {
    id: "center", category: "center", emoji: "🔥", minEra: 0, unique: true, specialCost: 30,
    baseCost: { wood: 100, stone: 100, food: 50 },
    names: ["Kampvuur", "Dorpsplein", "Stamhoofdhal", "Forum", "Marktplein", "Raadhuis", "Stadhuis", "Gemeentehuis", "Smart City Hub", "Ruimtehaven", "Galactische Senaat"],
  },
  {
    id: "house", category: "house", emoji: "🛖", minEra: 0, specialCost: 10,
    baseCost: { wood: 30, stone: 10 },
    names: ["Hut", "Lemen huis", "Langhuis", "Villa", "Vakwerkhuis", "Grachtenpand", "Arbeidershuis", "Rijtjeshuis", "Smart home", "Maanwoning", "Zweefwoning"],
  },
  {
    id: "food", category: "work", emoji: "🌾", minEra: 0, produces: "food", specialCost: 10,
    baseCost: { wood: 25 },
    names: ["Jagerskamp", "Akker", "Boerderij", "Wijngaard", "Hoeve", "Landgoed", "Graanmolen", "Agrobedrijf", "Verticale farm", "Hydrocultuur", "Voedselsynthesizer"],
  },
  {
    id: "wood", category: "work", emoji: "🪓", minEra: 0, produces: "wood", specialCost: 10,
    baseCost: { food: 20, stone: 5 },
    names: ["Houthakker", "Houtkamp", "Zagerij", "Timmerwerf", "Watermolen", "Scheepswerf", "Stoomzagerij", "Houtfabriek", "Bosdronestation", "Biodome", "Bioplant"],
  },
  {
    id: "stone", category: "work", emoji: "⛏️", minEra: 0, produces: "stone", specialCost: 10,
    baseCost: { wood: 30, food: 10 },
    names: ["Steengroeve", "Steenhouwerij", "Groeve", "Marmergroeve", "Steenbakkerij", "Metselwerkplaats", "Steenfabriek", "Betoncentrale", "3D-printerij", "Asteroïdeboor", "Materieprinter"],
  },
  ...(
    [
      ["bronze", "Kopermijn", "🥉", 1],
      ["iron", "IJzermijn", "⛓️", 2],
      ["gold", "Goudmijn", "🪙", 3],
      ["wool", "Schapenwei", "🐑", 4],
      ["knowledge", "Bibliotheek", "📚", 5],
      ["coal", "Kolenmijn", "⚫", 6],
      ["oil", "Oliebron", "🛢️", 7],
      ["data", "Datacenter", "🖥️", 8],
      ["titanium", "Titaniummijn", "🔷", 9],
      ["antimatter", "Antimateriereactor", "⚛️", 10],
    ] as const
  ).map(([res, name, emoji, era]): BuildingType => ({
    id: `mine_${res}`, category: "work", emoji, minEra: era, produces: res, specialCost: 10,
    baseCost: { wood: 40, stone: 40, food: 20 },
    names: sameName(name),
  })),
  {
    id: "storage", category: "storage", emoji: "🏚️", minEra: 0, specialCost: 15,
    baseCost: { wood: 50, stone: 30 },
    names: ["Schuur", "Graanschuur", "Voorraadhut", "Pakhuis", "Tiendschuur", "Waag", "Magazijn", "Silo", "Distributiecentrum", "Vrachthangar", "Ruimtedepot"],
  },
  ...(
    [
      ["market", "🏪", 0, { wood: 60, food: 30 }, ["Ruilplaats", "Marktkraam", "Handelspost", "Agora", "Markthal", "Handelshuis", "Beurs", "Winkelcentrum", "Webshop", "Ruimtemarkt", "Galactische beurs"]],
      ["sculptor", "🎨", 0, { stone: 60, wood: 20 }, ["Beeldhouwer", "Beeldhouwer", "Beeldensmidse", "Atelier", "Steenhouwersgilde", "Kunstatelier", "Gieterij", "Designstudio", "3D-kunstlab", "Holostudio", "Kosmisch atelier"]],
      ["tavern", "🍺", 0, { wood: 50, food: 40 }, ["Mede-hut", "Bierhuis", "Taverne", "Taberna", "Herberg", "Wijnhuis", "Kroeg", "Café", "Gamingcafé", "Ruimtebar", "Kosmische cantina"]],
      ["tailor", "🧵", 0, { wood: 40, food: 40 }, ["Huidenlooier", "Wever", "Kleermaker", "Toga-atelier", "Kleermakerij", "Modehuis", "Confectie", "Boetiek", "Streetwear-shop", "Ruimtepakkenzaak", "Holo-couture"]],
      ["smith", "⚒️", 1, { wood: 80, stone: 80 }, ["Bronsgieter", "Smederij", "Wapensmid", "Gildesmid", "Meestersmid", "IJzergieterij", "Werkplaats", "Robotfabriek", "Exo-smederij", "Nanosmid"]],
      ["bank", "🏦", 3, { stone: 120, wood: 60 }, ["Geldwisselaar", "Wisselbank", "Medici-bank", "Nationale bank", "Wereldbank", "Cryptobank", "Ruimtebank", "Galactische schatkist"]],
      ["university", "🎓", 5, { stone: 120, wood: 80 }, ["Universiteit", "Hogeschool", "Technische universiteit", "Onderzoekscampus", "Ruimteacademie", "Tijdloze academie"]],
      ["lab", "🔬", 7, { stone: 150, wood: 100 }, ["Laboratorium", "AI-lab", "Ruimtelab", "Kwantumlab"]],
      ["spaceport", "🛸", 9, { stone: 200, wood: 150 }, ["Handelsstation", "Interstellaire handelspost"]],
    ] as const
  ).map(([id, emoji, era, cost, names]): BuildingType => ({
    id: `shop_${id}`, category: "shop", emoji, minEra: era, unique: true, specialCost: 15,
    baseCost: cost, names: fromEra(era, names),
  })),
  ...(
    [
      ["statue67", "67-standbeeld", "🗿", 0, { wood: 20, stone: 40 }, "statue67", "photo", "#d4d4d8"],
      ["flowers", "Bloemperk", "🌷", 0, { food: 15, wood: 10 }, "flowers", "sit", "#f472b6"],
      ["totem", "Totempaal", "🪵", 0, { wood: 60 }, "totem", "dance", "#b45309"],
      ["menhir", "Menhir", "🪨", 1, { stone: 80 }, "menhir", "pose", "#9ca3af"],
      ["warrior", "Krijgersbeeld", "⚔️", 2, { stone: 60, wood: 20 }, "statue", "pose", "#78716c"],
      ["fountain", "Marmeren fontein", "⛲", 3, { stone: 80, food: 20 }, "fountain", "dance", "#f5f5f4"],
      ["knight", "Ridderstandbeeld", "🛡️", 4, { stone: 70, wood: 30 }, "statue", "pose", "#a8a29e"],
      ["david", "David-beeld", "🗽", 5, { stone: 90 }, "statue", "photo", "#fafaf9"],
      ["clocktower", "Klokkentoren", "🕰️", 6, { stone: 80, wood: 40 }, "tower", "pose", "#7c2d12"],
      ["neon", "Neonbord", "💡", 7, { wood: 40, stone: 40 }, "neon", "dance", "#ff2fb3"],
      ["hologram", "67-hologram", "✨", 8, { stone: 60, food: 40 }, "hologram", "photo", "#22f0ff"],
      ["astronaut", "Astronautenbeeld", "👨‍🚀", 9, { stone: 90, wood: 20 }, "statue", "photo", "#e2e8f0"],
      ["monument67", "Mega-67-monument", "🌀", 10, { stone: 150, wood: 50 }, "monument67", "dance", "#b06bff"],
    ] as const
  ).map(([id, name, emoji, era, cost, shape, behavior, color]): BuildingType => ({
    id: `decor_${id}`, category: "decor", emoji, minEra: era, noUpgrade: true,
    baseCost: cost, names: sameName(name), decor: { shape, behavior, color },
  })),
];

// ---------- shop items ----------

export type ShopEffect =
  /** Production of one resource (null = all) ×mult for a while; buying again extends it. */
  | { kind: "boost"; resource: ResourceId | null; mult: number; ms: number }
  /** A permanent upgrade, bought up to `max` times; its level lives in `perks[item id]`. */
  | { kind: "perk"; max: number }
  /** This many seconds of production at once. */
  | { kind: "instant"; seconds: number };

export interface ShopItem {
  id: string;
  /** Building type of the shop that sells it. */
  shop: string;
  name: string;
  emoji: string;
  /** What it does, for the shop window. */
  desc: string;
  /** Big purchases go through a vote; small ones are bought right away. */
  vote: boolean;
  /** Level-0 cost, ×4 per era; perks ×PERK_GROWTH per level owned. */
  cost: Amounts;
  effect: ShopEffect;
}

const MIN = 60_000;

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: "feast_food", shop: "shop_tavern", name: "Feestmaal", emoji: "🍗", desc: "+50% voedsel, 2 min", vote: false, cost: { wood: 30 }, effect: { kind: "boost", resource: "food", mult: 1.5, ms: 2 * MIN } },
  { id: "feast_wood", shop: "shop_tavern", name: "Houthakkerslied", emoji: "🎶", desc: "+50% hout, 2 min", vote: false, cost: { food: 30 }, effect: { kind: "boost", resource: "wood", mult: 1.5, ms: 2 * MIN } },
  { id: "feast_stone", shop: "shop_tavern", name: "Steenhouwersbier", emoji: "🍺", desc: "+50% steen, 2 min", vote: false, cost: { food: 30 }, effect: { kind: "boost", resource: "stone", mult: 1.5, ms: 2 * MIN } },
  { id: "party", shop: "shop_tavern", name: "Groot dorpsfeest", emoji: "🎉", desc: "×2 alle productie, 10 min", vote: true, cost: { food: 150, wood: 100, stone: 100 }, effect: { kind: "boost", resource: null, mult: 2, ms: 10 * MIN } },
  { id: "tools_food", shop: "shop_smith", name: "Betere sikkels", emoji: "🌾", desc: "+10% voedsel, voor altijd", vote: true, cost: { wood: 80, stone: 60 }, effect: { kind: "perk", max: 5 } },
  { id: "tools_wood", shop: "shop_smith", name: "Scherpere bijlen", emoji: "🪓", desc: "+10% hout, voor altijd", vote: true, cost: { food: 60, stone: 80 }, effect: { kind: "perk", max: 5 } },
  { id: "tools_stone", shop: "shop_smith", name: "Stalen houwelen", emoji: "⛏️", desc: "+10% steen, voor altijd", vote: true, cost: { food: 60, wood: 80 }, effect: { kind: "perk", max: 5 } },
  { id: "tools_special", shop: "shop_smith", name: "Mijnwerkerslampen", emoji: "🔦", desc: "+10% op alle speciale grondstoffen, voor altijd", vote: true, cost: { food: 100, wood: 100, stone: 100 }, effect: { kind: "perk", max: 5 } },
  { id: "vault", shop: "shop_bank", name: "Grotere kluis", emoji: "🔐", desc: "+25% opslag, voor altijd", vote: true, cost: { stone: 200, wood: 100 }, effect: { kind: "perk", max: 4 } },
  { id: "tradeDeal", shop: "shop_bank", name: "Handelsakkoord", emoji: "🤝", desc: "+5% betere koers op de markt", vote: true, cost: { food: 150, wood: 150 }, effect: { kind: "perk", max: 3 } },
  { id: "workplace", shop: "shop_university", name: "Efficiënte werkplaatsen", emoji: "👷", desc: "+1 werker per werkgebouw", vote: true, cost: { food: 200, wood: 200, stone: 200 }, effect: { kind: "perk", max: 3 } },
  { id: "architecture", shop: "shop_university", name: "Architectuur", emoji: "📐", desc: "−10% bouw- en upgradekosten", vote: true, cost: { wood: 250, stone: 250 }, effect: { kind: "perk", max: 3 } },
  { id: "auto", shop: "shop_lab", name: "Automatisering", emoji: "🤖", desc: "robots verzamelen elke grondstof (+½ klik per seconde)", vote: true, cost: { food: 250, wood: 250, stone: 250 }, effect: { kind: "perk", max: 5 } },
  { id: "timewarp", shop: "shop_spaceport", name: "Tijdsprong", emoji: "⏩", desc: "meteen 10 minuten productie", vote: true, cost: { food: 300, wood: 300, stone: 300 }, effect: { kind: "instant", seconds: 600 } },
];

// ---------- streets ----------

/** The whole street network has one level, upgraded (by vote) straight to the current era. */
export const ROAD_NAMES: readonly string[] = [
  "Zandpaden", "Grindpaden", "Aangestampte wegen", "Romeinse wegen", "Kasseien", "Klinkers",
  "Macadam", "Asfalt", "Slimme wegen", "Zweefbanen", "Lichtbanen",
];
/** Level-0 cost of upgrading the streets (×4 per era, plus that era's special). */
export const ROAD_COST: Amounts = { stone: 80, wood: 30 };
export const ROAD_SPECIAL_COST = 20;
/** Laying one tile of path, at the street network's level (×4 per level). */
export const PATH_TILE_COST: Amounts = { stone: 3, wood: 1 };
/** A path tile over the river is a bridge. */
export const BRIDGE_TILE_COST: Amounts = { wood: 12, stone: 6 };
/** At most this many path tiles in one proposal. */
export const MAX_PATH_TILES = 150;

// ---------- players' own NPCs ----------

export const SKIN_TONES: readonly string[] = ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#a1665e", "#8d5524"];
export const CLOTHES_COLORS: readonly string[] = [
  "#ef4444", "#f97316", "#facc15", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#f5f5f4", "#1f2937",
];

export interface Outfit {
  id: string;
  kind: "hat" | "pattern";
  name: string;
  emoji: string;
  /** Level-0 price at the tailor (×4 per era); none = everyone has it. */
  cost?: Amounts;
  /** First era the tailor sells it. */
  minEra: number;
}

export const OUTFITS: readonly Outfit[] = [
  { id: "none", kind: "hat", name: "Geen", emoji: "🙂", minEra: 0 },
  { id: "cap", kind: "hat", name: "Pet", emoji: "🧢", minEra: 0 },
  { id: "straw", kind: "hat", name: "Strohoed", emoji: "👒", cost: { food: 40, wood: 20 }, minEra: 0 },
  { id: "horns", kind: "hat", name: "Hoorntjeshelm", emoji: "🪖", cost: { stone: 60, wood: 30 }, minEra: 2 },
  { id: "crown", kind: "hat", name: "Kroon", emoji: "👑", cost: { stone: 150, food: 100 }, minEra: 3 },
  { id: "tophat", kind: "hat", name: "Hoge hoed", emoji: "🎩", cost: { food: 80, wood: 80 }, minEra: 6 },
  { id: "headphones", kind: "hat", name: "Koptelefoon", emoji: "🎧", cost: { stone: 80, food: 80 }, minEra: 8 },
  { id: "helmet", kind: "hat", name: "Ruimtehelm", emoji: "🧑‍🚀", cost: { stone: 120, wood: 60 }, minEra: 9 },
  { id: "plain", kind: "pattern", name: "Effen", emoji: "⬜", minEra: 0 },
  { id: "stripes", kind: "pattern", name: "Streepjes", emoji: "🦓", minEra: 0 },
  { id: "dots", kind: "pattern", name: "Stippen", emoji: "🔴", cost: { food: 30, wood: 30 }, minEra: 0 },
  { id: "sixseven", kind: "pattern", name: "67-print", emoji: "6️⃣", cost: { food: 67, wood: 67, stone: 67 }, minEra: 0 },
  { id: "camo", kind: "pattern", name: "Camouflage", emoji: "🌿", cost: { wood: 80, food: 40 }, minEra: 2 },
  { id: "gold", kind: "pattern", name: "Goud", emoji: "✨", cost: { stone: 200, food: 100 }, minEra: 3 },
  { id: "check", kind: "pattern", name: "Ruitjes", emoji: "🏁", cost: { wood: 80, stone: 40 }, minEra: 4 },
  { id: "neon", kind: "pattern", name: "Neon", emoji: "💡", cost: { stone: 100, food: 60 }, minEra: 7 },
  { id: "galaxy", kind: "pattern", name: "Sterrenstelsel", emoji: "🌌", cost: { stone: 150, wood: 100, food: 100 }, minEra: 10 },
];

export interface NpcLook {
  /** Index into SKIN_TONES. */
  skin: number;
  /** Index into CLOTHES_COLORS. */
  clothes: number;
  /** Outfit ids. */
  hat: string;
  pattern: string;
}

// ---------- balance ----------

/** Costs, production and storage all grow ×4 per level/era, so every era plays at the same pace. */
export const LEVEL_SCALE = 4;
/** Building something new costs this × its base cost, so the town grows at a steady pace. */
export const BUILD_COST_MULT = 1.5;
/** Each copy of a type costs this much more than the previous one. */
export const COST_GROWTH = 1.2;
/** Upgrading costs this share of building new at the target level (before BUILD_COST_MULT). */
export const UPGRADE_SHARE = 0.6;
/** Tearing down a building or a path gives back this share of what it costs at its level. */
export const REFUND_SHARE = 0.25;
/** Per work building at full staff, per second, at level 0. */
export const BASE_RATE: Readonly<Record<ResourceId, number>> = { food: 1, wood: 1, stone: 0.8 };
export const SPECIAL_BASE_RATE = 0.5;
/** Storage: the base everyone has (×4^era), per storage building and the center (×4^level). */
export const BASE_CAP = 200;
export const STORAGE_CAP = 400;
export const CENTER_CAP = 200;
/** One "click's worth" of a resource is this ×4^era (gatherers and the lab's robots count in clicks). */
export const CLICK_BASE = 1;

/** Each level of a perk costs this much more than the one before. */
export const PERK_GROWTH = 1.6;
/** Boosts reach at most this far ahead, however often they're bought. */
export const MAX_ITEM_BOOST_MS = 30 * MIN;
/** Market: value per unit (specials are produced at half the base rate). */
export const WORTH: Readonly<Record<ResourceId, number>> = { food: 1, wood: 1, stone: 1.25 };
export const SPECIAL_WORTH = 2;
/** Share of the value you get back, before the market's level and the bank's deals. */
export const MARKET_FEE = 0.5;
/** Market pressure halves this often; a trade worth a full storage adds 0.5. */
export const MARKET_HALF_LIFE_MS = 2 * MIN;
/** Village: homes, storage, shops and decorations stand this close (in tiles) to another building. */
export const VILLAGE_RANGE = 10;
/** Work buildings with a source (forest, rocks, a vein) stand this close to it. */
export const SOURCE_RANGE = 2;
/** A new town starts with streets on every 4th row and column within this many tiles of a building. */
export const STREET_RANGE = 2;

// ---------- nature runs out ----------

/** Nature comes in patches of at most this many tiles (a forest, a group of rocks). */
export const PATCH_MAX_TILES = 12;
/**
 * How many clicks one tile holds, per resource: the more valuable, the longer
 * it lasts. A deposit (special ore) is one tile holding DEPOSIT_CLICKS.
 */
export const PATCH_CLICKS: Readonly<Record<ResourceId, number>> = { food: 15, wood: 25, stone: 40 };
export const DEPOSIT_CLICKS = 2000;
/** Time for a fully used patch to grow back completely. */
export const REGROW_MS: Readonly<Record<ResourceId, number>> = { food: 15 * 60_000, wood: 30 * 60_000, stone: 2 * 60 * 60_000 };
export const DEPOSIT_REGROW_MS = 4 * 60 * 60_000;
/** Work buildings take from patches within this many tiles… */
export const WORK_RANGE = 6;
/** …and count as this many clicks per click's worth they make (they work carefully). */
export const WORK_DRAIN = 0.25;
/** Villagers without a job gather from nature within this many tiles of the town center… */
export const GATHER_RANGE = 15;
/** …each this many clicks' worth per second (a job pays far better), using up a click per click. */
export const GATHER_RATE = 0.1;

export const housingOf = (level: number): number => 3 + level;
export const slotsOf = (level: number): number => 2 + Math.floor(level / 3);
export const scaleOf = (level: number): number => LEVEL_SCALE ** level;

// ---------- lookups ----------

const RESOURCE_BY_ID: Record<ResourceId, ResourceDef> = Object.fromEntries(RESOURCES.map((r) => [r.id, r]));
const TYPE_BY_ID: Record<string, BuildingType> = Object.fromEntries(BUILDING_TYPES.map((t) => [t.id, t]));

export const resourceDef = (id: ResourceId): ResourceDef | undefined => RESOURCE_BY_ID[id];
export const buildingType = (id: string): BuildingType | undefined => TYPE_BY_ID[id];
const ITEM_BY_ID: Record<string, ShopItem> = Object.fromEntries(SHOP_ITEMS.map((i) => [i.id, i]));
export const shopItem = (id: string): ShopItem | undefined => ITEM_BY_ID[id];
export const worthOf = (id: ResourceId): number => WORTH[id] ?? SPECIAL_WORTH;
const OUTFIT_BY_ID: Record<string, Outfit> = Object.fromEntries(OUTFITS.map((o) => [o.id, o]));
export const outfit = (id: string): Outfit | undefined => OUTFIT_BY_ID[id];

export function buildingName(type: string, level: number): string {
  const t = buildingType(type);
  return t?.names[Math.min(level, t.names.length - 1)] ?? type;
}
