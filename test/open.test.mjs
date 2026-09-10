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
import { mkdtempSync, rmSync } from "node:fs";
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
// Paging the two top-level lists.
//
// The cursor is (sort key, tiebreak) rather than the sort key alone, and these
// exist because the sort key alone lost rows. Nothing here waits or sleeps: the
// ties are made by posting a burst, which is how they occur in the wild.

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
async function walk(path, key, pageSize, extra = {}) {
  const seen = [];
  let cursor;
  let pages = 0;
  for (;;) {
    const q = new URLSearchParams({ game: PAGED, limit: String(pageSize), ...extra });
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

test("a burst of reports shares timestamps, which is what the cursor has to survive", async () => {
  await postBurst(60, (i) => ({ kind: "error", message: "burst " + i }));
  const all = await fetch(`${base}/v1/reports?game=${PAGED}&limit=200`).then((r) => r.json());
  assert.equal(all.reports.length, 60);

  const perMs = new Map();
  for (const r of all.reports) perMs.set(r.received_at, (perMs.get(r.received_at) || 0) + 1);
  assert.ok(perMs.size < 60,
    "sixty reports posted at once should land on fewer than sixty milliseconds; " +
    "if they ever do not, this test has stopped covering the thing it was written for");
});

test("paging reports keeps every row exactly once, ties and all", async () => {
  const { seen, pages } = await walk("/v1/reports", "reports", 7);
  assert.ok(pages > 1, "seven at a time should take several pages");
  assert.equal(seen.length, 60, "every report comes back");
  assert.equal(new Set(seen.map((r) => r.id)).size, 60, "and none of them twice");
});

test("the cursor by timestamp alone is still accepted, and still loses rows", async () => {
  // The shape the first version of this documented. Kept working so a script
  // written against it does not break, and asserted to be lossy so nobody
  // mistakes it for the one to use.
  const seen = new Set();
  let before;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ game: PAGED, limit: "7" });
    if (before !== undefined) q.set("before", String(before));
    const { reports } = await fetch(`${base}/v1/reports?${q}`).then((r) => r.json());
    if (!reports.length) break;
    for (const r of reports) seen.add(r.id);
    const last = reports[reports.length - 1].received_at;
    if (last === before) break;
    before = last;
  }
  assert.ok(seen.size < 60,
    "paging by timestamp alone skips whatever shared the last row's millisecond");
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

test("the issue rollup pages too, and its ties are the same problem", async () => {
  // Distinct faults, so these are distinct signatures rather than one group.
  await postBurst(40, (i) => ({
    kind: "crash",
    message: "Nonexistent function 'fn_" + i + "' in base 'Panel'",
    stack: "at: res://scripts/mod_" + i + ".gd:" + (100 + i) + " @ _refresh_" + i + "()",
  }));
  const all = await fetch(`${base}/v1/signatures?game=${PAGED}&limit=200`).then((r) => r.json());
  const total = all.signatures.length;
  assert.ok(total >= 40, "each distinct fault is its own issue");

  const perMs = new Map();
  for (const s of all.signatures) perMs.set(s.last_seen, (perMs.get(s.last_seen) || 0) + 1);
  assert.ok(perMs.size < total, "and they share last_seen values, being one burst");

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
  const src = adminPage().match(/<script>([\s\S]*?)<\/script>/)[1];
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
    "addEventListener", "setTimeout",
    src + "\n;return { state, href, to, readUrl };",
  );
  return load(
    doc, loc, { pushState() {} },
    { getItem: () => "", setItem() {}, removeItem() {} },
    {}, () => new Promise(() => {}), () => {}, () => {},
  );
}

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

test("the game filter rides along, so a shared link is filtered as the screen was", () => {
  const { state, href, to } = router("/sessions", "?game=mining-mike");
  assert.equal(state.game, "mining-mike");
  assert.equal(href(state), "/sessions?game=mining-mike");
  assert.equal(to({ view: "reports", signature: "3f9a" }), "/issues/3f9a?game=mining-mike");
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
