import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// One SQLite file on the Fly volume.
//
// Not Postgres, and the reason is scale rather than taste: an indie game's
// crash reports arrive at a few an hour on a bad day. SQLite on a mounted
// volume handles that with no second service to pay for, no connection string
// to rotate and no network hop between the API and its data. What it cannot do
// is run on two machines at once, so this app is deliberately a single machine
// (see fly.toml). If it ever needs to be two, this is the file that changes.

export function openDatabase(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "reports.db"));

  // WAL so a long read (the dashboard listing everything) does not block an
  // incoming report. NORMAL rather than FULL: losing the last few reports to a
  // hard power cut is an acceptable trade for not fsyncing on every insert,
  // because a lost crash report is a crash that gets reported again next time.
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
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
      session     TEXT NOT NULL DEFAULT '',
      -- An HMAC of whatever id the client sent, never the id itself. See
      -- identity.js for why the raw one is not welcome here.
      player      TEXT NOT NULL DEFAULT '',
      context     TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS reports_received ON reports (received_at DESC);
    CREATE INDEX IF NOT EXISTS reports_signature ON reports (signature, received_at DESC);
    CREATE INDEX IF NOT EXISTS reports_game ON reports (game, received_at DESC);
  `);

  const stmts = {
    insert: db.prepare(`
      INSERT INTO reports (id, received_at, game, version, kind, signature, title,
                           message, stack, log, platform, gpu, engine, session, player, context)
      VALUES (@id, @received_at, @game, @version, @kind, @signature, @title,
              @message, @stack, @log, @platform, @gpu, @engine, @session, @player, @context)
    `),
    get: db.prepare("SELECT * FROM reports WHERE id = ?"),
    del: db.prepare("DELETE FROM reports WHERE id = ?"),
    count: db.prepare("SELECT COUNT(*) AS n FROM reports"),
    prune: db.prepare("DELETE FROM reports WHERE received_at < ?"),
  };

  return {
    db,

    insert(row) {
      stmts.insert.run(row);
      return row;
    },

    get(id) {
      return stmts.get.get(id);
    },

    remove(id) {
      return stmts.del.run(id).changes > 0;
    },

    count() {
      return stmts.count.get().n;
    },

    // The listing. Filters are optional and compose; `before` is the cursor,
    // which is the received_at of the last row of the previous page, so paging
    // cannot skip or repeat a row when new reports land mid-read the way an
    // OFFSET would.
    list({ game, kind, signature, before, limit = 50 } = {}) {
      const where = [];
      const args = {};
      if (game) {
        where.push("game = @game");
        args.game = game;
      }
      if (kind) {
        where.push("kind = @kind");
        args.kind = kind;
      }
      if (signature) {
        where.push("signature = @signature");
        args.signature = signature;
      }
      if (before) {
        where.push("received_at < @before");
        args.before = before;
      }
      args.limit = Math.min(Math.max(1, limit), 200);
      const sql = `
        SELECT id, received_at, game, version, kind, signature, title,
               platform, gpu, engine, session, player
        FROM reports
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY received_at DESC
        LIMIT @limit
      `;
      return db.prepare(sql).all(args);
    },

    // One row per distinct crash, which is the view worth opening first: what
    // is happening, how often, since when, and on which builds.
    signatures({ game, limit = 50 } = {}) {
      const args = { limit: Math.min(Math.max(1, limit), 200) };
      let filter = "";
      if (game) {
        filter = "WHERE game = @game";
        args.game = game;
      }
      return db
        .prepare(`
          SELECT signature,
                 COUNT(*)                AS count,
                 MIN(received_at)        AS first_seen,
                 MAX(received_at)        AS last_seen,
                 COUNT(DISTINCT session) AS sessions,
                 COUNT(DISTINCT CASE WHEN player <> '' THEN player END) AS players,
                 GROUP_CONCAT(DISTINCT version) AS versions,
                 MAX(game)               AS game,
                 MAX(kind)               AS kind,
                 MAX(title)              AS title
          FROM reports
          ${filter}
          GROUP BY signature
          ORDER BY last_seen DESC
          LIMIT @limit
        `)
        .all(args);
    },

    // Retention. Returns how many went, so the caller can log something true.
    prune(olderThanMs) {
      return stmts.prune.run(olderThanMs).changes;
    },

    close() {
      db.close();
    },
  };
}
