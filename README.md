# games-reporting

Crash and error reports from the games, taken over HTTP and kept in SQLite on a
Fly volume.

The game posts a report when something goes wrong. Nothing in the game waits on
the answer, so this being slow, asleep or entirely down costs a player nothing.

## What it is made of, and why

**Node with no framework.** One runtime dependency, `better-sqlite3`. The
service is four routes; a framework would be more code than the thing it wraps.

**SQLite on a volume, not Postgres.** An indie game's crash reports arrive at a
few an hour on a bad day. SQLite handles that with no second service to pay
for, no connection string to rotate and no network hop between the API and its
data. The cost is that it cannot run on two machines at once, so the app is
deliberately one machine.

**Two keys, and BOTH SHIP UNSET.** That is the current call: make it work
first, lock it down later. Right now posting is open to anyone who finds the
URL, and so is reading the reports and deleting them.

Each key is its own switch and neither needs a code change to flip:

| Set this | and | leave it unset and |
| --- | --- | --- |
| `INGEST_KEY` | posting a report needs `x-api-key` | anyone can post |
| `ADMIN_KEY` | reading and deleting need `x-api-key` | anyone with the URL can read and delete |

`INGEST_KEY` ships inside the game build, so treat it as public: anyone who
unpacks the game has it, and it can therefore only ever write. `ADMIN_KEY`
covers reading and deleting and never leaves your machine.

Turning either on is one command, or one repository secret (the deploy stages
both, so a value in the box closes that half on the next push):

```bash
fly secrets set ADMIN_KEY="$(openssl rand -hex 24)" -a games-reporting
```

What being open exposes: the log tail, the session id, platform and GPU, and
whatever the game put in `context`. Steam ids are not among them, whatever the
keys are set to. Those are HMACed on the way in and the raw one is never
stored, so an open portal opens the crash data without opening who anybody
is.

## Deploying

```bash
fly launch --no-deploy            # or: fly apps create games-reporting
fly volumes create reports_data --region ord --size 1

# Both optional, and both currently unset. See the two keys above.
# fly secrets set INGEST_KEY="$(openssl rand -hex 24)"
# fly secrets set ADMIN_KEY="$(openssl rand -hex 24)"

fly deploy
```

Keep the two values `fly secrets set` was given: the ingest one goes into the
game build, the admin one into your own shell. `fly secrets list` shows only
digests, not the secrets themselves.

The machine sleeps when idle (`auto_stop_machines`) and wakes on a request. The
volume keeps the database across both the sleep and a deploy.

## Routes

### Pages, and sharing one

Every view the portal can draw has an address of its own, so "look at this
crash" is a link rather than a set of directions. Paste one to somebody and it
opens on the thing you were looking at.

**A game is a path segment**, so a link says which game out loud:

| Address | What it opens on |
| --- | --- |
| `/mining-mike` or `/mining-mike/issues` | That game's issue rollup, with **Load more** |
| `/mining-mike/issues/<signature>` | The reports behind one issue |
| `/mining-mike/reports` | Every report, newest first, with **Load more** |
| `/mining-mike/reports/<id>` | One report in full, with its stack, context and log |
| `/mining-mike/sessions` | Every session, with playtime and which are still running |
| `/mining-mike/sessions/<session>` | One session: its runs and how far they got |
| `/mining-mike/sessions/<session>/<mode>` | The same, narrowed to campaign or survival |
| `/mining-mike/upgrades` | What players built, and how those runs ended |

Drop the prefix for the same pages across every game: `/issues`, `/reports`,
`/sessions`. The toolbar's picker switches between them, and whichever you
choose rides along as you click deeper.

A game with reports but no registry entry is still readable as
`?game=<id>`, but has no path of its own: `/<unregistered>/issues` is a **404**
rather than an empty page, because an empty page looks exactly like a game with
no crashes.

**Copy link** in the top right puts the current address on the clipboard; the
browser's back and forward buttons work, and so do right-click → copy link
address and ctrl-click to open a row in a new tab.

A link into a service with `ADMIN_KEY` set asks whoever opened it for the key
first and then lands on the view it pointed at, so sharing one is not a way
around the key.

