// ==========================
// NFL DFS Classic Dashboard
// FULL app.js (matches your current /data files)
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

function showMessageTable(el, title, msg) {
  setTable(el, [title], [{ [title]: msg }]);
}

// Diverging color scale centered at 0
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

// ==========================
// MAIN
// ==========================
(async function main() {
  // ---- Load your current files (exact names) ----
  const players = await loadCSV("data/players_classic.csv");
  const games = await loadCSV("data/games_classic.csv");
  const passHm = await loadCSV("data/heatmap_pass_matchup.csv");
  const rushProxy = await loadCSV("data/heatmap_rush_proxy.csv"); // kept for compatibility / “data files list”
  let optRec = [];
  try { optRec = await loadCSV("data/optimal_lineup_rec.csv"); } catch(e) {}

  let rushLaneOff = [];
  let rushLaneDef = [];
  try { rushLaneOff = await loadCSV("data/rush_lane_share_off.csv"); } catch(e) {}
  try { rushLaneDef = await loadCSV("data/rush_lane_share_def.csv"); } catch(e) {}

  // ---- Ensure required HTML ids exist ----
  const requiredIds = [
    "playersTable","gamesTable","heatmapTable",
    "playerSearch","posFilter","teamFilter","sortBy",
    "primaryGameSelect","buildLineupBtn",
    "lineupTable","lineupSummary",
    "showPassHm","showRushHm"
  ];
  for (const id of requiredIds) {
    if (!document.getElementById(id)) {
      throw new Error(`Missing HTML element id="${id}". Your index.html is out of sync.`);
    }
  }

  // ==========================
  // Column mapping: PLAYERS
  // ==========================
  const pName = guessCol(players[0], ["Player","Name","player_name","PLAYER","PlayerName"]);
  const pTeam = guessCol(players[0], ["Team","team","Tm"]);
  const pPos  = guessCol(players[0], ["Pos","Position","position"]);
  const pSal  = guessCol(players[0], ["Salary","salary","Sal","DK_Salary"]);
  const pProj = guessCol(players[0], ["Proj","Projection","proj","ProjectedPoints","FPTS","DK_Proj","ProjPts"]);
  const pOwn  = guessCol(players[0], ["Ownership","Own","own","ProjectedOwnership","OWN"]);
  const pInj  = guessCol(players[0], ["Injury_Status","injury_status","Status","Injury","InjuryStatus"]);

  // ==========================
  // Column mapping: GAMES
  // Your games_classic.csv headers (from screenshot):
  // Game, Home, Away, Total, Spread_x, Home_IMP, Away_IMP, Edge, Pace_Note, ...
  // ==========================
  const gHome = guessCol(games[0], ["Home","HomeTeam","home_team"]);
  const gAway = guessCol(games[0], ["Away","AwayTeam","away_team"]);
  const gTotal = guessCol(games[0], ["Total","Vegas_Total","vegas_total","Game_Total"]);
  const gSpread = guessCol(games[0], ["Spread","Spread_x"]);
  const gPaceNote = guessCol(games[0], ["Pace_Note","PaceNote","Pace"]);

  // Derive Env_Score even if your CSV doesn't have it
  const gEnv = "Env_Score";
  games.forEach(g => {
    const total = num(g[gTotal]);
    const spread = Math.abs(num(g[gSpread]));
    const paceTxt = (g[gPaceNote] || "").toLowerCase();

    let paceBonus = 0;
    if (paceTxt.includes("fast")) paceBonus = 2;
    if (paceTxt.includes("slow")) paceBonus = -2;

    // Env score: higher total + faster pace + closer spread
    g[gEnv] = (total + paceBonus - spread);
  });

  // ==========================
  // GAMES TABLE + PRIMARY GAME
  // ==========================
  const gamesSorted = [...games].sort((a,b)=>num(b[gEnv]) - num(a[gEnv]));
  const gamesHeaders = [gAway, gHome, gTotal, gEnv].filter(Boolean);

  setTable(document.getElementById("gamesTable"), gamesHeaders, gamesSorted, (td,row,h)=>{
    if (h === gEnv) td.innerHTML = `<span class="badge">${num(row[h]).toFixed(2)}</span>`;
  });

  const primarySelect = document.getElementById("primaryGameSelect");
  primarySelect.innerHTML = "";
  gamesSorted.forEach((g, idx)=>{
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `${g[gAway]} @ ${g[gHome]} (Total ${g[gTotal] ?? "-"} | Env ${num(g[gEnv]).toFixed(2)})`;
    primarySelect.appendChild(opt);
  });

  // ==========================
  // PLAYERS TABLE + FILTERS
  // ==========================
  const teamSel = document.getElementById("teamFilter");
  teamSel.innerHTML = `<option value="">All Teams</option>`;
  uniq(players.map(p => p[pTeam]).filter(Boolean)).sort().forEach(t=>{
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    teamSel.appendChild(opt);
  });

  const playersTable = document.getElementById("playersTable");
  const playerHeaders = [pName, pTeam, pPos, pSal, pProj, pOwn, pInj].filter(Boolean);

  function filteredPlayers() {
    const q = (document.getElementById("playerSearch").value || "").toLowerCase();
    const pos = document.getElementById("posFilter").value;
    const team = document.getElementById("teamFilter").value;
    const sortBy = document.getElementById("sortBy").value;

    let rows = players.filter(p=>{
      const hay = `${p[pName]||""} ${p[pTeam]||""}`.toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (pos && (p[pPos]||"") !== pos) return false;
      if (team && (p[pTeam]||"") !== team) return false;
      return true;
    });

    rows = rows.map(p=>{
      const proj = num(p[pProj]);
      const sal = num(p[pSal]);
      return { ...p, __value: sal ? proj/(sal/1000) : 0 };
    });

    if (sortBy === "proj_desc") rows.sort((a,b)=>num(b[pProj]) - num(a[pProj]));
    if (sortBy === "value_desc") rows.sort((a,b)=>b.__value - a.__value);
    if (sortBy === "own_asc") rows.sort((a,b)=>num(a[pOwn]) - num(b[pOwn]));
    if (sortBy === "salary_desc") rows.sort((a,b)=>num(b[pSal]) - num(a[pSal]));

    return rows.slice(0, 250);
  }

  function renderPlayers() {
    setTable(playersTable, playerHeaders, filteredPlayers(), (td,row,h)=>{
      if (h === pProj) td.innerHTML = `<span class="badge">${num(row[h]).toFixed(2)}</span>`;
      if (h === pInj) {
        const s = (row[h] || "").toUpperCase();
        if (s.includes("OUT")) td.innerHTML = `<span class="badge">OUT</span>`;
        else if (s.includes("Q")) td.innerHTML = `<span class="badge">Q</span>`;
      }
    });
  }

  ["playerSearch","posFilter","teamFilter","sortBy"].forEach(id=>{
    document.getElementById(id).addEventListener("input", renderPlayers);
    document.getElementById(id).addEventListener("change", renderPlayers);
  });
  renderPlayers();

  // ==========================
  // HEATMAPS
  // ==========================
  const heatTable = document.getElementById("heatmapTable");
  const passBtn = document.getElementById("showPassHm");
  const rushBtn = document.getElementById("showRushHm");
  let currentHm = "pass";

  // PASS heatmap: edge column varies in your file, so we guess broadly
  function renderPassHeatmap() {
    if (!passHm || !passHm.length) {
      showMessageTable(heatTable, "Heatmaps", "Missing data/heatmap_pass_matchup.csv");
      return;
    }

    const teamCol = guessCol(passHm[0], ["off_team","Team","team"]);
    const oppCol  = guessCol(passHm[0], ["def_team","Opponent","opp"]);
    const dirCol  = guessCol(passHm[0], ["direction","dir"]);
    const locCol  = guessCol(passHm[0], ["location","loc"]);
    const depthCol= guessCol(passHm[0], ["depth","Depth"]);

    const edgeCol = guessCol(passHm[0], [
      "edge_off_minus_def","edge_off_minus_defproxy",
      "edge_success_off_minus_defproxy",
      "edge_success_off_minus_def",
      "Edge","edge"
    ]);

    if (!edgeCol) {
      showMessageTable(heatTable, "Heatmaps", "Pass heatmap is missing an edge column (expected edge_*).");
      return;
    }

    const edges = passHm.map(r=>num(r[edgeCol]));
    const mn = Math.min(...edges);
    const mx = Math.max(...edges);

    const headers = [teamCol, oppCol, depthCol, locCol, dirCol, edgeCol].filter(Boolean);

    setTable(heatTable, headers, passHm.slice(0, 300), (td,row,h)=>{
      if (h === edgeCol) {
        const v = num(row[h]);
        td.textContent = v.toFixed(3);
        td.style.backgroundColor = getColor(v, mn, mx);
      }
    });
  }

  // RUSH 7-lane grid: uses your rush_lane_share_off/def files
  const laneOrder = ["left_end","left_tackle","left_guard","center","right_guard","right_tackle","right_end"];
  const laneLabels = {
    left_end: "Left End",
    left_tackle: "Left Tackle",
    left_guard: "Left Guard",
    center: "Center",
    right_guard: "Right Guard",
    right_tackle: "Right Tackle",
    right_end: "Right End"
  };

  const rushOffMap = {};
  rushLaneOff.forEach(r=>{
    const t = r.off_team || r.team;
    const lane = r.lane;
    if (!t || !lane) return;
    if (!rushOffMap[t]) rushOffMap[t] = {};
    rushOffMap[t][lane] = num(r.off_rush_share);
  });

  const rushDefMap = {};
  rushLaneDef.forEach(r=>{
    const t = r.def_team || r.team;
    const lane = r.lane;
    if (!t || !lane) return;
    if (!rushDefMap[t]) rushDefMap[t] = {};
    rushDefMap[t][lane] = num(r.def_rush_share_allowed);
  });

  const teamsAll = uniq(Object.keys(rushOffMap).concat(Object.keys(rushDefMap))).sort();

  // Build controls (Off/Def/Metric)
  const heatCard = heatTable.closest(".card");
  const ctrlRow = document.createElement("div");
  ctrlRow.className = "row";
  ctrlRow.id = "rushCtrlRow";
  ctrlRow.style.display = "none";

  const offSel = document.createElement("select");
  const defSel = document.createElement("select");
  const metricSel = document.createElement("select");
  metricSel.innerHTML = `
    <option value="edge">Edge (Off share − Def allowed)</option>
    <option value="off">Off rush share</option>
    <option value="def">Def allowed share</option>
  `;

  function fillSel(sel) {
    sel.innerHTML = "";
    teamsAll.forEach(t=>{
      const o = document.createElement("option");
      o.value = t; o.textContent = t;
      sel.appendChild(o);
    });
  }

  if (teamsAll.length) {
    fillSel(offSel);
    fillSel(defSel);

    // Default to top env game
    const topG = gamesSorted[0] || {};
    offSel.value = topG[gAway] || teamsAll[0];
    defSel.value = topG[gHome] || teamsAll[0];
  }

  const offLabel = document.createElement("span");
  offLabel.textContent = "Off:";
  offLabel.style.opacity = "0.8";
  const defLabel = document.createElement("span");
  defLabel.textContent = "Def:";
  defLabel.style.opacity = "0.8";

  ctrlRow.appendChild(offLabel);
  ctrlRow.appendChild(offSel);
  ctrlRow.appendChild(defLabel);
  ctrlRow.appendChild(defSel);
  ctrlRow.appendChild(metricSel);

 if (heatCard) {
  // safer: add controls near the top of the heatmap card even if table isn't a direct child
  heatCard.prepend(ctrlRow);
} else {
  // fallback: put controls right before the table
  heatTable.parentElement?.insertBefore(ctrlRow, heatTable);
}

  // Precompute edge min/max for coloring
  let edgeMin = -1, edgeMax = 1;
  if (teamsAll.length) {
    edgeMin = Infinity; edgeMax = -Infinity;
    teamsAll.forEach(offT=>{
      teamsAll.forEach(defT=>{
        laneOrder.forEach(l=>{
          const v = (rushOffMap[offT]?.[l] ?? 0) - (rushDefMap[defT]?.[l] ?? 0);
          edgeMin = Math.min(edgeMin, v);
          edgeMax = Math.max(edgeMax, v);
        });
      });
    });
    if (!Number.isFinite(edgeMin)) edgeMin = -1;
    if (!Number.isFinite(edgeMax)) edgeMax = 1;
  }

function renderRushHeatmap() {
  if (!teamsAll.length) {
    showMessageTable(
      heatTable,
      "Heatmaps",
      "Rush lane files not detected. Need:\n- data/rush_lane_share_off.csv\n- data/rush_lane_share_def.csv"
    );
    return;
  }

  const offT = offSel.value;
  const defT = defSel.value;
  const metric = metricSel.value; // we’ll still keep this dropdown, but stacked mode ignores it

  const headers = [
    "Row",
    "off_team",
    "def_team",
    "Left End",
    "Left Tackle",
    "Left Guard",
    "Center",
    "Right Guard",
    "Right Tackle",
    "Right End"
  ];

  // Build three stacked rows:
  const offRow = { Row: "OFFENSE (share %)", off_team: offT, def_team: defT };
  const defRow = { Row: "DEFENSE (allowed %)", off_team: offT, def_team: defT };
  const edgeRow = { Row: "EDGE (Off − Def)", off_team: offT, def_team: defT };

  laneOrder.forEach(l => {
    const offV = (rushOffMap[offT]?.[l] ?? 0);      // share %
    const defV = (rushDefMap[defT]?.[l] ?? 0);      // allowed share %
    const edgeV = offV - defV;                      // edge

    offRow[laneLabels[l]] = offV;
    defRow[laneLabels[l]] = defV;
    edgeRow[laneLabels[l]] = edgeV;
  });

  const rows = [offRow, defRow, edgeRow];

  setTable(heatTable, headers, rows, (td, r, h) => {
    if (h === "Row") {
      td.style.fontWeight = "700";
      return;
    }

    if (h === "off_team" || h === "def_team") {
      td.style.opacity = "0.9";
      return;
    }

    // Lane cells
    const v = num(r[h]);

    // OFF/DEF as % with 1 decimal
    if (r.Row.startsWith("OFFENSE") || r.Row.startsWith("DEFENSE")) {
      td.textContent = v.toFixed(1) + "%";
      td.style.backgroundColor = ""; // no coloring yet
      return;
    }

    // EDGE row: color scaled and show signed value
    if (r.Row.startsWith("EDGE")) {
      td.textContent = (v >= 0 ? "+" : "") + v.toFixed(2);
      td.style.backgroundColor = getColor(v, edgeMin, edgeMax);
      return;
    }
  });

  // Since we're stacked rows now, keep controls visible but you can hide metric dropdown if you want later
}


  // ==========================
  // CLASSIC LINEUP BUILDER (simple, works with your columns)
  // ==========================
  const lineupTable = document.getElementById("lineupTable");
  const lineupSummary = document.getElementById("lineupSummary");

  function isOut(p) {
    const s = (p[pInj] || "").toUpperCase();
    return s.includes("OUT");
  }

  function topBy(rows, col, n=1) {
    return [...rows].sort((a,b)=>num(b[col]) - num(a[col])).slice(0,n);
  }

  function buildClassicLineup() {
    if (!gamesSorted.length) return { players: [], meta: { note: "No games loaded." } };

    const idx = parseInt(primarySelect.value, 10) || 0;
    const g = gamesSorted[idx] || gamesSorted[0];

    const home = g[gHome];
    const away = g[gAway];

    // pick QB from primary game (higher proj)
    const qbs = players.filter(p =>
      (p[pPos] === "QB") &&
      (p[pTeam] === home || p[pTeam] === away) &&
      !isOut(p)
    );

    const qb = topBy(qbs, pProj, 1)[0];
    if (!qb) return { players: [], meta: { note: "No QB found in primary game." } };

    const qbTeam = qb[pTeam];
    const oppTeam = (qbTeam === home) ? away : home;

    const passCatchers = topBy(
      players.filter(p =>
        p[pTeam] === qbTeam &&
        ["WR","TE"].includes(p[pPos]) &&
        !isOut(p)
      ),
      pProj,
      2
    );

    const bringBack = topBy(
      players.filter(p =>
        p[pTeam] === oppTeam &&
        ["RB","WR","TE"].includes(p[pPos]) &&
        !isOut(p)
      ),
      pProj,
      1
    )[0];

    const core = [qb, ...passCatchers, bringBack].filter(Boolean);
    const used = new Set(core.map(p => p[pName]));

    const pool = players
      .filter(p => !used.has(p[pName]) && !isOut(p))
      .map(p => {
        const proj = num(p[pProj]);
        const sal = num(p[pSal]);
        const value = sal ? proj / (sal/1000) : 0;
        return { ...p, __value: value };
      });

    const rbs = pool.filter(p => p[pPos] === "RB").sort((a,b)=>b.__value - a.__value);
    const others = pool.filter(p => p[pPos] !== "RB").sort((a,b)=>b.__value - a.__value);

    const fills = [...rbs.slice(0,2), ...others.slice(0,3)].slice(0,5);
    const final = [...core, ...fills].slice(0,9);

    const salary = final.reduce((s,p)=>s + num(p[pSal]), 0);
    const proj = final.reduce((s,p)=>s + num(p[pProj]), 0);

    return {
      players: final,
      meta: {
        primaryGame: `${away} @ ${home}`,
        total: g[gTotal] ?? "-",
        env: num(g[gEnv]).toFixed(2),
        salary,
        proj: proj.toFixed(2),
        qbTeam,
        bringBackTeam: oppTeam
      }
    };
  }

  function renderLineup(result) {
    const meta = result.meta || {};
    lineupSummary.innerHTML = `
      <div class="pill"><b>Primary:</b> ${meta.primaryGame || "-"}</div>
      <div class="pill"><b>Total:</b> ${meta.total || "-"}</div>
      <div class="pill"><b>Env:</b> ${meta.env || "-"}</div>
      <div class="pill"><b>Proj:</b> ${meta.proj || "-"}</div>
      <div class="pill"><b>Salary:</b> ${meta.salary || "-"}</div>
      <div class="pill"><b>QB Team:</b> ${meta.qbTeam || "-"}</div>
      <div class="pill"><b>Bring-back:</b> ${meta.bringBackTeam || "-"}</div>
    `;

    const headers = [pPos, pName, pTeam, pSal, pProj, pOwn, pInj].filter(Boolean);
    setTable(lineupTable, headers, result.players, (td,row,h)=>{
      if (h === pProj) td.innerHTML = `<span class="badge">${num(row[h]).toFixed(2)}</span>`;
      if (h === pInj) {
        const s = (row[h] || "").toUpperCase();
        if (s.includes("OUT")) td.innerHTML = `<span class="badge">OUT</span>`;
        else if (s.includes("Q")) td.innerHTML = `<span class="badge">Q</span>`;
      }
    });
  }

  document.getElementById("buildLineupBtn").addEventListener("click", ()=>{
    renderLineup(buildClassicLineup());
  });

  renderLineup(buildClassicLineup());

})();
