// THE GAME REGISTRY.
//
// This service is not Mining Mike's crash collector. It is a crash collector,
// and Mining Mike is the first game in it. The difference is this file: adding
// a second game is an entry here, and nothing else.
//
// That is a rule and not an aspiration. Everything that knows what a "sector"
// is, how long a depth runs, or that a mech has weapons, is DATA below rather
// than a branch somewhere. The routes, the queries, the portal's tables and
// its charts are all written against the shape of a report, never against a
// particular game - so a second game gets the whole system on the day it posts
// its first report, and nobody rebuilds any of it.
//
// What is generic and therefore NOT in here: the id, version, kind, message,
// stack, log, platform, gpu, engine, session and player of a report; the
// session heartbeat; the run outcomes succeeded/failed/quit; and the Session
// and Machine context blocks, which are the same questions for every game
// (how long was it open, what was it running on).
//
// What IS in here: whatever the game calls the places you can be, how much of
// one counts as finishing it, and which of its own context keys are worth
// putting on screen.

// ---------------------------------------------------------------------------
// Paths the portal uses for itself, which therefore cannot be a game id. A
// game called "reports" would make /reports ambiguous, and the ambiguity would
// be discovered by somebody's link breaking rather than by anybody choosing
// it, so the collision is refused up front instead.
export const RESERVED_IDS = new Set([
  "admin", "healthz", "issues", "reports", "sessions", "runs", "v1", "g",
]);

