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
| Getting in | whether a session ever ENTERED a game, which is not whether it finished a run |
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
| `upgrades.picks` | where a run keeps the ORDER they were taken in, and what its entries call their fields |
| `stats` | where a run keeps the mech at BOTH ends of it, and which of those figures share a unit |

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

### The build order

`upgrades.path` is a SNAPSHOT: the levels a run ended on. `upgrades.picks` is
the same run's list of decisions in order, and the portal draws it as a time
axis per run.

**The level on a mark is not in the data, and must not be put there.** It is
the count of that key so far: the third time `max_health` appears is Vitality
at three. True by construction, and it cannot drift from the levels the same
report carries. A game that adds a `level` field to its pick entries is adding
a second copy of a number it already sends.

A game that sends no such list has no timeline and still has the tally, which
is every game until its reporter learns to send one.

### Before and after

`stats` is the same readout twice, as the mech dropped in and as it finished.
The end ALONE is a number with nothing to divide by: 214 DPS is a run that
tripled its damage or a run that dropped in at 200 and wasted twenty minutes,
and only the pair can tell you which.

Two rules the card keeps:

- **A shared axis needs a shared unit.** `axis` is the figures that may be
  drawn on one scale and `rows` is everything else. Three quantities of
  different kinds on one axis is a chart that lies about all three, so the
  entry NAMES the unit rather than the check assuming one, and `checkStats()`
  refuses an axis without it.
- **Round once, then subtract.** The first draft rounded for display and
  subtracted the raw values, so a card read "53 to 310" beside "+256.6" and
  the subtraction did not come out for anybody who tried it. Every figure on
  that card goes through `statRound()`, the arithmetic included.

A run carrying only one end still draws, and says which end it is. A missing
start is never filled in from the end: that would read as a run that changed
nothing, which is a finding, and inventing one is worse than admitting the gap.

**Both shapes arrive, and both are real.** A reporter sending both ends nests
them under the two keys the entry names. A reporter sending ONE sends the
figures flat, because that is what the first version shipped and what every
run already collected carries. Flat IS the end, and reading it as nothing at
all is how this shipped broken once.

## Starting a game is not finishing one

**A run summary is sent when a run ENDS.** Somebody who opens the game, starts
a run and quits mid-way sends none, so every count built on run summaries reads
zero for them - and that is the most common shape in a playtest, and the one
with the crashes in it. On the live service it was 292 of 500 sessions, and 400
of the 445 that carried a fault.

So the session rollup carries `entered` alongside `runs`, from two generic
signals: time inside a run (`played_sec`), or the id of one that was begun
(`run`). Three states, not two:

| | |
| --- | --- |
| finished runs | the outcomes, as they always were |
| started, unfinished | got in and walked away mid-run |
| menus only | never got in at all, and the only thing held off the list |

The first version of this filter held back everything with no run summary, and
that is the mistake to not make again: **"no runs" and "never played" are
different facts**, and the gap between them is most of what a playtest is.

## Modes are tabs, and the tabs come from the data

Campaign and survival are Mining Mike's words, so **no list of them is written
into the portal**. `sessionTotals()` returns the modes its reports actually
carry, and the tab row is built from that: a game that calls them something
else gets its own tabs, and a game with one mode gets none, because a tab row
with one tab is a label.

Two things about that split are worth keeping:

- **The modes do not partition the SESSIONS.** A session can play both, and 29
  of the 500 on the live service do. Each belongs under both tabs, so the tabs
  add up to more than the total and must never be drawn as if they were a pie.
  The run counts inside a session ARE narrowed to the tab, because a survival
  tab showing a session's campaign runs means nothing.
- **A clock cannot be narrowed.** The game reports one `session_sec` and one
  `played_sec` for the whole session, not a pair per mode. Splitting a number
  that was never split is inventing it, so the Time block says "whole session"
  on a mode tab instead.

The upgrade tally is the easy case: one run has one mode, so that split is
exact. It is worth having on its own - a survival build and a campaign build
are taken against different lengths and different failure conditions, and
tallying them together produces a ranking that describes neither.

## A page with no runs still has to say something

A session that finished nothing still has a machine, a build, two clocks and
whatever went wrong. The session drill-down draws all of that before it draws
any runs, and the faults the session list has always counted are fetched with
`/v1/reports?session=` - a filter that did not exist until the page that needed
it did, so the count led to a page that never mentioned it.

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
/mining-mike/sessions          ?mode=survival narrows it, ?menus=1 widens it
/mining-mike/sessions/<session>/<mode>
/mining-mike/upgrades          ?sector=<name> and ?mode=<name> narrow it
/issues                        the same pages across every game
```

An unregistered game is a **404**, not an empty page. A link to a game nobody
wrote an entry for looks exactly like a game with no crashes, and those are
opposite things to learn.

Two rules fall out of this and are worth keeping:

- **Paging never touches the address.** What is shareable is the view, not how
  far somebody scrolled it.
- **A filter belongs on the service, not on the page.** The session list hides
  the sessions that never got into a game, and it hides them in SQL: a filter
  applied after a page arrives takes fifty rows off the service and draws
  twelve, and the cursor is then paging a different list than the one on
  screen. The same filter has to ride on every page, which is what
  `listQuery()` is for.
- **A header describes the list, not the page.** The session totals are their
  own query over the whole filtered set, from the same grouped SELECT the rows
  come from. Worked out from the rows on screen, a crash rate would move every
  time somebody pressed Load more.
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
- **A fixture is not the wire.** The before-and-after card was tested against a
  hand-written `{end: ...}` and shipped unable to draw the FLAT shape every
  report on the service actually carried, so the live page showed nothing at
  all. Breaking the code and watching the test fail does not catch this: the
  test and the code agreed, and both were wrong about the data. When a shape
  is already on the wire, copy one off the service into the test.

The portal's browser script is compiled and run by the suite
(`router()` in `test/open.test.mjs`), so routing is tested rather than read. It
is handed the registry the same way the page is.
