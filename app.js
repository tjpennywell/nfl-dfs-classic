// APP VERSION: CLASSIC-RUSH-STACKED-V1
console.log("APP VERSION: CLASSIC-RUSH-STACKED-V1", new Date().toISOString());

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
  // cache-bust on every load so GitHub Pages doesn't serve stale CSV/JS fetches
  const url = path + (path.includes("?") ? "&" : "?") + "v=" + Date.now();
  const res = await fetch(url);
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

function ensureId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing HTML element id="${id}". Your index.html is out of sync.`);
  return el;
}

// ==========================
// MAIN
// ==========================
(async function main() {
  // ---- Required DOM elements (must exist in your index.html) ----
  const gamesTable = ensureId("gamesTable");
  const playersTable = ensureId("playersTable");
  const heatmapTable = ensureId("heatmapTable");

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

  // ---- Load data (your current file names) ----
  const players = await loadCSV("data/players_classic.csv");
  const games = await loadCSV("data/games_classic.csv");
  const passHm = await loadCSV("data/heatmap_pass_matchup.csv");
  let rushProxy = [];
  try { rushProxy = await loadCSV("data/heatmap_rush_proxy.csv"); } catch (e) {}

  let optRec = [];
  try { optRec = await loadCSV("data/optimal_lineup_rec.csv"); } catch (e) {}

  let rushLaneOff = [];
  let rushLaneDef = [];
  try { rushLaneOff = await loadCSV("data/rush_lane_share_off.csv"); } catch (e) {}
  try { rushLaneDef = await loadCSV("data/rush_lane_share_def.csv"); } catch (e) {}

  // ==========================
  // PLAYERS column mapping
  // ==========================
  const pName = guessCol(players[0], ["Player","Name","player_name","PLAYER","PlayerName"]);
  const pTeam = guessCol(players[0], ["Team","team","Tm"]);
  const pPos  = guessCol(players[0], ["Pos","Position","position"]);
  const pSal  = guessCol(players[0], ["Salary","salary","Sal","DK_Salary"]);
  const pProj = guessCol(players[0], ["Proj","Projection","proj","ProjectedPoints","FPTS","DK_Proj","ProjPts"]);
  const pOwn  = guessCol(players[0], ["Ownership","Own","own","ProjectedOwnership","OWN"]);
  const pInj  = guessCol(players[0], ["Injury_Status","injury_status","Status","Injury","InjuryStatus"]);

  // If projection column wasn't matched, don't crash; show warning via badge as 0
  if (!pProj) console.warn("Projection column not found in players_classic.csv. Add a column named Proj or Projection.");

  // ==========================
  // GAMES column mapping (your screenshot shows Home/Away/Total/Pace_Note/Spread)
  // ==========================
  const gHome = guessCol(games[0], ["Home","HomeTeam","home_team"]);
  const gAway = guessCol(games[0], ["Away","AwayTeam","away_team"]);
  const gTotal = guessCol(games[0], ["Total","Vegas_Total","vegas_total","Game_Total"]);
  const gSpread = guessCol(games[0], ["Spread","Spread_x"]);
  const gPaceNote = guessCol(games[0], ["Pace_Note","PaceNote","Pace"]);

  // Derive Env_Score
  const gEnv = "Env_Score";
  games.forEach(g => {
    const total = num(g[gTotal]);
    const spread = Math.abs(num(g[gSpread]));
    const paceTxt = (g[gPaceNote] || "").toLowerCase();

    let paceBonus = 0;
    if (paceTxt.includes("fast")) paceBonus = 2;
    if (paceTxt.includes("slow")) paceBonus = -2;

    // Higher total + faster pace + closer spread
    g[gEnv] = (total + paceBonus - spread);
  });

  // Render games table
  const gamesSorted = [...games].sort((a,b)=>num(b[gEnv]) - num(a[gEnv]));
  const gamesHeaders = [gAway, gHome, gTotal, gEnv].filter(Boolean);

  setTable(gamesTable, gamesHeaders, gamesSorted, (td,row,h)=>{
    if (h === gEnv) td.innerHTML = `<span class="badge">${num(row[h]).toFixed(2)}</span>`;
  });

  // Populate primary game select
  primaryGameSelect.innerHTML = "";
  gamesSorted.forEach((g, idx)=>{
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `${g[gAway]} @ ${g[gHome]} (Total ${g[gTotal] ?? "-"} | Env ${num(g[gEnv]).toFixed(2)})`;
    primaryGameSelect.appendChild(opt);
  });

  // ==========================
  // Players filters & table
  // ==========================
  teamFilter.innerHTML = `<option value="">All Teams</option>`;
  uniq(players.map(p => p[pTeam]).filter(Boolean)).sort().forEach(t=>{
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    teamFilter.appendChild(opt);
  });

  const playerHeaders = [pName, pTeam, pPos, pSal, pProj, pOwn, pInj].filter(Boolean);

  function isOut(p) {
    const s = (p[pInj] || "").toUpperCase();
    return s.includes("OUT");
  }

  function filteredPlayers() {
    const q = (playerSearch.value || "").toLowerCase();
    const pos = posFilter.value;
    const team = teamFilter.value;
    const sort = sortBy.value;

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
      const value = sal ? proj / (sal/1000) : 0;
      return { ...p, __value: value };
    });

    if (sort === "proj_desc") rows.sort((a,b)=>num(b[pProj]) - num(a[pProj]));
    if (sort === "value_desc") rows.sort((a,b)=>b.__value - a.__value);
    if (sort === "own_asc") rows.sort((a,b)=>num(a[pOwn]) - num(b[pOwn]));
    if (sort === "salary_desc") rows.sort((a,b)=>num(b[pSal]) - num(a[pSal]));

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
  ["input","change"].forEach(evt=>{
    playerSearch.addEventListener(evt, renderPlayers);
    posFilter.addEventListener(evt, renderPlayers);
    teamFilter.addEventListener(evt, renderPlayers);
    sortBy.addEventListener(evt, renderPlayers);
  });
  renderPlayers();

  // ==========================
  // Classic lineup builder (simple rules)
  // ==========================
  function topBy(rows, col, n=1) {
    return [...rows].sort((a,b)=>num(b[col]) - num(a[col])).slice(0,n);
  }

  function buildClassicLineup() {
    if (!gamesSorted.length) return { players: [], meta: { note: "No games loaded." } };

    const idx = parseInt(primaryGameSelect.value, 10) || 0;
    const g = gamesSorted[idx] || gamesSorted[0];

    const home = g[gHome];
    const away = g[gAway];

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

  buildLineupBtn.addEventListener("click", ()=> renderLineup(buildClassicLineup()));
  renderLineup(buildClassicLineup());

  // ==========================
  // HEATMAPS
  // ==========================
  let currentHm = "pass";

  // PASS heatmap table (data-first)
  function renderPassPFFGrid() {
    if (!passHm || !passHm.length) {
      showMessageTable(heatmapTable, "Heatmaps", "Missing data/heatmap_pass_matchup.csv");
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
      showMessageTable(heatmapTable, "Heatmaps", "Pass heatmap is missing an edge column (edge_*).");
      return;
    }

    const edges = passHm.map(r=>num(r[edgeCol]));
    const mn = Math.min(...edges);
    const mx = Math.max(...edges);

    const headers = [teamCol, oppCol, depthCol, locCol, dirCol, edgeCol].filter(Boolean);
    setTable(heatmapTable, headers, passHm.slice(0, 300), (td,row,h)=>{
      if (h === edgeCol) {
        const v = num(row[h]);
        td.textContent = v.toFixed(3);
        td.style.backgroundColor = getColor(v, mn, mx);
      }
    });
  }
  // ==========================
// PASS PFF-STYLE 3x3 GRID
// ==========================
function renderPassPFFGrid() {
  if (!passHm || !passHm.length) {
    showMessageTable(heatmapTable, "Heatmaps", "Missing pass heatmap data.");
    return;
  }

  const offCol   = "off_team";
  const defCol   = "def_team";
  const locCol   = "location";
  const depthCol = "depth_bucket";
  const edgeCol  = "edge_off_minus_def";
  const wtCol    = "off_pass_attempts";

  const offT = offSel ? offSel.value : passHm[0][offCol];
  const defT = defSel ? defSel.value : passHm[0][defCol];

  const rows = passHm.filter(r =>
    r[offCol] === offT &&
    r[defCol] === defT &&
    (r.play_type || "").toLowerCase().includes("pass")
  );

  if (!rows.length) {
    showMessageTable(
      heatmapTable,
      "Heatmaps",
      `No pass data for ${offT} vs ${defT}`
    );
    return;
  }

  const LOCS   = ["left","middle","right"];
  const DEPTHS = ["short","intermediate","deep"];

  // Aggregate weighted edge
  const grid = {};
  LOCS.forEach(l => {
    grid[l] = {};
    DEPTHS.forEach(d => {
      const cell = rows.filter(r =>
        (r[locCol] || "").toLowerCase() === l &&
        (r[depthCol] || "").toLowerCase() === d
      );

      let nume = 0, deno = 0;
      cell.forEach(r => {
        const w = Math.max(1, num(r[wtCol]));
        nume += num(r[edgeCol]) * w;
        deno += w;
      });

      grid[l][d] = deno ? (nume / deno) : 0;
    });
  });

  // Flatten for color scaling
  const vals = [];
  LOCS.forEach(l => DEPTHS.forEach(d => vals.push(grid[l][d])));
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals);

  // Render as table (PFF spatial layout)
  const headers = ["", "Short", "Intermediate", "Deep"];
  const rowsOut = LOCS.map(l => ({
    Row: l.toUpperCase(),
    Short: grid[l].short,
    Intermediate: grid[l].intermediate,
    Deep: grid[l].deep
  }));

  setTable(heatmapTable, headers, rowsOut, (td, r, h) => {
    if (h === "") return;

    if (h === "Row") {
      td.style.fontWeight = "700";
      return;
    }

    const v = num(r[h]);
    td.textContent = (v >= 0 ? "+" : "") + v.toFixed(3);
    td.style.backgroundColor = getColor(v, vMin, vMax);
  });
}


  // RUSH stacked rows (OFF / DEF / EDGE), color ALL rows
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

  // Create Off/Def selectors (always present in Rush view)
  const heatCard = heatmapTable.closest(".card") || heatmapTable.parentElement;
  const ctrlRow = document.createElement("div");
  ctrlRow.className = "row";
  ctrlRow.id = "rushCtrlRow";
  ctrlRow.style.display = "none";
  ctrlRow.style.gap = "8px";
  ctrlRow.style.alignItems = "center";
  ctrlRow.style.marginBottom = "10px";

  const offLabel = document.createElement("span");
  offLabel.textContent = "Off:";
  offLabel.style.opacity = "0.85";

  const defLabel = document.createElement("span");
  defLabel.textContent = "Def:";
  defLabel.style.opacity = "0.85";

  const offSel = document.createElement("select");
  const defSel = document.createElement("select");

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

    // default to top env game teams
    const topG = gamesSorted[0] || {};
    offSel.value = topG[gAway] || teamsAll[0];
    defSel.value = topG[gHome] || teamsAll[0];
  }

  ctrlRow.appendChild(offLabel);
  ctrlRow.appendChild(offSel);
  ctrlRow.appendChild(defLabel);
  ctrlRow.appendChild(defSel);

  if (heatCard) {
    // safest placement
    heatCard.prepend(ctrlRow);
  }

  // Precompute edge min/max across all matchups (stable scaling)
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
        heatmapTable,
        "Heatmaps",
        "Rush lane files not detected. Need:\n- data/rush_lane_share_off.csv\n- data/rush_lane_share_def.csv"
      );
      return;
    }

    const offT = offSel.value;
    const defT = defSel.value;

    const headers = [
      "Row","off_team","def_team",
      "Left End","Left Tackle","Left Guard","Center","Right Guard","Right Tackle","Right End"
    ];

    const offRow  = { Row: "OFFENSE (share %)",   off_team: offT, def_team: defT };
    const defRow  = { Row: "DEFENSE (allowed %)", off_team: offT, def_team: defT };
    const edgeRow = { Row: "EDGE (Off − Def)",    off_team: offT, def_team: defT };

    const offVals = [];
    const defVals = [];
    const edgeVals = [];

    laneOrder.forEach(l => {
      const offV = (rushOffMap[offT]?.[l] ?? 0);
      const defV = (rushDefMap[defT]?.[l] ?? 0);
      const edgeV = offV - defV;

      offRow[laneLabels[l]] = offV;
      defRow[laneLabels[l]] = defV;
      edgeRow[laneLabels[l]] = edgeV;

      offVals.push(offV);
      defVals.push(defV);
      edgeVals.push(edgeV);
    });

    const offAvg = offVals.length ? (offVals.reduce((a,b)=>a+b,0)/offVals.length) : 0;
    const defAvg = defVals.length ? (defVals.reduce((a,b)=>a+b,0)/defVals.length) : 0;

    const offMin = offVals.length ? Math.min(...offVals.map(v=>v-offAvg)) : -1;
    const offMax = offVals.length ? Math.max(...offVals.map(v=>v-offAvg)) : 1;
    const defMin = defVals.length ? Math.min(...defVals.map(v=>v-defAvg)) : -1;
    const defMax = defVals.length ? Math.max(...defVals.map(v=>v-defAvg)) : 1;

    const rows = [offRow, defRow, edgeRow];

    setTable(heatmapTable, headers, rows, (td, r, h) => {
      if (h === "Row") { td.style.fontWeight = "700"; return; }
      if (h === "off_team" || h === "def_team") { td.style.opacity = "0.9"; return; }

      const v = num(r[h]);

      if (r.Row.startsWith("OFFENSE")) {
        const dv = v - offAvg;
        td.textContent = v.toFixed(1) + "%";
        td.style.backgroundColor = getColor(dv, offMin, offMax);
        return;
      }

      if (r.Row.startsWith("DEFENSE")) {
        const dv = v - defAvg;
        td.textContent = v.toFixed(1) + "%";
        // invert: higher allowed = worse -> red
        td.style.backgroundColor = getColor(-dv, defMin, defMax);
        return;
      }

      if (r.Row.startsWith("EDGE")) {
        td.textContent = (v >= 0 ? "+" : "") + v.toFixed(2);
        td.style.backgroundColor = getColor(v, edgeMin, edgeMax);
        return;
      }
    });
  }

  function renderHeatmap() {
    if (currentHm === "pass") {
      ctrlRow.style.display = "none";
      renderPassHeatmap();
    } else {
      ctrlRow.style.display = teamsAll.length ? "flex" : "none";
      renderRushHeatmap();
    }
  }

  showPassHm.addEventListener("click", ()=>{ currentHm = "pass"; renderHeatmap(); });
  showRushHm.addEventListener("click", ()=>{ currentHm = "rush"; renderHeatmap(); });

  offSel.addEventListener("change", renderHeatmap);
  defSel.addEventListener("change", renderHeatmap);

  renderHeatmap();

})();