// ---------------------------------------------------------------------------
// The rows a context block can hold.
//
//   ["label", "path"]              a value, read by dotted path
//   ["label", "path", "mmss"]      the same, as minutes and seconds
//   ["label", "path", "yes/no"]    truthy as the left word, falsy as the right
//   {spread: "path"}               every key of an object, as its own row
//   {spread: "path", omitZero}     ...skipping the ones sitting at zero
//   {spread: "path", each: "tier"} ...with a word in front of each value
//
// A grammar rather than a callback because this crosses into the browser as
// JSON: the page is one file with no build step, and a registry that could
// hold functions could not be handed over the wire to the thing that draws it.
export const GAMES = [
  {
    id: "mining-mike",
    title: "Mining Mike",

    // WHERE A RUN HAPPENS, in this game's own words. The portal groups runs by
    // this pair and labels them with it: `sector` is the name a player would
    // say out loud and `depth` is the index inside it. A game with only one
    // axis leaves `sector` null and gets rows reading "Depth 3"; a game with
    // neither gets one row per mode.
    place: {
      sector: "sector_title",
      depth: "depth",
      // How much of a depth counts as finishing it. This is what lets the bars
      // be drawn against an ABSOLUTE scale: wave 5 of 10 is half a depth,
      // whoever else played. A mode with no end (survival here) has no such
      // number and is scaled against the furthest anybody reached instead.
      wavesPerDepth: 10,
    },

    // WHAT A PLAYER BUILT, as a map of name to level somewhere in the context.
    // The upgrade view reads this path and nothing else: a game whose entry
    // leaves it out has no upgrade view, and a game that calls them perks
    // points at "perks" and gets the same page.
    //
    // Snapshot rather than a timeline, because that is what arrives: the run
    // summary carries the levels a player ENDED on. Which upgrade was taken at
    // which wave is a different report and is not being sent yet.
    //
    // `meta` is what this game calls each of those keys, and what taking one
    // actually does. A game that leaves it out gets the raw key and the level,
    // which is what the page can work out on its own; a game that fills it in
    // gets the name a player would recognise, the art, and the effect written
    // out at the level actually reached.
    //
    // An effect is a sentence kept apart from its numbers, so the page can put
    // the numbers for A PARTICULAR level into it:
    //
    //   effect: ["+25 Max HP (+{0} total)", [25, 0]]
    //
    // {0} is the first pair, read as level * 25 + 0, so at level 3 that line
    // reads "+25 Max HP (+75 total)". A pair and not a formula for the same
    // reason the block grammar is a grammar rather than a callback: this
    // crosses into the browser as JSON, and a function would not survive it.
    //
    // `icons` is a directory holding <key>.png. `icon: false` is an upgrade the
    // game has no art for yet, and draws as a lettered tile rather than as a
    // broken image - the same thing the game itself does with it.
    upgrades: {
      path: "mech.upgrades",
      title: "Upgrades",
      unit: "lvl",
      icons: "/assets/icons/mining-mike",
      meta: {
        chain_lightning: { name: "Chain Lightning", max: 5, icon: true,
          effect: ["Shots chain to {0} nearby enemies", [1, 0]] },
        shotgun: { name: "Shotgun Blast", max: 5, icon: true,
          effect: ["Fire {0} projectiles in a spread", [1, 2]] },
        burning: { name: "Inferno", max: 5, icon: true,
          effect: ["Ignite enemies for {0} DPS", [4, 0]] },
        acid_lobber: { name: "Corroder", max: 5, icon: true,
          effect: ["Shots leave an acid pool for {0}s", [1, 0]] },
        ice: { name: "Frostbite", max: 5, icon: true,
          effect: ["Slow enemies by {0}%", [15, 0]] },
        damage_aura: { name: "Death Aura", max: 5, icon: true,
          effect: ["Deal {0} DPS in {1}px radius", [8, 0], [30, 60]] },
        orbital_lasers: { name: "Orbital Lasers", max: 5, icon: true,
          effect: ["{0} laser orbs orbit you", [1, 0]] },
        missiles: { name: "Missile Rack", max: 5, icon: false,
          effect: ["Fire {0} missiles at flyers", [1, 1]] },
        max_health: { name: "Vitality", max: 5, icon: true,
          effect: ["+25 Max HP (+{0} total)", [25, 0]] },
        move_speed: { name: "Swift Boots", max: 5, icon: true,
          effect: ["+15% speed (+{0}% total)", [15, 0]] },
        attack_speed: { name: "Rapid Fire", max: 5, icon: true,
          effect: ["+20% fire rate (+{0}% total)", [20, 0]] },
        mining_speed: { name: "Laser Drill", max: 5, icon: true,
          effect: ["+30% mining speed, +{0} yield", [1, 0]] },
        mining_heads: { name: "Multi-Beam", max: 4, icon: true,
          effect: ["Mine {0} rocks simultaneously", [1, 1]] },
        turret_damage: { name: "Turret Upgrade", max: 5, icon: true,
          effect: ["Bullet Turrets deal +{0} damage", [3, 0]] },
        turret_fire_rate: { name: "Turret Overdrive", max: 5, icon: true,
          effect: ["Bullet Turrets fire {0}% faster", [20, 0]] },
        refinery_speed: { name: "Refinery Efficiency", max: 5, icon: true,
          effect: ["Refineries produce {0}% faster", [25, 0]] },
        mining_range: { name: "Extended Reach", max: 5, icon: true,
          effect: ["+25px mining range (+{0}px total)", [25, 0]] },
        rock_regen: { name: "Mineral Attractor", max: 5, icon: true,
          effect: ["Resources regen +{0}/tick, {1}% faster", [2, 0], [40, 0]] },
        power_output: { name: "Overdrive Coils", max: 3, icon: true,
          effect: ["Power plants and the HQ make {0}% more", [15, 0]] },
        health_regen: { name: "Regeneration", max: 5, icon: true,
          effect: ["Heal {0} HP per second", [2, 0]] },
        dodge: { name: "Evasion", max: 5, icon: true,
          effect: ["{0}% chance to dodge attacks", [8, 0]] },
        armor: { name: "Plating", max: 5, icon: true,
          effect: ["Reduce damage by {0}", [2, 0]] },
        crit_chance: { name: "Critical Hit", max: 5, icon: true,
          effect: ["{0}% chance for 2x damage", [10, 0]] },
        pickup_range: { name: "Magnetic Field", max: 5, icon: true,
          effect: ["+15 pickup range (+{0}px total)", [15, 0]] },
        shoot_range: { name: "Eagle Eye", max: 5, icon: true,
          effect: ["+40 shoot range, +8 light range (+{0} / +{1} total)", [40, 0], [8, 0]] },
        crusader_balls: { name: "Extra Morning Star", max: 12, icon: false,
          effect: ["+1 orbiting morning star ({0} total, max 13)", [1, 1]] },
        crusader_ball_damage: { name: "Heavier Stars", max: 5, icon: false,
          effect: ["Morning stars hit for +{0} damage", [6, 0]] },
        crusader_spin: { name: "Whirlwind", max: 5, icon: false,
          effect: ["Morning stars orbit {0}% faster", [30, 0]] },
      },
    },

    // Context blocks, drawn after the generic Session one and before the
    // generic Machine one. `when` is the test for drawing the block at all:
    // any one of these keys present is enough.
    blocks: [
      {
        title: "Where",
        when: ["screen", "depth", "wave_number"],
        rows: [
          ["screen", "screen"],
          ["sector", "sector_title"],
          ["depth", "depth"],
          // Both numbers, always, and labelled so nobody has to remember which
          // is which. They are deliberately different and conflating them is
          // the most repeated bug in this game.
          ["wave shown", "wave_number"],
          ["difficulty wave", "difficulty_wave"],
          ["co-op", "coop", "yes/solo"],
        ],
      },
      {
        title: "Mech",
        when: ["mech"],
        rows: [
          ["role", "mech.role"],
          ["level", "mech.level"],
          ["hp", "mech.hp"],
          { spread: "mech.upgrades", omitZero: true },
          { spread: "mech.weapons", each: "tier" },
        ],
      },
      {
        title: "Run",
        when: ["kills", "credits", "prestige"],
        rows: [
          ["kills", "kills"],
          ["credits", "credits"],
          ["prestige", "prestige"],
          ["aliens alive", "aliens_alive"],
          ["outcome", "outcome"],
        ],
      },
    ],
  },
];

