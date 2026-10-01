import { registryForPage } from "./games.js";

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
/* Still running. Not an outcome, because it has not had one yet. */
.outcome-live      { color: #6fd08c; font-weight: 600; }
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
/* The upgrade tally. One row per upgrade: its art, what the game calls it, a
   stacked bar whose LENGTH is how many runs took it and whose segments are how
   those runs ended, and the counts. The row is a hit target as well as a line:
   hovering it says what taking the thing actually does. */
.up-row { position: relative; display: grid; gap: 12px; align-items: center;
          grid-template-columns: 190px 1fr auto;
          padding: 3px 6px; margin: 0 -6px; border-radius: 6px; }
.up-art .up-row { grid-template-columns: 32px 190px 1fr auto; }
.up-row:hover, .up-row:focus-within { background: #1b212a; outline: none; }
.up-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.up-icon { width: 32px; height: 32px; display: block; }
/* An upgrade the game has no art for. It draws a lettered tile in-game for
   these too, so this is not the page inventing a hole - it is the same hole. */
.up-tile { width: 32px; height: 32px; display: grid; place-items: center;
           border: 1px solid var(--line); border-radius: 6px; background: #10151c;
           color: var(--dim); font-size: 13px; }
.up-track { display: flex; height: 17px; background: #10151c; border: 1px solid var(--line);
            border-radius: 2px; overflow: hidden; }
/* A 2px gap of surface between segments. Succeeded and failed are only dE 7.2
   apart under deuteranopia, so the boundary cannot be carried by hue alone -
   the gap, the counts printed beside the bar and the legend all restate it. */
.up-seg + .up-seg { margin-left: 2px; }
.up-seg-succeeded { background: #6fd08c; }
.up-seg-failed    { background: var(--crash); }
.up-seg-died      { background: #a83a32; }
.up-seg-quit      { background: var(--warn); }
.up-tail { font-variant-numeric: tabular-nums; white-space: nowrap; }
/* The hover card. CSS and not a mousemove handler because the page redraws
   itself by replacing innerHTML, and anything that had to be re-bound after a
   redraw would be re-bound wrongly exactly once. The row is also focusable, so
   the card is reachable by tab as well as by pointer. */
.up-tip { position: absolute; z-index: 20; left: 0; top: calc(100% - 2px);
          display: none; width: 340px; max-width: 90vw; padding: 12px 14px;
          background: #0b0e12; border: 1px solid var(--accent); border-radius: 8px;
          box-shadow: 0 12px 34px rgba(0, 0, 0, .6); cursor: default; }
.up-row:hover .up-tip, .up-row:focus-within .up-tip { display: block; }
/* Rows near the bottom open upwards, so the last one in a long tally does not
   hang the card off the end of the document. */
.up-tip.above { top: auto; bottom: calc(100% - 2px); }
.up-tip h3 { font-size: 14px; margin: 0; color: var(--text); text-transform: none; letter-spacing: 0; }
.up-tip-head { display: flex; gap: 12px; align-items: center; }
.up-tip-head img { width: 48px; height: 48px; }
.up-tip-head .up-tile { width: 48px; height: 48px; font-size: 18px; }
.up-tip-eff { margin: 10px 0 0; }
.up-tip-eff b { color: var(--accent); font-weight: 600; }
.up-stats { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px;
            margin: 10px 0 0; font-variant-numeric: tabular-nums; }
.up-stats dt { color: var(--dim); }
.up-stats dd { margin: 0; display: flex; align-items: center; gap: 7px; }
.up-stats i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; flex: none; }
/* THE BUILD ORDER. One run's picks on the time the run took: the icon is what
   they took, the badge is the level it took it to, and where it sits is when.
   The axis is THIS run's length, so an early pick looks early whatever the
   runs either side of it did. */
.bo-run + .bo-run { margin-top: 26px; padding-top: 20px; border-top: 1px solid var(--line); }
.bo-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; margin: 0 0 16px; }
.bo-track { position: relative; height: 42px; margin: 0 18px; }
.bo-axis { position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
           background: var(--line); border-radius: 1px; }
.bo-pick { position: absolute; bottom: 0; transform: translateX(-50%);
           display: flex; flex-direction: column; align-items: center; }
.bo-pick:hover, .bo-pick:focus-within { z-index: 30; outline: none; }
.bo-stem { width: 2px; height: 8px; background: var(--line); }
.bo-pick:hover .bo-stem, .bo-pick:focus-within .bo-stem { background: var(--accent); }
.bo-mark { position: relative; display: block; }
.bo-mark .up-icon, .bo-mark .up-tile { width: 30px; height: 30px; }
/* The level this pick bought, which is the thing a row of identical icons
   cannot say on its own: four Vitality picks are 1, 2, 3, 4 and not four of
   the same event. */
.bo-lv { position: absolute; right: -5px; top: -5px; min-width: 16px; height: 16px;
         padding: 0 3px; border-radius: 8px; background: var(--accent); color: #08101a;
         font-size: 10px; line-height: 16px; text-align: center; font-weight: 700;
         font-variant-numeric: tabular-nums; }
.bo-scale { display: flex; justify-content: space-between; align-items: baseline;
            margin: 6px 18px 0; font-size: 12px; color: var(--dim);
            font-variant-numeric: tabular-nums; }
/* A hover card under a mark opens towards the middle of the track, because one
   opening outwards from either end hangs off it. */
.up-tip.centred { left: 50%; transform: translateX(-50%); }
.up-tip.from-left { left: -10px; }
.up-tip.from-right { left: auto; right: -10px; }
.up-tip.centred.above, .up-tip.from-left.above, .up-tip.from-right.above {
  top: auto; bottom: calc(100% + 4px);
}
.up-tip.centred:not(.above), .up-tip.from-left:not(.above), .up-tip.from-right:not(.above) {
  top: calc(100% + 4px);
}
.bo-pick:hover .up-tip, .bo-pick:focus-within .up-tip { display: block; }
/* WHAT THE RUN DID TO THE MECH: the same readout twice, as the mech dropped in
   and as it finished. The DIFFERENCE is the whole point, so the card leads with
   one figure rather than tiling sixteen of equal weight.

   Two shades of one hue, never two hues: this is a before and an after, not two
   categories. The pair is validated against this surface (deutan dE 18.1, both
   over 3:1 on #171b21) and every value is printed beside its dot anyway, so the
   shades are the fast read and never the only one. */
.ba-before { background: #336c9c; }
.ba-after  { background: #58a2ec; }
/* The legend stands in for the marks, so it wears their shape as well as their
   colour: a square swatch for a round mark is a third thing to learn. */
.legend i.ba-before, .legend i.ba-after { border-radius: 50%; width: 11px; height: 11px; }
/* The headline. One number, because a card of sixteen equal numbers has no
   headline and this one question is the reason anybody opens the card. */
.ba-lead { display: flex; align-items: flex-end; justify-content: space-between;
           gap: 20px; flex-wrap: wrap; margin: 0 0 14px; }
.ba-lead h3 { margin: 0 0 4px; font-size: 11px; letter-spacing: .12em;
              text-transform: uppercase; color: var(--dim); font-weight: 600; }
.ba-fig { margin: 0; font-size: 15px; color: var(--dim); font-variant-numeric: tabular-nums;
          display: flex; align-items: baseline; gap: 10px; }
/* Text wears text tokens; the dots beside it carry the identity. */
.ba-fig b { font-size: 40px; font-weight: 600; color: var(--text); line-height: 1.05; }
.ba-delta { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
.ba-delta b { font-size: 20px; font-weight: 600; color: var(--text); }
.ba-flat { color: var(--dim); }
/* The figures that share a unit, and therefore may share a scale. Everything
   else is a row of numbers: three quantities of different kinds on one axis is
   a chart that lies, so the registry names the unit and nothing else gets on. */
.ba-plot { display: grid; gap: 7px; margin: 14px 0 0; }
.ba-row { display: grid; grid-template-columns: 96px 1fr auto; gap: 12px;
          align-items: center; padding: 3px 6px; margin: 0 -6px; border-radius: 6px; }
.ba-row:hover { background: #1b212a; }
.ba-name { color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ba-track { position: relative; height: 14px; }
.ba-track::before { content: ""; position: absolute; left: 0; right: 0; top: 6px;
                    height: 2px; background: #10151c; border-radius: 1px; }
/* The bar between the two dots IS the change. A dumbbell reads as a distance,
   which is the thing being asked about. */
.ba-link { position: absolute; top: 6px; height: 2px; background: #2c4f70; border-radius: 1px; }
.ba-dot { position: absolute; top: 1px; width: 12px; height: 12px; border-radius: 50%;
          margin-left: -6px; box-shadow: 0 0 0 2px var(--panel); }
.ba-tail { font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--dim); }
.ba-tail b { color: var(--text); font-weight: 600; }
/* Everything without a shared unit. A plain pair per row: no axis, no scale,
   no claim that any of them can be compared with any other. */
.ba-rows { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
           gap: 4px 22px; margin: 18px 0 0; }
.ba-cell { display: flex; justify-content: space-between; gap: 12px;
           border-bottom: 1px solid var(--line); padding: 4px 0;
           font-variant-numeric: tabular-nums; }
.ba-cell span:first-child { color: var(--dim); }
.ba-same { color: var(--dim); }
.ba-arrow { color: var(--dim); padding: 0 2px; }
/* A tab row: the same chips as a filter, set apart because these are the
   first question asked of a page rather than a narrowing of it. */
.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin: 0 0 14px;
        padding-bottom: 12px; border-bottom: 1px solid var(--line); }
.legend { display: flex; gap: 14px; flex-wrap: wrap; margin: 0 0 12px; font-size: 12px; }
.legend span { display: flex; align-items: center; gap: 6px; color: var(--dim); }
.legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.never { margin-top: 14px; }
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
const state = {
  view: "signatures", game: "", signature: "", report: null, session: "", mode: "",
  // Which sector the upgrade tally is narrowed to. Empty is all of them.
  sector: "",
  // Whether the session list is showing the ones that never left the menu.
  menus: false,
};

// Whether a game name is one the service carries an entry for. A registered
// game gets a path of its own; anything else - a CI fixture, a game nobody has
// written an entry for yet - is still readable, just as a query filter.
function registered(id) {
  return GAMES.some((g) => g.id === id);
}
function entryFor(id) {
  return GAMES.find((g) => g.id === id) || null;
}

// state -> address. Innermost first, since each view is the one above it with
// one more thing chosen.
//
// A registered game is a PREFIX and not a parameter: /mining-mike/issues is
// the thing somebody pastes into a chat, and it survives being read aloud and
// retyped in a way that ?game=mining-mike does not. An unregistered game keeps
// the query form, because inventing a path for a game the service knows
// nothing about would mean the router could not tell it from a typo.
function href(s) {
  const seg = encodeURIComponent;
  let path;
  if (s.report) path = "/reports/" + seg(s.report);
  else if (s.view === "upgrades") path = "/upgrades";
  else if (s.view === "runs") {
    path = "/sessions" +
      (s.session ? "/" + seg(s.session) : "") +
      (s.session && s.mode ? "/" + seg(s.mode) : "");
  } else if (s.signature) path = "/issues/" + seg(s.signature);
  else if (s.view === "reports") path = "/reports";
  else path = "/issues";
  // The sector narrows the tally, and it is a filter rather than a place, so
  // it stays a query. A link to it still opens on the same screenful.
  const query = new URLSearchParams();
  if (s.game && !registered(s.game)) query.set("game", s.game);
  if (s.view === "upgrades" && s.sector) query.set("sector", s.sector);
  // The mode filter, on the two views that have one. Not inside a session,
  // where it is already a path segment and would otherwise be written twice.
  if (s.mode && (s.view === "upgrades" || (s.view === "runs" && !s.session))) {
    query.set("mode", s.mode);
  }
  // Only on the session LIST. Inside one session there is nothing to hide, and
  // a flag that rides along into a drill-down is a flag somebody cannot drop.
  if (s.view === "runs" && !s.session && s.menus) query.set("menus", "1");
  const tail = query.toString() ? "?" + query.toString() : "";
  if (s.game && registered(s.game)) return "/" + seg(s.game) + path + tail;
  return path + tail;
}

// A link to one view, from where we are now. The game filter rides along
// unless it is overridden: dropping it on the way into an issue is how you end
// up reading another game's reports without noticing.
function to(patch) {
  return href(Object.assign(
    {
      view: "signatures", game: state.game, signature: "", report: null,
      session: "", mode: "", sector: "", menus: false,
    },
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
  const params = new URLSearchParams(location.search);
  const next = {
    view: "signatures",
    game: params.get("game") || "",
    signature: "", report: null, session: "", mode: "",
    sector: params.get("sector") || "",
    // Sessions that never got into a game are off the list unless the address
    // says otherwise. A filter and not a place, so it is a query.
    menus: params.get("menus") === "1",
  };
  // A leading segment naming a registered game is the game, and the rest of
  // the path is read exactly as it would be without it. One shift, and every
  // view below is scoped for free.
  if (parts.length && registered(parts[0])) {
    next.game = parts[0];
    parts = parts.slice(1);
  }
  // On the session LIST and the upgrade tally the mode is a filter, so it is
  // a query. Inside one session it is a path segment, read below. Same piece
  // of state either way: a mode is a mode.
  next.mode = params.get("mode") || "";
  if (parts[0] === "reports") {
    next.view = "reports";
    if (parts[1]) next.report = parts[1];
  } else if (parts[0] === "sessions") {
    next.view = "runs";
    next.session = parts[1] || "";
    // A mode with no session to hang it on is not a view; it would render the
    // whole session list under a filter nothing shows.
    // A mode with no session to hang it on is not a PATH; it is still the
    // list's filter, read off the query above. Clearing it here is what made
    // the tab row draw and do nothing.
    next.mode = next.session ? (parts[2] || "") : next.mode;
  } else if (parts[0] === "upgrades") {
    next.view = "upgrades";
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
  if (state.view === "upgrades") return "Upgrades";
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
    // Only for a game whose entry names an upgrades path: a tab that opens on
    // "this game has no upgrades" is a tab nobody should have been offered.
    (hasUpgrades() ? nav("Upgrades", { view: "upgrades" }, state.view === "upgrades") : "") +
    gamePicker() +
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

// The registry, as the thing you choose a game from. A list rather than a text
// box because the service now knows what it carries: typing "mining mike" and
// getting an empty portal was a thing the old filter let you do.
//
// A game with reports but no entry keeps its place in the list rather than
// disappearing, since it is still readable and the point of showing it is that
// somebody may want to write it an entry.
// Whether the chosen game has a build worth tallying. With no game chosen the
// tally has no single path to read, so the tab waits until one is.
function hasUpgrades() {
  const e = entryFor(state.game);
  return !!(e && e.upgrades && e.upgrades.path);
}

function gamePicker() {
  const options = ['<option value="">all games</option>'];
  for (const g of GAMES) {
    options.push('<option value="' + esc(g.id) + '"' +
      (state.game === g.id ? " selected" : "") + '>' + esc(g.title) + '</option>');
  }
  if (state.game && !registered(state.game)) {
    options.push('<option value="' + esc(state.game) + '" selected>' +
      esc(state.game) + ' (no entry)</option>');
  }
  return '<select id="game" title="Which game">' + options.join("") + '</select>';
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
  // The same filter on the first page and on every page after it. A cursor
  // that walks a different list than the one on screen skips rows and repeats
  // others, and does it silently.
  if (kind === "sessions" && state.menus) q.set("menus", "1");
  if (kind === "sessions" && state.mode) q.set("mode", state.mode);
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
      kind === "signatures" ? sigRows(rows)
        : kind === "sessions" ? sessionRows(rows)
          : reportRows(rows));
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

// ---------------------------------------------------------------------------
// WHAT PLAYERS BUILT.
//
// One row per upgrade. The bar's LENGTH is how many runs took it, so the list
// reads top to bottom as most-taken first; its SEGMENTS are how those runs
// ended, so a long bar that is mostly red is a popular pick that is not
// working. Both questions at once, which is the point: either alone is a
// number somebody has to hold in their head while they read the other.
//
// Scaled against the most-taken upgrade rather than against the run count,
// because the question is which picks beat which other picks. Against the run
// total every bar would be short and the comparison would be between slivers.
//
// The outcome colours are the portal's status colours, and succeeded/failed
// are only dE 7.2 apart under deuteranopia - inside the band that is legal
// ONLY with a second encoding. So the counts are printed beside every bar, the
// segments are separated by 2px of surface, and the legend names each colour.
// Nobody has to tell green from red to read this.
const OUTCOMES = ["succeeded", "failed", "died", "quit"];

function upgradeLegend() {
  return '<p class="legend">' + OUTCOMES.map((o) =>
    '<span><i class="up-seg-' + o + '"></i>' + esc(o) + '</span>').join("") + '</p>';
}

// An effect is a sentence and its numbers, kept apart in the registry so the
// numbers can be worked out FOR A LEVEL rather than baked in at one of them.
// {0} is the first pair and a pair is [per level, flat], so [25, 0] at level 3
// is 75. A pair and not a function because the registry arrives here as JSON.
function effectAt(effect, level) {
  if (!effect || !effect.length) return "";
  const args = effect.slice(1);
  return String(effect[0]).replace(/\{(\d+)\}/g, (slot, i) => {
    const pair = args[Number(i)];
    return pair ? String(level * pair[0] + pair[1]) : slot;
  });
}

// What the page knows about one upgrade beyond its key: whatever this game's
// entry says, and nothing at all if the entry says nothing. Everything below
// degrades to the bare key, so a game that has written no vocabulary yet gets
// the same page with fewer words on it.
function upgradeMeta(upgrades, key) {
  return (upgrades && upgrades.meta && upgrades.meta[key]) || null;
}

function upgradeName(upgrades, key) {
  const m = upgradeMeta(upgrades, key);
  return (m && m.name) || key;
}

// The art, or the lettered tile standing in for art the game does not have.
// Missing art is a fact about the game and not an error, so it is drawn rather
// than left as a broken image: the game itself draws a lettered card for these.
function upgradeArt(upgrades, key) {
  const m = upgradeMeta(upgrades, key);
  if (m && m.icon && upgrades.icons) {
    return '<img class="up-icon" alt="" width="32" height="32" src="' +
      esc(upgrades.icons + "/" + key + ".png") + '">';
  }
  return '<span class="up-tile" aria-hidden="true">' +
    esc(upgradeName(upgrades, key).slice(0, 1).toUpperCase()) + '</span>';
}

// The head of a hover card: the art, the name a player would recognise, and
// the key underneath it for anybody who will go on to read the JSON. Shared,
// because a tally row and a single pick are the same upgrade seen from two
// distances and should not introduce themselves differently.
function upgradeHead(upgrades, key) {
  const m = upgradeMeta(upgrades, key);
  return '<div class="up-tip-head">' + upgradeArt(upgrades, key) +
    '<div><h3>' + esc(upgradeName(upgrades, key)) + '</h3>' +
    (m && m.name ? '<span class="dim">' + esc(key) + '</span>' : '') +
    '</div></div>';
}

// What it does at a level, and what it would do at its ceiling. The second
// line is dropped once they are the same line, which is the whole point of
// printing it: it says how much of the thing is still ahead.
function effectLines(m, unit, lv) {
  if (!m || !m.effect) return "";
  return '<p class="up-tip-eff"><b>' + esc(unit) + ' ' + lv + '</b>' +
      (m.max ? ' <span class="dim">of ' + m.max + '</span>' : '') +
      ' &middot; ' + esc(effectAt(m.effect, lv)) + '</p>' +
    (m.max && lv < m.max
      ? '<p class="up-tip-eff dim">' + esc(unit) + ' ' + m.max + ' &middot; ' +
        esc(effectAt(m.effect, m.max)) + '</p>'
      : '');
}

// The hover card: what this upgrade is, what taking it does at the level
// people actually reach and at its ceiling, and how the runs that took it
// ended. The bar says how OFTEN and how it WENT; this says what it IS, which
// is the question a bar cannot answer and the one everybody asks first.
function upgradeTip(u, upgrades, above) {
  const m = upgradeMeta(upgrades, u.upgrade);
  const unit = upgrades.unit || "lvl";
  const lv = median(u.levels);
  const lo = u.levels.length ? Math.min.apply(null, u.levels) : lv;
  const hi = u.levels.length ? Math.max.apply(null, u.levels) : lv;
  // The same denominator rule the tally follows. One run that cleared is one
  // run and not a 100% clear rate, so nothing here is a share until three.
  const share = (n) => u.runs >= 3
    ? ' <span class="dim">' + Math.round(n / u.runs * 100) + '%</span>' : '';
  // An outcome nobody hit is left out, EXCEPT a clear: "succeeded 0" is the
  // most useful line this card has and it cannot be one that only appears
  // when the news is good.
  const line = (o) => (u[o] || o === "succeeded")
    ? '<dt>' + esc(o) + '</dt><dd><i class="up-seg-' + o + '"></i>' + u[o] + share(u[o]) + '</dd>'
    : '';
  return '<div class="up-tip' + (above ? " above" : "") + '" role="tooltip">' +
    upgradeHead(upgrades, u.upgrade) +
    effectLines(m, unit, lv) +
    '<dl class="up-stats">' +
      '<dt>runs</dt><dd>' + u.runs + '</dd>' +
      '<dt>' + esc(unit) + ' reached</dt><dd>' +
        (lo === hi ? lo : lo + ' to ' + hi) +
        ' <span class="dim">typically ' + lv + '</span></dd>' +
      OUTCOMES.map(line).join("") +
    '</dl></div>';
}

// ---------------------------------------------------------------------------
// THE BUILD ORDER: one run's picks, laid out on the time the run took.
//
// The tally answers what got built. This answers HOW, which is the question
// with the design in it: whether the thing everybody takes is taken first or
// last, whether a run that cleared front-loaded its damage, and how long a
// player went before anything happened at all. None of that survives a
// snapshot of the levels somebody ended on.
//
// Where the list is and what its entries call their fields is the game's
// business and comes from upgrades.picks in its entry. The LEVEL is not in
// the list and does not need to be: the third time a key appears is that
// upgrade at level three, which is true by construction and cannot drift.

// Read the picks off a context, in order, each carrying the level it took its
// upgrade to. Anything the entry does not describe reads as nothing rather
// than as a row of undefined.
function picksOf(raw, upgrades) {
  const spec = upgrades && upgrades.picks;
  if (!spec || !Array.isArray(raw)) return [];
  const seen = {};
  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const key = String(p[spec.key] ?? "");
    if (!key) continue;
    seen[key] = (seen[key] || 0) + 1;
    out.push({
      key,
      level: seen[key],
      at: Number(p[spec.at]) || 0,
      wave: spec.wave ? p[spec.wave] : undefined,
    });
  }
  return out;
}

// One pick's card. Everything the tally's card says about the upgrade, plus
// the two things only a pick knows: which level this one bought, and when.
function pickTip(pick, upgrades, place) {
  const m = upgradeMeta(upgrades, pick.key);
  const unit = upgrades.unit || "lvl";
  return '<div class="up-tip ' + place + '" role="tooltip">' +
    upgradeHead(upgrades, pick.key) +
    effectLines(m, unit, pick.level) +
    '<dl class="up-stats">' +
      '<dt>taken at</dt><dd>' + esc(mmss(pick.at)) + ' <span class="dim">into the run</span></dd>' +
      (pick.wave == null ? '' : '<dt>wave</dt><dd>' + esc(pick.wave) + '</dd>') +
      '<dt>took it to</dt><dd>' + esc(unit) + ' ' + pick.level +
        (m && m.max ? ' <span class="dim">of ' + m.max + '</span>' : '') + '</dd>' +
    '</dl></div>';
}

// One run, drawn as its own length. The axis is the run and not the longest
// run on screen: a three minute run that took four upgrades and a nine minute
// run that took four are different runs, and a relative scale draws them the
// same.
function buildOrder(picks, seconds, upgrades, above) {
  if (!picks.length) return "";
  // A run whose length did not arrive still has an order to show, so the axis
  // falls back to the last pick. Marked as such, because the axis then means
  // something weaker than it usually does.
  const measured = Number(seconds) > 0;
  const span = measured ? Number(seconds) : Math.max(1, ...picks.map((p) => p.at));
  const marks = picks.map((p, i) => {
    const pct = Math.max(0, Math.min(100, (p.at / span) * 100));
    // A card 340px wide, anchored under a mark near an edge, hangs off it.
    // Which edge it opens towards is decided here, where the position is
    // known, rather than left to a CSS that cannot see the number.
    //
    // A third and not a quarter, because the bucket has to hold at the
    // NARROWEST track this draws on and not the widest: at a quarter, a
    // centred card on a 430px track ran eleven pixels off the side of it.
    const side = pct < 35 ? "from-left" : pct > 65 ? "from-right" : "centred";
    return '<span class="bo-pick" style="left:' + pct + '%" tabindex="0"' +
      ' data-i="' + i + '">' +
      '<span class="bo-mark">' + upgradeArt(upgrades, p.key) +
        '<span class="bo-lv">' + p.level + '</span></span>' +
      '<span class="bo-stem"></span>' +
      pickTip(p, upgrades, side + (above ? " above" : "")) +
      '</span>';
  }).join("");
  return '<div class="bo-track">' + marks + '<span class="bo-axis"></span></div>' +
    '<p class="bo-scale"><span class="dim">' + esc(mmss(0)) + '</span>' +
    '<span class="dim">' + picks.length + ' pick' + (picks.length === 1 ? "" : "s") + '</span>' +
    '<span>' + esc(measured ? mmss(span) : "~" + mmss(span)) + '</span></p>';
}

// How long a run took, which is generic: every game's runs have a length and
// none of them call it anything else. run_seconds is what a finished run
// reports; run_sec is what a report sent DURING one carries, and a run summary
// carries both, because it is sent before the clock is stopped.
function runSeconds(ctx) {
  if (!ctx) return 0;
  return Number(ctx.run_seconds) || Number(ctx.run_sec) || 0;
}

// The build order as a card, for anywhere one run is on screen. Returns
// nothing at all when the game's entry describes no picks or the run carried
// none, which is every run of every game until its reporter sends them.
function buildOrderCard(ctx, gameId) {
  const up = (entryFor(gameId) || {}).upgrades;
  const spec = up && up.picks;
  if (!ctx || !spec) return "";
  const picks = picksOf(reach(ctx, spec.path), up);
  if (!picks.length) return "";
  return '<div class="card"><h2>Build order</h2>' +
    '<p class="dim">What they took and when, laid out on the time this run took. ' +
    'The badge on an icon is the level that pick bought.</p>' +
    buildOrder(picks, runSeconds(ctx), up, false) + '</div>';
}

// Where a run happened, in as few words as the table above uses. Built from
// the fields rather than from the run's own message, which already ends in the
// outcome and would print it twice beside the chip that says it properly.
function runPlace(r) {
  if (r.sector && r.depth != null) return r.sector + " d" + r.depth;
  if (r.depth != null) return "Depth " + r.depth;
  return r.mode || "run";
}

// Every run in this session that carried a build order, newest first, on one
// card. Reading down it is the thing the tally cannot show: whether the runs
// that cleared took the same things in the same order as the ones that did
// not, and how much earlier.
function sessionBuildOrders(runs, gameId) {
  const up = (entryFor(gameId) || {}).upgrades;
  if (!up || !up.picks) return "";
  const withPicks = runs
    .map((r) => ({ run: r, picks: picksOf(r.picks, up) }))
    .filter((x) => x.picks.length);
  if (!withPicks.length) return "";
  const rows = withPicks.map((x, i) =>
    '<div class="bo-run">' +
      '<p class="bo-head">' +
        '<a href="' + esc(to({ report: x.run.id })) + '">' + esc(runPlace(x.run)) + '</a>' +
        '<span class="outcome-' + esc(x.run.outcome || "unknown") + '">' +
          esc(x.run.outcome || "-") + '</span>' +
        '<span class="dim">' + esc(mmss(x.run.seconds)) + '</span>' +
        '<span class="dim">' + esc(ago(x.run.received_at)) + '</span>' +
      '</p>' +
      // The first row opens its cards downwards and every row after it opens
      // upwards, so a card is always inside the list rather than hanging off
      // whichever end it happens to be nearest.
      buildOrder(x.picks, x.run.seconds, up, i > 0) +
    '</div>').join("");
  return '<div class="card"><h2>Build order</h2>' +
    '<p class="dim">Each run on the time it took. The badge on an icon is the level ' +
    'that pick bought, and hovering one says what it did at that level.</p>' +
    rows + '</div>';
}

// ---------------------------------------------------------------------------
// WHAT THE RUN DID TO THE MECH.
//
// The game reports the same readout twice, as the mech dropped in and as it
// finished, and the number worth looking at is neither of them: it is the
// difference. A run summary saying 214 DPS cannot tell a run that tripled its
// damage from one that dropped in at 200 and wasted twenty minutes.
//
// Which keys those are, what they are called, and which of them share a unit
// all come from the game's entry. The one thing decided here is that a shared
// axis needs a shared unit, because three quantities of different kinds drawn
// on one scale is a chart that lies about all three.

// ONE rounding rule for every figure on this card, and for the arithmetic
// between them. The first draft rounded the values for display and subtracted
// the raw ones, so a card read "53 to 310" beside "+256.6" and anybody who did
// the subtraction got a different answer than the page did.
function statRound(n) {
  return Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 100) / 100;
}

// A figure, in the units the entry says it is in.
function statValue(v, format) {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") return v;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (format === "pct") return Math.round(n * 1000) / 10 + "%";
  return format ? statRound(n) + format : String(statRound(n));
}

// How much the run moved a figure, as a signed number and, where there is
// something to divide by, as a multiple. A rise from zero has no multiple:
// dividing by it produces infinity, which is not a finding.
function statChange(before, after) {
  const a = Number(before);
  const b = Number(after);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // Rounded FIRST, and then subtracted, so the difference is the difference
  // between the two numbers actually printed.
  const from = statRound(a);
  const to = statRound(b);
  const times = from > 0 && to > from ? Math.round((to / from) * 10) / 10 : null;
  return { diff: statRound(to - from), times, up: to > from, down: to < from };
}

// The pair for one run, or nothing.
//
// TWO SHAPES arrive here, and both are real. A reporter that sends both ends
// nests them under the two keys the entry names. A reporter that sends ONE
// sends the figures FLAT, because that is what the first version of this
// shipped and what every run already on the service carries.
//
// Flat IS the end: the mech as the run finished. Reading it as nothing at all
// was a bug that shipped - the card drew for a fixture shaped {end: ...} and
// drew nothing at all for the shape actually on the wire, which is the one
// case that mattered, since no build was sending the other one yet.
//
// A start with no end is still nothing: that is a run that opened and never
// reported finishing, and half a before-and-after is a number pretending to
// be a comparison.
function statPair(ctx, gameId) {
  const spec = (entryFor(gameId) || {}).stats;
  if (!ctx || !spec) return null;
  const both = reach(ctx, spec.path);
  if (!both || typeof both !== "object") return null;
  const nested = spec.after in both || spec.before in both;
  const after = nested ? both[spec.after] : both;
  const before = nested ? both[spec.before] : null;
  if (!after || typeof after !== "object") return null;
  return { spec, before: (before && typeof before === "object") ? before : null, after };
}

// The dumbbell. One row per figure, all on ONE scale, because the entry says
// they share a unit. The dot pair is the fast read and the printed numbers are
// the real one: nobody has to tell two blues apart to use this.
function statPlot(spec, before, after) {
  const rows = (spec.axis && spec.axis.rows) || [];
  if (!rows.length) return "";
  const nums = [];
  for (const [key] of rows) {
    for (const side of [before, after]) {
      const n = side ? Number(side[key]) : NaN;
      if (Number.isFinite(n)) nums.push(n);
    }
  }
  const top = Math.max(1, ...nums);
  const pct = (v) => Math.max(0, Math.min(100, (Number(v) || 0) / top * 100));
  return '<div class="ba-plot">' + rows.map(([key, label]) => {
    const a = before ? Number(before[key]) : NaN;
    const b = Number(after[key]);
    if (!Number.isFinite(b)) return "";
    const pb = pct(b);
    const pa = Number.isFinite(a) ? pct(a) : null;
    const link = pa === null ? "" :
      '<span class="ba-link" style="left:' + Math.min(pa, pb) + '%;width:' +
      Math.abs(pb - pa) + '%"></span>';
    const dotA = pa === null ? "" :
      '<span class="ba-dot ba-before" style="left:' + pa + '%" title="as it dropped in: ' +
      esc(statValue(a)) + ' ' + esc(spec.axis.unit) + '"></span>';
    return '<div class="ba-row">' +
      '<span class="ba-name">' + esc(label) + '</span>' +
      '<span class="ba-track">' + link + dotA +
        '<span class="ba-dot ba-after" style="left:' + pb + '%" title="as it finished: ' +
        esc(statValue(b)) + ' ' + esc(spec.axis.unit) + '"></span></span>' +
      '<span class="ba-tail">' +
        (pa === null ? "" : esc(statValue(a)) + ' <span class="ba-arrow">&rarr;</span> ') +
        '<b>' + esc(statValue(b)) + '</b></span>' +
      '</div>';
  }).join("") + '</div>';
}

// Everything with no shared unit: a pair per row and no scale at all. A figure
// the run did not move is dimmed rather than dropped, because "nothing changed"
// is an answer and a missing row is not.
function statRows(spec, before, after) {
  const cells = (spec.rows || []).map(([key, label, format]) => {
    const b = statValue(after[key], format);
    if (b === null) return "";
    const a = before ? statValue(before[key], format) : null;
    const same = a === null || a === b;
    return '<div class="ba-cell' + (same ? " ba-same" : "") + '">' +
      '<span>' + esc(label) + '</span>' +
      '<span>' + (same ? "" : esc(a) + ' <span class="ba-arrow">&rarr;</span> ') +
      esc(b) + '</span></div>';
  }).join("");
  return cells ? '<div class="ba-rows">' + cells + '</div>' : "";
}

function statsCard(ctx, gameId) {
  const pair = statPair(ctx, gameId);
  if (!pair) return "";
  const { spec, before, after } = pair;

  // The headline. One figure and not sixteen of equal weight, because a card
  // with no headline is a table, and the question anybody opens this for is
  // whether the run made the mech better.
  let lead = "";
  if (spec.lead) {
    const label = ((spec.axis.rows.find(([k]) => k === spec.lead) || [])[1]) || spec.lead;
    const b = statValue(after[spec.lead]);
    const a = before ? statValue(before[spec.lead]) : null;
    const ch = before ? statChange(before[spec.lead], after[spec.lead]) : null;
    lead = '<div class="ba-lead">' +
      '<div><h3>' + esc(spec.axis.unit) + ' ' + esc(label) + '</h3>' +
      '<p class="ba-fig">' +
        (a === null ? "" : '<span>' + esc(a) + '</span><span class="ba-arrow">&rarr;</span>') +
        '<b>' + esc(b) + '</b></p></div>' +
      (!ch ? "" : '<p class="ba-delta">' +
        // Signed, and the word beside it: a rise and a fall must not be
        // separable by colour alone, and this card has no colour to spare.
        '<b>' + (ch.diff > 0 ? "+" : "") + esc(ch.diff) + '</b><br>' +
        '<span class="' + (ch.diff ? "dim" : "ba-flat") + '">' +
        (ch.diff > 0 ? "gained" : ch.diff < 0 ? "lost" : "unchanged") +
        (ch.times ? ", " + ch.times + " times over" : "") + '</span></p>') +
      '</div>';
  }

  const legend = '<p class="legend">' +
    '<span><i class="ba-before"></i>as it dropped in</span>' +
    '<span><i class="ba-after"></i>as it finished</span></p>';

  return '<div class="card"><h2>' + esc(spec.title || "Before and after") + '</h2>' +
    (before ? "" : '<p class="dim">This run reported only the mech it finished as. ' +
      'Runs played on a build that reports both show the change.</p>') +
    lead + (before ? legend : "") +
    statPlot(spec, before, after) +
    statRows(spec, before, after) + '</div>';
}

async function viewUpgrades() {
  const q = new URLSearchParams();
  if (state.game) q.set("game", state.game);
  if (state.sector) q.set("sector", state.sector);
  if (state.mode) q.set("mode", state.mode);
  const body = await api("/v1/upgrades?" + q.toString());

  if (!body.upgrades) {
    return '<div class="empty">This game has no upgrades in its registry entry.' +
      '<br><span class="dim">Add an <code>upgrades</code> path to its entry in src/games.js ' +
      'and this page draws itself.</span></div>';
  }
  if (!body.runs) {
    return modeTabs(body.modes, "upgrades") + sectorChips(body.sectors) +
      '<div class="empty">No finished run has carried a build yet.' +
      '<br><span class="dim">The tally is over run summaries, so it fills in as runs end.</span></div>';
  }

  const most = Math.max(1, ...body.taken.map((u) => u.runs));
  // A game whose entry names its upgrades gets a column of art; one that does
  // not gets the same rows, one column narrower. Neither is a branch on WHICH
  // game it is - it is a branch on how much the entry has to say.
  const named = !!body.upgrades.meta;
  const rows = body.taken.map((u, i) => {
    const cleared = u.succeeded;
    // A share needs a denominator worth dividing by. One run that cleared is
    // not a 100% clear rate, it is one run, and printing the percentage is how
    // a page invents a finding out of a single player's afternoon.
    const pct = u.runs >= 3 ? Math.round((cleared / u.runs) * 100) : null;
    const seg = (o) => u[o]
      ? '<span class="up-seg up-seg-' + o + '" style="width:' +
        (u[o] / most * 100) + '%"></span>'
      : "";
    // Far enough down the list that a card opening downwards would hang off
    // the end of it, and far enough from the top that opening upwards has
    // somewhere to open into.
    const above = i >= 4 && i >= body.taken.length - 3;
    return '<div class="up-row" tabindex="0">' +
      (named ? upgradeArt(body.upgrades, u.upgrade) : "") +
      '<span class="up-name">' + esc(upgradeName(body.upgrades, u.upgrade)) + '</span>' +
      '<span class="up-track">' + OUTCOMES.map(seg).join("") + '</span>' +
      '<span class="up-tail dim">' + u.runs + ' run' + (u.runs === 1 ? "" : "s") +
        ' &middot; <span class="' + (cleared ? "outcome-succeeded" : "dim") + '">' +
        cleared + ' cleared</span>' +
        (pct === null ? '' : ' <span class="dim">' + pct + '%</span>') +
        ' &middot; ' + esc(body.upgrades.unit || "lvl") + ' ' + median(u.levels) +
      '</span>' +
      upgradeTip(u, body.upgrades, above) +
      '</div>';
  }).join("");

  const never = body.never.length
    ? '<div class="card never"><h2>Never taken</h2>' +
      '<p class="dim">Present in the build every run reports, and picked in none of them. ' +
      'The loudest thing this page has to say, and invisible if it only listed what was.</p>' +
      '<p>' + body.never.map((n) =>
        '<span class="dim" title="' + esc(n) + '">' +
        esc(upgradeName(body.upgrades, n)) + '</span>').join(" &middot; ") +
      '</p></div>'
    : "";

  return modeTabs(body.modes, "upgrades") + sectorChips(body.sectors) +
    '<div class="card"><h2>' + esc(body.upgrades.title || "Upgrades") +
      ' <span class="dim">across ' + body.runs + ' ' +
      (state.mode ? esc(state.mode) + ' ' : '') + 'run' + (body.runs === 1 ? "" : "s") +
      (state.sector ? ' in ' + esc(state.sector) : '') + '</span></h2>' +
    upgradeLegend() +
    '<div class="up-list' + (named ? " up-art" : "") + '">' + rows + '</div>' +
    '</div>' + never;
}

// The sectors runs happened in, as filters. Same idiom as the mode chips on a
// session, and only drawn when there is a choice to make.
function sectorChips(sectors) {
  if (!sectors || sectors.length < 2) return "";
  const chip = (label, sector, on) =>
    '<a class="btn mode' + (on ? " on" : "") + '" href="' +
    esc(to({ view: "upgrades", sector })) + '">' + esc(label) + '</a>';
  return '<p class="dim">Sector: ' + chip("all", "", !state.sector) + " " +
    sectors.map((s) => chip(s, s, state.sector === s)).join(" ") + '</p>';
}

// The middle of a handful of runs, which is what the tally hands back a list
// for: an average is dragged around by one player who took a thing to five.
function median(xs) {
  const v = [...xs].sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
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
  return back + '<table><thead><tr><th>When</th><th>What</th><th>Version</th><th>Session</th><th>Platform</th><th>Player</th></tr></thead><tbody>' +
    reportRows(reports) + '</tbody></table>' + moreBar("reports", body.next);
}

function reportRows(reports) {
  return reports.map((r) =>
      '<tr data-href="' + esc(to({ report: r.id })) + '">' +
      '<td class="dim" title="' + esc(when(r.received_at)) + '">' + esc(ago(r.received_at)) + '</td>' +
      '<td><a href="' + esc(to({ report: r.id })) + '">' +
        '<span class="kind-' + esc(r.kind) + '">' + esc(r.kind) + '</span> ' + esc(r.title) + '</a></td>' +
      '<td class="dim">' + esc(r.version || "-") + '</td>' +
      // The session is on every report and was on no screen. A crash with no
      // way back to the half hour around it is a crash nobody can place.
      '<td class="dim">' + (r.session
        ? '<a href="' + esc(to({ view: "runs", session: r.session })) + '">' +
          esc(r.session) + '</a>'
        : "-") + '</td>' +
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
  if (parts.length) return parts.join(' <span class="dim">/</span> ');
  // TWO different nothings, and "no runs" was being printed for both. A
  // session that started a game and walked away mid-run is the most common
  // shape in a playtest and the one worth opening; a session that never left
  // the menu is neither.
  if (s.entered) return '<span class="outcome-quit">started, unfinished</span>';
  return '<span class="dim">menus only</span>';
}

// LEVEL ONE: every session.
async function viewSessionList() {
  const body = await api("/v1/sessions?" + listQuery("sessions").toString());
  const sessions = body.sessions;
  // The totals describe the WHOLE list, not the rows that came back, so the
  // crash rate is the crash rate however far down somebody has loaded. Working
  // it out from the page was fine while one page was all there was.
  const t = body.totals || {};
  const chips = modeTabs(t.modes, "runs") + emptyChips(t);

  if (!sessions.length) {
    // Two different nothings. "None with runs" and "none at all" send somebody
    // to opposite conclusions, and the second is the only one that means the
    // game is not reporting.
    return chips + '<div class="empty">' +
      (t.empty && !state.menus
        ? 'No session got into a game.' +
          '<br><span class="dim">' + t.empty + ' never left the menu. ' +
          'Show them with the button above.</span>'
        : 'No sessions yet.' +
          '<br><span class="dim">The game pings every few minutes while it is open, ' +
          'so a session appears as soon as somebody plays for that long.</span>') +
      '</div>';
  }

  const total = Number(t.seconds) || 0;
  const totalPlayed = Number(t.played) || 0;
  const live = Number(t.live) || 0;
  const ended = Number(t.ended) || 0;
  const crashed = Number(t.crashed) || 0;

  const head = '<div class="blocks"><div class="block"><h4>Sessions</h4>' +
      '<dl class="kv"><dt>played</dt><dd>' + (Number(t.sessions) || sessions.length) + '</dd>' +
      '<dt>median length</dt><dd>' + esc(dur(t.median)) + '</dd>' +
      // Started a game and walked away from it. The number a playtest wants
      // and the one a run count cannot give: not how many runs ended, but how
      // many attempts nobody saw the end of.
      (Number(t.unfinished)
        ? '<dt>started, unfinished</dt><dd>' + t.unfinished + '</dd>' : '') +
      (t.empty && !state.menus
        ? '<dt>menus only</dt><dd class="dim">' + t.empty + ' hidden</dd>' : '') +
      '</dl></div>' +
    // Two totals, because they answer different questions: how long was the
    // playtest, and how much game was actually played in it. The share tells
    // you how much of a session the shell is eating.
    '<div class="block"><h4>Time' +
      // The game reports one clock per session, not one per mode, so a mode
      // tab cannot narrow these and does not pretend to.
      (state.mode ? ' <span class="dim">whole session</span>' : '') + '</h4>' +
      '<dl class="kv"><dt>app open</dt><dd>' + esc(dur(total)) + '</dd>' +
      '<dt>in game</dt><dd>' + esc(dur(totalPlayed)) + '</dd>' +
      '<dt>in menus</dt><dd>' + esc(dur(Math.max(0, total - totalPlayed))) +
        (total ? ' <span class="dim">' + Math.round(((total - totalPlayed) / total) * 100) + '%</span>' : '') +
        '</dd></dl></div>' +
    // A session still checking in has not ended, so it is not evidence either
    // way about how sessions end. Counting it as "closed normally" is what
    // makes a crash rate drift down every time somebody leaves the game open.
    '<div class="block"><h4>How they ended</h4>' +
      '<dl class="kv"><dt>closed normally</dt><dd>' + Math.max(0, ended - crashed) + '</dd>' +
      '<dt class="crashy">ended in a crash</dt><dd class="crashy">' + crashed + '</dd>' +
      '<dt>crash rate</dt><dd>' +
        (ended ? Math.round((crashed / ended) * 100) : 0) + '%</dd>' +
      (live ? '<dt class="outcome-live">still open</dt><dd class="outcome-live">' + live +
              '</dd>' : '') + '</dl></div>' +
    '</div>';

  const table = '<table><thead><tr>' +
    '<th>Last seen</th><th>Session</th><th>App open</th><th>In game</th><th>Mode</th>' +
    '<th>Runs</th><th>Faults</th><th>Ended</th>' +
    '</tr></thead><tbody>' +
    sessionRows(sessions) + '</tbody></table>';

  return chips + head + table + moreBar("sessions", body.next);
}

// THE MODES A GAME REPORTS, as tabs.
//
// Built from what came back rather than from a list of any game's words: a
// game that calls them something else gets its own tabs, and a game with one
// mode gets none, because a tab row with one tab is a label.
//
// "All" first and always, because the modes do not partition the sessions: a
// session can play both, and 29 of the 500 on the live service do. Each of
// those belongs under both tabs, and the sum of the tabs is therefore more
// than the whole. Saying that out loud beats leaving somebody to add them up.
function modeTabs(modes, view) {
  if (!modes || modes.length < 2) return "";
  const tab = (label, mode, on, n) =>
    '<a class="btn mode' + (on ? " on" : "") + '" href="' +
    esc(to(view === "upgrades" ? { view: "upgrades", mode } : { view: "runs", mode })) +
    '">' + esc(label) +
    (n === undefined ? "" : ' <span class="dim">' + n + '</span>') + '</a>';
  return '<p class="tabs">' +
    tab("All", "", !state.mode) + " " +
    modes.map((m) => tab(m.mode, m.mode, state.mode === m.mode, m.sessions)).join(" ") +
    '</p>';
}

// The runless sessions, as a filter. Same idiom as the sector chips and the
// mode chips: a filter is a query rather than a place, so a link to it opens on
// the same screenful somebody was looking at.
//
// Only drawn when there is a choice to make. With nothing hidden the button
// would toggle between two identical lists.
function emptyChips(t) {
  if (!t || !t.empty) return "";
  const chip = (label, on, menus) =>
    '<a class="btn mode' + (on ? " on" : "") + '" href="' +
    esc(to({ view: "runs", menus })) + '">' + esc(label) + '</a>';
  return '<p class="dim">Sessions: ' +
    chip("got into a game", !state.menus, false) + " " +
    chip("all (" + t.empty + " menus only)", !!state.menus, true) + '</p>';
}

function sessionRows(sessions) {
  return sessions.map((s) =>
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
    // Three states, not two. A session that is still checking in has not
    // ended at all, and drawing it as "closed" or "crashed" is the portal
    // reporting an outcome that has not happened.
    '<td>' + (s.live
      ? '<span class="outcome-live">live</span>' +
        '<br><span class="dim">' + esc(ago(s.last_seen)) + '</span>'
      : s.ended_in_crash
        ? '<span class="outcome-crashed">crashed</span>'
        : '<span class="dim">closed</span>') + '</td>' +
    '</tr>').join("");
}

// The kinds that are things going wrong. The same three the issue rollup
// counts, named here so the session page and that rollup cannot disagree about
// what a fault is.
const FAULTS = ["crash", "error", "warning"];

// The session list's own row for one session, which is where the machine, the
// two clocks and the entered flag are already worked out. Fetched rather than
// recomputed, so the drill-down and the list agree by construction.
//
// Null on anything that goes wrong: this is context around the page, never the
// page itself, and a session that cannot be found in the list is still a
// session somebody can read the reports of.
async function sessionRow(session) {
  const q = new URLSearchParams({ limit: "500", menus: "1" });
  if (state.game) q.set("game", state.game);
  try {
    const { sessions } = await api("/v1/sessions?" + q.toString());
    return sessions.find((s) => s.session === session) || null;
  } catch (e) {
    void e;
    return null;
  }
}

// WHAT THIS SESSION WAS: how long, on what, and how far it got. The blocks a
// session page can always draw, because every one of them survives a session
// that finished nothing.
function sessionAbout(row, runs, faults) {
  if (!row) return "";
  const started = !row.runs && row.entered;
  const blocks = [];

  blocks.push('<div class="block"><h4>Session</h4><dl class="kv">' +
    '<dt>app open</dt><dd>' + esc(row.seconds ? dur(row.seconds) : "-") + '</dd>' +
    '<dt>in game</dt><dd>' + esc(row.played ? dur(row.played) : "-") + '</dd>' +
    '<dt>runs finished</dt><dd>' + (row.runs || 0) + '</dd>' +
    '<dt>faults</dt><dd class="' + (faults.length ? "crashy" : "dim") + '">' +
      (faults.length || 0) + '</dd>' +
    (row.modes ? '<dt>mode</dt><dd>' + esc(row.modes) + '</dd>' : '') +
    '</dl></div>');

  // STARTED AND NEVER FINISHED, said out loud. It is the shape of most of a
  // playtest - open the engine, start a game, hit something, quit - and it
  // reads as an empty session everywhere that counts only run summaries.
  blocks.push('<div class="block"><h4>How it went</h4><dl class="kv">' +
    '<dt>ended</dt><dd>' + (row.live
      ? '<span class="outcome-live">still open</span>'
      : row.ended_in_crash
        ? '<span class="outcome-crashed">in a crash</span>'
        : '<span class="dim">closed</span>') + '</dd>' +
    (started
      ? '<dt>got into a game</dt><dd><span class="outcome-quit">and left mid-run</span></dd>'
      : row.entered ? '' : '<dt>got into a game</dt><dd class="dim">no, menus only</dd>') +
    (runs.length ? '<dt>outcomes</dt><dd>' + tally(row) + '</dd>' : '') +
    '</dl></div>');

  blocks.push('<div class="block"><h4>Machine</h4><dl class="kv">' +
    '<dt>platform</dt><dd>' + esc(row.platform || "-") + '</dd>' +
    '<dt>gpu</dt><dd>' + esc(row.gpu || "-") + '</dd>' +
    '<dt>engine</dt><dd>' + esc(row.engine || "-") + '</dd>' +
    '<dt>build</dt><dd>' + esc(row.version || "-") +
      (row.channel ? ' <span class="dim">' + esc(row.channel) + '</span>' : '') + '</dd>' +
    (row.player ? '<dt>player</dt><dd>' + esc(row.player) + '</dd>' : '') +
    '</dl></div>');

  return '<div class="blocks">' + blocks.join("") + '</div>';
}

// The faults this session reported, newest first, each a link to the report.
// The count was on the session list all along and led to a page that never
// mentioned it.
function faultCard(faults) {
  if (!faults.length) return "";
  return '<div class="card"><h2>Faults</h2>' +
    '<table><thead><tr><th>When</th><th>What</th><th>Build</th></tr></thead><tbody>' +
    faults.map((r) =>
      '<tr data-href="' + esc(to({ report: r.id })) + '">' +
      '<td class="dim" title="' + esc(when(r.received_at)) + '">' + esc(ago(r.received_at)) + '</td>' +
      '<td><a href="' + esc(to({ report: r.id })) + '">' +
        '<span class="kind-' + esc(r.kind) + '">' + esc(r.kind) + '</span> ' +
        esc(r.title) + '</a></td>' +
      '<td class="dim">' + esc(r.version || "-") + '</td>' +
      '</tr>').join("") + '</tbody></table></div>';
}

async function viewOneSession() {
  const q = new URLSearchParams({ session: state.session });
  // The game, so the service can look up where THIS game keeps the order its
  // upgrades were taken in. A drill-down keeps the game for exactly this kind
  // of reason: without it the address is a cross-game list, and a build order
  // is one game's word.
  if (state.game) q.set("game", state.game);
  if (state.mode) q.set("mode", state.mode);
  // Three questions at once, because the answer to the first is often "none"
  // and the page still has to say something. The session list has counted
  // faults per session since it was written; this is the first time the page
  // behind that count could ask for them.
  const faultQ = new URLSearchParams({ session: state.session, limit: "200" });
  if (state.game) faultQ.set("game", state.game);
  const [{ runs }, reports, row] = await Promise.all([
    api("/v1/runs?" + q.toString()),
    api("/v1/reports?" + faultQ.toString()).then((b) => b.reports).catch(() => []),
    sessionRow(state.session),
  ]);
  const faults = reports.filter((r) => FAULTS.includes(r.kind));

  const crumb = '<p class="crumb"><a class="btn" href="' + esc(to({ view: "runs" })) + '">All sessions</a>' +
    '<span class="dim">session ' + esc(state.session) + '</span>' +
    (state.mode
      ? '<span class="dim">/</span><a class="btn" href="' +
        esc(to({ view: "runs", session: state.session })) + '">' + esc(state.mode) + ' &times;</a>'
      : "") +
    '</p>';

  // Drawn whether or not a run finished. A session that reported nothing but a
  // check-in and three errors is still a machine, a build, and a stretch of
  // somebody's afternoon, and a page that says "no runs" and stops throws all
  // of that away.
  const about = sessionAbout(row, runs, faults);

  if (!runs.length) {
    return crumb + about + faultCard(faults) +
      '<div class="empty">' +
      (row && row.entered
        ? 'This session started a game and never finished one.' +
          '<br><span class="dim">No run summary was sent, so there is nothing to lay out here. ' +
          'What it was doing is above.</span>'
        : 'This session finished no runs.' +
          '<br><span class="dim">It was open long enough to ping, but nothing reached the end of a depth. ' +
          'That is itself worth knowing.</span>') +
      '</div>';
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
  // How much of a depth counts as finishing it, from THE GAME'S OWN ENTRY
  // rather than from a constant in here. Ten is Mining Mike's number, not this
  // service's, and the next game's will be a different one or none at all.
  // Without an entry there is no known whole, so every row is scaled the way
  // an endless mode is: against the furthest anybody reached.
  const place = (entryFor(state.game) || {}).place || {};
  const WAVES_PER_DEPTH = Number(place.wavesPerDepth) || 0;

  const groups = new Map();
  for (const r of runs) {
    // No depth means a mode that HAS no depth, which is a different statement
    // from a depth that went missing. Survival gets its own row rather than
    // being filed under "Depth ?", where it was also being measured against
    // ten waves it was never playing for: two runs that reached waves 30 and
    // 22 rendered as a full bar reading "wave 26 / 10".
    // No depth, or a game with no notion of one, means a row that is not on
    // the ladder and cannot be a share of it.
    const endless = r.depth == null || !WAVES_PER_DEPTH;
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

  return crumb + about + faultCard(faults) + modeBar + bars +
    sessionBuildOrders(runs, state.game) + table;
}

// The context blocks, drawn from the GAME REGISTRY rather than from a list of
// field names written into this file.
//
// The Session and Machine blocks are here because they are the same two
// questions for every game: how long was it open, and what was it running on.
// Everything between them - what a sector is, that a mech has weapons - is one
// game's vocabulary and lives in src/games.js. That is the whole reason a
// second game does not need this function edited.
//
// The service never had to learn what a mech is either way: it stores the
// context JSON, the registry says which keys are worth a line, and a field the
// game stops sending simply stops appearing.
function reach(c, path) {
  return String(path).split(".").reduce((v, k) => (v == null ? v : v[k]), c);
}

function kvRows(pairs) {
  return '<dl class="kv">' +
    pairs.filter((p) => p[1] !== null && p[1] !== undefined && p[1] !== "")
      .map((p) => '<dt>' + esc(p[0]) + '</dt><dd>' + esc(String(p[1])) + '</dd>').join("") +
    '</dl>';
}

// One registry row to zero or more label/value pairs.
function rowPairs(c, row) {
  if (Array.isArray(row)) {
    const [label, path, format] = row;
    const v = reach(c, path);
    if (v === undefined || v === null || v === "") return [];
    if (format === "mmss") return [[label, mmss(v)]];
    if (typeof format === "string" && format.includes("/")) {
      const [yes, no] = format.split("/");
      return [[label, v ? yes : no]];
    }
    return [[label, v]];
  }
  // A spread: every key of an object gets its own row, which is how a list of
  // upgrades nobody enumerated in advance still renders.
  const obj = reach(c, row.spread);
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj)
    .filter(([, v]) => !(row.omitZero && !v))
    .map(([k, v]) => [k, row.each ? row.each + " " + v : v]);
}

function ctxBlocks(c, gameId) {
  if (!c || typeof c !== "object") return "";
  const has = (k) => {
    const v = reach(c, k);
    return v !== undefined && v !== null && v !== "";
  };
  const blocks = [];

  // Generic, and first: every game has a session and none of them call it
  // anything else.
  if (has("session_sec") || has("run") || has("run_sec")) {
    blocks.push(['Session', kvRows([
      ["app open", has("session_sec") ? mmss(c.session_sec) : null],
      ["in game", has("played_sec") ? mmss(c.played_sec) : null],
      ["run", c.run],
      ["run length", has("run_sec") ? mmss(c.run_sec) : null],
      ["channel", c.channel],
      ["commit", c.commit],
    ])]);
  }

  // The game's own, in the order its entry lists them.
  const entry = entryFor(gameId);
  for (const b of (entry && entry.blocks) || []) {
    if (b.when && !b.when.some(has)) continue;
    const pairs = b.rows.flatMap((row) => rowPairs(c, row));
    if (pairs.length) blocks.push([b.title, kvRows(pairs)]);
  }

  // Generic, and last: the machine is the machine.
  if (has("fps") || has("cpu") || has("renderer")) {
    blocks.push(['Machine', kvRows([
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
  const blocks = ctxBlocks(parsed, r.game);
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
    buildOrderCard(parsed, r.game) +
    statsCard(parsed, r.game) +
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
    else if (state.view === "upgrades") app.innerHTML = await viewUpgrades();
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
  // The registry, handed to the page as data. Its own <script> rather than an
  // interpolation into the one below, because that one is a String.raw
  // template and a `${` inside it would be read as a hole rather than as text.
  //
  // JSON is not HTML: a "<" inside a string would end this element early, so
  // the one character that could do it is escaped on the way out.
  const registry = JSON.stringify(registryForPage()).replace(/</g, "\\u003c");
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
<script>const GAMES = ${registry};</script>
<script>${JS}</script>
</body>
</html>`;
}
