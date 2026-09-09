// The failure this covers is not hypothetical: the first deploy onto a real
// volume crash-looped on boot with
//
//   SqliteError: table reports has no column named player
//
// because the volume already held a `reports` table from an earlier build and
// `CREATE TABLE IF NOT EXISTS` is a no-op against one. Nothing in the suite
// caught it, because every other test starts from an empty directory and an
// empty directory always gets the current schema.
//
// So this test starts from an OLD one, deliberately.

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDatabase } from "../src/db.js";

// The schema as it was before `player` and `context` existed, written by hand
// rather than imported so that changing the current one cannot quietly change
// what "old" means here.
function makeOldDatabase(dir) {
  const db = new Database(join(dir, "reports.db"));
  db.exec(`
    CREATE TABLE reports (
      id          TEXT PRIMARY KEY,
      received_at INTEGER NOT NULL,
      game        TEXT NOT NULL,
      version     TEXT NOT NULL DEFAULT '',
      kind        TEXT NOT NULL,
      signature   TEXT NOT NULL,
      title       TEXT NOT NULL DEFAULT '',
      message     TEXT NOT NULL DEFAULT '',
      stack       TEXT NOT NULL DEFAULT '',
      log         TEXT NOT NULL DEFAULT '',
      platform    TEXT NOT NULL DEFAULT '',
      gpu         TEXT NOT NULL DEFAULT '',
      engine      TEXT NOT NULL DEFAULT '',
      session     TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare(`
    INSERT INTO reports (id, received_at, game, version, kind, signature, title, message, session)
    VALUES ('old-1', 1000, 'legacy', '0.9.0', 'crash', 'sig-old', 'An older crash',
            'it happened before the column existed', 'session-old')
  `).run();
  db.close();
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "reporting-migrate-"));
}

test("an older database gains the columns it is missing", () => {
  const dir = tempDir();
  makeOldDatabase(dir);

  const store = openDatabase(dir);
  const columns = new Set(store.db.prepare("PRAGMA table_info(reports)").all().map((c) => c.name));
  assert.ok(columns.has("player"), "player should have been added");
  assert.ok(columns.has("context"), "context should have been added");
  store.close();
});

test("and keeps the rows that were already in it", () => {
  const dir = tempDir();
  makeOldDatabase(dir);

  const store = openDatabase(dir);
  const row = store.get("old-1");
  assert.equal(row.title, "An older crash");
  assert.equal(row.version, "0.9.0");
  // The added columns take their defaults rather than null, which is what the
  // `players` count in signatures() relies on to not miscount.
  assert.equal(row.player, "");
  assert.equal(row.context, "{}");
  store.close();
});

test("and takes a new report, which is the boot that used to fail", () => {
  const dir = tempDir();
  makeOldDatabase(dir);

  const store = openDatabase(dir);
  store.insert({
    id: "new-1",
    received_at: 2000,
    game: "test",
    version: "1.0.0",
    kind: "crash",
    signature: "sig-new",
    title: "A newer crash",
    message: "after the migration",
    stack: "",
    log: "",
    platform: "Linux",
    gpu: "",
    engine: "4.7.2",
    session: "session-new",
    player: "abcdef0123456789",
    context: "{}",
  });
  assert.equal(store.count(), 2);

  const groups = store.signatures({});
  const fresh = groups.find((g) => g.signature === "sig-new");
  assert.equal(fresh.players, 1);
  const legacy = groups.find((g) => g.signature === "sig-old");
  assert.equal(legacy.players, 0, "a row from before the column knows no player");
  store.close();
});

test("running twice adds nothing the second time", () => {
  const dir = tempDir();
  makeOldDatabase(dir);
  openDatabase(dir).close();

  const store = openDatabase(dir);
  const columns = store.db.prepare("PRAGMA table_info(reports)").all().map((c) => c.name);
  assert.equal(new Set(columns).size, columns.length, "no column should be duplicated");
  store.close();
});

test("a fresh directory still gets the whole schema in one go", () => {
  const store = openDatabase(tempDir());
  const columns = new Set(store.db.prepare("PRAGMA table_info(reports)").all().map((c) => c.name));
  for (const name of ["id", "received_at", "game", "version", "kind", "signature", "title",
                      "message", "stack", "log", "platform", "gpu", "engine", "session",
                      "player", "context"]) {
    assert.ok(columns.has(name), `${name} missing from a fresh database`);
  }
  store.close();
});
