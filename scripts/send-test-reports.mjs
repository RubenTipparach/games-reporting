// Sends a handful of realistic reports at a running service, so the portal has
// something in it and you can see grouping actually group.
//
//   node scripts/send-test-reports.mjs https://games-reporting.fly.dev
//   node scripts/send-test-reports.mjs http://localhost:8080 MY_INGEST_TOKEN
//
// The token is optional and only needed once INGEST_KEY is set on the service.
//
// Everything sent is marked `"context": {"smoke_test": true}` and carries the
// game id `test-harness`, so it is easy to find and easy to delete later:
//
//   curl -s -H "x-api-key: $ADMIN_KEY" "$URL/v1/reports?game=test-harness" \
//     | jq -r '.reports[].id' \
//     | xargs -I{} curl -s -X DELETE -H "x-api-key: $ADMIN_KEY" "$URL/v1/reports/{}"

const url = (process.argv[2] || "http://localhost:8080").replace(/\/+$/, "");
const token = process.argv[3] || process.env.INGEST_KEY || "";

// Two of these share a fault and differ in build, line numbers and machine, so
// the portal should show them as ONE issue seen by two players. The third and
// fourth are their own issues. That is the whole thing worth eyeballing.
const reports = [
  {
    game: "test-harness",
    version: "1.2.3",
    kind: "crash",
    message: "Invalid access to property 'text' on a base object of type 'null instance'",
    stack: "at: res://scripts/hud.gd:3312 @ update_hud()\nat: res://scripts/main.gd:1842 @ _process_body()",
    log: "[TERRAIN] pre-warmed 648 tiles in 200 ms\n[DEBUG] wave 21 incoming\nSCRIPT ERROR: Invalid access to property 'text'",
    platform: "Windows",
    gpu: "NVIDIA GeForce RTX 3070",
    engine: "4.7.2",
    session: "smoke-session-1",
    steam_id: "76561197960287930",
    context: { smoke_test: true, sector: 0, depth: 3, wave: 21 },
  },
  {
    game: "test-harness",
    version: "1.3.0",
    kind: "crash",
    message: "Invalid access to property 'text' on a base object of type 'null instance'",
    stack: "at: res://scripts/hud.gd:3400 @ update_hud()\nat: res://scripts/main.gd:1901 @ _process_body()",
    log: "[DEBUG] wave 24 incoming\nSCRIPT ERROR: Invalid access to property 'text'",
    platform: "Linux",
    gpu: "AMD Radeon RX 6700 XT",
    engine: "4.7.2",
    session: "smoke-session-2",
    steam_id: "76561197960287931",
    context: { smoke_test: true, sector: 1, depth: 2, wave: 14 },
  },
  {
    game: "test-harness",
    version: "1.3.0",
    kind: "error",
    message: "Nonexistent function 'half_line' in base 'ObjectivePanel'",
    stack: "at: res://scripts/objective_panel.gd:133 @ _refresh()",
    platform: "Windows",
    engine: "4.7.2",
    session: "smoke-session-3",
    context: { smoke_test: true },
  },
  {
    game: "test-harness",
    version: "1.3.0",
    kind: "warning",
    message: "AnimationMixer: couldn't resolve track 'Model/root_Pelvis:rotation:x'",
    stack: "at: res://scenes/player_mech.tscn @ _update_caches()",
    platform: "macOS",
    engine: "4.7.2",
    session: "smoke-session-3",
    context: { smoke_test: true },
  },
];

let failed = 0;
for (const body of reports) {
  try {
    const res = await fetch(`${url}/v1/reports`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { "x-api-key": token } : {}),
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      failed += 1;
      console.error(`FAIL ${res.status} ${body.kind}: ${text}`);
      continue;
    }
    const { id, signature } = JSON.parse(text);
    console.log(`sent ${body.kind.padEnd(7)} signature=${signature} id=${id}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${body.kind}: ${err.message}`);
  }
}

const health = await fetch(`${url}/healthz`).then((r) => r.json()).catch(() => null);
if (health) console.log(`service holds ${health.reports} report(s) in total`);

if (failed > 0) {
  console.error(`${failed} of ${reports.length} did not land`);
  process.exit(1);
}
console.log(`all ${reports.length} landed. Open ${url}/admin to see them grouped.`);
