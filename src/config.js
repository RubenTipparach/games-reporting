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

  // Posting a report is OPEN, on purpose and for now. Setting INGEST_KEY at
  // any point closes it without a code change: the check below is written so
  // the key is enforced when there is one and skipped when there is not, so
  // locking this down later is one `fly secrets set` and a game update, in
  // that order.
  //
  // Open means the rate limit and the body cap are doing the whole job of
  // keeping this from being a free write endpoint for anyone who finds it.
  // Those are not optional while it stays this way.
  ingestKey: process.env.INGEST_KEY || "",

  // Reading is never open. This one guards the admin portal and every route
  // that returns what players have sent, and it never leaves your machine.
  adminKey: process.env.ADMIN_KEY || "",

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
