// Everything the service reads from its environment, in one place, so a
// deployment is a list of `fly secrets set` lines rather than a search.

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: int("PORT", 8080),

  // The Fly volume. A machine with no volume mounted still runs, on a database
  // under the container's own filesystem, which is wiped on every deploy - so
  // the mount is checked at boot and shouted about rather than assumed.
  dataDir: process.env.DATA_DIR || "/data",

  // Two keys, deliberately. The ingest key ships inside the game build and can
  // therefore be pulled out of it by anyone who cares to look, so it may only
  // ever write. The admin key reads and deletes and never leaves your machine.
  // An empty ingest key means "no key required", which is for local runs only;
  // the server refuses to start that way unless ALLOW_ANONYMOUS_INGEST is set.
  ingestKey: process.env.INGEST_KEY || "",
  adminKey: process.env.ADMIN_KEY || "",
  allowAnonymousIngest: process.env.ALLOW_ANONYMOUS_INGEST === "1",

  // A report is a few KB of log tail. A quarter of a megabyte is generous for
  // that and small enough that a hostile client cannot fill the volume with
  // one request.
  maxBodyBytes: int("MAX_BODY_BYTES", 256 * 1024),
  // What is kept of the log itself, after the body cap. The tail is the part
  // with the crash in it.
  maxLogChars: int("MAX_LOG_CHARS", 64 * 1024),

  // Per IP, refilled continuously. A player who crashes twice in a minute is
  // real; a hundred posts a minute from one address is not.
  rateBurst: int("RATE_BURST", 20),
  ratePerMinute: int("RATE_PER_MINUTE", 10),

  // Reports older than this are swept. Long enough to still be looking at a
  // release two months after it shipped.
  retentionDays: int("RETENTION_DAYS", 90),
  // How often the sweeper runs.
  pruneIntervalMs: int("PRUNE_INTERVAL_MS", 6 * 60 * 60 * 1000),
};