### The API

| Route | Key | What it does |
| --- | --- | --- |
| `GET /healthz` | none | Liveness, plus how many reports are held |
| `GET /v1/games` | admin | The game registry, and what has posted against it |
| `GET /v1/upgrades` | admin | What players built, tallied by outcome |
| `POST /v1/reports` | ingest | Take a report |
| `GET /v1/reports` | admin | List, newest first; paged by cursor |
| `GET /v1/reports/:id` | admin | One report, in full, with its log |
| `GET /v1/signatures` | admin | One row per distinct crash, with counts; paged |
| `GET /v1/sessions` | admin | One row per session, with playtime and outcome |
| `GET /v1/runs` | admin | Run summaries, filterable by session and mode |
| `DELETE /v1/reports/:id` | admin | Drop one |

### Posting a report

```bash
curl -X POST https://games-reporting.fly.dev/v1/reports \
  -H 'content-type: application/json' \
  -H "x-api-key: $INGEST_KEY" \
  -d '{
    "game": "mining-mike",
    "version": "1.2.3",
    "kind": "crash",
    "message": "Invalid access to property text on a base object of type null instance",
    "stack": "at: res://scripts/hud.gd:3312 @ update_hud()",
    "log": "...the tail of user://logs/godot.log...",
    "platform": "Windows",
    "gpu": "NVIDIA GeForce RTX 3070",
    "engine": "4.7.2",
    "session": "8f2c...",
    "steam_id": "76561197960287930",
    "context": {"sector": 0, "depth": 3, "wave": 21}
  }'
```

`kind` is one of `crash`, `error`, `warning` (the faults), `run` and `session`
(a depth ending and the five minute check-in), or `purchase` and `research`
(the two spends, which happen between runs and so ride on neither). Anything
else is filed as an `error` rather than refused, which is why a kind the game
starts sending has to be added to `KINDS` before it ships: an unlisted kind
does not go missing, it goes into the issue list.

`game` is required, and so is at least one of `message` or `stack`. Everything
else is optional. The reply is `{"id": ..., "signature": ...}`. Send
`x-api-key` when the client has a token and leave the header off when it does
not; today either is accepted.

`session` is the client's own idea of which run this was. It is not an account
and not a machine id: it exists so that twenty reports from one bad session can
be told apart from twenty players hitting the same thing, which is the
difference between a nuisance and a disaster.

`steam_id` (or `player_id`, whichever the game has) is **hashed on arrival and
the raw value is never stored**, never logged and never returned. What lands in
the database is an HMAC of it under a salt that stays on the server: enough to
say "three distinct players", not enough to say who. A plain SHA would not do,
since the Steam id space is small and public and anyone could hash all of it
and look the answer up. The salt is what stops that, and is why rotating
`ID_SALT` re-pseudonymises everybody: old and new hashes for one player stop
matching, which is useful deliberately and a trap by accident.

### Reading them back

The first thing worth opening is the rollup, because it answers "what is
actually happening" rather than "what happened most recently":

```bash
# The header is only needed once ADMIN_KEY is set; it is ignored while it is not.
curl -s https://games-reporting.fly.dev/v1/signatures?game=mining-mike | jq
```

```json
{"signatures": [
  {"signature": "3f9a...", "count": 41, "sessions": 27, "players": 19,
   "first_seen": 1757000000000, "last_seen": 1757400000000,
   "versions": "1.2.3,1.3.0", "title": "Invalid access to property text ..."}
]}
```

Then pull the reports behind one of them:

```bash
curl -s "https://games-reporting.fly.dev/v1/reports?signature=3f9a..." | jq
```

Paging is by cursor, not offset, and the cursor is a **pair**: the sort key of
the last row you saw and its tiebreak. The reply hands you the next one ready
to send back, so in practice you copy it rather than build it:

```json
{"reports": [ ... 50 rows ... ],
 "next": {"before": 1757400000123, "before_id": "8f2c...-...-..."}}
```

```bash
curl -s "$URL/v1/reports?before=1757400000123&before_id=8f2c...-...-..."
```

