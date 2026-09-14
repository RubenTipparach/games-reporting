// Both lockdown flags off, which is how this is deployed right now: make it
// work first, lock it down later. api.test.mjs runs the same routes with
// ADMIN_KEY set and closed.test.mjs with INGEST_KEY set, so between the three
// of them the flag is pinned in both positions rather than just the shipped
// one - which is the only way "easy to turn on later" stays true.
//
// A separate file because config is read once at import, so the choice cannot
// be flipped inside a running server without lying about how it works.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "reporting-open-"));
process.env.DATA_DIR = dir;
// Neither key. Both halves open, except the one that deletes.
delete process.env.INGEST_KEY;
delete process.env.ADMIN_KEY;
process.env.ID_SALT = "test-salt";
process.env.RATE_BURST = "500";
process.env.RATE_PER_MINUTE = "500";

const { adminPage } = await import("../src/admin.js");
const { registryForPage, upgradePathFor, checkUpgrades, checkStats, GAMES: REGISTRY } = await import("../src/games.js");
const { server, store } = await import("../src/server.js");
const base = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
});

test.after(() => {
  server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const posted = await fetch(`${base}/v1/reports`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    game: "mining-mike",
    version: "1.0.0",
    kind: "crash",
    message: "Invalid access to property 'text' on a base object of type 'null instance'",
    stack: "at: res://scripts/hud.gd:3312 @ update_hud()",
    session: "open-1",
    steam_id: "76561197960287930",
  }),
});
const { id } = await posted.json();

test("the issue list opens with no key", async () => {
  const res = await fetch(`${base}/v1/signatures`);
  assert.equal(res.status, 200);
  const { signatures } = await res.json();
  assert.equal(signatures.length, 1);
  assert.equal(signatures[0].players, 1, "and still counts players, pseudonymously");
});

test("so does the report list", async () => {
  const res = await fetch(`${base}/v1/reports`);
  assert.equal(res.status, 200);
  const { reports } = await res.json();
  assert.equal(reports.length, 1);
});

test("and one report in full", async () => {
  const res = await fetch(`${base}/v1/reports/${id}`);
  assert.equal(res.status, 200);
  const report = await res.json();
  assert.equal(report.game, "mining-mike");
  // The thing that must stay true however open the rest of it is.
  assert.notEqual(report.player, "76561197960287930", "the raw steam id must never be stored");
  assert.equal(report.player.length, 16);
});

test("a key that nobody asked for is simply ignored", async () => {
  const res = await fetch(`${base}/v1/signatures`, { headers: { "x-api-key": "nonsense" } });
  assert.equal(res.status, 200, "an open service does not start checking a key it was not given");
});

test("and so is deleting, since it is behind the same flag", async () => {
  const res = await fetch(`${base}/v1/reports/${id}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.equal(store.count(), 0);
});

test("the portal is served, and does not gate on arrival", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  // The gate exists in the page, for when a key IS set. What must NOT be there
  // any more is the early return that put it up before asking the service.
  assert.ok(!html.includes('if (!key) return gate("")'), "the page must not gate before it has asked");
});

// ---------------------------------------------------------------------------
// Run summaries. Mining Mike posts one at the end of every depth, cleared or
// not, and they arrive on the same endpoint as the crashes.

test("a run summary keeps its own kind instead of being filed as an error", async () => {
  const res = await fetch(`${base}/v1/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      game: "mining-mike",
      kind: "run",
      message: "cleared at depth 2 after 10m 02s",
      context: { outcome: "cleared", depth: 2, run_seconds: 602, wave_number: 10 },
    }),
  });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  assert.equal(store.get(id).kind, "run", "an unlisted kind would have become 'error'");
});

test("and does not show up as an issue", async () => {
  const res = await fetch(`${base}/v1/signatures?game=mining-mike`);
  const { signatures } = await res.json();
  assert.equal(signatures.length, 0, "a cleared run is not something that went wrong");
});

test("while a real fault in the same game still does", async () => {
  await fetch(`${base}/v1/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      game: "mining-mike",
      kind: "crash",
      message: "Invalid access to property 'text' on a null instance",
    }),
  });
  const res = await fetch(`${base}/v1/signatures?game=mining-mike`);
  const { signatures } = await res.json();
  assert.equal(signatures.length, 1);
  assert.equal(signatures[0].kind, "crash");
});

test("a genuinely unknown kind is still filed as an error, not rejected", async () => {
  const res = await fetch(`${base}/v1/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "mining-mike", kind: "banana", message: "what is this" }),
  });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  assert.equal(store.get(id).kind, "error");
});

// ---------------------------------------------------------------------------
// The Runs view's data. The portal reads these columns out of the context JSON
// rather than out of real columns, so a change to what the game sends shows up
// here rather than as an empty table nobody notices.

test("a run summary comes back on /v1/runs with its columns unpacked", async () => {
  await fetch(`${base}/v1/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      game: "mining-mike",
      version: "abc1234",
      kind: "run",
      message: "cleared at depth 2 after 10m 02s",
      context: {
        outcome: "cleared", depth: 2, sector_title: "Dust Hive",
        run_seconds: 602, wave_number: 10, difficulty_wave: 20,
        kills: 602, credits: 3110, mech: { level: 12, role: "Combat" },
      },
    }),
  });
  const { runs } = await fetch(`${base}/v1/runs?game=mining-mike`).then((r) => r.json());
  const run = runs.find((r) => r.outcome === "cleared");
  assert.ok(run, "the run should be listed");
  assert.equal(run.depth, 2);
  assert.equal(run.sector, "Dust Hive");
  assert.equal(run.seconds, 602);
  assert.equal(run.kills, 602);
  assert.equal(run.credits, 3110);
  assert.equal(run.mech_level, 12, "read out of the nested mech object");
});

test("and faults do not appear in it", async () => {
  const { runs } = await fetch(`${base}/v1/runs`).then((r) => r.json());
  assert.ok(runs.every((r) => r.outcome !== undefined || r.depth !== undefined),
    "only run-kind rows come back");
  const ids = new Set(runs.map((r) => r.id));
  const { reports } = await fetch(`${base}/v1/reports?kind=crash`).then((r) => r.json());
  for (const c of reports) {
    assert.ok(!ids.has(c.id), "a crash must not be listed as a run");
  }
});

test("the issue list carries the depth span, which is what makes it scannable", async () => {
  // Same fault at two different depths: the span should widen rather than
  // showing only the most recent.
  for (const depth of [1, 3]) {
    await fetch(`${base}/v1/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        game: "span-test",
        kind: "crash",
        message: "A fault seen at more than one depth",
        context: { depth, difficulty_wave: depth * 10 },
      }),
    });
  }
  const { signatures } = await fetch(`${base}/v1/signatures?game=span-test`).then((r) => r.json());
  assert.equal(signatures.length, 1);
  assert.equal(signatures[0].depth_min, 1);
  assert.equal(signatures[0].depth_max, 3);
  assert.equal(signatures[0].wave_max, 30);
});

// ---------------------------------------------------------------------------
// Sessions: the outermost level of how a playtest gets read.
//
//   session -> campaign or survival -> a sector+depth run

test("the page's own script parses", () => {
  // Twice now a backtick inside a comment in src/admin.js has terminated the
  // template literal the browser script lives in, and the failure is invisible
  // from the server: adminPage() still returns a string, the page still serves
  // 200, and the browser gets JavaScript that stops at the stray backtick. So
  // this parses the script the page actually ships.
  const html = adminPage();
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "the page should carry a script");
  // Function() compiles without running, which is exactly the check wanted.
  assert.doesNotThrow(() => new Function(m[1]), "the browser script must parse");
});

// ---------------------------------------------------------------------------
// Is it still running?
//
// A session cannot report its own end: a clean quit is the process leaving and
// a crash is the process gone. The only evidence is the check-in the game
// sends every five minutes, and the only reading of it is the absence.
//
// The clock is handed in rather than waited on, so these assert the rule and
// not the patience of whoever is running them.

const HEARTBEAT = 300_000;
const STALE = 2 * HEARTBEAT;
const LIVE = "live-fixture";

