// ==========================
// NFL DFS Classic Dashboard
// FULL app.js (stable)
// ==========================

// ---- Debug banner (shows runtime errors on-screen) ----
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

// ---- Helpers ----
function num(x) {
  const v = parseFloat(x);
  return Number.isFinite(v) ? v : 0;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

// Very simple CSV parser (assumes no embedded commas inside quoted fields)
function parseCSV(text) {
  const lines = (text || "").trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => obj[h] = (cols[i] ?? "").trim());
    return obj;
  });
}

async function loadCSV(path) {
  // Cache-bust so GitHub Pages updates actually show up
  const res = await fetch(path + (path.includes("?") ? "&" : "?") + "v=" + Date.now());
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  const text = await res.text();
  return parseCSV(text);
}

function guessCol(row, candidates) {
  if (!row) return null;
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

// Diverging color scale centered around 0
function getColor(value, min, max) {
  const mid = 0;
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

function showMessageTable(el, title, msg) {
  setTable(el, [title], [{ [title]: msg }]);
}

// ---- Main ----
(async function main(){
  // ===== Load data =====
  // Required:
  // data/players_classic.csv
  // data/games_classic.csv
  // data/heatmap_pass_matchup.csv
  // data/heatmap_rush_proxy.csv
  //
  // Optional for 7-lane rush grid:
  // data/rush_lane_share_off.csv
  // data/rush_lane_share_def.csv

  const players = await loadCSV("data/players_classic.csv");
  const games   = await loadCSV("data/games_classic.csv");
  const passHm  = await loadCSV("data/heatmap_pass_matchup.csv");
  // Keep proxy rush file for now (not used for the 7-lane grid, but keeps your “data files” consistent)
  const rushProxy = await loadCSV("data/heatmap_rush_proxy.csv");

  // Optional rush lane share files (7 lanes)
  let rushLaneOff = [];
  let rushLaneDef = [];
  try { rushLaneOff = await loadCSV("data/rush_lane_share_off.csv"); } catch(e) {}
  try { rushLaneDef = await loadCSV("data/rush_lane_share_def.csv"); } catch(e) {}

  // ===== Column mapping =====
  const pName = guessCol(players[0], ["Name","Player","player_name","PLAYER","PlayerName"]);
  const pTeam = guessCol(players[0], ["Team","team","Tm"]);
  const pPos  = guessCol(players[0], ["Pos","Position","position"]);
  const pSal  = guessCol(players[0], ["Salary","salary","Sal"]);
  const pProj = guessCol(players[0], ["Proj","Projection","proj","ProjectedPoints","FPTS"]);
  const pOwn  = guessCol(players[0], ["Own","Ownership","own","ProjectedOwnership"]);
  const pInj  = guessCol(players[0], ["Injury_Status","injury_status","Status","Injury"]);

  const gHome = guessCol(games[0], ["HomeTeam","Home","home_team"]);
  const gAway = guessCol(games[0], ["AwayTeam","Away","away_team"]);
  const gTotal= guessCol(games[0], ["Total","Vegas_Total","vegas_total","Game_Total"]);
  const gEnv  = guessCol(games[0], ["Env_Score","env_score","EnvScore"]);

  // Basic HTML element checks (prevents silent failures)
  const elsNeeded = [
    "playersTable","gamesTable","heatmapTable",
    "playerSearch","posFilter","teamFilter","sortBy",
    "primaryGameSelect","buildLineupBtn",
    "lineupTable","lineupSummary",
    "showPassHm","showRushHm"
  ];
  for (const id of elsNeeded) {
    if (!document.getElementById(id)) {
      throw new Error(`Missing HTML element id="${id}". Your index.html is out of sync.`);
    }
  }

  // ===== Populate team filter =====
  const teamSel = document.getElementById("teamFilter");
  uniq(players.map(p => p[pTeam]).filter(Boolean)).sort().forEach(t=>{
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    teamSel.appendChild(opt);
  });

  // ===== Games table =====
  const gamesSorted = [...games].sort((a,b)=>num(b[gEnv]) - num(a[gEnv]));
  const gamesHeaders = [gAway, gHome, gTotal, gEnv].filter(Boolean);

  setTable(document.getElementById("gamesTable"), gamesHeaders, gamesSorted, (td,row,h)=>{
    if (h === gEnv) td.innerHTML = `<span class="badge">${num(row[h]).toFixed(2)}</span>`;
  });

  // Primary game selector
  const primarySelect = document.getElementById("primaryGameSelect");
  gamesSorted.forEach((g, idx)=>{
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `${g[gAway]} @ ${g[gHome]} (Total ${g[gTotal] ?? "-"} | Env ${num(g[gEnv]).toFixed(2)})`;
    primarySelect.appendChild(opt);
  });

  // ===== Players table =====
  const playersTable = document.getElementById("playersTable");
  const playerHeaders = [pName, pTeam, pPos, pSal, pProj, pOwn, pInj].filter(Boolean);

  function filteredPlayers() {
    const q = (document.getElementById("playerSearch").value || "").toLowerCase();
    const pos = document.getElementById("posFilter").value;
    const team = document.getElementById("teamFilter").value;
    const sortBy = document.getElementById("sortBy").value;

    let rows = players.filter(p=>{
      const
