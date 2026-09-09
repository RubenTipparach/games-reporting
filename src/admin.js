// The portal, as one self-contained page.
//
// Served without a key, because the page itself holds nothing: every number on
// it comes from the read routes. Those are open while ADMIN_KEY is unset, so
// the page just loads. When a key IS set they answer 401, and only then does
// the page ask, keeping what it is given in sessionStorage - so it is gone when the tab
// closes and is never in a URL, a cookie or the server's logs.
//
// No CDN and no build step. One file, and reading it is how you know what it
// does.

const CSS = `
:root {
  color-scheme: dark;
  --bg: #0f1216;
  --panel: #171b21;
  --line: #262c35;
  --text: #dde3ea;
  --dim: #8b95a3;
  --accent: #6fb3ff;
  --crash: #ff6b5e;
  --error: #ffb057;
  --warn: #8b95a3;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
header {
  display: flex; align-items: center; gap: 16px;
  padding: 12px 20px; border-bottom: 1px solid var(--line); background: var(--panel);
  position: sticky; top: 0; z-index: 5; flex-wrap: wrap;
}
h1 { font-size: 15px; margin: 0; font-weight: 600; letter-spacing: .04em; }
.spacer { flex: 1; }
main { padding: 20px; max-width: 1200px; }
button, select, input {
  font: inherit; color: var(--text); background: #10141a;
  border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px;
}
button { cursor: pointer; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); color: #08101a; border-color: var(--accent); font-weight: 600; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--dim); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: #1b2029; }
.count { font-weight: 700; }
/* The Runs view and the context blocks, per the reviewed mockup. */
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.where { color: #6fd08c; white-space: nowrap; }
.bars { display: grid; gap: 9px; }
.bar-row { display: grid; grid-template-columns: 84px 1fr 70px 68px; gap: 12px; align-items: center; }
.bar-track { background: #10151c; border: 1px solid var(--line); border-radius: 2px; height: 17px; position: relative; overflow: hidden; }
.bar-fill { position: absolute; inset: 0 auto 0 0; background: var(--accent); opacity: .55; }
.bar-val { text-align: right; font-variant-numeric: tabular-nums; }
.blocks { display: grid; grid-template-columns: repeat(auto-fit, minmax(228px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; margin-bottom: 16px; }
.block { background: var(--panel); padding: 14px 16px; display: grid; gap: 8px; align-content: start; }
.block h4 { margin: 0; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); font-weight: 600; }
.block .kv { display: grid; grid-template-columns: 1fr auto; gap: 3px 14px; font-size: 12px; }
.block .kv dt { color: var(--dim); }
.block .kv dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
/* Outcome is state, so it reads at a glance rather than as another word. */
.outcome-cleared   { color: #6fd08c; }
.outcome-died      { color: var(--crash); }
.outcome-crashed   { color: var(--crash); font-weight: 600; }
.outcome-abandoned { color: var(--warn); }
.outcome-redeploy  { color: var(--error); }
.kind-crash { color: var(--crash); }
.kind-error { color: var(--error); }
.kind-warning { color: var(--warn); }
.title { color: var(--text); }
.dim { color: var(--dim); }
.mono { font-family: inherit; }
pre {
  background: #0b0e12; border: 1px solid var(--line); border-radius: 6px;
  padding: 12px; overflow: auto; max-height: 460px; white-space: pre-wrap;
  word-break: break-word; margin: 0;
}
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin-bottom: 16px; }
.card h2 { font-size: 13px; margin: 0 0 10px; color: var(--dim); text-transform: uppercase; letter-spacing: .06em; }
.kv { display: grid; grid-template-columns: 150px 1fr; gap: 6px 14px; }
.kv dt { color: var(--dim); }
.kv dd { margin: 0; word-break: break-word; }
.gate { max-width: 460px; margin: 80px auto; }
.gate p { color: var(--dim); }
.err { color: var(--crash); }
.empty { color: var(--dim); padding: 40px 0; text-align: center; }
`;