function checkIn(session, at, extra = {}) {
  store.insert({
    id: `${session}-${at}-${Math.random().toString(16).slice(2, 8)}`,
    received_at: at, game: LIVE, version: "", kind: "session",
    signature: "sig", title: "open", message: "open", stack: "", log: "",
    platform: "", gpu: "", engine: "", session, player: "", context: "{}",
    ...extra,
  });
}

const rowFor = (session, now) =>
  store.sessions({ game: LIVE, now, staleAfter: STALE, limit: 50 })
    .find((s) => s.session === session);

test("a session that checked in a moment ago is still running", () => {
  const t = 1_800_000_000_000;
  checkIn("still-here", t - 3 * HEARTBEAT);
  checkIn("still-here", t - 2 * HEARTBEAT);
  checkIn("still-here", t - 60_000);
  const row = rowFor("still-here", t);
  assert.equal(row.live, 1, "one minute since the last check-in is not gone");
  assert.ok(row.silent_for < HEARTBEAT);
});

test("one missed check-in is forgiven, two is the session ending", () => {
  const t = 1_800_000_000_000;
  checkIn("one-missed", t - 6 * HEARTBEAT);
  checkIn("one-missed", t - HEARTBEAT - 30_000);
  assert.equal(rowFor("one-missed", t).live, 1,
    "a single dropped post is a network, not a death");

  checkIn("two-missed", t - 6 * HEARTBEAT);
  checkIn("two-missed", t - STALE - 30_000);
  assert.equal(rowFor("two-missed", t).live, 0,
    "two intervals of silence and the game is not running");
});

test("the same session is live and then is not, as the clock moves past it", () => {
  const t = 1_800_000_000_000;
  checkIn("goes-quiet", t);
  assert.equal(rowFor("goes-quiet", t + HEARTBEAT).live, 1);
  assert.equal(rowFor("goes-quiet", t + STALE - 1).live, 1, "the window is inclusive up to it");
  assert.equal(rowFor("goes-quiet", t + STALE).live, 0, "and closed at it");
  assert.equal(rowFor("goes-quiet", t + 10 * STALE).silent_for, 10 * STALE);
});

test("a marker crash is only an ending if nothing checked in after it", () => {
  const t = 1_800_000_000_000;
  const marker = (session, at) => store.insert({
    id: `${session}-marker-${at}`, received_at: at, game: LIVE, version: "",
    kind: "crash", signature: "sig", title: "Game did not shut down cleanly",
    message: "Game did not shut down cleanly", stack: "", log: "",
    platform: "", gpu: "", engine: "", session, player: "",
    context: JSON.stringify({ detected_by: "session marker" }),
  });

  // A second copy of the game, started while the first is still open, finds a
  // marker file that is being refreshed by a LIVE process and reports it as a
  // crash. The check-ins that follow are the refutation - and this ran for ten
  // more hours in the real data while the portal called it crashed.
  checkIn("kept-going", t - 20 * HEARTBEAT);
  marker("kept-going", t - 19 * HEARTBEAT);
  checkIn("kept-going", t - HEARTBEAT);
  const alive = rowFor("kept-going", t);
  assert.equal(alive.live, 1);
  assert.equal(alive.ended_in_crash, 0,
    "a session that kept checking in did not end when the marker was read");

  // The real thing: the marker is the last word.
  checkIn("really-died", t - 20 * HEARTBEAT);
  marker("really-died", t - 19 * HEARTBEAT);
  const dead = rowFor("really-died", t);
  assert.equal(dead.live, 0);
  assert.equal(dead.ended_in_crash, 1, "nothing after the marker, so it is the ending");
});

test("the window comes from config, so it can follow the game's interval", async () => {
  const res = await fetch(`${base}/v1/sessions?game=${LIVE}&limit=50`);
  assert.equal(res.status, 200);
  const { sessions } = await res.json();
  const row = sessions.find((s) => s.session === "still-here");
  assert.ok(row, "the route serves the same rows");
  assert.equal(typeof row.live, "number", "and carries the state it worked out");
  assert.equal(typeof row.silent_for, "number");
  // Everything in this fixture was inserted at a fixed instant in 2027, so by
  // a real clock it is either far future or long silent - never mid-window.
  assert.ok(row.live === 0 || row.live === 1);
});

test("a purchase and a research unlock keep their own kind", async () => {
  // The game posts these between runs. If the service does not know the kind,
  // an unknown one is filed as an error and every shop visit becomes a fake
  // crash in the issue list.
  const post = (body) => fetch(`${base}/v1/reports`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "spend-fixture", ...body }),
  });
  await post({ kind: "purchase", message: "bought repair_kit for 120 credits",
    context: { item: "repair_kit", cost: 120, currency: "credits" } });
  await post({ kind: "research", message: "unlocked chain_damage",
    context: { node: "chain_damage", cost: 40 } });

  const { reports } = await fetch(`${base}/v1/reports?game=spend-fixture&limit=50`)
    .then((r) => r.json());
  assert.deepEqual(reports.map((r) => r.kind).sort(), ["purchase", "research"],
    "both kept the kind they were sent as");

  // And neither shows up as something that went wrong.
  const { signatures } = await fetch(`${base}/v1/signatures?game=spend-fixture`)
    .then((r) => r.json());
  assert.equal(signatures.length, 0, "a spend is not a fault and is not an issue");
});

// ---------------------------------------------------------------------------
// What players built.
//
// The tally reads a path the GAME'S ENTRY names, so these assert the registry
// is what drives it and not a hardcoded "mech.upgrades" somewhere.

const BUILDS = "builds-fixture";

test("the tally counts a run per upgrade, split by how the run ended", () => {
  let n = 0;
  const run = (outcome, sector, upgrades) => store.insert({
    id: `build-${n++}`, received_at: 1_900_000_000_000 + n, game: BUILDS,
    version: "", kind: "run", signature: "sig", title: outcome, message: outcome,
    stack: "", log: "", platform: "", gpu: "", engine: "", session: "b", player: "",
    context: JSON.stringify({ outcome, sector_title: sector, mech: { upgrades } }),
  });
  // armor is taken in three runs and clears one; shotgun in one and clears
  // none; missiles is present in every build and picked by nobody.
  run("succeeded", "Meridian", { armor: 2, shotgun: 0, missiles: 0 });
  run("failed", "Meridian", { armor: 1, shotgun: 0, missiles: 0 });
  run("failed", "Dust Hive", { armor: 3, shotgun: 1, missiles: 0 });
  run("quit", "Dust Hive", { armor: 0, shotgun: 0, missiles: 0 });

  const t = store.upgradeTally({ game: BUILDS, path: "mech.upgrades" });
  assert.equal(t.runs, 4, "every run that carried a build counts, even an empty one");

  const armor = t.taken.find((u) => u.upgrade === "armor");
  assert.equal(armor.runs, 3, "three runs took armor");
  assert.equal(armor.succeeded, 1);
  assert.equal(armor.failed, 2);
  assert.deepEqual(armor.levels.sort(), [1, 2, 3], "and the levels it was taken at");

  const shotgun = t.taken.find((u) => u.upgrade === "shotgun");
  assert.equal(shotgun.runs, 1);
  assert.equal(shotgun.succeeded, 0);

  assert.deepEqual(t.never, ["missiles"],
    "an upgrade present in every build and picked in none is named, not dropped");
  assert.equal(t.taken[0].upgrade, "armor", "most taken first");
});

test("the tally narrows to one place", () => {
  const t = store.upgradeTally({ game: BUILDS, path: "mech.upgrades", sector: "Meridian" });
  assert.equal(t.runs, 2, "only the runs in that sector");
  const armor = t.taken.find((u) => u.upgrade === "armor");
  assert.equal(armor.runs, 2);
  assert.equal(armor.succeeded, 1);
  assert.deepEqual(store.runPlaces({ game: BUILDS }).sort(), ["Dust Hive", "Meridian"]);
});

test("the path comes from the registry, so another game's word for it works too", () => {
  // The same rows read through a DIFFERENT path return nothing, which is the
  // proof that the path is doing the work rather than a hardcoded key.
  const wrong = store.upgradeTally({ game: BUILDS, path: "mech.perks" });
  assert.equal(wrong.taken.length, 0);
  assert.equal(wrong.runs, 0);

  // And a game with no entry at all has no path to read.
  assert.equal(upgradePathFor("not-a-game"), null);
  assert.equal(upgradePathFor("mining-mike"), "mech.upgrades");
});