`next` is only present when the page came back full, so its absence is the end
of the list. `/v1/signatures` pages the same way, with `last_seen` and the
signature as the pair.

The pair is not decoration. `received_at` is a millisecond and is **not
unique**: sixty reports posted at once land on about twenty seven distinct
milliseconds, and a cursor of the timestamp alone asks for everything strictly
older than the last row's, skipping whatever else shared it - paging that burst
returned 53 of the 60. A log scrape uploading a backlog is exactly that shape.
Sending `before=` on its own is still accepted, and still loses rows that way;
send both.

Neither `/v1/sessions` nor `/v1/runs` is paged. A session is a bounded thing
and a run belongs to one, so once you have opened a session there is nothing
behind it to page to; both take a `limit` and nothing more.

### More than one game

This service is not Mining Mike's crash collector. It is a crash collector, and
Mining Mike is the first game in it: **adding a second is one entry in
`src/games.js`** and nothing else.

Everything generic to a crash report lives outside that file and is never
branched on a game id: the report's own fields, the signature and its rollup,
the session model, run outcomes, and the Session and Machine context blocks,
which ask the same two questions of every game. What lives IN the entry is
whatever the game calls the places you can be, how much of one counts as
finishing it, and which of its own context keys are worth a line on screen.

```js
{
  id: "mining-mike",
  title: "Mining Mike",
  place: { sector: "sector_title", depth: "depth", wavesPerDepth: 10 },
  blocks: [ { title: "Mech", when: ["mech"], rows: [...] } ],
}
```

`GET /v1/games` answers what is registered and what has posted without an
entry, which is the list of games somebody should write one for. `CLAUDE.md`
carries the rule and the block grammar.

### A game's upgrade art

`/<game>/upgrades` tallies what players built and how those runs ended. When
the entry also carries `upgrades.meta`, each row gets the name a player would
recognise, the game's own icon, and - on hover - what taking the thing does at
the level people actually reach.

The art is served from `assets/icons/<game>/<key>.png`, one file per upgrade
key, at `96x96`. It is the only thing this service serves that is not JSON or
the portal, and it is **open even when `ADMIN_KEY` is set**: an `<img>` cannot
carry a header, so a key there would mean broken tiles for exactly the person
who has the key, and there is nothing behind it anyway - it is the same art the
game ships to anybody who installs it.

Mining Mike's came out of the game's own `resources/sprites/upgrade icons/`,
resized and reduced to a 128-colour palette (about 3.5 KB each, against 20 KB
for the originals, and no difference at 2x). The mapping from upgrade key to
file is the game's `_icon_for()`, applied once on the way in, so the copy here
is named by key and the page never has to look anything up:

```sh
python3 -c "
from PIL import Image
im = Image.open('.../upgrade icons/vitality.png').convert('RGBA')
im.resize((96, 96), Image.LANCZOS).quantize(colors=128, method=Image.FASTOCTREE) \
  .save('assets/icons/mining-mike/max_health.png', optimize=True)"
```

A test asserts art on disk and art claimed by an entry agree in both
directions, so a file nobody shows and an `icon: true` with no file are each
a failure rather than a surprise. An upgrade with no art draws a lettered
tile, which is what the game draws for it too.

### The build order of one run

`upgrades.path` says what a run ended on. `upgrades.picks` says the order it
got there in, and every place one run is on screen draws it as a time axis:
the icon is what they took, the badge is the level that pick bought, and where
it sits is when.

```
/mining-mike/reports/<id>                one run, under its message
/mining-mike/sessions/<session>          every run of that session, newest first
```

The axis is THAT run's length, never the longest run on screen. A relative
scale draws a three minute run that took four upgrades and a nine minute run
that took four exactly the same, which is the opposite of the thing worth
seeing.

The level on a mark is **derived, not reported**: the third time a key appears
in the list is that upgrade at level three. That is true by construction and
cannot drift from the levels the same report carries, so a game does not send
it and should not.