// A game id is legal if it is a path segment and is not one of ours.
const ID_SHAPE = /^[a-z0-9][a-z0-9-]{0,63}$/;

for (const g of GAMES) {
  if (!ID_SHAPE.test(g.id)) throw new Error(`game id ${g.id} is not a path segment`);
  if (RESERVED_IDS.has(g.id)) throw new Error(`game id ${g.id} collides with a portal route`);
}
if (new Set(GAMES.map((g) => g.id)).size !== GAMES.length) {
  throw new Error("two games share an id");
}

export function gameById(id) {
  return GAMES.find((g) => g.id === id);
}

// Whether a path segment names a game. Used by the router to tell
// /mining-mike/issues from /issues, which is the whole of the difference
// between one game's portal and all of them at once.
export function isGameId(segment) {
  return GAMES.some((g) => g.id === segment);
}

// What the page is handed. The registry is the source for both halves - the
// routes here and the drawing there - because two copies of "what does this
// game call a depth" is how they end up disagreeing.
//
// Minus `meta`, which is the one part of an entry that is big: a line of
// vocabulary per upgrade, on every page load, to be read by the one view that
// asks for it anyway. /v1/upgrades hands over the whole `upgrades` field, so
// the upgrade page gets it there and nothing else carries it.
export function registryForPage() {
  return GAMES.map((g) => ({
    id: g.id,
    title: g.title,
    place: g.place,
    blocks: g.blocks,
    upgrades: g.upgrades && { ...g.upgrades, meta: undefined },
  }));
}

// A context path is spliced into SQL as a JSON path, so it has to be a path and
// not an expression. These come from the file above rather than from a request,
// but "it is our own data" is how the first injection in every codebase gets
// written, and the check costs one line.
const PATH_SHAPE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export function upgradePathFor(id) {
  const g = gameById(id);
  const path = g && g.upgrades && g.upgrades.path;
  if (!path) return null;
  if (!PATH_SHAPE.test(path)) throw new Error(`upgrades.path ${path} is not a context path`);
  return path;
}

for (const g of GAMES) {
  if (g.upgrades) upgradePathFor(g.id);
}

// ---------------------------------------------------------------------------
// The upgrade vocabulary, checked at import for the same reason a bad game id
// is: every one of these mistakes shows up as a page that looks fine and says
// something wrong, which is the kind of bug nobody reports.

// An upgrade key is a file name under `icons` and a segment of a URL, so it is
// held to the same standard as a game id rather than trusted to be tidy.
const KEY_SHAPE = /^[a-z0-9][a-z0-9_]{0,63}$/;
// `icons` is pasted into an <img src> by the page AND joined to a file path by
// the server, so it is pinned to one directory under assets/. Not only to keep
// it on this service: a game whose entry said "/v1" would have its art answered
// at an address the API already owns, and the shadowing would be discovered by
// a route quietly not working.
const ICONS_SHAPE = /^\/assets\/icons\/[a-z0-9][a-z0-9-]{0,63}$/;

// Exported so it can be run against an entry that is WRONG. The loop below
// only ever sees entries that are right, which proves nothing about a check.
export function checkUpgrades(g) {
  const up = g.upgrades;
  if (!up || !up.meta) return;
  if (up.icons !== undefined && !ICONS_SHAPE.test(up.icons)) {
    throw new Error(`${g.id}: upgrades.icons ${up.icons} is not a path on this service`);
  }
  for (const [key, m] of Object.entries(up.meta)) {
    if (!KEY_SHAPE.test(key)) throw new Error(`${g.id}: upgrade key ${key} is not a file name`);
    if (m.icon && !up.icons) throw new Error(`${g.id}: ${key} has art but the entry has no icons path`);
    if (!m.effect) continue;
    const [text, ...args] = m.effect;
    // A sentence and its numbers arrive separately, so the two can disagree.
    // They disagree silently: a {1} with nothing to put in it prints as {1},
    // and an unused pair is a number somebody meant to show and did not.
    const slots = new Set((String(text).match(/\{(\d+)\}/g) || []).map((t) => Number(t.slice(1, -1))));
    for (const i of slots) {
      if (i >= args.length) throw new Error(`${g.id}: ${key} says {${i}} with only ${args.length} numbers`);
    }
    for (let i = 0; i < args.length; i++) {
      if (!slots.has(i)) throw new Error(`${g.id}: ${key} carries a number nothing says {${i}} for`);
      const pair = args[i];
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite)) {
        throw new Error(`${g.id}: ${key} slot {${i}} is not a [per level, flat] pair`);
      }
    }
  }
}

for (const g of GAMES) checkUpgrades(g);