test("a game with no upgrades entry gets an empty tally rather than an error", async () => {
  const res = await fetch(`${base}/v1/upgrades?game=${BUILDS}`);
  assert.equal(res.status, 200, "not a 404: the game is real, it just has no entry");
  const body = await res.json();
  assert.equal(body.upgrades, null, "and the page knows to say so");
  assert.deepEqual(body.taken, []);
});

test("the route serves the tally for a game whose entry names the path", async () => {
  const res = await fetch(`${base}/v1/upgrades?game=mining-mike`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.upgrades.path, "mech.upgrades", "carrying the entry it read");
  assert.ok(Array.isArray(body.taken));
  assert.ok(Array.isArray(body.sectors));
});

test("the upgrades page has an address of its own, per game", async () => {
  for (const path of ["/mining-mike/upgrades", "/upgrades"]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, `${path} should serve the portal`);
  }
  const { state, href } = router("/mining-mike/upgrades");
  assert.equal(state.view, "upgrades");
  assert.equal(state.game, "mining-mike");
  assert.equal(href(state), "/mining-mike/upgrades");

  // The sector is a filter, so it stays a query, and a link to it still opens
  // on the same screenful.
  const filtered = router("/mining-mike/upgrades", "?sector=The%20Long%20Haul");
  assert.equal(filtered.state.sector, "The Long Haul");
  assert.equal(filtered.href(filtered.state), "/mining-mike/upgrades?sector=The+Long+Haul");
});

// ---------------------------------------------------------------------------
// Paging the two top-level lists.
//
// The cursor is (sort key, tiebreak) rather than the sort key alone, because
// the sort key alone lost rows.
//
// The arrangement that loses them is built BY HAND below rather than by
// posting a burst and hoping. A burst does produce ties, but at timestamps
// nobody chose, and whether a page boundary happens to fall inside one is
// luck: the first version of this asserted the lossy cursor was lossy, and CI
// ran it green on a boundary that missed every tie. A test that only fails
// sometimes is not a test.

// Everything in one game of its own, so the reports the rest of this file
// posted cannot pad or skew the counts.
const PAGED = "paging-fixture";

