// Every source file parses.
//
// This exists because the same mistake has now been made three times: a
// backtick inside a comment, inside a template literal, silently ending the
// literal. Once in a browser-script comment in admin.js, once more there, and
// once in a SQL comment in db.js. It is easy to make and hard to read, because
// the file still looks completely reasonable at the point it breaks.
//
// Without this the failure surfaces as every other suite failing at once with
// "SyntaxError: missing ) after argument list" and no file named. With it, the
// broken file is named and nothing else is.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

for (const file of readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
  test(`src/${file} parses`, () => {
    assert.doesNotThrow(
      () => execFileSync(process.execPath, ["--check", join(SRC, file)], { stdio: "pipe" }),
      `src/${file} is not valid JavaScript. A backtick inside a template literal is the usual cause.`,
    );
  });
}
