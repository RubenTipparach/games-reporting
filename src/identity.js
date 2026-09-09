import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// A Steam id names a person. It is on their profile page, it is what a lookup
// site takes, and a table of them sitting in a crash database is a list of who
// plays your game that you did not set out to keep.
//
// What the reports actually need from it is narrower: whether two crashes came
// from the same player. An HMAC answers exactly that and nothing else. The
// same id always gives the same hash, so "nine reports from three players"
// still works, and the hash cannot be turned back into the id without the
// salt, which never leaves the server.
//
// Plain SHA of a Steam id would be useless here, by the way: the id space is
// small and public, so anyone could hash every id in existence and look the
// answer up. The salt is what stops that, which is why it must be secret and
// must be stable.

const SALT_FILE = "id-salt";

// The salt, in order of preference:
//   1. ID_SALT from the environment, ie `fly secrets set ID_SALT=...`
//   2. one generated on first boot and kept on the volume beside the database
//
// The second exists so the service works with no configuration at all, and the
// first exists so the salt can be rotated or shared deliberately. Rotating it
// re-pseudonymises everyone: old hashes and new hashes for one player stop
// matching, which is a feature if you ever need to sever that link and a
// footgun if you do it by accident, so it is written down here.
export function loadSalt(dataDir) {
  const fromEnv = process.env.ID_SALT;
  if (fromEnv && fromEnv.length > 0) {
    console.log("[reporting] id salt: from ID_SALT");
    return fromEnv;
  }

  const path = join(dataDir, SALT_FILE);
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (existing.length > 0) {
      console.log("[reporting] id salt: read from the volume");
      return existing;
    }
  }
  const fresh = randomBytes(32).toString("hex");
  writeFileSync(path, fresh, { mode: 0o600 });
  // Expected exactly once, on the first boot of a fresh volume. Seeing it on
  // EVERY deploy means DATA_DIR is not actually the volume, so the database is
  // being thrown away with the container and every player is being given a new
  // hash each time. That is the line to look for when the numbers look wrong.
  console.log("[reporting] id salt: GENERATED a new one (expected only on a fresh volume)");
  return fresh;
}

// The stored stand-in for a player. Short enough to read in a table, long
// enough that two players will not collide.
export function pseudonym(rawId, salt) {
  const id = String(rawId || "").trim();
  if (!id) return "";
  return createHmac("sha256", salt).update(id).digest("hex").slice(0, 16);
}
