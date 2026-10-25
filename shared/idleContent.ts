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

/**
 * The three base resources exist from the start; every later era adds one
 * special. The Iron Age also brings coal (the Industrial Revolution's special,
 * mined long before) and what the smiths make of iron and coal.
 */
export const RESOURCES: readonly ResourceDef[] = [
  { id: "food", name: "voedsel", emoji: "🍖", era: 0 },
  { id: "wood", name: "hout", emoji: "🪵", era: 0 },
  { id: "stone", name: "steen", emoji: "🪨", era: 0 },
  { id: "bronze", name: "brons", emoji: "🥉", era: 1 },
  { id: "iron", name: "ijzer", emoji: "⛓️", era: 2 },
  { id: "coal", name: "kolen", emoji: "⚫", era: 2 },
  { id: "weapons", name: "wapens", emoji: "🗡️", era: 2 },
  { id: "armor", name: "harnassen", emoji: "🛡️", era: 2 },
  { id: "gold", name: "goud", emoji: "🪙", era: 3 },
  { id: "wool", name: "wol", emoji: "🧶", era: 4 },
  { id: "knowledge", name: "kennis", emoji: "📜", era: 5 },
  { id: "oil", name: "olie", emoji: "🛢️", era: 7 },
  { id: "data", name: "data", emoji: "💾", era: 8 },
  { id: "titanium", name: "titanium", emoji: "🔷", era: 9 },
  { id: "antimatter", name: "antimaterie", emoji: "⚛️", era: 10 },
];

/** Food comes in kinds, by where it comes from; in storage it's all the same 🍖. */
export type FoodKind = "grain" | "meat" | "fish" | "berries";

