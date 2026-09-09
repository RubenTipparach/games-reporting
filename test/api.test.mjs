// Drives the real server over real HTTP on a temp database. Nothing is
// stubbed: if these pass, `fly deploy` is deploying something that works.
//
//   npm test

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RateLimiter } from "../src/ratelimit.js";

const dir = mkdtempSync(join(tmpdir(), "reporting-test-"));
process.env.DATA_DIR = dir;
process.env.INGEST_KEY = "ingest-secret";
process.env.ADMIN_KEY = "admin-secret";
// Generous, so no ordinary test is throttled by the ones before it. The
// throttling itself is driven deliberately, at the bottom.
process.env.RATE_BURST = "500";
process.env.RATE_PER_MINUTE = "500";
process.env.MAX_BODY_BYTES = "2048";

const { server, store, limiter, tail } = await import("../src/server.js");

const base = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
});

test.after(() => {
  server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function post(body, key = "ingest-secret", headers = {}) {
  return fetch(`${base}/v1/reports`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function adminGet(path, key = "admin-secret") {
  return fetch(`${base}${path}`, { headers: { "x-api-key": key } });
}

const crash = {
  game: "mining-mike",
  version: "1.2.3",
  kind: "crash",
  message: "Invalid access to property 'text' on a base object of type 'null instance'",
  stack: "at: res://scripts/hud.gd:3312 @ update_hud()\nat: res://scripts/main.gd:1842 @ _process_body()",
  log: "line one\nline two\nthe last line",
  platform: "Windows",
  gpu: "NVIDIA GeForce RTX 3070",
  engine: "4.7.2",
  session: "session-a",
  context: { sector: 0, depth: 3, wave: 21 },
};

test("healthz answers without a key", async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test("a report needs the ingest key", async () => {
  assert.equal((await post(crash, "wrong")).status, 401);
  assert.equal((await post(crash, "")).status, 401);
});

test("a report is stored and comes back with an id and a signature", async () => {
  const res = await post(crash);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.match(body.id, /^[0-9a-f-]{36}$/);
  assert.match(body.signature, /^[0-9a-f]{16}$/);

  const one = await (await adminGet(`/v1/reports/${body.id}`)).json();
  assert.equal(one.game, "mining-mike");
  assert.equal(one.version, "1.2.3");
  assert.equal(one.kind, "crash");
  assert.equal(one.platform, "Windows");
  assert.equal(one.log, crash.log);
  assert.equal(JSON.parse(one.context).wave, 21);
  // The title is what a list shows, so it must not be empty.
  assert.ok(one.title.length > 0);
});

test("the same bug from two machines groups under one signature", async () => {
  const a = await (await post({ ...crash, session: "s1" })).json();
  // Same fault, different build, different line numbers after an edit above
  // it, different machine. Still one bug.
  const b = await (await post({
    ...crash,
    version: "1.3.0",
    session: "s2",
    stack: "at: res://scripts/hud.gd:3400 @ update_hud()\nat: res://scripts/main.gd:1900 @ _process_body()",
  })).json();
  assert.equal(a.signature, b.signature);

  const different = await (await post({
    ...crash,
    message: "Something else entirely went wrong",
    stack: "at: res://scripts/player.gd:12 @ _ready()",
  })).json();
  assert.notEqual(a.signature, different.signature);
});

test("signatures roll up with a count and the versions they were seen on", async () => {
  const { signatures } = await (await adminGet("/v1/signatures?game=mining-mike")).json();
  const top = signatures.find((s) => s.count > 1);
  assert.ok(top, "expected at least one repeated signature");
  assert.ok(top.count >= 2);
  assert.ok(top.sessions >= 2, "distinct sessions are counted");
  assert.ok(top.last_seen >= top.first_seen);
  assert.ok(top.versions.includes("1.2.3"));
});

test("reading anything back needs the admin key, and the ingest key will not do", async () => {
  assert.equal((await adminGet("/v1/reports", "ingest-secret")).status, 401);
  assert.equal((await adminGet("/v1/signatures", "nope")).status, 401);
  assert.equal((await adminGet("/v1/reports")).status, 200);
});

test("a report without a game or without any content is refused", async () => {
  assert.equal((await post({ message: "no game field" })).status, 400);
  assert.equal((await post({ game: "mining-mike" })).status, 400);
  assert.equal((await post("not json at all")).status, 400);
  assert.equal((await post([1, 2, 3])).status, 400);
});

test("an oversized body is refused rather than buffered", async () => {
  const res = await post({ ...crash, log: "x".repeat(8192) });
  assert.equal(res.status, 413);
});

test("a long log is kept by its tail, the end with the crash in it", () => {
  assert.equal(tail("short", 100), "short", "under the cap, nothing is touched");
  assert.equal(tail("AAAAAAAAAABBBBBBBBBB", 10), "BBBBBBBBBB", "over it, the END survives");
  assert.equal(tail(undefined, 10), "");
});

test("a log that fits is stored whole", async () => {
  const { id } = await (await post({ ...crash, log: "first\nmiddle\nlast" })).json();
  const one = await (await adminGet(`/v1/reports/${id}`)).json();
  assert.equal(one.log, "first\nmiddle\nlast");
});

test("a flood from one address is throttled, with a Retry-After to back off by", async () => {
  // Drained on purpose rather than by hammering the socket, so this asserts
  // the limiter's behaviour instead of asserting how fast the test host is.
  while (limiter.allow("127.0.0.1")) { /* spend the bucket */ }
  const limited = await post(crash);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  // Handed back so nothing after this pays for it.
  limiter.buckets.clear();
  assert.equal((await post(crash)).status, 201);
});

test("the bucket refills over time rather than latching shut", () => {
  const rl = new RateLimiter({ burst: 2, perMinute: 60 });
  const t0 = 1_000_000;
  assert.equal(rl.allow("ip", t0), true);
  assert.equal(rl.allow("ip", t0), true);
  assert.equal(rl.allow("ip", t0), false, "burst of 2 is spent");
  assert.equal(rl.allow("ip", t0 + 1000), true, "a second later, one token back");
  assert.equal(rl.allow("ip", t0 + 1000), false);
  // A different caller is unaffected by this one's spending.
  assert.equal(rl.allow("other", t0 + 1000), true);
});

test("idle buckets are swept so one-off callers cannot grow the map forever", () => {
  const rl = new RateLimiter({ burst: 2, perMinute: 60 });
  const t0 = 1_000_000;
  rl.allow("gone", t0);
  rl.allow("here", t0);
  assert.equal(rl.buckets.size, 2);
  rl.allow("here", t0 + 60_000);
  rl.sweep(t0 + 60_000);
  assert.ok(!rl.buckets.has("gone"), "the idle one went");
  assert.ok(rl.buckets.has("here"), "the active one stayed");
});

test("an unknown route is a 404 rather than a stack trace", async () => {
  assert.equal((await fetch(`${base}/v1/nope`)).status, 404);
});