// Kept as a plain function so the page is one file. It is only ever inserted
// into a <script> block, never evaluated here.
const JS = String.raw`
const KEY = "reporting.adminKey";
let key = sessionStorage.getItem(KEY) || "";
const app = document.getElementById("app");
const bar = document.getElementById("bar");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = (ms) => !ms ? "" : new Date(ms).toLocaleString();
const ago = (ms) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return Math.floor(s) + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
};

async function api(path) {
  // No header at all when there is no key, which is what an open service
  // wants. If the service is gated it answers 401 and render() puts the gate
  // up; it must NOT call render() from in here, because with an empty key
  // that is a 401 calling a render calling a 401 forever.
  const res = await fetch(path, { headers: key ? { "x-api-key": key } : {} });
  if (res.status === 401) {
    key = "";
    sessionStorage.removeItem(KEY);
    const err = new Error("unauthorized");
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function gate(msg) {
  bar.innerHTML = "";
  app.innerHTML =
    '<div class="gate card"><h2>Admin key</h2>' +
    '<p>Whatever you set as ADMIN_KEY. It is kept in this tab only, and is gone when you close it.</p>' +
    (msg ? '<p class="err">' + esc(msg) + '</p>' : '') +
    '<p><input id="k" type="password" style="width:100%" placeholder="ADMIN_KEY" autofocus></p>' +
    '<p><button class="primary" id="go">Open</button></p></div>';
  const submit = () => {
    key = document.getElementById("k").value.trim();
    if (!key) return;
    sessionStorage.setItem(KEY, key);
    render();
  };
  document.getElementById("go").onclick = submit;
  document.getElementById("k").onkeydown = (e) => { if (e.key === "Enter") submit(); };
}

function toolbar(active) {
  bar.innerHTML =
    '<button id="nav-sig">Issues</button><button id="nav-all">All reports</button>' +
    '<button id="nav-runs">Runs</button>' +
    '<input id="game" placeholder="filter by game" value="' + esc(state.game) + '" size="16">' +
    '<span class="spacer"></span>' +
    '<span class="dim" id="status"></span>' +
    '<button id="refresh">Refresh</button>' +
    (key ? '<button id="out">Forget key</button>' : '');
  document.getElementById("nav-sig").onclick = () => { state.view = "signatures"; state.signature = ""; render(); };
  document.getElementById("nav-all").onclick = () => { state.view = "reports"; state.signature = ""; render(); };
  document.getElementById("nav-runs").onclick = () => { state.view = "runs"; state.signature = ""; state.report = null; render(); };
  document.getElementById("refresh").onclick = render;
  const out = document.getElementById("out");
  if (out) out.onclick = () => { key = ""; sessionStorage.removeItem(KEY); render(); };
  const g = document.getElementById("game");
  g.onchange = () => { state.game = g.value.trim(); render(); };
  void active;
}

const state = { view: "signatures", game: "", signature: "", report: null };

// Seconds as something a person reads. Runs are minutes, not hours.
function mmss(sec) {
  const n = Number(sec) || 0;
  return Math.floor(n / 60) + "m " + String(n % 60).padStart(2, "0") + "s";
}

// The depth span for an issue, which is the thing worth scanning the list for:
// one depth is a lead, every depth is not. Null when no report carried a depth,
// which is every report from the menu.
function where(s) {
  if (s.depth_min == null) return "-";
  if (s.depth_min === 0 && s.depth_max === 0) return "menu";
  if (s.depth_min === s.depth_max) {
    const w = s.wave_max != null ? " w" + s.wave_max : "";
    return "d" + s.depth_min + w;
  }
  return "d" + s.depth_min + "-d" + s.depth_max;
}

async function viewSignatures() {
  const q = state.game ? "?game=" + encodeURIComponent(state.game) : "";
  const { signatures } = await api("/v1/signatures" + q);
  if (!signatures.length) return '<div class="empty">Nothing reported yet.</div>';
  return '<table><thead><tr><th>Count</th><th>Players</th><th>What</th><th>Where</th><th>Versions</th><th>Last seen</th></tr></thead><tbody>' +
    signatures.map((s) =>
      '<tr data-sig="' + esc(s.signature) + '">' +
      '<td class="count">' + s.count + '</td>' +
      '<td>' + (s.players || "-") + '<span class="dim"> / ' + s.sessions + ' sess</span></td>' +
      '<td><span class="kind-' + esc(s.kind) + '">' + esc(s.kind) + '</span> ' +
      '<span class="title">' + esc(s.title) + '</span><br><span class="dim">' + esc(s.game) + " " + esc(s.signature) + '</span></td>' +
      '<td class="where">' + esc(where(s)) + '</td>' +
      '<td class="dim">' + esc(s.versions || "-") + '</td>' +
      '<td class="dim" title="' + esc(when(s.last_seen)) + '">' + esc(ago(s.last_seen)) + '</td>' +
      '</tr>').join("") + '</tbody></table>';
}

async function viewReports() {
  const q = new URLSearchParams();
  if (state.game) q.set("game", state.game);
  if (state.signature) q.set("signature", state.signature);
  const { reports } = await api("/v1/reports?" + q.toString());
  if (!reports.length) return '<div class="empty">No reports match.</div>';
  const back = state.signature
    ? '<p><button id="back">Back to issues</button> <span class="dim">signature ' + esc(state.signature) + '</span></p>' : "";
  return back + '<table><thead><tr><th>When</th><th>What</th><th>Version</th><th>Platform</th><th>Player</th></tr></thead><tbody>' +
    reports.map((r) =>
      '<tr data-id="' + esc(r.id) + '">' +
      '<td class="dim" title="' + esc(when(r.received_at)) + '">' + esc(ago(r.received_at)) + '</td>' +
      '<td><span class="kind-' + esc(r.kind) + '">' + esc(r.kind) + '</span> ' + esc(r.title) + '</td>' +
      '<td class="dim">' + esc(r.version || "-") + '</td>' +
      '<td class="dim">' + esc(r.platform || "-") + '</td>' +
      '<td class="dim">' + esc(r.player || "-") + '</td>' +
      '</tr>').join("") + '</tbody></table>';
}

// The pacing view. A run summary arrives at the end of every depth, cleared or
// not, and the ones that went FINE are the point: timings drawn only from the
// attempts that broke describe the breakages rather than the pacing.
async function viewRuns() {
  const q = state.game ? "?game=" + encodeURIComponent(state.game) : "";
  const { runs } = await api("/v1/runs" + q);
  if (!runs.length) {
    return '<div class="empty">No runs reported yet.' +
      '<br><span class="dim">The game posts one at the end of every depth. ' +
      'Nothing here means no build has finished a depth yet.</span></div>';
  }

  // Median, not mean: one abandoned run at twenty seconds drags a mean down
  // and says nothing about how long a depth takes.
  const byDepth = new Map();
  for (const r of runs) {
    const d = r.depth == null ? "?" : r.depth;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d).push(Number(r.seconds) || 0);
  }
  const rows = [...byDepth.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const median = (xs) => {
    const v = [...xs].sort((a, b) => a - b);
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
  };
  const medians = rows.map(([d, xs]) => [d, median(xs), xs.length]);
  const peak = Math.max(1, ...medians.map((m) => m[1]));

  const bars = '<div class="card"><h2>Median time per depth</h2><div class="bars">' +
    medians.map(([d, med, n]) =>
      '<div class="bar-row"><span>Depth ' + esc(d) + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="width:' +
        Math.round((med / peak) * 100) + '%"></span></span>' +
      '<span class="bar-val">' + esc(mmss(med)) + '</span>' +
      '<span class="dim">' + n + ' run' + (n === 1 ? "" : "s") + '</span></div>').join("") +
    '</div></div>';

  const table = '<table><thead><tr>' +
    '<th>Ended</th><th>Sector</th><th>Depth</th><th>Outcome</th>' +
    '<th>Wave</th><th>Time</th><th>Kills</th><th>Credits</th><th>Mech</th>' +
    '</tr></thead><tbody>' +
    runs.map((r) =>
      '<tr data-id="' + esc(r.id) + '">' +
      '<td class="dim" title="' + esc(when(r.received_at)) + '">' + esc(ago(r.received_at)) + '</td>' +
      '<td>' + esc(r.sector || "-") + '</td>' +
      '<td class="num">' + esc(r.depth == null ? "-" : r.depth) + '</td>' +
      '<td class="outcome-' + esc(r.outcome || "unknown") + '">' + esc(r.outcome || "-") + '</td>' +
      '<td class="num dim">' + esc(r.wave == null ? "-" : r.wave) + '</td>' +
      '<td class="num">' + esc(mmss(r.seconds)) + '</td>' +
      '<td class="num dim">' + esc(r.kills == null ? "-" : r.kills) + '</td>' +
      '<td class="num dim">' + esc(r.credits == null ? "-" : r.credits) + '</td>' +
      '<td class="num dim">' + esc(r.mech_level == null ? "-" : r.mech_level) + '</td>' +
      '</tr>').join("") + '</tbody></table>';

  return bars + table;
}

// The blocks the mockup showed. Everything here is read out of the context field, so
// the service never had to learn what a mech is: it stores the JSON, the page
// knows the shape, and a field the game stops sending simply stops appearing.
function ctxBlocks(c) {
  if (!c || typeof c !== "object") return "";
  const has = (k) => c[k] !== undefined && c[k] !== null && c[k] !== "";
  const kv = (pairs) => '<dl class="kv">' +
    pairs.filter((p) => p[1] !== null && p[1] !== undefined && p[1] !== "")
      .map((p) => '<dt>' + esc(p[0]) + '</dt><dd>' + esc(String(p[1])) + '</dd>').join("") +
    '</dl>';

  const blocks = [];

  if (has("session_sec") || has("run") || has("run_sec")) {
    blocks.push(['Session', kv([
      ["playing for", has("session_sec") ? mmss(c.session_sec) : null],
      ["run", c.run],
      ["run length", has("run_sec") ? mmss(c.run_sec) : null],
      ["channel", c.channel],
      ["commit", c.commit],
    ])]);
  }

  if (has("screen") || has("depth") || has("wave_number")) {
    blocks.push(['Where', kv([
      ["screen", c.screen],
      ["sector", c.sector_title],
      ["depth", c.depth],
      // Both numbers, always, and labelled so nobody has to remember which is
      // which. They are deliberately different and conflating them is the most
      // repeated bug in this game.
      ["wave shown", c.wave_number],
      ["difficulty wave", c.difficulty_wave],
      ["co-op", c.coop === undefined ? null : (c.coop ? "yes" : "solo")],
    ])]);
  }

  if (c.mech && typeof c.mech === "object") {
    const m = c.mech;
    const picks = m.upgrades && typeof m.upgrades === "object"
      ? Object.entries(m.upgrades).filter(([, v]) => v > 0) : [];
    const guns = m.weapons && typeof m.weapons === "object" ? Object.entries(m.weapons) : [];
    blocks.push(['Mech', kv([
      ["role", m.role],
      ["level", m.level],
      ["hp", m.hp],
      ...picks.map(([k, v]) => [k, v]),
      ...guns.map(([k, v]) => [k, "tier " + v]),
    ])]);
  }

  if (has("kills") || has("credits") || has("prestige")) {
    blocks.push(['Run', kv([
      ["kills", c.kills],
      ["credits", c.credits],
      ["prestige", c.prestige],
      ["aliens alive", c.aliens_alive],
      ["outcome", c.outcome],
    ])]);
  }

  if (has("fps") || has("cpu") || has("renderer")) {
    blocks.push(['Machine', kv([
      ["fps", c.fps],
      ["cpu", c.cpu],
      ["cores", c.cores],
      ["renderer", c.renderer],
      ["window", c.window],
    ])]);
  }

  if (!blocks.length) return "";
  return '<div class="blocks">' + blocks.map(([h, body]) =>
    '<div class="block"><h4>' + esc(h) + '</h4>' + body + '</div>').join("") + '</div>';
}

async function viewReport(id) {
  const r = await api("/v1/reports/" + encodeURIComponent(id));
  let ctx = r.context;
  let parsed = null;
  try {
    parsed = JSON.parse(r.context);
    ctx = JSON.stringify(parsed, null, 2);
  } catch (e) { void e; }
  const blocks = ctxBlocks(parsed);
  return '<p><button id="back">Back</button></p>' +
    '<div class="card"><h2>' + esc(r.kind) + '</h2>' +
    '<dl class="kv">' +
    '<dt>What</dt><dd>' + esc(r.title) + '</dd>' +
    '<dt>Game</dt><dd>' + esc(r.game) + " " + esc(r.version) + '</dd>' +
    '<dt>When</dt><dd>' + esc(when(r.received_at)) + '</dd>' +
    '<dt>Platform</dt><dd>' + esc(r.platform || "-") + '</dd>' +
    '<dt>GPU</dt><dd>' + esc(r.gpu || "-") + '</dd>' +
    '<dt>Engine</dt><dd>' + esc(r.engine || "-") + '</dd>' +
    '<dt>Session</dt><dd>' + esc(r.session || "-") + '</dd>' +
    '<dt>Player</dt><dd>' + esc(r.player || "-") + ' <span class="dim">(hashed, not reversible)</span></dd>' +
    '<dt>Signature</dt><dd>' + esc(r.signature) + '</dd>' +
    '</dl></div>' +
    (r.message ? '<div class="card"><h2>Message</h2><pre>' + esc(r.message) + '</pre></div>' : "") +
    (r.stack ? '<div class="card"><h2>Stack</h2><pre>' + esc(r.stack) + '</pre></div>' : "") +
    blocks +
    (ctx && ctx !== "{}" ? '<div class="card"><h2>Context, raw</h2><pre>' + esc(ctx) + '</pre></div>' : "") +
    (r.log ? '<div class="card"><h2>Log tail</h2><pre>' + esc(r.log) + '</pre></div>' : "");
}

async function render() {
  // No key check here on the way in. The service decides whether it wants one,
  // and it says so with a 401; asking the visitor for a key the service is not
  // going to check is how an open portal ends up looking shut.
  const tried = key;
  toolbar(state.view);
  app.innerHTML = '<div class="empty">Loading...</div>';
  try {
    if (state.report) app.innerHTML = await viewReport(state.report);
    else if (state.view === "runs") app.innerHTML = await viewRuns();
    else if (state.view === "reports" || state.signature) app.innerHTML = await viewReports();
    else app.innerHTML = await viewSignatures();
  } catch (err) {
    if (err.unauthorized) return gate(tried ? "That key was not accepted." : "");
    app.innerHTML = '<div class="card err">' + esc(err.message) + '</div>';
    return;
  }
  const back = document.getElementById("back");
  if (back) back.onclick = () => {
    if (state.report) state.report = null;
    else { state.signature = ""; state.view = "signatures"; }
    render();
  };
  app.querySelectorAll("tr[data-sig]").forEach((tr) => {
    tr.onclick = () => { state.signature = tr.dataset.sig; state.view = "reports"; render(); };
  });
  app.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.onclick = () => { state.report = tr.dataset.id; render(); };
  });
}

render();
`;

export function adminPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Reports</title>
<style>${CSS}</style>
</head>
<body>
<header><h1>REPORTS</h1><div id="bar" style="display:flex;gap:8px;align-items:center;flex:1;flex-wrap:wrap"></div></header>
<main id="app"></main>
<script>${JS}</script>
</body>
</html>`;
}
