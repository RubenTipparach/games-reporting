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

**Two keys.** `INGEST_KEY` ships inside the game build, so treat it as public:
anyone who unpacks the game has it, and it can therefore only ever write.
`ADMIN_KEY` reads and deletes and never leaves your machine.

## Deploying

```bash
fly launch --no-deploy            # or: fly apps create games-reporting
fly volumes create reports_data --region ord --size 1

fly secrets set INGEST_KEY="$(openssl rand -hex 24)"
fly secrets set ADMIN_KEY="$(openssl rand -hex 24)"

fly deploy
```

Keep the two values `fly secrets set` was given: the ingest one goes into the
game build, the admin one into your own shell. `fly secrets list` shows only
digests, not the secrets themselves.

The machine sleeps when idle (`auto_stop_machines`) and wakes on a request. The
volume keeps the database across both the sleep and a deploy.

## Routes

| Route | Key | What it does |
| --- | --- | --- |
| `GET /healthz` | none | Liveness, plus how many reports are held |
| `POST /v1/reports` | ingest | Take a report |
| `GET /v1/reports` | admin | List, newest first |
| `GET /v1/reports/:id` | admin | One report, in full, with its log |
| `GET /v1/signatures` | admin | One row per distinct crash, with counts |
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
curl -s -H "x-api-key: $ADMIN_KEY" \
  https://games-reporting.fly.dev/v1/signatures?game=mining-mike | jq
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
curl -s -H "x-api-key: $ADMIN_KEY" \
  "https://games-reporting.fly.dev/v1/reports?signature=3f9a..." | jq
```

Paging is by cursor, not offset: pass the `received_at` of the last row you saw
as `before=`, so a page cannot skip or repeat a row when new reports land
mid-read.

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
| `ADMIN_KEY` | none | Required to read anything. Warned about if missing |
| `ID_SALT` | generated | HMAC salt for player ids. Generated onto the volume if unset |
| `MAX_BODY_BYTES` | `262144` | Bodies over this are refused as they arrive |
| `MAX_LOG_CHARS` | `65536` | How much of the log tail is kept |
| `RATE_BURST` | `20` | Posts one address may make at once |
| `RATE_PER_MINUTE` | `10` | How fast that allowance refills |
| `RETENTION_DAYS` | `90` | Reports older than this are swept |

## Running it locally

```bash
npm install
ADMIN_KEY=dev DATA_DIR=./data npm start
```

Then open <http://localhost:8080> and give it `dev`.

## Tests

```bash
npm test
```

Twenty one checks, driving the real server over real HTTP against a temporary
database. Nothing is stubbed, so a pass means `fly deploy` is deploying
something that works: posting open and posting closed (the second in its own
file, since the choice is read once at boot), reading refused without the admin
key, grouping across builds and machines, Steam ids provably absent from the
stored row, distinct players counted without being named, the portal holding no
data of its own, the body cap, the rate limit and its refill, the log tail, and
the refusals.
