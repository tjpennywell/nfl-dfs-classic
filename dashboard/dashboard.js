// dashboard/dashboard.js  (NO IMPORTS — GitHub Pages safe)
const BASE = "data/";

const state = {
  games: [],
  players: [],
  rec: [],
  pass: [],
  rush: [],
};

function loadCsv(path) {
  return new Promise((resolve, reject) => {
    Papa.parse(path, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      download: true,
      complete: (res) => resolve(res.data || []),
      error: (err) => reject(err),
    });
  });
}

function uniq(arr) {
  return Array.from(new Set(arr)).filter(Boolean).sort();
}

function normalizeTeam(t) {
  if (!t) return t;
  const x = String(t).trim().toUpperCase();
  if (x === "LAR") return "LA";
  if (x === "LAC") return "LAC";
  return x;
}

function setOptions(sel, values, includeBlank = false) {
  sel.innerHTML = "";
  if (includeBlank) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "";
    sel.appendChild(opt);
  }
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

function heatColor(val) {
  const v = Math.max(-1, Math.min(1, Number(val) || 0));
  // dark neutral -> green for positive -> red for negative
  if (v >= 0) {
    const g = Math.floor(80 + 175 * v);
    const r = Math.floor(30 + 40 * (1 - v));
    const b = Math.floor(30 + 40 * (1 - v));
    return `rgb(${r},${g},${b})`;
  } else {
    const a = Math.abs(v);
    const r = Math.floor(80 + 175 * a);
    const g = Math.floor(30 + 40 * (1 - a));
    const b = Math.floor(30 + 40 * (1 - a));
    return `rgb(${r},${g},${b})`;
  }
}

function textColor(bg) {
  // bg like "rgb(r,g,b)"
  const m = bg.match(/\d+/g);
  if (!m) return "#fff";
  const r = +m[0], g = +m[1], b = +m[2];
  const lum = 0.2126*r + 0.7152*g + 0.0722*b;
  return lum > 120 ? "#111" : "#fff";
}

function buildRushCols() {
  return ["Left End","Left Tackle","Left Guard","Center","Right Guard","Right Tackle","Right End"];
}

function buildPassCols() {
  // pass file usually has short/int/deep or buckets; we’ll detect numeric cols
  return null;
}

function getNumericCols(row) {
  const ignore = new Set(["off_team","def_team","play_type","location","depth_bucket"]);
  return Object.keys(row || {}).filter(k => !ignore.has(k) && typeof row[k] === "number");
}

