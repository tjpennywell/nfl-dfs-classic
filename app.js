// APP VERSION: CLASSIC-RUSH-PASS-V1
const APP_VERSION = "CLASSIC-RUSH-PASS-V1";
console.log("APP VERSION:", APP_VERSION, new Date().toISOString());

// ==========================
// Debug banner: show runtime errors on screen
// ==========================
(function () {
  function show(msg) {
    let bar = document.getElementById("debugBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "debugBar";
      bar.style.position = "fixed";
      bar.style.left = "0";
      bar.style.right = "0";
      bar.style.bottom = "0";
      bar.style.zIndex = "99999";
      bar.style.padding = "10px 12px";
      bar.style.background = "rgba(200,0,0,0.92)";
      bar.style.color = "#fff";
      bar.style.fontFamily = "system-ui, Arial";
      bar.style.fontSize = "12px";
      bar.style.whiteSpace = "pre-wrap";
      bar.style.display = "none";
      document.body.appendChild(bar);
    }
    bar.style.display = "block";
    bar.textContent = "Dashboard error:\n" + msg;
  }
  window.addEventListener("error", (e) => show(e.message || String(e.error || e)));
  window.addEventListener("unhandledrejection", (e) => show(String(e.reason || e)));
})();

// ==========================
// Helpers
// ==========================
function num(x) {
  const v = parseFloat(String(x ?? "").replace("%", "").trim());
  return Number.isFinite(v) ? v : 0;
}
function uniq(arr) { return Array.from(new Set(arr)); }

function parseCSV(text) {
  const lines = (text || "").trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(","); // assumes no embedded commas
    const obj = {};
    headers.forEach((h, i) => obj[h] = (cols[i] ?? "").trim());
    return obj;
  });
}

async function loadCSV(path) {
  // Cache-bust with version (stable) so GH Pages updates reliably
  const url = path + (path.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(APP_VERSION);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  const text = await res.text();
  return parseCSV(text);
}

function guessCol(row, candidates) {
  if (!row) return null;
  const keys = Object.keys(row);
  const lower = keys.map(k => k.toLowerCase());
  for (const c of candidates) {
    const i = lower.indexOf(String(c).toLowerCase());
    if (i !== -1) return keys[i];
  }
  // fallback: direct hit
  for (const c of candidates) if (c in row) return c;
  return null;
}

function setTable(el, headers, rows, cellFn) {
  if (!el) return;
  el.innerHTML = "";

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  el.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach(r => {
    const tr = document.createElement("tr");
    headers.forEach(h => {
      const td = document.createElement("td");
      td.textContent = (r[h] ?? "");
      if (cellFn) cellFn(td, r, h);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  el.appendChild(tbody);
}

function showMessageTable(el, title, msg) {
  setTable(el, [title], [{ [title]: msg }]);
}

// Diverging color scale centered at 0
function getColor(value, min, max) {
  const mid = 0;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return "transparent";
  if (value >= mid) {
    const denom = (max - mid) || 1;
    const t = Math.min((value - mid) / denom, 1);
    return `rgba(0, 200, 0, ${0.12 + 0.78 * t})`;
  } else {
    const denom = (mid - min) || 1;
    const t = Math.min((mid - value) / denom, 1);
    return `rgba(220, 0, 0, ${0.12 + 0.78 * t})`;
  }
}

function ensureId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing HTML element id="${id}". index.html is out of sync.`);
  return el;
}

// ==========================
// MAIN
// ==========================
(async function main() {
  // DOM
  const versionStamp = ensureId("versionStamp");

  const gamesTable = ensureId("gamesTable");
  const playersTable = ensureId("playersTable");

  const playerSearch = ensureId("playerSearch");
  const posFilter = ensureId("posFilter");
  const teamFilter = ensureId("teamFilter");
  const sortBy = ensureId("sortBy");

  const primaryGameSelect = ensureId("primaryGameSelect");
  const buildLineupBtn = ensureId("buildLineupBtn");
  const lineupTable = ensureId("lineupTable");
  const lineupSummary = ensureId("lineupSummary");

  const showPassHm = ensureId("showPassHm");
  const showRushHm = ensureId("showRushHm");
  const hmOffTeam = ensureId("hmOffTeam");
  const hmDefTeam = ensureId("hmDefTeam");
  const heatmapMeta = ensureId("heatmapMeta");
  const heatmapTable = ensureId("heatmapTable");

  versionStamp.textContent = `Version: ${APP_VERSION} • ${new Date().toLocaleString()}`;

  // Data
  const players = await loadCSV("data/players_classic.csv");
  const games = await loadCSV("data/games_classic.csv");
  const passHm = await loadCSV("data/heatmap_pass_matchup.csv");

  let rushLaneOff = [];
  let rushLaneDef = [];
  try { rushLaneOff = await loadCSV("data/rush_lane_share_off.csv"); } catch (e) {}
  try { rushLaneDef = await loadCSV("data/rush_lane_share_def.csv"); } catch (e) {}

  // ==========================
  // PLAYERS mapping
  // ==========================
  const pName = guessCol(players[0], ["Player","Name","player_name","player"]);
  const pTeam = guessCol(players[0], ["Team","team","Tm"]);
  const pPos  = guessCol(players[0], ["Pos","Position","position"]);
  const pSal  = guessCol(players[0], ["Salary","salary","Sal","DK_Salary"]);
  const pProj = guessCol(players[0], ["Proj","Projection","proj","ProjectedPoints","FPTS","DK_Proj","ProjPts"]);
  const pOwn  = guessCol(players[0], ["Ownership","Own","own","ProjectedOwnership","OWN"]);
  const pInj  = guessCol(players[0], ["Injury_Status","injury_status","Status","Injury","InjuryStatus"]);

  function isOut(p) {
    const s = (p[pInj] || "").toUpperCase();
    return s.includes("OUT");
  }

  //
