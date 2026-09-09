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

// The table, as data rather than as one SQL string, because it is read twice:
// once to create the table on a fresh volume and once to work out what an
// EXISTING volume is missing. `CREATE TABLE IF NOT EXISTS` does nothing at all
// to a table that is already there, so a column added in a later version never
// appears on a volume that predates it - the app then crash-loops on boot with
// "table reports has no column named player" while the deploy itself reports
// success. That happened on the first volume this app ever had.
const COLUMNS = [
  ["id", "TEXT PRIMARY KEY"],
  ["received_at", "INTEGER NOT NULL DEFAULT 0"],
  ["game", "TEXT NOT NULL DEFAULT ''"],
  ["version", "TEXT NOT NULL DEFAULT ''"],
  ["kind", "TEXT NOT NULL DEFAULT ''"],
  ["signature", "TEXT NOT NULL DEFAULT ''"],
  ["title", "TEXT NOT NULL DEFAULT ''"],
  ["message", "TEXT NOT NULL DEFAULT ''"],
  ["stack", "TEXT NOT NULL DEFAULT ''"],
  ["log", "TEXT NOT NULL DEFAULT ''"],
  ["platform", "TEXT NOT NULL DEFAULT ''"],
  ["gpu", "TEXT NOT NULL DEFAULT ''"],
  ["engine", "TEXT NOT NULL DEFAULT ''"],
  ["session", "TEXT NOT NULL DEFAULT ''"],
  // An HMAC of whatever id the client sent, never the id itself. See
  // identity.js for why the raw one is not welcome here.
  ["player", "TEXT NOT NULL DEFAULT ''"],
  ["context", "TEXT NOT NULL DEFAULT '{}'"],
];

// Bring an older database up to the current shape. Only additive: SQLite can
// add a column to a populated table in place, so an existing row simply gets
// the default and keeps its data. Nothing here drops or rewrites anything,
// which is the property that makes it safe to run unconditionally on boot.
function addMissingColumns(db) {
  const present = new Set(db.prepare("PRAGMA table_info(reports)").all().map((c) => c.name));
  const added = [];
  for (const [name, type] of COLUMNS) {
    if (present.has(name)) continue;
    // A primary key cannot be added after the fact, and a reports table with
    // no `id` is not a reports table. Louder than a silent bad query later.
    if (type.includes("PRIMARY KEY")) {
      throw new Error(`reports table exists but has no ${name} column; it is not one of ours`);
    }
    db.exec(`ALTER TABLE reports ADD COLUMN ${name} ${type}`);
    added.push(name);
  }
  if (added.length > 0) {
    console.log(`[reporting] schema: added ${added.join(", ")} to an existing database`);
  }
  return added;
}

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
      ${COLUMNS.map(([name, type]) => `${name} ${type}`).join(",\n      ")}
    );
  `);
  addMissingColumns(db);
  db.exec(`
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
    signatures({ game, limit = 50, kinds } = {}) {
      const args = { limit: Math.min(Math.max(1, limit), 200) };
      // Faults only unless the caller says otherwise. Run summaries arrive on
      // the same endpoint and share the table, but they are not things that
      // went wrong, and grouping them as issues would put "cleared at depth 2"
      // at the top of a crash list.
      const wanted = kinds && kinds.length > 0 ? kinds : ["crash", "error", "warning"];
      const placeholders = wanted.map((_, i) => `@kind${i}`);
      wanted.forEach((k, i) => { args[`kind${i}`] = k; });
      const where = [`kind IN (${placeholders.join(", ")})`];
      if (game) {
        where.push("game = @game");
        args.game = game;
      }
      const filter = "WHERE " + where.join(" AND ");
      return db
        .prepare(`
          SELECT signature,
                 COUNT(*)                AS count,
                 MIN(received_at)        AS first_seen,
                 MAX(received_at)        AS last_seen,
                 COUNT(DISTINCT session) AS sessions,
                 COUNT(DISTINCT CASE WHEN player <> '' THEN player END) AS players,
                 -- The depth span, read out of the context JSON. This is the
                 -- column that changes how the list gets used: a crash only
                 -- ever seen at depth 3 is a lead, and one seen everywhere is
                 -- not. SQLite reads JSON in place, so nothing had to be
                 -- promoted to a real column to sort on it.
                 MIN(json_extract(context, '$.depth')) AS depth_min,
                 MAX(json_extract(context, '$.depth')) AS depth_max,
                 MIN(json_extract(context, '$.difficulty_wave')) AS wave_min,
                 MAX(json_extract(context, '$.difficulty_wave')) AS wave_max,
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

    // Run summaries, newest first. Separate from list() because a run is not a
    // fault and the columns worth seeing are different ones: how it ended, how
    // long it took, how far it got.
    runs({ game, limit = 100 } = {}) {
      const args = { limit: Math.min(Math.max(1, limit), 500) };
      let filter = "WHERE kind = 'run'";
      if (game) {
        filter += " AND game = @game";
        args.game = game;
      }
      return db
        .prepare(`
          SELECT id, received_at, game, version, message,
                 json_extract(context, '$.outcome')     AS outcome,
                 json_extract(context, '$.depth')       AS depth,
                 json_extract(context, '$.sector_title') AS sector,
                 json_extract(context, '$.run_seconds') AS seconds,
                 json_extract(context, '$.wave_number') AS wave,
                 json_extract(context, '$.kills')       AS kills,
                 json_extract(context, '$.credits')     AS credits,
                 json_extract(context, '$.mech.level')  AS mech_level,
                 player
          FROM reports
          ${filter}
          ORDER BY received_at DESC
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