function renderHeatmap(containerId, rows, title) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  const h = document.createElement("div");
  h.style.margin = "8px 0";
  h.style.fontWeight = "700";
  h.textContent = title;
  el.appendChild(h);

  if (!rows.length) {
    const p = document.createElement("div");
    p.textContent = "No data.";
    el.appendChild(p);
    return;
  }

  // Determine columns dynamically from numeric fields
  const cols = getNumericCols(rows[0]);
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.style.marginBottom = "10px";

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  const th0 = document.createElement("th");
  th0.textContent = "Row";
  th0.style.textAlign = "left";
  th0.style.padding = "6px";
  trh.appendChild(th0);

  cols.forEach(c => {
    const th = document.createElement("th");
    th.textContent = c.replaceAll("_"," ");
    th.style.padding = "6px";
    th.style.textAlign = "center";
    trh.appendChild(th);
  });

  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach(r => {
    const tr = document.createElement("tr");

    const td0 = document.createElement("td");
    td0.textContent = r.__label || "";
    td0.style.padding = "6px";
    td0.style.fontWeight = "700";
    tr.appendChild(td0);

    cols.forEach(c => {
      const td = document.createElement("td");
      const v = Number(r[c] || 0);
      const bg = heatColor(v);
      td.style.background = bg;
      td.style.color = textColor(bg);
      td.style.padding = "6px";
      td.style.textAlign = "center";
      td.textContent = (v*100).toFixed(1) + "%";
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  el.appendChild(table);
}

function matchupRows(off, def, dataRows) {
  const offN = normalizeTeam(off);
  const defN = normalizeTeam(def);
  const match = dataRows.filter(r => normalizeTeam(r.off_team) === offN && normalizeTeam(r.def_team) === defN);

  if (!match.length) return [];

  // Build offense/defense/edge rows based on numeric cols aggregation
  const cols = getNumericCols(match[0]);
  const sum = (arr, col) => arr.reduce((a, x) => a + (Number(x[col]) || 0), 0);

  // If file already has OFF/DEF rows we’ll just show the matching rows
  // Otherwise treat the matching set as “offense share” vs “def allowed” isn’t available
  // so we show a single row.
  if (match.length === 1) {
    const single = {...match[0], __label: "MATCHUP"};
    return [single];
  }

  // If rows include “row” label, preserve
  if (match[0].row) {
    return match.map(r => ({...r, __label: String(r.row)}));
  }

  // Fallback: average rows
  const avg = {};
  cols.forEach(c => avg[c] = sum(match, c) / match.length);
  avg.__label = "AVG";
  return [avg];
}

async function init() {
  // Grab DOM
  const gameSelect = document.getElementById("gameSelect");
  const styleSelect = document.getElementById("styleSelect");
  const offTeam = document.getElementById("offenseTeam");
  const defTeam = document.getElementById("defenseTeam");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const summaryEl = document.getElementById("summaryText");

  // Load CSVs
  try {
    const [games, players, rec, pass, rush] = await Promise.all([
      loadCsv(BASE + "games_classic.csv"),
      loadCsv(BASE + "players_classic.csv"),
      loadCsv(BASE + "optimal_lineup_rec.csv"),
      loadCsv(BASE + "heatmap_pass_matchup.csv"),
      loadCsv(BASE + "heatmap_rush_proxy.csv"),
    ]);

    state.games = games;
    state.players = players;
    state.rec = rec;
    state.pass = pass;
    state.rush = rush;

  } catch (e) {
    console.error(e);
    alert("CSV load failed. Check /data paths and file names. See console for details.");
    return;
  }

  // Populate game dropdown
  const gameLabels = state.games
    .map(g => g.game || g.Game || g.matchup || g.Matchup || `${g.away_team || g.Away}@${g.home_team || g.Home}`)
    .filter(Boolean);

  setOptions(gameSelect, gameLabels, true);

  // Style dropdown (basic)
  setOptions(styleSelect, ["Classic","Showdown","Matchup"], false);

  // Populate team dropdowns from heatmaps + games
  const teams = uniq([
    ...state.games.flatMap(g => [g.home_team, g.away_team, g.Home, g.Away]),
    ...state.pass.flatMap(r => [r.off_team, r.def_team]),
    ...state.rush.flatMap(r => [r.off_team, r.def_team]),
  ].map(normalizeTeam));

  setOptions(offTeam, teams, true);
  setOptions(defTeam, teams, true);

  // Default: pick first teams if blank
  if (!offTeam.value && teams[0]) offTeam.value = teams[0];
  if (!defTeam.value && teams[0]) defTeam.value = teams[0];

  function analyze() {
    const off = offTeam.value;
    const def = defTeam.value;

    const passRows = matchupRows(off, def, state.pass).map(r => ({...r, __label: r.__label || "PASS"}));
    const rushRows = matchupRows(off, def, state.rush).map(r => ({...r, __label: r.__label || "RUSH"}));

    renderHeatmap("passHeatmap", passRows, `Pass Heatmap — ${off} vs ${def}`);
    renderHeatmap("rushHeatmap", rushRows, `Rush Heatmap — ${off} vs ${def}`);

    summaryEl.textContent = `Showing matchup for ${off} vs ${def}. (Next: we’ll add edge rows + optimizer back once dropdowns are confirmed.)`;
  }

  analyzeBtn.addEventListener("click", analyze);

  // Auto render once loaded
  analyze();
}

document.addEventListener("DOMContentLoaded", init);