export const FOOD_KINDS: readonly { id: FoodKind; name: string; emoji: string }[] = [
  { id: "grain", name: "graan", emoji: "🌾" },
  { id: "meat", name: "vlees", emoji: "🥩" },
  { id: "fish", name: "vis", emoji: "🐟" },
  { id: "berries", name: "bessen", emoji: "🫐" },
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

export type Category = "center" | "house" | "work" | "storage" | "shop" | "decor" | "wonder" | "defense";

/** How idle villagers react to a decoration. */
export type DecorBehavior = "dance" | "photo" | "pose" | "sit";

export type DecorShape =
  | "statue67" | "flowers" | "totem" | "menhir" | "statue" | "fountain"
  | "tower" | "neon" | "hologram" | "monument67";

export type WonderShape =
  | "stonehenge" | "pyramid" | "colossus" | "colosseum" | "cathedral"
  | "dome" | "eiffel" | "skyscraper" | "computer" | "rocket";

export interface BuildingType {
  id: string;
  category: Category;
  /** Name per level (= era); a type without an entry for a level can't be at that level. */
  names: readonly string[];
  emoji: string;
  /** First era it can be built in. */
  minEra: number;
  /** Work buildings: what they make (a mine: what it makes until the players pick another ore). */
  produces?: ResourceId;
  /** A mine: the ores it can dig, as far as they're unlocked (the players vote which). */
  ores?: readonly ResourceId[];
  /** …and the share it digs of what a quarry or a mine at the vein would make. */
  oreShare?: number;
  /** Uses this much of each per unit it makes, and makes nothing without it (the smiths). */
  consumes?: Amounts;
  /** Food buildings: which kind of food. */
  foodKind?: FoodKind;
  /** The nature it works from, if not what it makes (null: none, it grows its own). */
  source?: ResourceId | null;
  /** Doesn't use its source up, but makes less as there's less of it (game lives in the forest). */
  sparesSource?: boolean;
  /** Types in the same group share the price growth per copy (all food buildings). */
  costGroup?: string;
  /** Level-0 cost, multiplied by the balance table for higher levels. */
  baseCost: Amounts;
  /** Plus this much of the building's level's special resource (from era 1). */
  specialCost?: number;
  /** Only one can exist (the center, every shop). */
  unique?: boolean;
  /** Decorations don't level up. */
  noUpgrade?: boolean;
  decor?: { shape: DecorShape; behavior: DecorBehavior; color: string };
  wonder?: { shape: WonderShape; color: string };
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
    id: "hunter", category: "work", emoji: "🏹", minEra: 0, produces: "food", foodKind: "meat", source: "wood", sparesSource: true,
    costGroup: "food", specialCost: 10, baseCost: { wood: 25 },
    names: ["Jagerskamp", "Jagershut", "Jachthut", "Jachtterrein", "Jachtslot", "Jachtgilde", "Jachtvereniging", "Wildbeheer", "Dronejacht", "Holojacht", "Ruimtejacht"],
  },
  {
    id: "farm", category: "work", emoji: "🌾", minEra: 0, produces: "food", foodKind: "grain", source: null,
    costGroup: "food", specialCost: 10, baseCost: { wood: 25 },
    names: ["Akker", "Graanveld", "Boerderij", "Wijngaard", "Hoeve", "Landgoed", "Graanmolen", "Agrobedrijf", "Verticale farm", "Hydrocultuur", "Voedselsynthesizer"],
  },
  {
    id: "fishery", category: "work", emoji: "🎣", minEra: 0, produces: "food", foodKind: "fish", source: null,
    costGroup: "food", specialCost: 10, baseCost: { wood: 30 },
    names: ["Visstek", "Vissershut", "Visserij", "Vissershaven", "Visafslag", "Vishandel", "Stoomvisserij", "Viskwekerij", "Aquafarm", "Ruimteaquarium", "Oceaansynthesizer"],
  },
  {
    id: "ranch", category: "work", emoji: "🐄", minEra: 1, produces: "food", foodKind: "meat", source: null,
    costGroup: "food", specialCost: 10, baseCost: { wood: 35, stone: 10 },
    names: fromEra(1, ["Veekraal", "Veehouderij", "Boerenerf", "Herenboerderij", "Melkveebedrijf", "Stoomzuivel", "Veebedrijf", "Robotstal", "Ruimtestal", "Kweekvleeslab"]),
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
  {
    // Dug into the mountain: never runs out, but a vein gives more ore.
    id: "mine", category: "work", emoji: "🏔️", minEra: 0, produces: "stone", source: null, specialCost: 10,
    ores: ["stone", "bronze", "iron", "coal", "gold", "titanium"], oreShare: 0.5,
    baseCost: { wood: 50, food: 20 },
    names: ["Vuursteenmijn", "Mijnschacht", "Mijngang", "Romeinse mijn", "Mijnwerkersgilde", "Mijnbouwbedrijf", "Stoommijn", "Dagbouwmijn", "Robotmijn", "Bergboor", "Kernboor"],
  },
  {
    id: "weaponsmith", category: "work", emoji: "⚔️", minEra: 2, produces: "weapons", source: null, specialCost: 10,
    consumes: { iron: 1, coal: 1 }, baseCost: { wood: 40, stone: 60 },
    names: fromEra(2, ["Wapensmid", "Zwaardsmederij", "Wapensmederij", "Wapenkamer", "Geweermakerij", "Wapenfabriek", "Defensiebedrijf", "Dronefabriek", "Lasersmid"]),
  },
  {
    id: "armorsmith", category: "work", emoji: "🔨", minEra: 2, produces: "armor", source: null, specialCost: 10,
    consumes: { iron: 1, coal: 1 }, baseCost: { wood: 40, stone: 60 },
    names: fromEra(2, ["Harnassmid", "Pantsersmederij", "Harnasmakerij", "Harnaswerkplaats", "Uniformfabriek", "Vestenfabriek", "Exopakfabriek", "Pantserwerf", "Krachtveldsmid"]),
  },
  ...(
    [
      ["bronze", "Kopermijn", "🥉", 1],
      ["iron", "IJzermijn", "⛓️", 2],
      ["gold", "Goudmijn", "🪙", 3],
      ["wool", "Schapenwei", "🐑", 4],
      ["knowledge", "Bibliotheek", "📚", 5],
      ["coal", "Kolenmijn", "⚫", 2],
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
    id: "tower", category: "defense", emoji: "🗼", minEra: 0, specialCost: 10,
    baseCost: { wood: 60, stone: 80 },
    names: ["Uitkijkpost", "Houten toren", "Wachttoren", "Romeinse toren", "Kasteeltoren", "Vestingtoren", "Kanonstoren", "Bunker", "Radarpost", "Lasertoren", "Schildtoren"],
  },
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
      ["smith", "⚒️", 1, { wood: 80, stone: 80 }, ["Bronsgieter", "Smederij", "Smidse", "Gildesmid", "Meestersmid", "IJzergieterij", "Werkplaats", "Robotfabriek", "Exo-smederij", "Nanosmid"]],
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
  // One world wonder per era (but the last): building it takes the town to the next era.
  ...(
    [
      ["Stonehenge", "🗿", "stonehenge", "#9ca3af"],
      ["Piramide", "🔺", "pyramid", "#e0c08a"],
      ["Kolossus", "🗽", "colossus", "#b87333"],
      ["Colosseum", "🏟️", "colosseum", "#efe6d4"],
      ["Kathedraal", "⛪", "cathedral", "#d6cfc0"],
      ["Sint-Pietersbasiliek", "🏛️", "dome", "#f0e6d0"],
      ["Eiffeltoren", "🗼", "eiffel", "#7c4a2d"],
      ["Wolkenkrabber", "🏙️", "skyscraper", "#9fb3c8"],
      ["Supercomputer", "🖥️", "computer", "#22f0ff"],
      ["Ruimteraket", "🚀", "rocket", "#e2e8f0"],
    ] as const
  ).map(([name, emoji, shape, color], era): BuildingType => ({
    id: `wonder_${era}`, category: "wonder", emoji, minEra: era, unique: true, noUpgrade: true,
    baseCost: {}, names: sameName(name), wonder: { shape, color },
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

// ---------- walls ----------

/** The whole wall has one level, like the streets, upgraded by vote to the current era. */
export const WALL_NAMES: readonly string[] = [
  "Palissade", "Aarden wal", "Stenen muur", "Romeinse muur", "Kasteelmuur", "Bastion",
  "Vestingwerk", "Betonmuur", "Laserhek", "Krachtveld", "Schildgenerator",
];
/** One tile of wall, at the wall's level (×4 per level). */
export const WALL_TILE_COST: Amounts = { wood: 6, stone: 4 };
/** Level-0 cost of upgrading the whole wall (×4 per era, plus that era's special). */
export const WALL_UPGRADE_COST: Amounts = { stone: 100, wood: 50 };
export const WALL_SPECIAL_COST = 20;

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

// ---------- eras: goals and world wonders ----------

/** Something the town must have before it can start its era's world wonder. */
export type EraGoal =
  | { kind: "population"; n: number }
  | { kind: "happiness"; n: number }
  | { kind: "foodKinds"; n: number }
  /** At least one of this building type. */
  | { kind: "building"; type: string }
  /** This many buildings (not decorations or wonders) at the current era's level: built or upgraded. */
  | { kind: "current"; n: number };

/** Per era (index), the goals for leaving it; the last era has none. */
export const ERA_GOALS: readonly (readonly EraGoal[])[] = [
  [{ kind: "population", n: 15 }, { kind: "happiness", n: 50 }, { kind: "foodKinds", n: 3 }, { kind: "building", type: "storage" }],
  [{ kind: "population", n: 30 }, { kind: "happiness", n: 55 }, { kind: "foodKinds", n: 3 }, { kind: "building", type: "mine_bronze" }, { kind: "building", type: "shop_smith" }, { kind: "current", n: 5 }],
  [{ kind: "population", n: 50 }, { kind: "happiness", n: 55 }, { kind: "building", type: "mine_iron" }, { kind: "building", type: "shop_market" }, { kind: "current", n: 8 }],
  [{ kind: "population", n: 75 }, { kind: "happiness", n: 60 }, { kind: "building", type: "mine_gold" }, { kind: "building", type: "shop_bank" }, { kind: "current", n: 10 }],
  [{ kind: "population", n: 100 }, { kind: "happiness", n: 60 }, { kind: "foodKinds", n: 4 }, { kind: "building", type: "mine_wool" }, { kind: "current", n: 12 }],
  [{ kind: "population", n: 140 }, { kind: "happiness", n: 60 }, { kind: "building", type: "mine_knowledge" }, { kind: "building", type: "shop_university" }, { kind: "current", n: 15 }],
  [{ kind: "population", n: 180 }, { kind: "happiness", n: 65 }, { kind: "building", type: "mine_coal" }, { kind: "current", n: 18 }],
  [{ kind: "population", n: 230 }, { kind: "happiness", n: 65 }, { kind: "building", type: "mine_oil" }, { kind: "building", type: "shop_lab" }, { kind: "current", n: 20 }],
  [{ kind: "population", n: 290 }, { kind: "happiness", n: 70 }, { kind: "building", type: "mine_data" }, { kind: "current", n: 22 }],
  [{ kind: "population", n: 360 }, { kind: "happiness", n: 70 }, { kind: "building", type: "mine_titanium" }, { kind: "building", type: "shop_spaceport" }, { kind: "current", n: 25 }],
  [],
];

/** A wonder goes up in this many phases, each its own vote. */
export const WONDER_PHASES = 3;
/** Level-0 cost of the first phase (×4 per era); every next phase costs half of it more. */
export const WONDER_COST: Amounts = { wood: 400, stone: 400, food: 300 };
/** Plus this much of the era's special resource (from the Bronze Age on). */
export const WONDER_SPECIAL_COST = 120;
/** After a phase the builders need this long before the next one can start. */
export const WONDER_BUILD_MS = 6 * 60 * 60_000;

// ---------- enemies ----------

/** Raids start in this era. */
export const RAID_FROM_ERA = 1;
/** The next raid comes this long after the last one, plus up to the spread… */
export const RAID_GAP_MS = 20 * 60 * 60_000;
export const RAID_GAP_SPREAD_MS = 16 * 60 * 60_000;
/** …in the daytime (Dutch time, from–to hour), and is seen coming this long before. */
export const RAID_HOURS: readonly [number, number] = [10, 22];
export const RAID_WARNING_MS = 60 * 60_000;
/** Attack: a base, more per era and per villager (they come for what's there), ± the spread. */
export const RAID_BASE = 15;
export const RAID_PER_ERA = 15;
export const RAID_PER_PERSON = 0.4;
export const RAID_SPREAD = 0.2;
/** Defense: every villager a little; a guard per this many weapons (×4 per era) a lot more, armor on top. */
export const PERSON_DEFENSE = 0.2;
export const ARMS_PER_GUARD = 20;
export const GUARD_POINTS = 1;
export const ARMOR_POINTS = 0.5;
/** Per wall tile and per tower, ×(1 + level). */
export const WALL_POINTS = 0.5;
export const TOWER_POINTS = 10;
/** A lost fight, at its worst (defense 0): this share of every resource stolen, of the villagers killed. */
export const RAID_STEAL = 0.4;
export const RAID_KILL = 0.1;
/** Weapons and armor lost in every fight. */
export const RAID_WEAR = 0.1;
/** Fixing a damaged building costs this share of building it new at its level. */
export const REPAIR_SHARE = 0.3;

export type RaidMoodId = "raid_won" | "raid_lost";

/** How a fight leaves the town feeling, for a while. */
export const RAID_MOODS: readonly { id: RaidMoodId; emoji: string; name: string; points: number; ms: number }[] = [
  { id: "raid_won", emoji: "🛡️", name: "aanval afgeslagen", points: 10, ms: 3 * 60 * MIN },
  { id: "raid_lost", emoji: "😢", name: "geplunderd", points: -15, ms: 6 * 60 * MIN },
];

// ---------- the 67 counter's extras ----------

/** Every new 67 on the counter (by its highest value) drops a crate in town, holding this many seconds of production… */
export const DROP_SECONDS = 300;
/** …and at least this much of each base resource (×4 per era). */
export const DROP_MIN = 30;
/** Crates waiting to be opened, at most. */
export const MAX_DROPS = 3;
/** Chance per +1 of a lucky event, at most one per cooldown. */
export const LUCKY_CHANCE = 1 / 67;
export const LUCKY_COOLDOWN_MS = 30 * MIN;
/** How long a lucky event lasts. */
export const LUCKY_MS = 10 * MIN;

export type LuckyId = "lucky_gold" | "lucky_newcomers" | "lucky_party" | "lucky_merchant";

export const LUCKY_EVENTS: readonly { id: LuckyId; emoji: string; name: string }[] = [
  { id: "lucky_gold", emoji: "🌟", name: "Gouden uur" },
  { id: "lucky_newcomers", emoji: "🧳", name: "Nieuwkomers" },
  { id: "lucky_party", emoji: "🥳", name: "Spontaan feest" },
  { id: "lucky_merchant", emoji: "🐪", name: "Rondtrekkende koopman" },
];
/** Golden hour: one resource ×this. */
export const LUCKY_GOLD_MULT = 3;
/** Newcomers: this share of the beds (at least 3). */
export const LUCKY_NEWCOMERS_SHARE = 0.1;
/** A spontaneous party: this much happiness. */
export const LUCKY_PARTY_POINTS = 20;
/** The merchant: market rates ×this. */
export const LUCKY_MERCHANT_MULT = 1.5;

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
/** A mine digs the land's ores (and stone) this close to the mountain. */
export const MINE_RANGE = 5;
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

// ---------- happiness ----------

/** Happiness (0–100) starts here: a town with a bed for everyone and two kinds of food is content. */
export const HAPPY_BASE = 50;
/** Points by how many kinds of food the town makes (index: 0–4 kinds). */
export const VARIETY_POINTS: readonly number[] = [-20, -20, 0, 10, 20];
/** Points off when everyone sleeps outside (a share of it for a share of the town). */
export const HOMELESS_POINTS = 60;
/** Each decoration, up to MAX_DECOR_POINTS for all of them together. */
export const DECOR_POINTS = 4;
export const MAX_DECOR_POINTS = 20;
/** A tavern in town, and a big party from it while it lasts. */
export const TAVERN_POINTS = 10;
export const PARTY_POINTS = 15;
/** Villagers moving in or out, per minute, until the town has as many as it draws. */
export const MOVE_PER_MIN = 1;

/** Beds in a house. */
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
