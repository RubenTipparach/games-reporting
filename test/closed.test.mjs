// The other half of the ingest decision: what happens once INGEST_KEY is set.
//
// A separate file because the choice is read once at boot, so it cannot be
// flipped inside a running server without lying about how it actually works.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "reporting-closed-"));
process.env.DATA_DIR = dir;
process.env.INGEST_KEY = "the-future-key";
process.env.ADMIN_KEY = "admin-secret";
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

const body = { game: "high-frontier", kind: "error", message: "locked down now" };

function post(key) {
  return fetch(`${base}/v1/reports`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}) },
    body: JSON.stringify(body),
  });
}

test("setting INGEST_KEY closes posting, with no code change", async () => {
  assert.equal((await post()).status, 401, "no key");
  assert.equal((await post("wrong")).status, 401, "wrong key");
  assert.equal((await post("the-future-key")).status, 201, "the key");
});

test("and the admin key is not a way in either", async () => {
  assert.equal((await post("admin-secret")).status, 401);
});
