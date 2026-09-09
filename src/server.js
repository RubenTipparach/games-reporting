import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { openDatabase } from "./db.js";
import { RateLimiter } from "./ratelimit.js";
import { signatureOf, titleOf } from "./signature.js";
import { loadSalt, pseudonym } from "./identity.js";
import { adminPage } from "./admin.js";

const store = openDatabase(config.dataDir);
const idSalt = loadSalt(config.dataDir);
const limiter = new RateLimiter({ burst: config.rateBurst, perMinute: config.ratePerMinute });

// A key comparison that does not leak the key one character at a time through
// how long it took to say no.
function keyMatches(given, expected) {
  if (!expected) return false;
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function clientAddress(req) {
  // Fly puts the real client address here; everything else is the proxy's.
  const fwd = req.headers["fly-client-ip"] || req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

function send(res, status, body, headers = {}, closeAfter = false) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    ...(closeAfter ? { connection: "close" } : {}),
    ...headers,
  });
  // The socket is only torn down once the response is actually on the wire.
  // Destroying it any earlier - which is what refusing an oversized body used
  // to do - reaches the client as a connection reset, so the caller learns
  // nothing and retries the same too-big request forever.
  res.end(text, closeAfter ? () => res.socket && res.socket.destroy() : undefined);
}

// Reads the body, refusing anything over the cap as it arrives rather than
// after it has all been buffered - the point of a cap is not to hold the thing
// in memory in the first place.
//
// Two gates. A declared Content-Length over the cap is refused before a byte
// is read. A chunked body that grows past it mid-flight stops being collected
// and is drained instead: the bytes still arrive, but nothing holds them, and
// the connection stays healthy long enough to carry the 413 back.
function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => Object.assign(new Error("body too large"), { status: 413 });
    const declared = Number.parseInt(req.headers["content-length"] || "", 10);
    if (Number.isFinite(declared) && declared > cap) {
      req.resume();
      reject(tooLarge());
      return;
    }
    let size = 0;
    let chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > cap) {
        chunks = [];
        req.removeAllListeners("data");
        req.resume();
        reject(tooLarge());
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function str(v, max) {
  if (v === undefined || v === null) return "";
  return String(v).slice(0, max);
}

// The tail, not the head. A log's last few thousand lines are the ones with
// the crash in them; the first few thousand are the asset loader.
function tail(text, max) {
  const s = String(text || "");
  return s.length <= max ? s : s.slice(s.length - max);
}

async function handleIngest(req, res) {
  const ip = clientAddress(req);
  if (!limiter.allow(ip)) {
    return send(res, 429, { error: "rate limited" }, {
      "retry-after": String(limiter.retryAfter(ip)),
    });
  }

  // Open while no key is configured. The moment INGEST_KEY is set this starts
  // enforcing it, with no code change and no redeploy of anything but the
  // secret - which is the whole point of writing the check this way round.
  if (config.ingestKey && !keyMatches(req.headers["x-api-key"], config.ingestKey)) {
    return send(res, 401, { error: "bad or missing X-Api-Key" });
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req, config.maxBodyBytes));
  } catch (err) {
    // Closed after answering: the rest of an oversized body is of no interest
    // and reading it all just to be polite is what the cap exists to avoid.
    if (err.status === 413) return send(res, 413, { error: "body too large" }, {}, true);
    return send(res, 400, { error: "body is not JSON" });
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return send(res, 400, { error: "body must be a JSON object" });
  }

  const game = str(payload.game, 64).trim();
  if (!game) return send(res, 400, { error: "game is required" });

  // Anything that is not one of these is filed as an error rather than
  // rejected: a report that arrives is worth more than a taxonomy.
  const kind = ["crash", "error", "warning"].includes(payload.kind) ? payload.kind : "error";

  const message = str(payload.message, 4000);
  const stack = str(payload.stack, 16000);
  if (!message && !stack) {
    return send(res, 400, { error: "message or stack is required" });
  }

  let context = "{}";
  if (payload.context && typeof payload.context === "object") {
    context = JSON.stringify(payload.context).slice(0, 8000);
  }

  const row = {
    id: randomUUID(),
    received_at: Date.now(),
    game,
    version: str(payload.version, 64),
    kind,
    signature: signatureOf({ game, kind, message, stack }),
    title: titleOf({ message, stack, kind }),
    message,
    stack,
    log: tail(payload.log, config.maxLogChars),
    platform: str(payload.platform, 128),
    gpu: str(payload.gpu, 256),
    engine: str(payload.engine, 64),
    // The client's own idea of which run this was. Not an account and not a
    // machine id: it is there so twenty reports from one bad session can be
    // told from twenty players hitting the same thing, which is the difference
    // between a nuisance and a disaster.
    session: str(payload.session, 64),
    // Whatever id the client offered, kept only as an HMAC. The raw value is
    // used to compute the hash on this line and is never written to the
    // database, never logged, and never returned by any route.
    player: pseudonym(payload.steam_id || payload.player_id || "", idSalt),
    context,
  };

  store.insert(row);
  // The id and the signature go back so the client can say "already reported"
  // and so a support conversation has something to quote.
  return send(res, 201, { id: row.id, signature: row.signature });
}