async function postBurst(n, shape) {
  await Promise.all(Array.from({ length: n }, (_, i) =>
    fetch(`${base}/v1/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ game: PAGED, ...shape(i) }),
    })));
}

// Walks a list with the cursor the service hands back, and reports what it saw.
async function walk(path, key, pageSize) {
  const seen = [];
  let cursor;
  let pages = 0;
  for (;;) {
    const q = new URLSearchParams({ game: PAGED, limit: String(pageSize) });
    if (cursor) {
      q.set("before", String(cursor.before));
      q.set("before_id", String(cursor.before_id));
    }
    const body = await fetch(`${base}${path}?${q}`).then((r) => r.json());
    if (!body[key].length) break;
    pages += 1;
    seen.push(...body[key]);
    if (!body.next) break;
    cursor = body.next;
    assert.ok(pages < 50, "the cursor should terminate, not run forever");
  }
  return { seen, pages };
}

// The exact arrangement, straight into the table: three reports sharing one
// millisecond, with a page edge falling inside them. This is what a log scrape
// uploading a backlog produces, and what the timestamp-only cursor steps over.
const TIED = "tie-fixture";
const T0 = 1_700_000_000_000;

test("the cursor is a pair, because received_at is not unique", () => {
  const at = (ms, id) => store.insert({
    id, received_at: ms, game: TIED, version: "", kind: "error",
    signature: "sig", title: "t", message: "m", stack: "", log: "",
    platform: "", gpu: "", engine: "", session: "", player: "", context: "{}",
  });
  at(T0 + 2, "tie-a");
  at(T0 + 1, "tie-b1");
  at(T0 + 1, "tie-b2");
  at(T0 + 1, "tie-b3");
  at(T0, "tie-c");

  // Newest first, ties broken by id descending, which is a total order.
  const order = store.list({ game: TIED, limit: 10 }).map((r) => r.id);
  assert.deepEqual(order, ["tie-a", "tie-b3", "tie-b2", "tie-b1", "tie-c"]);

  // Two at a time, so the second page starts in the middle of the tie.
  const pair = [];
  let cur;
  for (let page = 0; page < 10; page++) {
    const rows = store.list({ game: TIED, limit: 2, before: cur?.before, beforeId: cur?.beforeId });
    if (!rows.length) break;
    pair.push(...rows.map((r) => r.id));
    const last = rows[rows.length - 1];
    cur = { before: last.received_at, beforeId: last.id };
  }
  assert.deepEqual(pair, order, "the pair walks every row, in order, exactly once");

  // The same walk with the timestamp alone, which is what shipped first.
  const lone = [];
  let before;
  for (let page = 0; page < 10; page++) {
    const rows = store.list({ game: TIED, limit: 2, before });
    if (!rows.length) break;
    lone.push(...rows.map((r) => r.id));
    const last = rows[rows.length - 1].received_at;
    if (last === before) break;
    before = last;
  }
  assert.deepEqual(lone, ["tie-a", "tie-b3", "tie-c"],
    "asking for strictly older skips the rest of the millisecond it stopped on");
  assert.equal(lone.length, 3, "three of the five, and no error to say so");
});

test("a burst of reports pages completely, however its timestamps fall", async () => {
  await postBurst(60, (i) => ({ kind: "error", message: "burst " + i }));
  const all = await fetch(`${base}/v1/reports?game=${PAGED}&limit=200`).then((r) => r.json());
  assert.equal(all.reports.length, 60);

  const { seen, pages } = await walk("/v1/reports", "reports", 7);
  assert.ok(pages > 1, "seven at a time should take several pages");
  assert.equal(seen.length, 60, "every report comes back");
  assert.equal(new Set(seen.map((r) => r.id)).size, 60, "and none of them twice");
});

test("the timestamp-only cursor is still accepted, so anything using it still reads", async () => {
  const first = await fetch(`${base}/v1/reports?game=${PAGED}&limit=5`).then((r) => r.json());
  const edge = first.reports[first.reports.length - 1].received_at;
  const res = await fetch(`${base}/v1/reports?game=${PAGED}&limit=5&before=${edge}`);
  assert.equal(res.status, 200, "the shape that shipped first is not an error");
  const { reports } = await res.json();
  assert.ok(reports.every((r) => r.received_at < edge), "and it means what it always meant");
});

test("the last page carries no cursor, so a Load more link stops existing", async () => {
  const body = await fetch(`${base}/v1/reports?game=${PAGED}&limit=200`).then((r) => r.json());
  assert.equal(body.reports.length, 60);
  assert.equal(body.next, undefined, "a page that is not full is the end of the list");

  const full = await fetch(`${base}/v1/reports?game=${PAGED}&limit=60`).then((r) => r.json());
  assert.ok(full.next, "a full page offers the cursor for what might be behind it");
  assert.equal(typeof full.next.before, "number");
  assert.equal(typeof full.next.before_id, "string");
});

test("the issue rollup pages too, on last_seen and the signature", async () => {
  // Distinct faults, so these are distinct signatures rather than one group.
  await postBurst(40, (i) => ({
    kind: "crash",
    message: "Nonexistent function 'fn_" + i + "' in base 'Panel'",
    stack: "at: res://scripts/mod_" + i + ".gd:" + (100 + i) + " @ _refresh_" + i + "()",
  }));
  const all = await fetch(`${base}/v1/signatures?game=${PAGED}&limit=200`).then((r) => r.json());
  const total = all.signatures.length;
  assert.ok(total >= 40, "each distinct fault is its own issue");

  const { seen, pages } = await walk("/v1/signatures", "signatures", 6);
  assert.ok(pages > 1);
  assert.equal(seen.length, total, "every issue comes back");
  assert.equal(new Set(seen.map((s) => s.signature)).size, total, "and none of them twice");
});

test("a nonsense limit is the default rather than a refusal", async () => {
  for (const limit of ["", "0", "-5", "banana"]) {
    const res = await fetch(`${base}/v1/reports?game=${PAGED}&limit=${limit}`);
    assert.equal(res.status, 200, `?limit=${limit} should still read`);
    const { reports } = await res.json();
    assert.equal(reports.length, 50, "which is the default page");
  }
  // And one over the cap is the cap, not the number asked for.
  const { reports } = await fetch(`${base}/v1/reports?game=${PAGED}&limit=9999`).then((r) => r.json());
  assert.ok(reports.length <= 200, "the hard cap still holds");
});

// ---------------------------------------------------------------------------
// Addresses. A view you cannot link to is one you can only describe out loud,
// so every view the portal draws has an address, and the two halves of that
// are tested here: the server serves the page at each shape, and the page
// turns each shape back into the view it names.

test("every view of the portal has an address, and every one of them serves it", async () => {
  const paths = [
    "/", "/admin",
    "/issues", "/issues/3f9adeadbeef",
    "/reports", `/reports/${id}`,
    "/sessions", "/sessions/open-1", "/sessions/open-1/campaign",
    // A session id is whatever the game called it, so it can carry anything
    // once it has been escaped. That must not stop being an address.
    "/sessions/a%2Fb",
    "/issues?game=mining-mike",
  ];
  for (const path of paths) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, `${path} should serve the portal`);
    assert.match(res.headers.get("content-type"), /text\/html/, path);
  }
});

test("a registered game has every page under its own path", async () => {
  for (const g of REGISTRY) {
    for (const path of [
      `/${g.id}`, `/${g.id}/issues`, `/${g.id}/issues/3f9adeadbeef`,
      `/${g.id}/reports`, `/${g.id}/reports/${id}`,
      `/${g.id}/sessions`, `/${g.id}/sessions/open-1`, `/${g.id}/sessions/open-1/campaign`,
    ]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, `${path} should serve the portal`);
      assert.match(res.headers.get("content-type"), /text\/html/, path);
    }
  }
});

test("a game nobody registered is a 404 rather than an empty portal", async () => {
  // The failure has to be loud. A link to a game with no entry drawing a
  // blank page looks exactly like a game with no crashes, and those are
  // opposite things to learn.
  for (const path of ["/not-a-game/issues", "/not-a-game", "/test-harness/sessions"]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 404, `${path} names no registered game`);
    assert.match(res.headers.get("content-type"), /application\/json/, path);
  }
});

test("the registry is served, with what has actually turned up against it", async () => {
  const res = await fetch(`${base}/v1/games`);
  assert.equal(res.status, 200);
  const { games, unregistered } = await res.json();
  assert.equal(games.length, REGISTRY.length, "one row per entry");
  const mike = games.find((g) => g.id === "mining-mike");
  assert.ok(mike, "the first game is in it");
  assert.equal(mike.path, "/mining-mike", "carrying the path its pages live under");
  assert.equal(typeof mike.reports, "number", "and how much it has posted");

  // This file posts under several game names that have no entry. They are
  // listed rather than hidden, because the list is the answer to "what should
  // somebody write an entry for next".
  assert.ok(Array.isArray(unregistered));
  assert.ok(unregistered.some((u) => u.id === PAGED),
    "a game with reports and no entry is named, not dropped");
});

test("an address that is not one of them is still a JSON 404", async () => {
  for (const path of ["/nonsense", "/issues/a/b", "/reports/one/two", "/sessions/a/b/c/d"]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 404, `${path} is not a view`);
    // The page routes sit ALONGSIDE the API, not over it. A mistyped API call
    // answered with a page is a much worse afternoon than the other way round.
    assert.match(res.headers.get("content-type"), /application\/json/, path);
  }
  const api = await fetch(`${base}/v1/reports`);
  assert.match(api.headers.get("content-type"), /application\/json/, "/v1 still answers in JSON");
});

// The page half of it. The script is compiled with the browser objects it
// expects handed in, then asked for its routing functions: what is on screen
// turned into an address, and an address turned back into what to draw. A
// shared link is those two agreeing, so they are worth running rather than
// reading.
function router(pathname, search = "") {
  // The page ships two scripts: the registry, then the code that draws with
  // it. Take the LAST, and hand it the registry the way the browser would.
  const scripts = [...adminPage().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const src = scripts[scripts.length - 1];
  const el = () => ({
    innerHTML: "", style: {}, setAttribute() {}, select() {}, remove() {},
    querySelectorAll: () => [],
  });
  const doc = { title: "", getElementById: el, createElement: el, body: { appendChild() {} }, addEventListener() {} };
  const loc = { pathname, search, href: "http://test" + pathname + search };
  // The script is written as a page, so it draws itself on load. A fetch that
  // never settles is what keeps that first draw from reaching any of these
  // stubs - by the time it is waiting, the routing has already happened.
  const load = new Function(
    "document", "location", "history", "sessionStorage", "navigator", "fetch",
    "addEventListener", "setTimeout", "GAMES",
    src + "\n;return { state, href, to, readUrl, GAMES," +
      " effectAt, upgradeName, upgradeArt, upgradeTip," +
      " picksOf, buildOrder, pickTip, runPlace," +
      " statsCard, statPair, statPlot, statRows, statChange, statValue };",
  );
  return load(
    doc, loc, { pushState() {} },
    { getItem: () => "", setItem() {}, removeItem() {} },
    {}, () => new Promise(() => {}), () => {}, () => {},
    registryForPage(),
  );
}

// The same compile, asked for what it draws rather than where it goes.
const portal = () => router("/mining-mike/upgrades");

test("an address opens the view it names", () => {
  const cases = [
    ["/", { view: "signatures", signature: "", session: "", report: null }],
    ["/admin", { view: "signatures" }],
    ["/issues", { view: "signatures", signature: "" }],
    ["/issues/3f9a", { view: "reports", signature: "3f9a" }],
    ["/reports", { view: "reports", report: null }],
    ["/reports/abc-123", { view: "reports", report: "abc-123" }],
    ["/sessions", { view: "runs", session: "", mode: "" }],
    ["/sessions/sess-a", { view: "runs", session: "sess-a", mode: "" }],
    ["/sessions/sess-a/campaign", { view: "runs", session: "sess-a", mode: "campaign" }],
    // A mode with no session to hang it on is not a view.
    ["/sessions//campaign", { view: "runs", session: "campaign", mode: "" }],
  ];
  for (const [path, want] of cases) {
    const { state } = router(path);
    for (const [k, v] of Object.entries(want)) {
      assert.equal(state[k], v, `${path} should set ${k} to ${JSON.stringify(v)}`);
    }
  }
});

test("and the view hands back the address it was opened on", () => {
  const paths = [
    "/issues", "/issues/3f9a", "/reports", "/reports/abc-123",
    "/sessions", "/sessions/sess-a", "/sessions/sess-a/campaign",
  ];
  for (const path of paths) {
    const { state, href } = router(path);
    assert.equal(href(state), path, "a view's address must survive the round trip");
  }
});

test("a registered game is a path, so the link says which game out loud", () => {
  const { state, href, to } = router("/mining-mike/sessions");
  assert.equal(state.game, "mining-mike", "the leading segment is the game");
  assert.equal(state.view, "runs", "and the rest of the path is read as it always was");
  assert.equal(href(state), "/mining-mike/sessions", "round trips");
  assert.equal(to({ view: "reports", signature: "3f9a" }), "/mining-mike/issues/3f9a",
    "and it rides along into every view from there");
});

test("every registered game round trips through its own path", () => {
  for (const g of REGISTRY) {
    for (const tail of ["/issues", "/reports", "/sessions"]) {
      const path = "/" + g.id + tail;
      const { state, href } = router(path);
      assert.equal(state.game, g.id, path + " should name " + g.id);
      assert.equal(href(state), path, path + " should round trip");
    }
  }
});

test("a game with no entry is still readable, as a filter rather than a path", () => {
  // Ingest takes any `game` string on purpose, so reports arrive from things
  // nobody has written an entry for. Inventing a path for one would mean the
  // router could not tell it from a typo, so it keeps the query form.
  const { state, href } = router("/sessions", "?game=test-harness");
  assert.equal(state.game, "test-harness");
  assert.equal(href(state), "/sessions?game=test-harness");

  // And the segment is NOT read as a game, because it is not one.
  const stray = router("/test-harness/sessions");
  assert.equal(stray.state.game, "", "an unregistered segment names no game");
});

test("no game at all is every game, which is the unprefixed path", () => {
  const { state, href, to } = router("/issues");
  assert.equal(state.game, "");
  assert.equal(href(state), "/issues");
  assert.equal(to({ view: "runs" }), "/sessions", "and stays unprefixed on the way in");
});

test("a session id that needs escaping still makes an address", () => {
  const { to } = router("/sessions");
  assert.equal(to({ view: "runs", session: "a/b" }), "/sessions/a%2Fb");
  assert.equal(router("/sessions/a%2Fb").state.session, "a/b", "and comes back whole");
  // Nonsense in the path is a view, not a crash: the default one.
  assert.equal(router("/sessions/%E0%A4%A").state.view, "signatures");
});

test("a session is one row, with its length and how it ended", async () => {
  const post = (body) => fetch(`${base}/v1/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  // A session that played two campaign depths, won one, lost one, then died.
  await post({ game: "pt", kind: "session", message: "played for 20m",
    session: "sess-a", context: { session_sec: 1200, mode: "campaign" } });
  await post({ game: "pt", kind: "run", message: "succeeded at depth 1",
    session: "sess-a", context: { mode: "campaign", outcome: "succeeded", depth: 1, run_seconds: 438 } });
  await post({ game: "pt", kind: "run", message: "failed at depth 2",
    session: "sess-a", context: { mode: "campaign", outcome: "failed", depth: 2, run_seconds: 351 } });
  // The crash that ends it is posted by the NEXT launch, carrying the dead
  // session's id. That is what makes "ended in a crash" knowable at all.
  await post({ game: "pt", kind: "crash", message: "Game did not shut down cleanly",
    session: "sess-a", context: { detected_by: "session marker", session_sec: 1400 } });

  const { sessions } = await fetch(`${base}/v1/sessions?game=pt`).then((r) => r.json());
  const a = sessions.find((s) => s.session === "sess-a");
  assert.ok(a, "the session should be listed");
  assert.equal(a.seconds, 1400, "length is the furthest the game clocked, not the report spread");
  assert.equal(a.runs, 2);
  assert.equal(a.succeeded, 1);
  assert.equal(a.failed, 1);
  assert.equal(a.quit, 0);
  assert.equal(a.ended_in_crash, 1, "the marker crash marks the session as crashed");
  assert.equal(a.modes, "campaign");
});

test("a session that closed normally is not marked as crashed", async () => {
  await fetch(`${base}/v1/reports`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "pt", kind: "session", message: "played for 5m",
      session: "sess-b", context: { session_sec: 300, mode: "survival" } }),
  });
  const { sessions } = await fetch(`${base}/v1/sessions?game=pt`).then((r) => r.json());
  const b = sessions.find((s) => s.session === "sess-b");
  assert.equal(b.ended_in_crash, 0);
  assert.equal(b.seconds, 300);
  assert.equal(b.modes, "survival");
});

