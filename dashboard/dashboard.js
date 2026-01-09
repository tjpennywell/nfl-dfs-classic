// dashboard/dashboard.js  (NO IMPORTS — GitHub Pages safe)
const BASE = "data/";

const state = {
  games: [],
  pass: [],
  rushOff: [],
  rushDef: [],
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

const norm = (t) => {
  if (!t) return "";
  const x = String(t).trim().toUpperCase();
  if (x === "LAR") return "LA";
  return x;
};

function uniq(arr) {
  return Array.from(new Set(arr.map(norm))).filter(Boolean).sort();
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

// Dark heatmap colors
function heatColor(v) {
  v = Number(v);
  if (!Number.isFinite(v)) v = 0;
  v = Math.max(-1, Math.min(1, v));
  if (v >= 0) {
    const g = Math.floor(80 + 175 * v);
    const r = Math.floor(25 + 50 * (1 - v));
    const b = Math.floor(25 + 50 * (1 - v));
    return `rgb(${r},${g},${b})`;
  } else {
    const a = Math.abs(v);
    const r = Math.floor(80 + 175 * a);
    const g = Math.floor(25 + 50 * (1 - a));
    const b = Math.floor(25 + 50 * (1 - a));
    return `rgb(${r},${g},${b})`;
  }
}
function textColor(bg) {
  const m = bg.match(/\d+/g);
  if (!m) return "#fff";
  const r = +m[0], g = +m[1], b = +m[2];
  const lum = 0.2126*r + 0.7152*g + 0.0722*b;
  return lum > 120 ? "#111" : "#fff";
}

function renderTable(containerId, title, cols, rows, fmt = (x)=>String(x)) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";

  const h = document.createElement("div");
  h.style.margin = "8px 0";
  h.style.fontWeight = "800";
  h.textContent = title;
  el.appendChild(h);

  if (!rows.length) {
    const p = document.createElement("div");
    p.textContent = "No data for this matchup.";
    el.appendChild(p);
    return;
  }

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");

  const th0 = document.createElement("th");
  th0.textContent = "Row";
  th0.style.textAlign = "left";
  th0.style.padding = "6px";
  trh.appendChild(th0);

  cols.forEach(c => {
    const th = document.createElement("th");
    th.textContent = c;
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
    td0.textContent = r.label || "";
    td0.style.padding = "6px";
    td0.style.fontWeight = "800";
    tr.appendChild(td0);

    cols.forEach(c => {
      const td = document.createElement("td");
      const v = r[c];
      const bg = heatColor(v);
      td.style.background = bg;
      td.style.color = textColor(bg);
      td.style.padding = "6px";
      td.style.textAlign = "center";
      td.textContent = fmt(v);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  el.appendChild(table);
}

// PASS: build Short/Intermediate/Deep from heatmap_pass_matchup.csv
function buildPass(off, def) {
  const offT = norm(off), defT = norm(def);
  const rows = state.pass.filter(r => norm(r.off_team) === offT && norm(r.def_team) === defT);
  if (!rows.length) return [];

  // expected columns in file: depth_bucket + off_epa_per_att + def_epa_allowed_per_play + edge_off_minus_def
  const bucketMap = new Map();
  rows.forEach(r => {
    const b = String(r.depth_bucket || "").toLowerCase();
    if (b.includes("short")) bucketMap.set("Short", r);
    else if (b.includes("inter")) bucketMap.set("Intermediate", r);
    else if (b.includes("deep")) bucketMap.set("Deep", r);
  });

  const cols = ["Short","Intermediate","Deep"];

  const offense = { label: "OFFENSE (EPA/att)" };
  const defense = { label: "DEFENSE (EPA allowed)" };
  const edge   = { label: "EDGE (Off - Def)" };

  cols.forEach(c => {
    const r = bucketMap.get(c);
    offense[c] = r ? Number(r.off_epa_per_att) : 0;
    defense[c] = r ? Number(r.def_epa_allowed_per_play) : 0;
    edge[c]    = r ? Number(r.edge_off_minus_def) : (offense[c] - defense[c]);
  });

  return [offense, defense, edge];
}

// RUSH: build LE..RE from rush_lane_share_off/def
function buildRush(off, def) {
  const offT = norm(off), defT = norm(def);

  const offRow = state.rushOff.find(r => norm(r.off_team || r.team) === offT);
  const defRow = state.rushDef.find(r => norm(r.def_team || r.team) === defT);

  if (!offRow || !defRow) return [];

  // Try multiple possible column namings
  const laneCols = [
    ["Left End","LE"], ["Left Tackle","LT"], ["Left Guard","LG"], ["Center","C"],
    ["Right Guard","RG"], ["Right Tackle","RT"], ["Right End","RE"]
  ];

  const offense = { label: "OFFENSE (share %)" };
  const defense = { label: "DEFENSE (allowed %)" };
  const edge    = { label: "EDGE (Off - Def)" };

  laneCols.forEach(([nice, short]) => {
    // possible keys: "LE" or "left_end" or "Left End"
    const keys = [
      nice, short,
      nice.toLowerCase().replaceAll(" ","_"),
      short.toLowerCase()
    ];

    const getVal = (row) => {
      for (const k of keys) {
        if (row[k] !== undefined) return Number(row[k]);
      }
      return 0;
    };

    const o = getVal(offRow);
    const d = getVal(defRow);

    offense[nice] = o;
    defense[nice] = d;
    edge[nice] = o - d;
  });

  return [offense, defense, edge];
}

async function init() {
  const gameSelect = document.getElementById("gameSelect");
  const offTeam = document.getElementById("offenseTeam");
  const defTeam = document.getElementById("defenseTeam");
  const analyzeBtn = document.getElementById("analyzeBtn");
  const summaryEl = document.getElementById("summaryText");

  try {
    const [games, pass, rushOff, rushDef] = await Promise.all([
      loadCsv(BASE + "games_classic.csv"),
      loadCsv(BASE + "heatmap_pass_matchup.csv"),
      loadCsv(BASE + "rush_lane_share_off.csv"),
      loadCsv(BASE + "rush_lane_share_def.csv"),
    ]);
    state.games = games;
    state.pass = pass;
    state.rushOff = rushOff;
    state.rushDef = rushDef;
  } catch (e) {
    console.error(e);
    alert("CSV load failed. Check file names in /data (games, pass, rush_off, rush_def).");
    return;
  }

  // Populate games
  const gameLabels = state.games.map(g => {
    const a = norm(g.away_team || g.Away);
    const h = norm(g.home_team || g.Home);
    return (a && h) ? `${a}@${h}` : (g.game || g.Game || "");
  }).filter(Boolean);

  setOptions(gameSelect, gameLabels, true);

  // Teams from games
  const teams = uniq(state.games.flatMap(g => [g.home_team, g.away_team, g.Home, g.Away]));
  setOptions(offTeam, teams, true);
  setOptions(defTeam, teams, true);

  // Default selection
  if (teams[0]) offTeam.value = teams[0];
  if (teams[1]) defTeam.value = teams[1] || teams[0];

  function analyze() {
    const off = offTeam.value;
    const def = defTeam.value;

    const passRows = buildPass(off, def);
    const rushRows = buildRush(off, def);

    renderTable("passHeatmap", `Pass Heatmap — ${off} vs ${def}`, ["Short","Intermediate","Deep"], passRows,
      (v)=>Number(v).toFixed(3)
    );

    const rushCols = ["Left End","Left Tackle","Left Guard","Center","Right Guard","Right Tackle","Right End"];
    renderTable("rushHeatmap", `Rush Heatmap — ${off} vs ${def}`, rushCols, rushRows,
      (v)=>(Number(v)*100).toFixed(1) + "%"
    );

    summaryEl.textContent =
      `Matchup: ${off} vs ${def}. Pass table is EPA (off/def/edge) by depth. Rush table is lane share (off/def/edge).`;
  }

  analyzeBtn.addEventListener("click", analyze);
  analyze();
}

document.addEventListener("DOMContentLoaded", init);
