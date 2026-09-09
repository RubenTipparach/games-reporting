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
