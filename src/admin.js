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
button, select, input, a.btn {
  font: inherit; color: var(--text); background: #10141a;
  border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px;
}
button { cursor: pointer; }
button:hover, a.btn:hover { border-color: var(--accent); }
/* Every navigation on the page is a real link, so that right-click offers
   "copy link address" and ctrl-click opens a tab. These are the ones that used
   to be buttons and should still read as buttons. */
a.btn { cursor: pointer; text-decoration: none; display: inline-block; line-height: 1.2; }
a.btn.on { border-color: var(--accent); color: var(--accent); }
a { color: var(--accent); }
/* Inside a table the link is the whole row's job; it should not announce
   itself as a second, differently coloured thing. */
td a { color: inherit; text-decoration: none; }
.crumb { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
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
.bar-row { display: grid; grid-template-columns: 170px 1fr 118px auto; gap: 12px; align-items: center; }
/* A sector is named, not numbered, and the names are as long as they are.
   Clipping one is better than reflowing the whole row around it; the full
   name is on the row's title. */
.bar-where { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar-track { background: #10151c; border: 1px solid var(--line); border-radius: 2px; height: 17px; position: relative; overflow: hidden; }
.bar-fill { position: absolute; inset: 0 auto 0 0; background: var(--accent); opacity: .55; }
/* Both of these are short, fixed phrases; wrapping one costs a row of height
   and buys nothing. */
.bar-val { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.bar-row > span:last-child { white-space: nowrap; }
.blocks { display: grid; grid-template-columns: repeat(auto-fit, minmax(228px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; margin-bottom: 16px; }
.block { background: var(--panel); padding: 14px 16px; display: grid; gap: 8px; align-content: start; }
.block h4 { margin: 0; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--dim); font-weight: 600; }
.block .kv { display: grid; grid-template-columns: 1fr auto; gap: 3px 14px; font-size: 12px; }
.block .kv dt { color: var(--dim); }
.block .kv dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
/* Outcome is state, so it reads at a glance rather than as another word. */
.outcome-succeeded { color: #6fd08c; }
.outcome-failed    { color: var(--crash); }
.outcome-quit      { color: var(--warn); }
.outcome-crashed   { color: var(--crash); font-weight: 600; }
.crashy            { color: var(--crash); }
a.btn.mode         { padding: 3px 8px; font-size: 12px; }
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
.more { display: flex; gap: 10px; align-items: center; margin: 14px 0 0; }
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

// ---------------------------------------------------------------------------
// Addresses.
//
// Everything on screen is decided by 'state', and every field of state is in
// the URL, so a view can be pasted into a chat and open on the same thing for
// whoever clicks it. The traffic is one-way on purpose - navigate() writes the
// address, readUrl() reads it back into state, and nothing else touches state
// - because two things allowed to change it separately is how a shared link
// ends up showing something other than what it was copied from.
//
// 'session' and 'mode' are the two drill-down steps. Empty means "not drilled
// in yet", so the same view renders all three levels and a crumb just clears
// one of them.
const state = { view: "signatures", game: "", signature: "", report: null, session: "", mode: "" };

// state -> address. Innermost first, since each view is the one above it with
// one more thing chosen.
function href(s) {
  const seg = encodeURIComponent;
  let path;
  if (s.report) path = "/reports/" + seg(s.report);
  else if (s.view === "runs") {
    path = "/sessions" +
      (s.session ? "/" + seg(s.session) : "") +
      (s.session && s.mode ? "/" + seg(s.mode) : "");
  } else if (s.signature) path = "/issues/" + seg(s.signature);
  else if (s.view === "reports") path = "/reports";
  else path = "/issues";
  return path + (s.game ? "?game=" + seg(s.game) : "");
}

// A link to one view, from where we are now. The game filter rides along
// unless it is overridden: dropping it on the way into an issue is how you end
// up reading another game's reports without noticing.
function to(patch) {
  return href(Object.assign(
    { view: "signatures", game: state.game, signature: "", report: null, session: "", mode: "" },
    patch));
}

// address -> state, which is the half that makes a cold link work: nothing
// about the view is remembered anywhere else, so this is all it takes to open
// on somebody else's screenful.
function readUrl() {
  let parts = [];
  try {
    parts = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch (e) { void e; } // a hand-mangled %-escape just lands on the default view
  const next = {
    view: "signatures",
    game: new URLSearchParams(location.search).get("game") || "",
    signature: "", report: null, session: "", mode: "",
  };
  if (parts[0] === "reports") {
    next.view = "reports";
    if (parts[1]) next.report = parts[1];
  } else if (parts[0] === "sessions") {
    next.view = "runs";
    next.session = parts[1] || "";
    // A mode with no session to hang it on is not a view; it would render the
    // whole session list under a filter nothing shows.
    next.mode = next.session ? (parts[2] || "") : "";
  } else if (parts[0] === "issues" && parts[1]) {
    next.view = "reports";
    next.signature = parts[1];
  }
  Object.assign(state, next);
}

function navigate(url) {
  if (url !== location.pathname + location.search) history.pushState(null, "", url);
  readUrl();
  render();
}

// One handler for every link on the page, rather than one per link redrawn on
// every render. Plain clicks are routed here; a click with a modifier is left
// entirely alone, so ctrl-click still opens a new tab and right-click still
// offers "copy link address", which is most of the point of having addresses.
document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (!e.target.closest) return;
  const a = e.target.closest('a[href^="/"]');
  if (a) {
    e.preventDefault();
    navigate(a.getAttribute("href"));
    return;
  }
  // A whole row is a bigger target than the link inside it, so the row takes
  // the click too. Delegated like the links, which is what lets rows appended
  // by Load more work without being wired up a second time.
  const tr = e.target.closest("tr[data-href]");
  if (tr) navigate(tr.dataset.href);
});

// The back and forward buttons, which now work, because there is something for
// them to go back to.
addEventListener("popstate", () => { readUrl(); render(); });

// The tab's name, so a row of them can be told apart and a bookmark says what
// it points at.
function pageTitle() {
  const short = (v) => String(v).slice(0, 12);
  if (state.report) return "Report " + short(state.report);
  if (state.view === "runs") return state.session ? "Session " + short(state.session) : "Sessions";
  if (state.signature) return "Issue " + short(state.signature);
  if (state.view === "reports") return "Reports";
  return "Issues";
}

// The address bar already holds it, but a button that puts it on the clipboard
// is the difference between "look at this crash" being one click and being an
// explanation.
function copyLink() {
  const url = location.href;
  const said = (msg) => {
    const el = document.getElementById("status");
    if (!el) return;
    el.textContent = msg;
    setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 2000);
  };
  const manual = () => {
    // No clipboard API on a page served over plain http, which is exactly how
    // this runs locally, so fall back to the old select-and-copy.
    const t = document.createElement("textarea");
    t.value = url;
    t.setAttribute("readonly", "");
    t.style.position = "fixed";
    t.style.opacity = "0";
    document.body.appendChild(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { void e; }
    t.remove();
    said(ok ? "Link copied" : "Copy it from the address bar");
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => said("Link copied"), manual);
  } else manual();
}

function toolbar() {
  const nav = (label, patch, on) =>
    '<a class="btn' + (on ? " on" : "") + '" href="' + esc(to(patch)) + '">' + label + '</a>';
  const onReports = state.view === "reports" && !state.signature;
  bar.innerHTML =
    nav("Issues", { view: "signatures" }, state.view === "signatures" || !!state.signature) +
    nav("All reports", { view: "reports" }, onReports || !!state.report) +
    nav("Sessions", { view: "runs" }, state.view === "runs") +
    '<input id="game" placeholder="filter by game" value="' + esc(state.game) + '" size="16">' +
    '<span class="spacer"></span>' +
    '<span class="dim" id="status"></span>' +
    '<button id="share" title="Copy the address of what is on screen">Copy link</button>' +
    '<button id="refresh">Refresh</button>' +
    (key ? '<button id="out">Forget key</button>' : '');
  document.getElementById("share").onclick = copyLink;
  document.getElementById("refresh").onclick = render;
  const out = document.getElementById("out");
  if (out) out.onclick = () => { key = ""; sessionStorage.removeItem(KEY); render(); };
  const g = document.getElementById("game");
  // Changing the game steps back out to the list, because a drill-down is into
  // one game's issue or one game's session and neither survives the change.
  g.onchange = () => navigate(href({
    view: state.signature ? "signatures" : state.view,
    game: g.value.trim(), signature: "", report: null, session: "", mode: "",
  }));
}

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

// ---------------------------------------------------------------------------
// Paging, for the two top-level lists.
//
// A list is the newest page of something that keeps growing; the sessions view
// and the runs inside one are not paged, because a session is a bounded thing
// and once it is open there is nothing behind it to page to.
//
// Load more APPENDS rather than replacing, so reading down a long list does not
// throw away what you already read, and it does not touch the address: what is
// shareable is the view, not how far somebody happened to scroll it.

// The filters the current view is showing, which the next page has to repeat -
// a second page filtered differently from the first is not the same list.
function listQuery(kind) {
  const q = new URLSearchParams();
  if (state.game) q.set("game", state.game);
  if (kind === "reports" && state.signature) q.set("signature", state.signature);
  return q;
}

// Only drawn when the service handed back a cursor, which it only does when
// the page came back full. A "more" button pointing at nothing is worse than
// no button.
function moreBar(kind, next) {
  if (!next) return "";
  return '<p class="more"><button id="more" data-kind="' + esc(kind) +
    '" data-before="' + esc(next.before) +
    '" data-before-id="' + esc(next.before_id) + '">Load more</button>' +
    '<span class="dim" id="shown"></span></p>';
}

function countShown() {
  const el = document.getElementById("shown");
  if (!el) return;
  const n = app.querySelectorAll("tbody tr").length;
  // Once the button has gone there is nothing behind the list, and saying so
  // is the difference between "the first 70" and "all 70".
  el.textContent = document.getElementById("more") ? n + " shown" : "all " + n + " shown";
}

async function loadMore(btn) {
  const kind = btn.dataset.kind;
  const q = listQuery(kind);
  q.set("before", btn.dataset.before);
  q.set("before_id", btn.dataset.beforeId);
  btn.disabled = true;
  btn.textContent = "Loading...";
  let body;
  try {
    body = await api("/v1/" + kind + "?" + q.toString());
  } catch (err) {
    // The list already on screen is still good, so say what went wrong next to
    // the button rather than replacing the page with an error.
    btn.disabled = false;
    btn.textContent = "Load more";
    const el = document.getElementById("shown");
    if (el) el.textContent = err.unauthorized ? "that key stopped working" : err.message;
    return;
  }
  const rows = body[kind];
  const tbody = app.querySelector("tbody");
  if (tbody && rows.length) {
    tbody.insertAdjacentHTML("beforeend",
      kind === "signatures" ? sigRows(rows) : reportRows(rows));
  }
  if (body.next) {
    btn.dataset.before = body.next.before;
    btn.dataset.beforeId = body.next.before_id;
    btn.disabled = false;
    btn.textContent = "Load more";
  } else {
    btn.remove();
  }
  countShown();
}

async function viewSignatures() {
  const body = await api("/v1/signatures?" + listQuery("signatures").toString());
  const signatures = body.signatures;
  if (!signatures.length) return '<div class="empty">Nothing reported yet.</div>';
  return '<table><thead><tr><th>Count</th><th>Players</th><th>What</th><th>Where</th><th>Versions</th><th>Last seen</th></tr></thead><tbody>' +
    sigRows(signatures) + '</tbody></table>' + moreBar("signatures", body.next);
}

function sigRows(signatures) {
  return signatures.map((s) => {
      // The row and the link point at the same place. The row is what gets
      // clicked; the link is what gets copied, and what a middle-click opens.
      const at = esc(to({ view: "reports", signature: s.signature }));
      return '<tr data-href="' + at + '">' +
        '<td class="count">' + s.count + '</td>' +
        '<td>' + (s.players || "-") + '<span class="dim"> / ' + s.sessions + ' sess</span></td>' +
        '<td><a href="' + at + '"><span class="kind-' + esc(s.kind) + '">' + esc(s.kind) + '</span> ' +
        '<span class="title">' + esc(s.title) + '</span><br><span class="dim">' + esc(s.game) + " " + esc(s.signature) + '</span></a></td>' +
        '<td class="where">' + esc(where(s)) + '</td>' +
        '<td class="dim">' + esc(s.versions || "-") + '</td>' +
        '<td class="dim" title="' + esc(when(s.last_seen)) + '">' + esc(ago(s.last_seen)) + '</td>' +
        '</tr>';
    }).join("");
}

async function viewReports() {
  const body = await api("/v1/reports?" + listQuery("reports").toString());
  const reports = body.reports;
  if (!reports.length) return '<div class="empty">No reports match.</div>';
  const back = state.signature
    ? '<p class="crumb"><a class="btn" href="' + esc(to({ view: "signatures" })) + '">Back to issues</a>' +
      '<span class="dim">signature ' + esc(state.signature) + '</span></p>' : "";
  return back + '<table><thead><tr><th>When</th><th>What</th><th>Version</th><th>Platform</th><th>Player</th></tr></thead><tbody>' +
    reportRows(reports) + '</tbody></table>' + moreBar("reports", body.next);
}

function reportRows(reports) {
  return reports.map((r) =>
      '<tr data-href="' + esc(to({ report: r.id })) + '">' +
      '<td class="dim" title="' + esc(when(r.received_at)) + '">' + esc(ago(r.received_at)) + '</td>' +
      '<td><a href="' + esc(to({ report: r.id })) + '">' +
        '<span class="kind-' + esc(r.kind) + '">' + esc(r.kind) + '</span> ' + esc(r.title) + '</a></td>' +
      '<td class="dim">' + esc(r.version || "-") + '</td>' +
      '<td class="dim">' + esc(r.platform || "-") + '</td>' +
      '<td class="dim">' + esc(r.player || "-") + '</td>' +
      '</tr>').join("");
}

// A playtest, read from the outside in:
//
//   session (open the game to close or crash it)
//     -> campaign or survival
//        -> a sector+depth run that succeeded, failed or was quit
//
// All three levels are this one function, because they are one question asked
// at three widths and splitting them would mean three back buttons that each
// forget something different.
async function viewRuns() {
  if (state.session) return viewOneSession();
  return viewSessionList();
}

// How long, in the units a session is actually discussed in.
function dur(sec) {
  const n = Math.max(0, Number(sec) || 0);
  if (n < 60) return n + "s";
  if (n < 3600) return Math.floor(n / 60) + "m " + String(n % 60).padStart(2, "0") + "s";
  return Math.floor(n / 3600) + "h " + String(Math.floor((n % 3600) / 60)).padStart(2, "0") + "m";
}

// The outcome tally as one readable cell. Zeroes are dropped rather than
// printed, so a session that went perfectly reads "3 succeeded" and not
// "3 succeeded 0 failed 0 quit".
function tally(s) {
  const parts = [];
  if (s.succeeded) parts.push('<span class="outcome-succeeded">' + s.succeeded + ' succeeded</span>');
  if (s.failed) parts.push('<span class="outcome-failed">' + s.failed + ' failed</span>');
  if (s.quit) parts.push('<span class="outcome-quit">' + s.quit + ' quit</span>');
  if (!parts.length) return '<span class="dim">no runs</span>';
  return parts.join(' <span class="dim">/</span> ');
}

// LEVEL ONE: every session.
async function viewSessionList() {
  const q = state.game ? "?game=" + encodeURIComponent(state.game) : "";
  const { sessions } = await api("/v1/sessions" + q);
  if (!sessions.length) {
    return '<div class="empty">No sessions yet.' +
      '<br><span class="dim">The game pings every few minutes while it is open, ' +
      'so a session appears as soon as somebody plays for that long.</span></div>';
  }

  // Playtime is the headline: it is what a playtest is measured in, and it is
  // the number nothing else in this service could produce.
  const total = sessions.reduce((n, s) => n + (Number(s.seconds) || 0), 0);
  const totalPlayed = sessions.reduce((n, s) => n + (Number(s.played) || 0), 0);
  const lengths = sessions.map((s) => Number(s.seconds) || 0).sort((a, b) => a - b);
  const mid = Math.floor(lengths.length / 2);
  const med = lengths.length % 2 ? lengths[mid] : Math.round((lengths[mid - 1] + lengths[mid]) / 2);
  const crashed = sessions.filter((s) => s.ended_in_crash).length;

  const head = '<div class="blocks"><div class="block"><h4>Sessions</h4>' +
      '<dl class="kv"><dt>played</dt><dd>' + sessions.length + '</dd>' +
      '<dt>median length</dt><dd>' + esc(dur(med)) + '</dd></dl></div>' +
    // Two totals, because they answer different questions: how long was the
    // playtest, and how much game was actually played in it. The share tells
    // you how much of a session the shell is eating.
    '<div class="block"><h4>Time</h4>' +
      '<dl class="kv"><dt>app open</dt><dd>' + esc(dur(total)) + '</dd>' +
      '<dt>in game</dt><dd>' + esc(dur(totalPlayed)) + '</dd>' +
      '<dt>in menus</dt><dd>' + esc(dur(Math.max(0, total - totalPlayed))) +
        (total ? ' <span class="dim">' + Math.round(((total - totalPlayed) / total) * 100) + '%</span>' : '') +
        '</dd></dl></div>' +
    '<div class="block"><h4>How they ended</h4>' +
      '<dl class="kv"><dt>closed normally</dt><dd>' + (sessions.length - crashed) + '</dd>' +
      '<dt class="crashy">ended in a crash</dt><dd class="crashy">' + crashed + '</dd>' +
      '<dt>crash rate</dt><dd>' +
        (sessions.length ? Math.round((crashed / sessions.length) * 100) : 0) + '%</dd></dl></div>' +
    '</div>';

  const table = '<table><thead><tr>' +
    '<th>Last seen</th><th>Session</th><th>App open</th><th>In game</th><th>Mode</th>' +
    '<th>Runs</th><th>Faults</th><th>Ended</th>' +
    '</tr></thead><tbody>' +
    sessions.map((s) =>
      '<tr data-href="' + esc(to({ view: "runs", session: s.session })) + '">' +
      '<td class="dim" title="' + esc(when(s.last_seen)) + '">' + esc(ago(s.last_seen)) + '</td>' +
      '<td><a href="' + esc(to({ view: "runs", session: s.session })) + '">' + esc(s.session) +
        (s.player ? '<br><span class="dim">player ' + esc(s.player) + '</span>' : '') + '</a></td>' +
      // A dash for absent, a duration for measured, the same way "in game"
      // already reads. A session whose reports never carried a length is not a
      // session that lasted no time, and "0s" says the second thing.
      '<td class="num' + (s.seconds ? '' : ' dim') + '">' + esc(s.seconds ? dur(s.seconds) : "-") + '</td>' +
      '<td class="num' + (s.played ? '' : ' dim') + '">' + esc(s.played ? dur(s.played) : "-") + '</td>' +
      '<td class="dim">' + esc(s.modes || "-") + '</td>' +
      '<td>' + tally(s) + '</td>' +
      '<td class="num ' + (s.faults ? "kind-error" : "dim") + '">' + (s.faults || "-") + '</td>' +
      '<td>' + (s.ended_in_crash
        ? '<span class="outcome-crashed">crashed</span>'
        : '<span class="dim">closed</span>') + '</td>' +
      '</tr>').join("") + '</tbody></table>';

  return head + table;
}

// LEVELS TWO AND THREE: one session, its modes, and the runs inside them.
async function viewOneSession() {
  const q = new URLSearchParams({ session: state.session });
  if (state.mode) q.set("mode", state.mode);
  const { runs } = await api("/v1/runs?" + q.toString());

  const crumb = '<p class="crumb"><a class="btn" href="' + esc(to({ view: "runs" })) + '">All sessions</a>' +
    '<span class="dim">session ' + esc(state.session) + '</span>' +
    (state.mode
      ? '<span class="dim">/</span><a class="btn" href="' +
        esc(to({ view: "runs", session: state.session })) + '">' + esc(state.mode) + ' &times;</a>'
      : "") +
    '</p>';

  if (!runs.length) {
    return crumb + '<div class="empty">This session finished no runs.' +
      '<br><span class="dim">It was open long enough to ping, but nothing reached the end of a depth. ' +
      'That is itself worth knowing.</span></div>';
  }

  // Level two: the modes present, as filters. Only shown when there is a
  // choice to make, since one button that does nothing is worse than none.
  const modes = [...new Set(runs.map((r) => r.mode).filter(Boolean))];
  const modeBar = (!state.mode && modes.length > 1)
    ? '<p class="dim">Mode: ' + modes.map((m) =>
        '<a class="btn mode" href="' +
        esc(to({ view: "runs", session: state.session, mode: m })) + '">' + esc(m) + '</a>').join(" ") + '</p>'
    : "";

  const table = '<table><thead><tr>' +
    '<th>Ended</th><th>Mode</th><th>Sector</th><th>Depth</th><th>Outcome</th>' +
    '<th>Wave</th><th>Time</th><th>Kills</th><th>Credits</th><th>Mech</th>' +
    '</tr></thead><tbody>' +
    runs.map((r) =>
      '<tr data-href="' + esc(to({ report: r.id })) + '">' +
      '<td class="dim" title="' + esc(when(r.received_at)) + '">' +
        '<a href="' + esc(to({ report: r.id })) + '">' + esc(ago(r.received_at)) + '</a></td>' +
      '<td class="dim">' + esc(r.mode || "-") + '</td>' +
      '<td>' + esc(r.sector || "-") + '</td>' +
      '<td class="num">' + esc(r.depth == null ? "-" : r.depth) + '</td>' +
      '<td class="outcome-' + esc(r.outcome || "unknown") + '">' + esc(r.outcome || "-") + '</td>' +
      '<td class="num dim">' + esc(r.wave == null ? "-" : r.wave) + '</td>' +
      '<td class="num">' + esc(mmss(r.seconds)) + '</td>' +
      '<td class="num dim">' + esc(r.kills == null ? "-" : r.kills) + '</td>' +
      '<td class="num dim">' + esc(r.credits == null ? "-" : r.credits) + '</td>' +
      '<td class="num dim">' + esc(r.mech_level == null ? "-" : r.mech_level) + '</td>' +
      '</tr>').join("") + '</tbody></table>';

  // HOW FAR THEY GOT, not how long it took. A playtest asks how much of a
  // depth a player survived, and every campaign depth is ten waves, so that is
  // a share of a known whole.
  //
  // It is drawn against an ABSOLUTE scale of ten rather than against the
  // longest bar on screen. A relative scale makes a single run fill the track
  // whatever it did - one run that died on wave 0 rendered as a full bar,
  // which is the opposite of the truth. Against ten, a wave 0 run is an empty
  // track, which is what happened.
  //
  // A row is one PLACE: a sector AND a depth, not a depth on its own. Depth 1
  // of Meridian and depth 1 of The Long Haul are different rooms that happen
  // to share a number, and folding them into one row is how a sector nobody
  // can clear hides behind one everybody can. The number alone also cannot be
  // acted on - "depth 1 is brutal" is not a thing anybody can go and look at.
  const median = (xs) => {
    const v = [...xs].sort((a, b) => a - b);
    if (!v.length) return 0;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
  };
  // Ten waves to a campaign depth. An endless mode has no contract length, so
  // its bars scale to the furthest reached instead - see below.
  const WAVES_PER_DEPTH = 10;

  const groups = new Map();
  for (const r of runs) {
    // No depth means a mode that HAS no depth, which is a different statement
    // from a depth that went missing. Survival gets its own row rather than
    // being filed under "Depth ?", where it was also being measured against
    // ten waves it was never playing for: two runs that reached waves 30 and
    // 22 rendered as a full bar reading "wave 26 / 10".
    const endless = r.depth == null;
    const sector = r.sector || "";
    const mode = r.mode || "";
    // A key that cannot be forged by a sector name, whatever is in it.
    const key = JSON.stringify(endless ? ["endless", mode] : ["depth", sector, r.depth]);
    if (!groups.has(key)) groups.set(key, { endless, sector, mode, depth: r.depth, runs: [] });
    groups.get(key).runs.push(r);
  }

  const rows = [...groups.values()]
    .map((g) => ({
      endless: g.endless,
      sector: g.sector,
      mode: g.mode,
      depth: g.depth,
      wave: median(g.runs.map((r) => Number(r.wave) || 0)),
      best: Math.max(0, ...g.runs.map((r) => Number(r.wave) || 0)),
      secs: median(g.runs.map((r) => Number(r.seconds) || 0)),
      n: g.runs.length,
      won: g.runs.filter((r) => r.outcome === "succeeded").length,
    }))
    // The sectors in order, each with its depths climbing numerically - 2
    // before 10, which sorting the labels as text got backwards. Endless last,
    // since it is not on the same ladder.
    .sort((a, b) =>
      (a.endless ? 1 : 0) - (b.endless ? 1 : 0) ||
      a.sector.localeCompare(b.sector) ||
      (a.depth || 0) - (b.depth || 0) ||
      a.mode.localeCompare(b.mode));

  // A mode with no end has no whole to be a share of, so its denominator is
  // the furthest any single run in this session actually reached. It has to be
  // the best RUN and not the best row's median, or a lone endless row is
  // measured against itself and fills the track no matter what it did - the
  // very thing the absolute scale above exists to prevent. Where the bar's
  // right edge is gets printed beside it, since a scale nobody can see is not
  // one anybody can read.
  const endlessBest = Math.max(1, ...rows.filter((g) => g.endless).map((g) => g.best));

  const title = (g) => {
    if (g.endless) return g.mode ? g.mode.charAt(0).toUpperCase() + g.mode.slice(1) : "Endless";
    if (g.sector) return g.sector + " d" + g.depth;
    return "Depth " + g.depth;
  };
  const label = (g) => {
    if (g.endless || !g.sector) return esc(title(g));
    // The sector is the name worth reading; the depth rides along beside it.
    return esc(g.sector) + ' <span class="dim">d' + esc(g.depth) + '</span>';
  };

  const bars = '<div class="card"><h2>How far they got</h2><div class="bars">' +
    rows.map((g) => {
      const scale = g.endless ? endlessBest : WAVES_PER_DEPTH;
      return '<div class="bar-row">' +
      '<span class="bar-where" title="' + esc(title(g)) + '">' + label(g) + '</span>' +
      '<span class="bar-track">' +
        // The cleared share is drawn solid over the reached bar, so a depth
        // people finish looks different from one they merely survive into.
        '<span class="bar-fill" style="width:' +
          Math.round((Math.min(g.wave, scale) / scale) * 100) + '%"></span>' +
        '</span>' +
      '<span class="bar-val">wave ' + esc(g.wave) +
        ' <span class="dim">/ ' + esc(g.endless ? endlessBest : WAVES_PER_DEPTH) + '</span></span>' +
      '<span class="dim">' + esc(mmss(g.secs)) + ' &middot; ' + g.n + ' run' + (g.n === 1 ? "" : "s") +
        (g.won ? ', ' + g.won + ' cleared' : '') +
        // Only when it says something the median did not.
        (g.endless && g.best > g.wave ? ', best ' + esc(g.best) : '') + '</span></div>';
    }).join("") +
    '</div></div>';

  return crumb + modeBar + bars + table;
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
      ["app open", has("session_sec") ? mmss(c.session_sec) : null],
      ["in game", has("played_sec") ? mmss(c.played_sec) : null],
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
  // The way back is read out of the REPORT rather than out of where the click
  // came from, so a link somebody was sent arrives with the same two ways out
  // as one that was clicked into: the issue this is one of, and the session it
  // happened in. Both are the neighbouring questions once a crash is open.
  const crumb = '<p class="crumb">' +
    '<a class="btn" href="' + esc(to({ view: "reports" })) + '">All reports</a>' +
    (r.signature
      ? '<a class="btn" href="' + esc(to({ view: "reports", signature: r.signature })) + '">This issue</a>' : "") +
    (r.session
      ? '<a class="btn" href="' + esc(to({ view: "runs", session: r.session })) + '">This session</a>' : "") +
    '</p>';
  return crumb +
    '<div class="card"><h2>' + esc(r.kind) + '</h2>' +
    '<dl class="kv">' +
    '<dt>What</dt><dd>' + esc(r.title) + '</dd>' +
    '<dt>Game</dt><dd>' + esc(r.game) + " " + esc(r.version) + '</dd>' +
    '<dt>When</dt><dd>' + esc(when(r.received_at)) + '</dd>' +
    '<dt>Platform</dt><dd>' + esc(r.platform || "-") + '</dd>' +
    '<dt>GPU</dt><dd>' + esc(r.gpu || "-") + '</dd>' +
    '<dt>Engine</dt><dd>' + esc(r.engine || "-") + '</dd>' +
    '<dt>Session</dt><dd>' + (r.session
      ? '<a href="' + esc(to({ view: "runs", session: r.session })) + '">' + esc(r.session) + '</a>'
      : "-") + '</dd>' +
    '<dt>Player</dt><dd>' + esc(r.player || "-") + ' <span class="dim">(hashed, not reversible)</span></dd>' +
    '<dt>Signature</dt><dd>' + (r.signature
      ? '<a href="' + esc(to({ view: "reports", signature: r.signature })) + '">' + esc(r.signature) + '</a>'
      : "-") + '</dd>' +
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
  document.title = pageTitle();
  toolbar();
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
  const more = document.getElementById("more");
  if (more) {
    more.onclick = () => loadMore(more);
    countShown();
  }
}

// The address is the input, not the output: whatever it says on arrival is
// what gets drawn, which is what makes a pasted link work.
readUrl();
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
