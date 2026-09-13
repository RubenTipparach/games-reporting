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
export function registryForPage() {
  return GAMES.map((g) => ({ id: g.id, title: g.title, place: g.place, blocks: g.blocks }));
}