test("runs drill down by session, then by mode", async () => {
  await fetch(`${base}/v1/reports`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "pt", kind: "run", message: "quit survival",
      session: "sess-a", context: { mode: "survival", outcome: "quit", depth: 0, run_seconds: 90 } }),
  });

  const all = await fetch(`${base}/v1/runs?session=sess-a`).then((r) => r.json());
  assert.equal(all.runs.length, 3, "every run in the session");

  const camp = await fetch(`${base}/v1/runs?session=sess-a&mode=campaign`).then((r) => r.json());
  assert.equal(camp.runs.length, 2, "only the campaign ones");
  assert.ok(camp.runs.every((r) => r.mode === "campaign"));

  const surv = await fetch(`${base}/v1/runs?session=sess-a&mode=survival`).then((r) => r.json());
  assert.equal(surv.runs.length, 1);
  assert.equal(surv.runs[0].outcome, "quit");
});

test("a session reports both clocks, and they are different numbers", async () => {
  const post = (b) => fetch(`${base}/v1/reports`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b),
  });
  // Ninety minutes open, twenty of them inside runs. The gap is the shell, and
  // reporting only one of these loses it.
  await post({ game: "clocks", kind: "session", message: "open 90m, 20m in game",
    session: "sess-clock", context: { session_sec: 5400, played_sec: 1200, mode: "campaign" } });

  const { sessions } = await fetch(`${base}/v1/sessions?game=clocks`).then((r) => r.json());
  const c = sessions.find((s) => s.session === "sess-clock");
  assert.equal(c.seconds, 5400, "the whole time the exe was up");
  assert.equal(c.played, 1200, "and the part of it inside a run");
  assert.ok(c.played < c.seconds, "play time cannot exceed app-open time");
});

test("a session with no runs reports open time and zero play time", async () => {
  await fetch(`${base}/v1/reports`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ game: "clocks", kind: "session", message: "open 9m",
      session: "sess-menus", context: { session_sec: 546, played_sec: 0 } }),
  });
  const { sessions } = await fetch(`${base}/v1/sessions?game=clocks`).then((r) => r.json());
  const m = sessions.find((s) => s.session === "sess-menus");
  assert.equal(m.seconds, 546);
  assert.equal(m.played, 0, "nine minutes of shell, and the table should say so");
});

// ---------------------------------------------------------------------------
// Upgrade art, and the hover card it sits in.
//
// The point of all of this is that a row says what the thing IS, not just how
// often it was taken - and everything it says comes from the game's entry, so
// the checks below are on the entry and on the drawing, never on the game.

