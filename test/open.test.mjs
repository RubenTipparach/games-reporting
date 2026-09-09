// The portal with no ADMIN_KEY set, which is how it is deployed right now:
// make it work first, lock it down later. api.test.mjs covers the same routes
// WITH a key, so between them both halves of the decision are pinned.
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

test("but deleting is OFF, not open", async () => {
  const res = await fetch(`${base}/v1/reports/${id}`, { method: "DELETE" });
  assert.equal(res.status, 403);
  const { error } = await res.json();
  assert.match(error, /ADMIN_KEY/);
  assert.equal(store.count(), 1, "and the report is still there");
});

test("the portal is served, and does not gate on arrival", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  // The gate exists in the page, for when a key IS set. What must NOT be there
  // any more is the early return that put it up before asking the service.
  assert.ok(!html.includes('if (!key) return gate("")'), "the page must not gate before it has asked");
});