// Reads and deletes, behind the ADMIN_KEY flag (see config.js). Open while it
// is unset, which is how this ships; set it and every route below closes.
//
// One function rather than two because reading and deleting are behind the
// same switch. Splitting them was the version that shipped for one commit and
// it made deleting OFF by default rather than open, which is a different
// posture from the one that was asked for.
function requireKey(req, res) {
  if (!config.adminKey) return true;
  if (keyMatches(req.headers["x-api-key"], config.adminKey)) return true;
  send(res, 401, { error: "bad or missing X-Api-Key" });
  return false;
}

function handleRequest(req, res, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && path === "/healthz") {
    return send(res, 200, { ok: true, reports: store.count() });
  }

  // The portal is a static page that holds no data; everything it draws comes
  // from the read routes below, and those are open, so it just loads.
  if (req.method === "GET" && (path === "/" || path === "/admin")) {
    const html = adminPage();
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(html),
      // No inline anything from anywhere else, and no framing.
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    });
    return res.end(html);
  }

  if (path === "/v1/reports" && req.method === "POST") {
    return handleIngest(req, res);
  }

  if (path === "/v1/reports" && req.method === "GET") {
    if (!requireKey(req, res)) return undefined;
    const q = url.searchParams;
    return send(res, 200, {
      reports: store.list({
        game: q.get("game") || undefined,
        kind: q.get("kind") || undefined,
        signature: q.get("signature") || undefined,
        before: q.get("before") ? Number(q.get("before")) : undefined,
        limit: q.get("limit") ? Number(q.get("limit")) : 50,
      }),
    });
  }

  if (path === "/v1/signatures" && req.method === "GET") {
    if (!requireKey(req, res)) return undefined;
    const q = url.searchParams;
    return send(res, 200, {
      signatures: store.signatures({
        game: q.get("game") || undefined,
        limit: q.get("limit") ? Number(q.get("limit")) : 50,
      }),
    });
  }

  const one = path.match(/^\/v1\/reports\/([A-Za-z0-9-]+)$/);
  if (one) {
    if (req.method === "GET") {
      if (!requireKey(req, res)) return undefined;
      const report = store.get(one[1]);
      if (!report) return send(res, 404, { error: "not found" });
      return send(res, 200, report);
    }
    if (req.method === "DELETE") {
      if (!requireKey(req, res)) return undefined;
      const deleted = store.remove(one[1]);
      return send(res, deleted ? 200 : 404,
        deleted ? { deleted: true } : { error: "not found" });
    }
  }

  return send(res, 404, { error: "not found" });
}

const server = createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    return send(res, 400, { error: "bad request line" });
  }
  try {
    const out = handleRequest(req, res, url);
    if (out && typeof out.catch === "function") {
      out.catch((err) => {
        console.error("[reporting] unhandled:", err);
        if (!res.headersSent) send(res, 500, { error: "internal error" });
      });
    }
  } catch (err) {
    console.error("[reporting] threw:", err);
    if (!res.headersSent) send(res, 500, { error: "internal error" });
  }
});

function startPruning() {
  const run = () => {
    try {
      const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
      const gone = store.prune(cutoff);
      if (gone > 0) console.log(`[reporting] pruned ${gone} report(s) older than ${config.retentionDays}d`);
    } catch (err) {
      console.error("[reporting] prune failed:", err);
    }
  };
  run();
  const timer = setInterval(run, config.pruneIntervalMs);
  // The sweeper must not be the reason the process stays alive during a
  // shutdown.
  timer.unref();
  return timer;
}

export function start() {
  if (!config.ingestKey) {
    console.log("[reporting] ingest is OPEN (no INGEST_KEY set); the rate limit and body cap are the only gate");
  }
  // The posture, on every boot, in one line. Worth having in the log because
  // "is this thing open" is otherwise a question you answer by reading code.
  console.log(
    "[reporting] posting is " + (config.ingestKey ? "CLOSED (INGEST_KEY is set)" : "OPEN") +
    "; reading and deleting are " + (config.adminKey ? "CLOSED (ADMIN_KEY is set)" : "OPEN")
  );
  startPruning();
  server.listen(config.port, "0.0.0.0", () => {
    console.log(`[reporting] listening on ${config.port}, data in ${config.dataDir}, ${store.count()} report(s) held`);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`[reporting] ${sig}, closing`);
      server.close(() => {
        store.close();
        process.exit(0);
      });
    });
  }
  return server;
}

// Started when run directly; importable without listening, so the tests can
// drive it on a port of their own.
if (process.argv[1] && process.argv[1].endsWith("server.js")) start();

export { server, store, limiter, tail };