test("upgrade art is served, and only where there is art to serve", async () => {
  const entry = REGISTRY.find((g) => g.id === "mining-mike");
  const [withArt] = Object.entries(entry.upgrades.meta).find(([, m]) => m.icon);
  const [without] = Object.entries(entry.upgrades.meta).find(([, m]) => !m.icon);

  const res = await fetch(`${base}${entry.upgrades.icons}/${withArt}.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  const body = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "and it is really a PNG");

  // An upgrade the game has no art for is a 404 and not a zero-byte image, so
  // the page's lettered tile is the only thing that ever stands in for it.
  const missing = await fetch(`${base}${entry.upgrades.icons}/${without}.png`);
  assert.equal(missing.status, 404);
});

// fetch() tidies a path before it puts it on the wire, and the URL parser on
// the way in tidies it again, so a traversal typed into fetch is not one by
// the time anything sees it. This writes the bytes as given.
function rawGet(path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1", () => {
      sock.write("GET " + path + " HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    });
    let out = "";
    sock.setEncoding("utf8");
    sock.on("data", (c) => { out += c; });
    sock.on("end", () => resolve(out));
    sock.on("error", reject);
  });
}

test("the icon route serves icons and nothing else", async () => {
  for (const path of [
    "/assets/icons/mining-mike/../../../package.json",
    "/assets/icons/../../package.json",
    "/assets/icons/mining-mike/..%2f..%2f..%2fpackage.json",
    "/assets/icons/mining-mike/%2e%2e/%2e%2e/package.json",
    // Not traversals, just outside the one spelling: a second extension, a
    // capital, a space in the game id.
    "/assets/icons/mining-mike/max_health.png.png",
    "/assets/icons/mining-mike/MAX_HEALTH.png",
    "/assets/icons/mining%20mike/max_health.png",
  ]) {
    const raw = await rawGet(path);
    assert.match(raw.split("\r\n")[0], /^HTTP\/1\.1 404 /, `${path} must not be served`);
    assert.ok(!raw.includes("better-sqlite3"), "and must not leak a file either");
  }

  // These two ARE served, and are here to say why the route can get away with
  // being a shape: the URL parser resolves . and .. before anything here sees
  // the path, so a dotted spelling arrives as the icon itself rather than as
  // something to work out. Nothing in the route does path arithmetic, because
  // by the time it runs there is none left to do.
  for (const path of [
    "/assets/icons/mining-mike/../mining-mike/max_health.png",
    "/assets/icons/./mining-mike/max_health.png",
    "/assets/icons/mining-mike/max_health.png",
  ]) {
    const raw = await rawGet(path);
    assert.match(raw.split("\r\n")[0], /^HTTP\/1\.1 200 /, `${path} is the icon`);
  }
});

test("the page is allowed to load its own images and nobody else's", async () => {
  const res = await fetch(`${base}/mining-mike/upgrades`);
  const csp = res.headers.get("content-security-policy");
  assert.match(csp, /img-src 'self'/, "art on the page needs saying so here");
  assert.match(csp, /default-src 'none'/, "and everything else stays shut");
});

test("every claim of art is a file, and every file is claimed", () => {
  for (const g of REGISTRY) {
    if (!g.upgrades || !g.upgrades.meta) continue;
    // The directory the ENTRY names, not one guessed from the game id: those
    // two agreeing is a convention and this test is about the other thing.
    const dir = new URL(".." + g.upgrades.icons + "/", import.meta.url);
    const claimed = Object.entries(g.upgrades.meta)
      .filter(([, m]) => m.icon).map(([key]) => key + ".png").sort();
    const onDisk = existsSync(dir) ? readdirSync(dir).sort() : [];
    // Both directions. A claim with no file is a broken image on the page; a
    // file with no claim is art somebody drew and the page never shows.
    assert.deepEqual(onDisk, claimed, `${g.id}: art on disk and art in the entry must agree`);
  }
});

test("an effect is written out at the level it is asked about", () => {
  const { effectAt } = portal();
  // [per level, flat], so level 3 of [25, 0] is 75.
  assert.equal(effectAt(["+25 Max HP (+{0} total)", [25, 0]], 3), "+25 Max HP (+75 total)");
  // Two numbers, each its own pair, and the flat part is not multiplied.
  assert.equal(effectAt(["Deal {0} DPS in {1}px radius", [8, 0], [30, 60]], 2),
    "Deal 16 DPS in 120px radius");
  assert.equal(effectAt(["Fire {0} projectiles in a spread", [1, 2]], 1),
    "Fire 3 projectiles in a spread");
  // The registry is the only source of these, and a game with none still draws.
  assert.equal(effectAt(null, 3), "");
});

test("the hover card says what the thing is, at the level people reach", () => {
  const { upgradeTip } = portal();
  const entry = REGISTRY.find((g) => g.id === "mining-mike");
  const tip = upgradeTip(
    { upgrade: "max_health", runs: 8, succeeded: 2, failed: 5, died: 0, quit: 1,
      levels: [1, 2, 3, 3, 4, 5, 3, 2] },
    entry.upgrades, false,
  );
  assert.match(tip, /Vitality/, "the name a player would recognise");
  assert.match(tip, /max_health/, "and the key, for anybody reading the JSON");
  assert.match(tip, /\+75 total/, "the effect at the level typically reached");
  assert.match(tip, /\+125 total/, "and at its ceiling, which is what it is worth chasing for");
  assert.match(tip, /1 to 5/, "the spread of levels behind that");
  assert.match(tip, /succeeded/, "and how the runs that took it ended");
  assert.match(tip, /25%/, "as a share, since eight runs is a denominator");
  // died is zero and is left out.
  assert.ok(!/>died</.test(tip), "an outcome nobody hit is not a row");

  // A clear is the exception. "succeeded 0" is the most useful line this card
  // has, and it cannot be one that only appears when the news is good.
  const never = upgradeTip(
    { upgrade: "turret_damage", runs: 9, succeeded: 0, failed: 9, died: 0, quit: 0,
      levels: [5, 5, 5, 5, 5, 5, 5, 5, 5] },
    entry.upgrades, false,
  );
  assert.match(never, />succeeded</, "nine runs, no clears, and the card says so");
  assert.match(never, /typically 5/, "and that they all took it to the ceiling");
});

test("a clear rate needs a denominator worth dividing by", () => {
  const { upgradeTip } = portal();
  const entry = REGISTRY.find((g) => g.id === "mining-mike");
  const two = upgradeTip(
    { upgrade: "max_health", runs: 2, succeeded: 2, failed: 0, died: 0, quit: 0, levels: [1, 2] },
    entry.upgrades, false,
  );
  assert.ok(!/100%/.test(two), "two runs that cleared are two runs, not a 100% clear rate");
  assert.match(two, /succeeded/);
  const three = upgradeTip(
    { upgrade: "max_health", runs: 3, succeeded: 3, failed: 0, died: 0, quit: 0, levels: [1, 2, 3] },
    entry.upgrades, false,
  );
  assert.match(three, /100%/, "three is where the tally starts printing shares, and this agrees");
});

test("an upgrade with no art draws a tile instead of a broken image", () => {
  const { upgradeArt } = portal();
  const entry = REGISTRY.find((g) => g.id === "mining-mike");
  const [withArt] = Object.entries(entry.upgrades.meta).find(([, m]) => m.icon);
  const [without] = Object.entries(entry.upgrades.meta).find(([, m]) => !m.icon);
  assert.match(upgradeArt(entry.upgrades, withArt), /<img class="up-icon"/);
  assert.ok(!/<img/.test(upgradeArt(entry.upgrades, without)), "no art means no <img> at all");
  assert.match(upgradeArt(entry.upgrades, without), /class="up-tile"/);
  // A game that has written no vocabulary gets the same page, one tile per row.
  assert.match(upgradeArt({ path: "x" }, "some_key"), /class="up-tile"/);
});

test("the vocabulary is checked, and the check is checked", () => {
  const ok = { path: "mech.upgrades", icons: "/assets/icons/x", meta: {} };
  const bad = (meta, over = {}) => () => checkUpgrades({ id: "x", upgrades: { ...ok, ...over, meta } });

  // Every one of these draws a page that looks fine and reads wrong, which is
  // why they are refused at import rather than left to be noticed.
  assert.throws(bad({ a: { effect: ["says {1}", [1, 0]] } }), /\{1\}/, "a slot with no number for it");
  assert.throws(bad({ a: { effect: ["says {0}", [1, 0], [2, 0]] } }), /nothing says/, "a number no slot shows");
  assert.throws(bad({ a: { effect: ["says {0}", 5] } }), /pair/, "a number that is not a pair");
  assert.throws(bad({ a: { effect: ["says {0}", [1, "x"]] } }), /pair/, "a pair that is not numbers");
  assert.throws(bad({ "../etc": { name: "n" } }), /file name/, "a key that is not a file name");
  assert.throws(bad({ a: { icon: true } }, { icons: undefined }), /no icons path/, "art with nowhere to load it from");
  assert.throws(bad({ a: {} }, { icons: "https://elsewhere.example" }), /not a path/, "art from somewhere else");
  assert.throws(bad({ a: {} }, { icons: "/v1" }), /not a path/, "art at an address the API already owns");

  // And the shapes that are right stay right.
  assert.doesNotThrow(bad({ a: { name: "A", max: 3, icon: true, effect: ["says {0} and {1}", [1, 0], [0, 9]] } }));
  assert.doesNotThrow(bad({ a: { name: "A" } }), "vocabulary without an effect is allowed");
});

test("the vocabulary is on the page, and on the route that draws a tally", async () => {
  // It used to be held back from the page and fetched by the one view that
  // drew it. Three views name an upgrade now - the tally, a run's build order
  // and a session's - so the page carries it once instead of three fetches
  // and a cache keeping them honest.
  const onPage = JSON.stringify(registryForPage());
  assert.ok(onPage.includes("Vitality"), "the page can name an upgrade without asking");
  assert.ok(onPage.includes("mech.upgrades"));

  // And /v1/upgrades still hands over the whole field, because the tally is
  // drawn from its answer rather than from the page's copy.
  const res = await fetch(`${base}/v1/upgrades?game=mining-mike`);
  const body = await res.json();
  assert.equal(body.upgrades.meta.max_health.name, "Vitality");
  assert.equal(body.upgrades.icons, "/assets/icons/mining-mike");
});

// ---------------------------------------------------------------------------
// The build order: one run's picks, in the order they were taken.
//
// The tally says what got built. This says HOW, and the level on each mark is
// not in the data - it is the count of that key so far, which is true by
// construction and cannot drift from the levels the same run reports.

const PICKED = "picks-fixture";

async function postRun(session, context) {
  const res = await fetch(`${base}/v1/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      game: "mining-mike", version: "1.0.0", kind: "run",
      message: "failed at depth 2", session, context,
    }),
  });
  assert.equal(res.status, 201);
  return (await res.json()).id;
}

