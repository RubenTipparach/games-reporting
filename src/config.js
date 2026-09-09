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

  // The other half of the same switch. Set ADMIN_KEY and reading the reports
  // and deleting them both start wanting `x-api-key`; leave it unset and the
  // portal and its data are open to anyone with the URL.
  //
  // THE TWO ARE INDEPENDENT AND BOTH SHIP OFF. That is deliberate: the call is
  // to make it work first and lock it down later, and "later" is meant to cost
  // one `fly secrets set` rather than a code change, a review and a new image.
  // The deploy workflow already stages both from repository secrets, so
  // turning either on is putting a value in one box.
  //
  // What being open exposes, so the choice keeps its price attached: the log
  // tail, the session id, platform and GPU, and whatever the game put in
  // `context`. Steam ids are NOT among them - those are HMACed on the way in
  // and the raw one is never stored (see identity.js) - so an open portal
  // opens the crash data without opening who anybody is.
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
