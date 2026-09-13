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

// How big a page each listing hands back, and how big a caller may ask for.
// Exported because the routes clamp with these too: the route needs the same
// number the query used to tell whether a full page means there is more behind
// it, and two copies of that number is one copy too many.
export const PAGE = {
  reports:    { fallback: 50,  max: 200 },
  signatures: { fallback: 50,  max: 200 },
  runs:       { fallback: 100, max: 500 },
  sessions:   { fallback: 100, max: 500 },
};

// A limit from a query string: absent, empty or nonsense means the default
// rather than an error, since a bad ?limit= is not worth refusing a read over.
export function pageLimit(asked, { fallback, max }) {
  const n = Number(asked);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

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

    // The listing. Filters are optional and compose, and `before` plus
    // `beforeId` are the cursor: the received_at AND the id of the last row of
    // the previous page. Both, because received_at is not unique.
    //
    // It used to be the timestamp alone, and that quietly dropped rows. Sixty
    // reports posted at once land on about twenty seven distinct milliseconds,
    // and asking for everything strictly older than the last row's timestamp
    // skips whatever else shared it: paging that burst returned 53 of the 60.
    // A log scrape uploading a backlog is exactly that shape.
    //
    // The pair is unique because the id is, so the order is total and every
    // row sits in exactly one page.
    list({ game, kind, signature, before, beforeId, limit = 50 } = {}) {
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
        args.before = before;
        if (beforeId) {
          // Strictly older, or the same instant and further down the tie.
          where.push("(received_at < @before OR (received_at = @before AND id < @beforeId))");
          args.beforeId = beforeId;
        } else {
          // A caller paging by timestamp alone, which is what the first
          // version of this documented. Still honoured, still able to skip a
          // tie - which is why nothing in this repo pages that way any more.
          where.push("received_at < @before");
        }
      }
      args.limit = Math.min(Math.max(1, limit), PAGE.reports.max);
      const sql = `
        SELECT id, received_at, game, version, kind, signature, title,
               platform, gpu, engine, session, player
        FROM reports
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY received_at DESC, id DESC
        LIMIT @limit
      `;
      return db.prepare(sql).all(args);
    },

    // One row per distinct crash, which is the view worth opening first: what
    // is happening, how often, since when, and on which builds.
    signatures({ game, limit = 50, kinds, before, beforeId } = {}) {
      const args = { limit: Math.min(Math.max(1, limit), PAGE.signatures.max) };
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
      // The cursor for a rollup has to be a HAVING, not a WHERE: last_seen is
      // MAX(received_at), which does not exist until the rows are grouped. The
      // signature is the GROUP BY key and so is unique per row, which makes
      // (last_seen, signature) a total order the same way (received_at, id) is
      // for the listing above.
      const having = before
        ? (beforeId
            ? "HAVING (MAX(received_at) < @before OR (MAX(received_at) = @before AND signature < @beforeId))"
            : "HAVING MAX(received_at) < @before")
        : "";
      if (before) args.before = before;
      if (before && beforeId) args.beforeId = beforeId;
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
          ${having}
          ORDER BY last_seen DESC, signature DESC
          LIMIT @limit
        `)
        .all(args);
    },

    // Run summaries, newest first. Separate from list() because a run is not a
    // fault and the columns worth seeing are different ones: how it ended, how
    // long it took, how far it got.
    runs({ game, session, mode, limit = 100 } = {}) {
      const args = { limit: Math.min(Math.max(1, limit), PAGE.runs.max) };
      let filter = "WHERE kind = 'run'";
      if (game) {
        filter += " AND game = @game";
        args.game = game;
      }
      // The two drill-down steps: into one session, then into one mode.
      if (session) {
        filter += " AND session = @session";
        args.session = session;
      }
      if (mode) {
        filter += " AND json_extract(context, '$.mode') = @mode";
        args.mode = mode;
      }
      return db
        .prepare(`
          SELECT id, received_at, game, version, message,
                 session,
                 json_extract(context, '$.mode')        AS mode,
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

    // One row per play session: who, how long, what they played, how it ended.
    //
    // Length is MAX(session_sec) rather than last_seen - first_seen, because
    // the second measures when reports happened to arrive and the first is
    // what the game actually clocked. A session that sends one report at
    // minute 90 is ninety minutes long, not zero.
    //
    // A session ENDED IN A CRASH if any report for it was raised from the
    // session marker - that report is posted by the NEXT launch and carries
    // the dead session's id, which is exactly what makes this knowable.
    // `now` and `staleAfter` are passed in rather than read from a clock in
    // here, so the same rows can be asked about at a chosen instant - which is
    // what makes liveness testable without waiting five minutes for it.
    sessions({ game, limit = 100, now = Date.now(), staleAfter = 600_000 } = {}) {
      const args = {
        limit: Math.min(Math.max(1, limit), PAGE.sessions.max),
        now,
        staleAfter,
      };
      let filter = "WHERE session <> ''";
      if (game) {
        filter += " AND game = @game";
        args.game = game;
      }
      return db
        .prepare(`
          SELECT session,
                 MAX(game)                   AS game,
                 MAX(version)                AS version,
                 MAX(player)                 AS player,
                 MIN(received_at)            AS first_seen,
                 MAX(received_at)            AS last_seen,
                 -- Two clocks, deliberately. The first is the whole time the
                 -- executable was up, menus and all; the second is the part of
                 -- it spent inside a run. The gap between them is the shell,
                 -- and a session that is ninety minutes open with twenty
                 -- minutes of runs in it says something no single number does.
                 MAX(COALESCE(json_extract(context, '$.session_sec'), 0)) AS seconds,
                 MAX(COALESCE(json_extract(context, '$.played_sec'), 0))  AS played,
                 MAX(COALESCE(json_extract(context, '$.channel'), '')) AS channel,
                 -- What they played. A session can hold both, so this is the
                 -- set rather than a single value.
                 GROUP_CONCAT(DISTINCT json_extract(context, '$.mode')) AS modes,
                 SUM(CASE WHEN kind = 'run' THEN 1 ELSE 0 END) AS runs,
                 SUM(CASE WHEN json_extract(context, '$.outcome') = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
                 SUM(CASE WHEN json_extract(context, '$.outcome') = 'failed'    THEN 1 ELSE 0 END) AS failed,
                 SUM(CASE WHEN json_extract(context, '$.outcome') = 'quit'      THEN 1 ELSE 0 END) AS quit,
                 SUM(CASE WHEN kind IN ('crash','error') THEN 1 ELSE 0 END) AS faults,
                 -- STILL RUNNING, or over. A session cannot report its own end
                 -- - a clean quit is the process leaving and a crash is the
                 -- process gone - so the only evidence either way is the
                 -- check-in, and the only reading of it is the absence. Inside
                 -- the window the game is still there; past it, it is not.
                 CASE WHEN @now - MAX(received_at) < @staleAfter
                      THEN 1 ELSE 0 END AS live,
                 -- When the last thing we heard was heard, so a caller can say
                 -- "4m ago" about a live session without a second query.
                 @now - MAX(received_at) AS silent_for,
                 -- Ended in a crash only if the crash was the LAST WORD.
                 --
                 -- This used to be "a marker crash exists anywhere in this
                 -- session", and that is not the same claim. A marker crash is
                 -- posted by a LATER launch that found a marker file lying
                 -- about, and a second copy of the game started while the
                 -- first is still open finds exactly that - so a session that
                 -- ran for ten more hours after the marker was read was being
                 -- reported as having died at the start of it. The check-ins
                 -- that came afterwards are the refutation, and they are right
                 -- there in the same rows.
                 CASE WHEN MAX(CASE WHEN json_extract(context, '$.detected_by') = 'session marker'
                                    THEN received_at END) IS NOT NULL
                       AND COALESCE(MAX(CASE WHEN kind = 'session' THEN received_at END), 0)
                           < MAX(CASE WHEN json_extract(context, '$.detected_by') = 'session marker'
                                      THEN received_at END)
                      THEN 1 ELSE 0 END AS ended_in_crash
          FROM reports
          ${filter}
          GROUP BY session
          ORDER BY last_seen DESC
          LIMIT @limit
        `)
        .all(args);
    },

    // WHAT PLAYERS BUILT, tallied across runs.
    //
    // The upgrades live in the context as a map of name to level, at a path the
    // GAME'S REGISTRY ENTRY names - so this counts Mining Mike's mech upgrades
    // and would count another game's perks without a line changing. json_each
    // walks the map, which is what lets a set of upgrades nobody enumerated in
    // advance be grouped at all.
    //
    // A row per upgrade, the outcomes of the runs that took it, and every level
    // it was taken at. Levels come back as a list rather than an average
    // because the median is the honest middle of a handful of runs and SQLite
    // has no median function; the caller takes it.
    upgradeTally({ game, path, sector, depth }) {
      if (!game || !path) return { runs: 0, taken: [], never: [] };
      const json = "$." + path;
      const args = { game, json };
      let filter = "WHERE r.kind = 'run' AND r.game = @game";
      if (sector) {
        filter += " AND json_extract(r.context, '$.sector_title') = @sector";
        args.sector = sector;
      }
      if (depth !== undefined && depth !== null && depth !== "") {
        filter += " AND json_extract(r.context, '$.depth') = @depth";
        args.depth = Number(depth);
      }

      // Runs that carried a build at all, which is the denominator. A run
      // reported before the game started sending them is not a run where
      // nobody took anything.
      const runs = db.prepare(`
        SELECT COUNT(*) AS n FROM reports r
        ${filter} AND json_extract(r.context, @json) IS NOT NULL
      `).get(args).n;

      const rows = db.prepare(`
        SELECT u.key AS upgrade,
               COUNT(*) AS runs,
               SUM(CASE WHEN json_extract(r.context, '$.outcome') = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
               SUM(CASE WHEN json_extract(r.context, '$.outcome') = 'failed'    THEN 1 ELSE 0 END) AS failed,
               SUM(CASE WHEN json_extract(r.context, '$.outcome') = 'died'      THEN 1 ELSE 0 END) AS died,
               SUM(CASE WHEN json_extract(r.context, '$.outcome') = 'quit'      THEN 1 ELSE 0 END) AS quit,
               GROUP_CONCAT(u.value) AS levels
        FROM reports r, json_each(json_extract(r.context, @json)) u
        ${filter} AND u.value > 0
        GROUP BY u.key
        ORDER BY runs DESC, u.key
      `).all(args);

      // Every name the game has ever mentioned, so the ones NOBODY took can be
      // named. An upgrade that is never picked is the loudest thing this page
      // has to say, and it is invisible if the page only lists what was.
      const known = db.prepare(`
        SELECT DISTINCT u.key AS upgrade
        FROM reports r, json_each(json_extract(r.context, @json)) u
        ${filter}
      `).all(args).map((r) => r.upgrade);

      const taken = new Set(rows.map((r) => r.upgrade));
      return {
        runs,
        taken: rows.map((r) => ({
          upgrade: r.upgrade,
          runs: r.runs,
          succeeded: r.succeeded,
          failed: r.failed,
          died: r.died,
          quit: r.quit,
          levels: String(r.levels || "").split(",").filter(Boolean).map(Number),
        })),
        never: known.filter((k) => !taken.has(k)).sort(),
      };
    },

    // The places runs happened, for the filter chips above the tally.
    runPlaces({ game }) {
      if (!game) return [];
      return db.prepare(`
        SELECT DISTINCT json_extract(context, '$.sector_title') AS sector
        FROM reports
        WHERE kind = 'run' AND game = @game
          AND json_extract(context, '$.sector_title') IS NOT NULL
        ORDER BY sector
      `).all({ game }).map((r) => r.sector);
    },

    // Which games have actually posted, and how much. The registry says what
    // this service KNOWS about; this says what has turned up, and the gap
    // between the two is the list of games somebody should add an entry for.
    gameCounts() {
      const rows = db.prepare("SELECT game, COUNT(*) AS n FROM reports GROUP BY game").all();
      return Object.fromEntries(rows.map((r) => [r.game, r.n]));
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