test("a pick's level is the count of that key so far", () => {
  const { picksOf } = portal();
  const up = REGISTRY.find((g) => g.id === "mining-mike").upgrades;
  const picks = picksOf([
    { key: "max_health", wave: 1, at_sec: 20 },
    { key: "armor", wave: 3, at_sec: 65 },
    { key: "max_health", wave: 5, at_sec: 120 },
    { key: "max_health", wave: 7, at_sec: 180 },
  ], up);
  assert.deepEqual(picks.map((p) => p.key + " " + p.level),
    ["max_health 1", "armor 1", "max_health 2", "max_health 3"]);
  assert.deepEqual(picks.map((p) => p.at), [20, 65, 120, 180]);
  assert.deepEqual(picks.map((p) => p.wave), [1, 3, 5, 7]);
});

test("a pick list the entry does not describe is no list at all", () => {
  const { picksOf } = portal();
  const up = REGISTRY.find((g) => g.id === "mining-mike").upgrades;
  // A game that sends no picks, and a game whose entry says nothing about
  // them. Both draw nothing rather than a row of marks with no upgrade on it.
  assert.deepEqual(picksOf(undefined, up), []);
  assert.deepEqual(picksOf([{ key: "armor", at_sec: 1 }], { path: "x" }), []);
  // And junk inside the list is skipped rather than drawn.
  assert.equal(picksOf([null, 7, "armor", { at_sec: 4 }, { key: "armor", at_sec: 9 }], up).length, 1);
});

test("a mark sits at the share of the run it was taken at", () => {
  const { buildOrder } = portal();
  const up = REGISTRY.find((g) => g.id === "mining-mike").upgrades;
  const picks = [
    { key: "armor", level: 1, at: 0, wave: 1 },
    { key: "armor", level: 2, at: 150, wave: 5 },
    { key: "dodge", level: 1, at: 300, wave: 9 },
  ];
  const html = buildOrder(picks, 300, up, false);
  assert.match(html, /left:0%/, "a pick at the start sits at the start");
  assert.match(html, /left:50%/, "halfway through a five minute run is halfway along");
  assert.match(html, /left:100%/);
  // The axis is THIS run's length, so it is printed rather than implied.
  assert.match(html, /5m 00s/);
  assert.match(html, /3 picks/);

  // The same three picks in a run twice as long sit in the first half of it.
  const longer = buildOrder(picks, 600, up, false);
  assert.match(longer, /left:25%/, "not rescaled to the last pick");
  assert.ok(!/left:100%/.test(longer), "the axis is the run, not the picks");
});

test("a run whose length never arrived still has an order", () => {
  const { buildOrder } = portal();
  const up = REGISTRY.find((g) => g.id === "mining-mike").upgrades;
  const html = buildOrder([
    { key: "armor", level: 1, at: 30, wave: 1 },
    { key: "dodge", level: 1, at: 90, wave: 4 },
  ], 0, up, false);
  assert.match(html, /left:100%/, "the last pick becomes the end of the axis");
  // And says so, because the axis then means something weaker than usual.
  assert.match(html, /~1m 30s/);
});

test("a mark's card says what that pick did, at the level that pick bought", () => {
  const { pickTip } = portal();
  const up = REGISTRY.find((g) => g.id === "mining-mike").upgrades;
  const tip = pickTip({ key: "max_health", level: 3, at: 245, wave: 6 }, up, "centred");
  assert.match(tip, /Vitality/);
  assert.match(tip, /\+75 total/, "the effect at level 3, not at the level the run ended on");
  assert.match(tip, /\+125 total/, "and at its ceiling");
  assert.match(tip, /4m 05s/, "when it was taken");
  assert.match(tip, /wave/);
  assert.match(tip, />6</);
  assert.match(tip, /lvl 3 <span class="dim">of 5/);
});

test("a card near an end of the axis opens towards the middle", () => {
  const { buildOrder } = portal();
  const up = REGISTRY.find((g) => g.id === "mining-mike").upgrades;
  const html = buildOrder([
    { key: "armor", level: 1, at: 0, wave: 1 },
    { key: "dodge", level: 1, at: 50, wave: 5 },
    { key: "ice", level: 1, at: 100, wave: 9 },
  ], 100, up, false);
  // 340px of card hung off either end of the track otherwise, and which end a
  // mark is near is only knowable here, where the position is.
  assert.match(html, /up-tip from-left/);
  assert.match(html, /up-tip centred/);
  assert.match(html, /up-tip from-right/);
});

test("the runs route carries the picks when it is told which game", async () => {
  const id = await postRun(PICKED, {
    mode: "campaign", outcome: "failed", depth: 2, sector_title: "Meridian",
    run_seconds: 240, wave_number: 6,
    upgrade_picks: [
      { key: "max_health", wave: 2, at_sec: 40 },
      { key: "max_health", wave: 6, at_sec: 160 },
    ],
  });

  const named = await (await fetch(`${base}/v1/runs?game=mining-mike&session=${PICKED}`)).json();
  const run = named.runs.find((r) => r.id === id);
  assert.equal(run.picks.length, 2, "read through the path the registry gave");
  assert.equal(run.picks[0].key, "max_health");
  assert.equal(run.picks[0].at_sec, 40, "and handed over as JSON, not as a string of it");

  // Without a game there is no single answer to where the picks are, so the
  // column is absent rather than empty: a run that reported none and a list
  // nobody asked for should not look the same.
  const all = await (await fetch(`${base}/v1/runs?session=${PICKED}`)).json();
  assert.ok(!("picks" in all.runs.find((r) => r.id === id)), "no game named, no picks column");
});

test("a picks field that is not a list is not a 500", async () => {
  // Context is whatever the game sent, and a reporter mid-change can send the
  // wrong shape. The page should draw no timeline; the service should not fall
  // over on the way to telling it so.
  for (const bad of ["not a list", 7, { key: "armor" }]) {
    const id = await postRun(PICKED + "-bad", {
      mode: "campaign", outcome: "quit", run_seconds: 60, upgrade_picks: bad,
    });
    const res = await fetch(`${base}/v1/runs?game=mining-mike&session=${PICKED}-bad`);
    assert.equal(res.status, 200);
    const run = (await res.json()).runs.find((r) => r.id === id);
    assert.deepEqual(run.picks, [], `${JSON.stringify(bad)} should read as no picks`);
  }
});

test("a half-filled picks entry is refused at import", () => {
  const ok = { path: "mech.upgrades", picks: { path: "upgrade_picks", key: "key", at: "at_sec" } };
  const bad = (picks) => () => checkUpgrades({ id: "x", upgrades: { ...ok, picks } });
  // Two of the three field names missing draws a row of marks with no time and
  // no upgrade on them, which reads as a page bug rather than an entry that
  // was half filled in.
  assert.throws(bad({ path: "p", at: "at_sec" }), /no key field/);
  assert.throws(bad({ path: "p", key: "key" }), /no at field/);
  assert.doesNotThrow(bad({ path: "p", key: "key", at: "at_sec" }));
  // The wave is genuinely optional: a game with no waves still has an order.
  assert.doesNotThrow(bad({ path: "p", key: "key", at: "at_sec", wave: "wave" }));
});

// ---------------------------------------------------------------------------
// Before and after: what the run did to the mech.
//
// The end alone is a number with nothing to divide by. These check that the
// card subtracts rather than derives, that a shared axis is only ever drawn
// over a shared unit, and that half a pair is never dressed up as a whole one.

function statsFixture(over = {}) {
  const end = {
    dps: 310, dps_around: 32.8, dps_air: 0,
    damage: 17, shots: 2, interval: 0.27, crit_chance: 0.1, pierce: 1,
    burn_dps: 0, slow: 0.3, chain: 2, hull: 225, speed: 390, reach: 800,
    level: 8, chassis: "Generalist", weapon: "Blaster",
  };
  const start = {
    dps: 53, dps_around: 0, dps_air: 0,
    damage: 8, shots: 1, interval: 0.42, crit_chance: 0, pierce: 0,
    burn_dps: 0, slow: 0, chain: 0, hull: 100, speed: 320, reach: 600,
    level: 1, chassis: "Generalist", weapon: "Blaster",
  };
  return { mech: { stats: { start, end, ...over } } };
}