A session's runs are one game's runs, so the drill-down passes the game along
and the service looks up where that game keeps its picks. Asking for every
game's runs at once (`/v1/runs` with no `game`) leaves the column out
entirely, because "where are the picks" has a different answer per game.

### Is a session still running?

Nothing can report its own end. A clean quit is the process leaving and a crash
is the process gone, so neither gets to send a last word. What there is instead
is a **check-in every five minutes** - `heartbeat_minutes = 5.0` in the game's
`telemetry.gd` - and the reading of it is the absence:

| Since the last check-in | The session is |
| --- | --- |
| under 10 minutes (`HEARTBEAT_SECONDS` x `HEARTBEAT_STALE_FACTOR`) | **still running** |
| over that | over |

Two intervals rather than one because a single missed post is a dropped
request, a flaky network, or this service waking from sleep, and calling a
session dead over one of those makes the state flicker. Two in a row is the
game not running.

`HEARTBEAT_SECONDS` has to match what the game sends. Set it shorter and live
sessions get called dead; longer, and dead ones stay listed as live.

A session still checking in is **not counted as having ended**, which is what
keeps the crash rate honest: it is over the sessions that finished, not over
the sessions that exist, so leaving the game open all afternoon no longer
quietly dilutes it.

**"Ended in a crash" means the crash was the last word.** A crash marked
`detected_by: "session marker"` is posted by a LATER launch that found a marker
file lying around - and a second copy of the game started while the first is
still open finds exactly that, because the marker is refreshed every fifteen
seconds by the live process. So the marker alone does not settle it: a session
with check-ins after the marker was read did not end there, and the check-ins
are the refutation. One real session ran for ten more hours after being
reported as crashed.

### How reports are grouped

Forty reports of one null dereference are one bug, and a list showing forty
rows tells you less than a list showing one row saying 41. The signature is a
hash of the game, the kind, the message with its variable parts filed off, and
the first five stack frames.

Two things are deliberately excluded from it:

- **Line numbers**, because they move whenever anything above them is edited,
  and a bug whose signature changes every time you touch its file has its
  history split in two.
- **The version**, because the same bug across two builds should still group.
  That is what lets you watch one survive a release; the versions it was seen
  on are reported alongside the count.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Listen port |
| `DATA_DIR` | `/data` | Where the SQLite file lives, ie the volume mount |
| `INGEST_KEY` | none | Unset means posting is open. Set it and posting requires it |
| `ADMIN_KEY` | none | Unset means reading and deleting are open. Set it and both require it |
| `ID_SALT` | generated | HMAC salt for player ids. Generated onto the volume if unset |
| `MAX_BODY_BYTES` | `262144` | Bodies over this are refused as they arrive |
| `MAX_LOG_CHARS` | `65536` | How much of the log tail is kept |
| `RATE_BURST` | `20` | Posts one address may make at once |
| `RATE_PER_MINUTE` | `10` | How fast that allowance refills |
| `HEARTBEAT_SECONDS` | `300` | How often the game checks in. Must match `telemetry.gd` |
| `HEARTBEAT_STALE_FACTOR` | `2` | Missed check-ins forgiven before a session counts as ended |
| `RETENTION_DAYS` | `90` | Reports older than this are swept |

## Running it locally

```bash
npm install
DATA_DIR=./data npm start
```

Then open <http://localhost:8080>. It loads straight into the reports, and
every view it draws has an address you can copy out of the bar. Add
`ADMIN_KEY=dev` to that command to try the locked-down side, and the page will
ask for `dev` instead.

## Tests

```bash
npm test
```

Driving the real server over real HTTP against a temporary
database. Nothing is stubbed, so a pass means `fly deploy` is deploying
something that works: posting open and posting closed (the second in its own
file, since the choice is read once at boot), reading refused without the admin
key, grouping across builds and machines, Steam ids provably absent from the
stored row, distinct players counted without being named, the portal holding no
data of its own, the body cap, the rate limit and its refill, the log tail, the
refusals, every page address round-tripping to the view it names, and the
cursor recovering every row of a burst that shares timestamps, a session
counting as over only once its check-ins have stopped, and every registered
game round-tripping through a path of its own.
