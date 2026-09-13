# CLAUDE.md

## This service is not Mining Mike's crash collector

It is a crash collector. Mining Mike is the first game in it, and the second
game is meant to cost one entry in `src/games.js` and nothing else.

That sentence is the whole point of this file. The system was built once,
around one game, and the temptation every time is to reach for
`if (game === "mining-mike")`. Do not. The rule below is what keeps the next
game from being a rebuild.

## THE RULE

**Everything a particular game knows about itself lives in `src/games.js`.
Nothing anywhere else branches on a game id.**

If you find yourself about to write a game's name into `src/db.js`,
`src/server.js`, `src/admin.js` or a test, stop: the thing you are about to
hardcode is a registry field that has not been added yet.

### What is generic, and stays out of the registry

These are the same questions for every game, so they are asked the same way
for every game and the registry says nothing about them:

| | |
| --- | --- |
| A report | id, received_at, game, version, kind, message, stack, log |
| Its machine | platform, gpu, engine, and the `Machine` context block |
| Its owner | session, player (HMACed on arrival, never stored raw) |
| Its life | the `Session` context block: how long open, how long in a run |
| Grouping | the signature, and the issue rollup over it |
| Sessions | the five minute check-in, live vs ended, ended in a crash |
| Run outcomes | succeeded, failed, quit |

### What is game-specific, and therefore IS the registry

| Field | What it answers |
| --- | --- |
| `id` | the path segment, `/mining-mike/...` |
| `title` | what a human calls it in the picker |
| `place.sector` | the context key naming WHERE a run happened |
| `place.depth` | the context key indexing how deep into it |
| `place.wavesPerDepth` | how much of one counts as finishing it |
| `blocks` | which of the game's own context keys are worth a line |
| `upgrades.path` | the context path holding what a player built, name to level |
| `upgrades.meta` | what the game calls each of those, and what taking one does |
| `upgrades.icons` | where that game's art lives, one `<key>.png` per upgrade |

## Adding a game

1. **Add the entry** to `GAMES` in `src/games.js`. The id must be a path
   segment and must not collide with `RESERVED_IDS`; both are asserted at
   import, so a bad id fails at boot rather than at somebody's link.
2. **Point the game's reporter at `POST /v1/reports`** with `game: "<id>"`.
   Ingest already takes any game string, so reports can arrive before the
   entry exists. They are readable at `/reports?game=<id>` in the meantime and
   listed under `unregistered` by `GET /v1/games`, which is the list of games
   somebody should write an entry for.
3. **Match the heartbeat.** `HEARTBEAT_SECONDS` has to equal what the game
   sends. Mining Mike's `telemetry.gd` uses `heartbeat_minutes = 5.0`, so the
   default is 300. A game that pings on a different interval needs that config
   moved, and until it is, its sessions get called dead early or listed as
   live long after they are gone.
4. **That is all.** The routes, the paging, the issue rollup, the session
   model, the portal's tables and its charts already work: none of them were
   written against a game.

### The block grammar

A block is a heading, a test for drawing it at all, and rows. Rows read the
context by dotted path:

```js
["label", "path"]                 a value
["label", "path", "mmss"]         the same, as minutes and seconds
["label", "path", "yes/solo"]     truthy as the left word, falsy as the right
{spread: "path"}                  every key of an object, one row each
{spread: "path", omitZero: true}  ...skipping the ones sitting at zero
{spread: "path", each: "tier"}    ...with a word in front of each value
```

It is a grammar and not a callback because the registry crosses into the
browser as JSON. The page is one file with no build step, so a registry that
could hold functions could not be handed to the thing that draws it.

If a game needs a row shape this grammar cannot express, **add the shape to
the grammar** in `rowPairs()`. Do not add a branch for the game.

### The effect grammar

`upgrades.meta` is the same idea for a different question: not where a number
is, but what a number MEANS. An effect is a sentence kept apart from its
numbers, so the page can write it out at whatever level it is asked about:

```js
effect: ["+25 Max HP (+{0} total)", [25, 0]]
```

`{0}` is the first pair, `[per level, flat]`, so level 3 reads `+75 total`.
Kept apart and not baked in at one level because the useful question is what
the thing does AT THE LEVEL PEOPLE ACTUALLY REACH, and the page only learns
that from the tally.

A sentence and its numbers can disagree, and they disagree silently: a `{1}`
with nothing to fill it prints as `{1}`. So `checkUpgrades()` refuses both
halves of that at import, and is exported so the check itself can be run
against an entry that is wrong.

`icon: false` is art the game does not have. The page draws a lettered tile,
which is what the game draws too - a hole somebody can see beats a broken
image, and beats pretending the upgrade is not there.

## Charts

Two decisions the portal's charts already made, both worth keeping:

- **Succeeded green and failed red are only dE 7.2 apart under deuteranopia.**
  That is inside the band a validator passes ONLY with a second encoding, so
  every outcome bar prints its counts beside it, separates its segments with
  2px of surface, and carries a legend. Never ship an outcome split that leans
  on hue alone. The check is runnable, so run it rather than reasoning about
  it.
- **A share needs a denominator worth dividing by.** One run that cleared is
  not a 100% clear rate. The upgrade tally prints a percentage only at three
  runs or more; below that the raw count speaks for itself.

And the step everybody skips: **render it and look at it**. The first draft of
the upgrade tally clipped its right-hand column at 1200px wide, which no test
would have caught and one screenshot did.

## Addresses are the product

Every view has an address and a game is a path segment, because the thing
somebody does with this service is paste a link at somebody else:

```
/mining-mike/issues            /mining-mike/issues/<signature>
/mining-mike/reports           /mining-mike/reports/<id>
/mining-mike/sessions          /mining-mike/sessions/<session>/<mode>
/mining-mike/upgrades          ?sector=<name> narrows it
/issues                        the same pages across every game
```

An unregistered game is a **404**, not an empty page. A link to a game nobody
wrote an entry for looks exactly like a game with no crashes, and those are
opposite things to learn.

Two rules fall out of this and are worth keeping:

- **Paging never touches the address.** What is shareable is the view, not how
  far somebody scrolled it.
- **A drill-down keeps the game.** Dropping it on the way into an issue is how
  somebody ends up reading another game's reports without noticing.

## Two flags, and both ship unset

`INGEST_KEY` closes posting; `ADMIN_KEY` closes reading and deleting. They are
independent, both default to open, and turning either on is one
`fly secrets set` rather than a code change. See `src/config.js`, which carries
the reasoning next to the values. Do not add a third way to configure this.

## Testing

`npm test` drives the real server over real HTTP against a temporary database.
Nothing is stubbed, so a pass means a deploy is deploying something that works.

Three habits this suite learned the hard way:

- **Never assert on a clock you did not set.** The rate limit test drained a
  token bucket and then asserted over a real HTTP round trip, and CI went red
  the first time a runner took longer than one refill interval. Pass the
  instant in: `store.sessions({ now, staleAfter })` exists for exactly this.
- **Build the case, do not sample for it.** A test that posted sixty reports
  and asserted some of them shared a millisecond passed on a fast machine and
  failed on a slow one. The tie the cursor has to survive is now five rows
  inserted by hand with the timestamps written down.
- **A test that only fails sometimes is not a test.** Both of the above shipped,
  went red in CI, and had to be rewritten. Check a new test by breaking the
  code it covers and watching it fail.

The portal's browser script is compiled and run by the suite
(`router()` in `test/open.test.mjs`), so routing is tested rather than read. It
is handed the registry the same way the page is.