test("the card leads with the change, not with the end", () => {
  const { statsCard } = portal();
  const html = statsCard(statsFixture(), "mining-mike");
  assert.match(html, /53/, "what it dropped in with");
  assert.match(html, /310/, "what it finished as");
  assert.match(html, /\+257/, "and the difference, which is the point");
  assert.match(html, /5\.8 times over/);
  // Never colour alone: the direction is a word as well as a sign.
  assert.match(html, /gained/);
});

test("a rise from nothing has no multiple", () => {
  const { statChange } = portal();
  // Dividing by zero produces infinity, which is not a finding.
  assert.equal(statChange(0, 63).times, null);
  assert.equal(statChange(0, 63).diff, 63);
  assert.equal(statChange(53, 310).times, 5.8);
  assert.equal(statChange(200, 100).diff, -100);
  assert.equal(statChange(200, 100).down, true);
  assert.equal(statChange("x", 3), null, "a figure that is not a number has no change");

  // The difference is between the numbers PRINTED, not between the raw ones.
  // The first draft rounded 309.6 to 310 for display and subtracted 309.6, so
  // a card read "53 to 310" beside "+256.6" and the subtraction did not come
  // out for anybody who tried it.
  const { statValue } = portal();
  assert.equal(statValue(309.6), "310");
  assert.equal(statChange(53, 309.6).diff, 257, "310 minus 53, which is what the card shows");
});

test("the dumbbell puts every figure on the one scale its unit earns", () => {
  const { statPlot } = portal();
  const spec = REGISTRY.find((g) => g.id === "mining-mike").stats;
  const { mech } = statsFixture();
  const html = statPlot(spec, mech.stats.start, mech.stats.end);
  // 310 is the largest figure across BOTH ends, so it is the full width and
  // everything else is drawn against it. A per-row scale would draw
  // "0 to 32.8" and "53 to 310" the same length, which is the lie.
  assert.match(html, /ba-after" style="left:100%/);
  const around = html.slice(html.indexOf("around it"));
  assert.match(around, /ba-after" style="left:10\.5/, "32.8 of 310 is a tenth of the track");
  // Both numbers printed beside every row, so nobody has to tell two blues
  // apart to read it.
  assert.match(html, /53 <span class="ba-arrow">&rarr;<\/span> <b>310<\/b>/);
});

test("a figure with no unit to share never gets on the axis", () => {
  const { statPlot } = portal();
  const spec = REGISTRY.find((g) => g.id === "mining-mike").stats;
  const { mech } = statsFixture();
  const html = statPlot(spec, mech.stats.start, mech.stats.end);
  // interval is 0.27 seconds and reach is 800 pixels. On a DPS axis they are
  // a dot at zero and a dot off the end, and both would be nonsense.
  assert.ok(!/interval/.test(html));
  assert.ok(!/reach/.test(html));
  // They are rows instead, which claim no scale at all.
  const { statRows } = portal();
  const rows = statRows(spec, mech.stats.start, mech.stats.end);
  assert.match(rows, /0\.42s <span class="ba-arrow">&rarr;<\/span> 0\.27s/);
  assert.match(rows, /600px <span class="ba-arrow">&rarr;<\/span> 800px/);
  assert.match(rows, /0% <span class="ba-arrow">&rarr;<\/span> 10%/, "a fraction reads as a percentage");
});

test("a figure the run did not move says so rather than vanishing", () => {
  const { statRows } = portal();
  const spec = REGISTRY.find((g) => g.id === "mining-mike").stats;
  const { mech } = statsFixture();
  const rows = statRows(spec, mech.stats.start, mech.stats.end);
  // "nothing changed" is an answer; a missing row is not.
  assert.match(rows, /ba-cell ba-same/);
  assert.match(rows, /burn dps/);
  assert.match(rows, /Generalist/, "and a chassis that stayed put prints once");
  assert.ok(!/Generalist <span class="ba-arrow">/.test(rows), "not as a change to itself");
});

test("half a pair is not dressed up as a whole one", () => {
  const { statsCard, statPair } = portal();
  const spec = REGISTRY.find((g) => g.id === "mining-mike").stats;
  const { mech } = statsFixture();

  // A run from a build that only reported the end. The card still draws, and
  // says what it is missing rather than inventing a start equal to the end,
  // which would read as a run that changed nothing.
  const onlyEnd = { mech: { stats: { end: mech.stats.end } } };
  const html = statsCard(onlyEnd, "mining-mike");
  assert.match(html, /310/);
  assert.match(html, /only the mech it finished as/);
  assert.ok(!/\+/.test(html.slice(html.indexOf("ba-delta"))) || !/ba-delta/.test(html),
    "no delta without something to subtract");
  assert.ok(!/as it dropped in/.test(html), "and no legend for a mark it does not draw");

  // No end at all is not a before-and-after in any sense.
  assert.equal(statPair({ mech: { stats: { start: mech.stats.start } } }, "mining-mike"), null);
  assert.equal(statPair({ mech: {} }, "mining-mike"), null);
  assert.equal(statsCard({ mech: {} }, "mining-mike"), "");
  // And a game whose entry describes no such readout draws nothing.
  assert.equal(statPair(mech, "no-such-game"), null);
});

test("a flat stats block is the end, because that is what one end looks like", () => {
  const { statPair, statsCard } = portal();
  // Copied off a real report on the live service. The first reporter to send
  // these sent them FLAT, and that is what every run already collected carries,
  // so this is the shape that matters most and the one the card missed: it drew
  // for a fixture shaped {end: ...} and drew nothing at all for this.
  const live = { mech: { stats: {
    burn_dps: 0, chain: 8, chassis: "Combat", crit_chance: 0, damage: 27,
    dps: 189, dps_air: 0, dps_around: 2309, hull: 185, interval: 0.14,
    level: 28, pierce: 0, reach: 720, shots: 1, slow: 0.64, speed: 200,
    weapon: "Autocannon",
  } } };
  const pair = statPair(live, "mining-mike");
  assert.ok(pair, "a flat block is a readout, not a malformed one");
  assert.equal(pair.after.dps, 189, "and it is the END: the mech as the run finished");
  assert.equal(pair.before, null, "with no start to compare it against");

  const html = statsCard(live, "mining-mike");
  assert.match(html, /189/, "the headline draws");
  assert.match(html, /2309/, "and so does the rest of the readout");
  assert.match(html, /Autocannon/);
  assert.match(html, /only the mech it finished as/, "and it says which end it has");
  assert.ok(!/as it dropped in/.test(html), "no legend for a mark it cannot draw");
});

test("a start with no end is still not a comparison", () => {
  const { statPair } = portal();
  const { mech } = statsFixture();
  // A run that opened and never reported finishing. Nested, so it is read as
  // nested, and then there is nothing to compare against.
  assert.equal(statPair({ mech: { stats: { start: mech.stats.start } } }, "mining-mike"), null);
});

test("an axis that claims a shared scale has to name the unit", () => {
  const base = { path: "mech.stats", before: "start", after: "end" };
  const bad = (over) => () => checkStats({ id: "x", stats: { ...base, ...over } });
  // Three quantities of different kinds on one scale is a chart that lies
  // about all three, and the unit is how an entry says it meant the claim.
  assert.throws(bad({ axis: { rows: [["dps", "on target"]] } }), /no unit/);
  assert.throws(bad({ axis: { unit: "dps" } }), /no rows/);
  assert.throws(bad({ lead: "dps" }), /needs an axis/);
  assert.throws(bad({ unit: "dps", lead: "dps", axis: { unit: "dps", rows: [["hull", "hull"]] } }),
    /not one of the figures on the axis/);
  assert.throws(bad({ before: "end" }), /the same key/);
  assert.throws(bad({ path: "a-b" }), /not a context path/);
  assert.doesNotThrow(bad({ lead: "dps", axis: { unit: "dps", rows: [["dps", "on target"]] } }));
  assert.doesNotThrow(() => checkStats({ id: "x" }), "a game with no such readout is fine");
});
