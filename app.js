// APP VERSION: CLASSIC-SIMPLE-REWRITE-V1
const APP_VERSION = "CLASSIC-SIMPLE-REWRITE-V1";
console.log("APP VERSION:", APP_VERSION, new Date().toISOString());

/* ==========================
   Error banner (visible)
========================== */
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

/* ==========================
   Helpers
========================== */
const $ = (id) => document.getElementById(id) || null;

function num(x) {
  const v = parseFloat(x);
  return Number.isFinite(v) ? v : 0;
}
function uniq(arr) {
  return Array.from(new Set(arr));
}

function parseCSV(text) {
  const lines = (text || "").trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(","); // assumes no embedded commas
    const obj = {};
    headers.forEach((h, i) => (obj[h] = (cols[i] ?? "").trim()));
    return obj;
  });
}

// Cache busting:
// - uses script querystring (if any) + APP_VERSION + Date.now for CSV freshness
async function loadCSV(path) {
  const baseV =
    new URLSearchParams(location.search).get("v") ||
    new URLSearchParams(document.currentScript?.src?.split("?")[1] || "").get("v") ||
    APP_VERSION;

  const url = path + (path.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(baseV) + "&t=" + Date.now();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return parseCSV(await res.text());
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
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  el.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = r[h] ?? "";
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

function ensureRowContainer(heatmapTable) {
  // Create a controls row above the heatmap table (no dependency on HTML IDs)
  const card = heatmapTable?.closest(".card") || heatmapTable?.parentElement || document.body;
  let ctrl = card.querySelector("#hmCtrlRow");
  if (!ctrl) {
    ctrl = document.createElement("div");
    ctrl.id = "hmCtrlRow";
    ctrl.className = "row";
    ctrl.style.display = "flex";
    ctrl.style.gap = "8px";
    ctrl.style.alignItems = "center";
    ctrl.style.flexWrap = "wrap";
    ctrl.style.margin = "6px 0 10px";
    card.insertBefore(ctrl, heatmapTable);
  }
  return ctrl;
}

/* ==========================
   Main
========================== */
(async function main() {
  // Version stamp (optional)
  const versionStamp = $("versionStamp");
  if (versionStamp) {
    versionStamp.textContent = `Version: ${APP_VERSION}`;
  }

  // DOM (soft requirements: if missing, that section just won’t render)
  const gamesTable = $("gamesTable");
  const playersTable = $("playersTable");
  const heatmapTable = $("heatmapTable");

  const playerSearch = $("playerSearch");
  const posFilter = $("posFilter");
  const teamFilter = $("teamFilter");
  const sortBy = $("sortBy");

  const primaryGameSelect = $("primaryGameSelect");
  const buildLineupBtn = $("buildLineupBtn");
  const lineupTable = $("lineupTable");
  const lineupSummary = $("lineupSummary");

  const showPassHm = $("showPassHm");
  const showRushHm = $("showRushHm");

  // ---- Load CSVs ----
  const players = await loadCSV("data/players_classic.csv");
  const games = await loadCSV("data/games_classic.csv");
  const passHm = await loadCSV("data/heatmap_pass_matchup.csv");

  let optRec = [];
  try { optRec = await loadCSV("data/optimal_lineup_rec.csv"); } catch (e) {}

  let rushLaneOff = [];
  let rushLaneDef = [];
  try { rushLaneOff = await loadCSV("data/rush_lane_share_off.csv"); } catch (e) {}
  try { rushLaneDef = await loadCSV("data/rush_lane_share_def.csv"); } catch (e) {}

  /* ==========================
     Column mapping
  ========================== */
  const pName = guessCol(players[0], ["Player", "Name", "player_name", "PLAYER", "PlayerName"]);
  const pTeam = guessCol(players[0], ["Team", "team", "Tm"]);
  const pPos  = guessCol(players[0], ["Pos", "Position", "position"]);
  const pSal  = guessCol(players[0], ["Salary", "salary", "Sal", "DK_Salary"]);
  const pProj = guessCol(players[0], ["Proj", "Projection", "proj", "ProjectedPoints", "FPTS", "DK_Proj", "ProjPts"]);
  const pOwn  = guessCol(players[0], ["Ownership", "Own", "own", "ProjectedOwnership", "OWN"]);
  const pInj  = guessCol(players[0], ["Injury_Status", "injury_status", "Status", "Injury", "InjuryStatus"]);

  const gHome = guessCol(games[0], ["Home", "HomeTeam", "home_team"]);
  const gAway = guessCol(games[0], ["Away", "AwayTeam", "away_team"]);
  const gTotal = guessCol(games[0], ["Total", "Vegas_Total", "vegas_total", "Game_Total"]);
  const gSpread = guessCol(games[0], ["Spread", "spread"]);
  const gPaceNote = guessCol(games[0], ["Pace_Note", "PaceNote", "Pace"]);

  function isOut(p) {
    const s = (p[pInj] || "").toUpperCase();
    return s.includes("OUT");
  }

  /* ==========================
     Games + Env Score
  ========================== */
  const gEnv = "Env_Score";
  games.forEach((g) => {
    const total = num(g[gTotal]);
    const spread = Math.abs(num(g[gSpread]));
    const paceTxt = (g[gPaceNote] || "").toLowerCase();

    let paceBonus = 0;
    if (paceTxt.includes("fast")) paceBonus = 2;
    if (paceTxt.includes("slow")) paceBonus = -2;

    g[gEnv] = total + paceBonus - spread;
  });

  const gamesSorted = [...games].sort((a, b) => num(b[gEnv]) - num(a[gEnv]));

  if (gamesTable && gAway && gHome) {
    const headers = [gAway, gHome, gTotal, gEnv].filter(Boolean);
    setTable(gamesTable, headers, gamesSorted, (td, row, h) => {
      if (h === gEnv) td.textContent = num(row[h]).toFixed(2);
    });
  }

  if (primaryGameSelect && gAway && gHome) {
    primaryGameSelect.innerHTML = "";
    gamesSorted.forEach((g, idx) => {
      const opt = document.createElement("option");
      opt.value = String(idx);
      opt.textContent = `${g[gAway]} @ ${g[gHome]} (Total ${g[gTotal] ?? "-"} | Env ${num(g[gEnv]).toFixed(2)})`;
      primaryGameSelect.appendChild(opt);
    });
  }

  /* ==========================
     Players table + filters
  ========================== */
  function renderPlayers() {
    if (!playersTable || !players.length) return;

    const q = (playerSearch?.value || "").toLowerCase();
    const pos = posFilter?.value || "";
    const team = teamFilter?.value || "";
    const sort = sortBy?.value || "proj_desc";

    let rows = players.filter((p) => {
      const hay = `${p[pName] || ""} ${p[pTeam] || ""}`.toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (pos && (p[pPos] || "") !== pos) return false;
      if (team && (p[pTeam] || "") !== team) return false;
      return true;
    });

    rows = rows.map((p) => {
      const proj = num(p[pProj]);
      const sal = num(p[pSal]);
      const value = sal ? proj / (sal / 1000) : 0;
      return { ...p, __value: value };
    });

    if (sort === "proj_desc") rows.sort((a, b) => num(b[pProj]) - num(a[pProj]));
    if (sort === "value_desc") rows.sort((a, b) => b.__value - a.__value);
    if (sort === "own_asc") rows.sort((a, b) => num(a[pOwn]) - num(b[pOwn]));
    if (sort === "salary_desc") rows.sort((a, b) => num(b[pSal]) - num(a[pSal]));

    rows = rows.slice(0, 250);

    const headers = [pName, pTeam, pPos, pSal, pProj, pOwn, pInj].filter(Boolean);

    setTable(playersTable, headers, rows, (td, row, h) => {
      if (h === pProj) td.textContent = num(row[h]).toFixed(2);
      if (h === pSal) td.textContent = String(num(row[h]).toFixed(0));
      if (h === pOwn) td.textContent = num(row[h]).toFixed(3);
      if (h === pInj) {
        const s = (row[h] || "").toUpperCase();
        if (s.includes("OUT")) td.textContent = "OUT";
        else if (s.includes("Q")) td.textContent = "Q";
      }
    });
  }

  if (teamFilter && pTeam) {
    teamFilter.innerHTML = `<option value="">All Teams</option>`;
    uniq(players.map((p) => p[pTeam]).filter(Boolean)).sort().forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      teamFilter.appendChild(opt);
    });
  }

  ["input", "change"].forEach((evt) => {
    playerSearch?.addEventListener(evt, renderPlayers);
    posFilter?.addEventListener(evt, renderPlayers);
    teamFilter?.addEventListener(evt, renderPlayers);
    sortBy?.addEventListener(evt, renderPlayers);
  });

  renderPlayers();

  /* ==========================
     Classic lineup builder (simple + stable)
  ========================== */
  function topBy(rows, col, n = 1) {
    return [...rows].sort((a, b) => num(b[col]) - num(a[col])).slice(0, n);
  }

  function buildClassicLineup() {
    if (!gamesSorted.length) return { players: [], meta: { note: "No games loaded." } };
    const idx = parseInt(primaryGameSelect?.value || "0", 10) || 0;
    const g = gamesSorted[idx] || gamesSorted[0];

    const home = g[gHome];
    const away = g[gAway];

    const qbs = players.filter((p) =>
      (p[pPos] === "QB") &&
      (p[pTeam] === home || p[pTeam] === away) &&
      !isOut(p)
    );

    const qb = topBy(qbs, pProj, 1)[0];
    if (!qb) return { players: [], meta: { note: "No QB found in primary game." } };

    const qbTeam = qb[pTeam];
    const oppTeam = (qbTeam === home) ? away : home;

    const passCatchers = topBy(
      players.filter((p) =>
        p[pTeam] === qbTeam &&
        ["WR", "TE"].includes(p[pPos]) &&
        !isOut(p)
      ),
      pProj,
      2
    );

    const bringBack = topBy(
      players.filter((p) =>
        p[pTeam] === oppTeam &&
        ["RB", "WR", "TE"].includes(p[pPos]) &&
        !isOut(p)
      ),
      pProj,
      1
    )[0];

    const core = [qb, ...passCatchers, bringBack].filter(Boolean);
    const used = new Set(core.map((p) => p[pName]));

    const pool = players
      .filter((p) => !used.has(p[pName]) && !isOut(p))
      .map((p) => {
        const proj = num(p[pProj]);
        const sal = num(p[pSal]);
        const value = sal ? proj / (sal / 1000) : 0;
        return { ...p, __value: value };
      });

    const rbs = pool.filter((p) => p[pPos] === "RB").sort((a, b) => b.__value - a.__value);
    const others = pool.filter((p) => p[pPos] !== "RB").sort((a, b) => b.__value - a.__value);

    const fills = [...rbs.slice(0, 2), ...others.slice(0, 3)].slice(0, 5);
    const final = [...core, ...fills].slice(0, 9);

    const salary = final.reduce((s, p) => s + num(p[pSal]), 0);
    const proj = final.reduce((s, p) => s + num(p[pProj]), 0);

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
    if (!lineupTable || !lineupSummary) return;

    const meta = result.meta || {};
    lineupSummary.innerHTML = `
      <div><b>Primary:</b> ${meta.primaryGame || "-"}</div>
      <div><b>Total:</b> ${meta.total || "-"}</div>
      <div><b>Env:</b> ${meta.env || "-"}</div>
      <div><b>Proj:</b> ${meta.proj || "-"}</div>
      <div><b>Salary:</b> ${meta.salary || "-"}</div>
      <div><b>QB Team:</b> ${meta.qbTeam || "-"}</div>
      <div><b>Bring-back:</b> ${meta.bringBackTeam || "-"}</div>
    `;

    const headers = [pPos, pName, pTeam, pSal, pProj, pOwn, pInj].filter(Boolean);
    setTable(lineupTable, headers, result.players, (td, row, h) => {
      if (h === pProj) td.textContent = num(row[h]).toFixed(2);
      if (h === pSal) td.textContent = String(num(row[h]).toFixed(0));
      if (h === pOwn) td.textContent = num(row[h]).toFixed(3);
      if (h === pInj) {
        const s = (row[h] || "").toUpperCase();
        if (s.includes("OUT")) td.textContent = "OUT";
        else if (s.includes("Q")) td.textContent = "Q";
      }
    });
  }

  buildLineupBtn?.addEventListener("click", () => renderLineup(buildClassicLineup()));
  renderLineup(buildClassicLineup());

  /* ==========================
     HEATMAPS
     - Rush: stacked rows OFF/DEF/EDGE, color all rows, 7 lanes
     - Pass: stacked grid by depth (Short/Intermediate/Deep) x direction/location
  ========================== */
  if (!heatmapTable) return;

  // Controls row (injected)
  const ctrlRow = ensureRowContainer(heatmapTable);

  // Buttons: if missing in HTML, we create them
  function ensureButton(id, label) {
    let b = $(id);
    if (!b) {
      b = document.createElement("button");
      b.id = id;
      b.type = "button";
      b.textContent = label;
      ctrlRow.appendChild(b);
    }
    return b;
  }

  const passBtn = ensureButton("showPassHm", "Pass");
  const rushBtn = ensureButton("showRushHm", "Rush");

  // Off/Def dropdowns injected (no dependency on hmOffTeam/hmDefTeam)
  const offLabel = document.createElement("span");
  offLabel.textContent = "Off:";
  offLabel.style.opacity = "0.85";

  const offSel = document.createElement("select");
  offSel.id = "hmOffTeam";

  const defLabel = document.createElement("span");
  defLabel.textContent = "Def:";
  defLabel.style.opacity = "0.85";

  const defSel = document.createElement("select");
  defSel.id = "hmDefTeam";

  // Meta text
  let meta = $("heatmapMeta");
  if (!meta) {
    meta = document.createElement("div");
    meta.id = "heatmapMeta";
    meta.style.opacity = "0.8";
    meta.style.margin = "6px 0 10px";
    ctrlRow.parentElement?.insertBefore(meta, heatmapTable);
  }

  // Place selects after buttons (only once)
  if (!ctrlRow.querySelector("#hmOffTeam")) {
    ctrlRow.appendChild(offLabel);
    ctrlRow.appendChild(offSel);
    ctrlRow.appendChild(defLabel);
    ctrlRow.appendChild(defSel);
  }

  // Rush lane setup
  const laneOrder = ["left_end", "left_tackle", "left_guard", "center", "right_guard", "right_tackle", "right_end"];
  const laneLabels = {
    left_end: "Left End",
    left_tackle: "Left Tackle",
    left_guard: "Left Guard",
    center: "Center",
    right_guard: "Right Guard",
    right_tackle: "Right Tackle",
    right_end: "Right End",
  };

  const rushOffMap = {};
  rushLaneOff.forEach((r) => {
    const t = r.off_team || r.team;
    const lane = r.lane;
    if (!t || !lane) return;
    if (!rushOffMap[t]) rushOffMap[t] = {};
    rushOffMap[t][lane] = num(r.off_rush_share);
  });

  const rushDefMap = {};
  rushLaneDef.forEach((r) => {
    const t = r.def_team || r.team;
    const lane = r.lane;
    if (!t || !lane) return;
    if (!rushDefMap[t]) rushDefMap[t] = {};
    rushDefMap[t][lane] = num(r.def_rush_share_allowed);
  });

  // Pass setup
  const passTeamCol = guessCol(passHm[0], ["off_team", "Team", "team"]);
  const passOppCol  = guessCol(passHm[0], ["def_team", "Opponent", "opp"]);
  const passDepthCol= guessCol(passHm[0], ["depth", "Depth", "DEPTH"]);
  const passDirCol  = guessCol(passHm[0], ["direction", "dir", "side"]);
  const passLocCol  = guessCol(passHm[0], ["location", "Location", "loc"]);
  const passEdgeCol = guessCol(passHm[0], [
    "edge_off_minus_def",
    "edge_success_off_minus_def",
    "edge_success_off_minus_defproxy",
    "Edge",
    "edge",
  ]);

  // Teams list for selectors: prefer rush teams, fallback to games
  let teamsAll = uniq(Object.keys(rushOffMap).concat(Object.keys(rushDefMap))).filter(Boolean);
  if (!teamsAll.length && gamesSorted.length) {
    teamsAll = uniq(gamesSorted.flatMap(g => [g[gAway], g[gHome]])).filter(Boolean);
  }
  teamsAll.sort();

  function fillSel(sel) {
    sel.innerHTML = "";
    teamsAll.forEach((t) => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      sel.appendChild(o);
    });
  }
  fillSel(offSel);
  fillSel(defSel);

  // Default to top env game
  const topG = gamesSorted[0] || {};
  offSel.value = topG[gAway] || teamsAll[0] || "";
  defSel.value = topG[gHome] || teamsAll[0] || "";

  // Precompute stable rush edge min/max for coloring
  let rushEdgeMin = -1, rushEdgeMax = 1;
  if (teamsAll.length && Object.keys(rushOffMap).length && Object.keys(rushDefMap).length) {
    rushEdgeMin = Infinity; rushEdgeMax = -Infinity;
    teamsAll.forEach((oT) => {
      teamsAll.forEach((dT) => {
        laneOrder.forEach((l) => {
          const v = (rushOffMap[oT]?.[l] ?? 0) - (rushDefMap[dT]?.[l] ?? 0);
          rushEdgeMin = Math.min(rushEdgeMin, v);
          rushEdgeMax = Math.max(rushEdgeMax, v);
        });
      });
    });
    if (!Number.isFinite(rushEdgeMin)) rushEdgeMin = -1;
    if (!Number.isFinite(rushEdgeMax)) rushEdgeMax = 1;
  }

  let currentHm = "rush"; // default (since your rush is working)

  function renderRushStacked() {
    if (!Object.keys(rushOffMap).length || !Object.keys(rushDefMap).length) {
      meta.textContent = "Rush: missing rush_lane_share_off.csv / rush_lane_share_def.csv";
      showMessageTable(heatmapTable, "Rush Heatmap", "Missing rush lane CSVs in /data/.");
      return;
    }

    const offT = offSel.value;
    const defT = defSel.value;

    meta.textContent = `Rush: ${offT} vs ${defT} (stacked OFF/DEF/EDGE)`;

    const headers = ["Row", "off_team", "def_team",
      "Left End","Left Tackle","Left Guard","Center","Right Guard","Right Tackle","Right End"
    ];

    const offRow  = { Row: "OFFENSE (share %)",   off_team: offT, def_team: defT };
    const defRow  = { Row: "DEFENSE (allowed %)", off_team: offT, def_team: defT };
    const edgeRow = { Row: "EDGE (Off − Def)",    off_team: offT, def_team: defT };

    const offVals = [], defVals = [], edgeVals = [];

    laneOrder.forEach((l) => {
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

    // Color ALL rows: use "relative to row mean" for OFF/DEF, stable for EDGE
    const offAvg = offVals.reduce((a,b)=>a+b,0) / (offVals.length || 1);
    const defAvg = defVals.reduce((a,b)=>a+b,0) / (defVals.length || 1);

    const offMin = Math.min(...offVals.map(v => v - offAvg));
    const offMax = Math.max(...offVals.map(v => v - offAvg));

    const defMin = Math.min(...defVals.map(v => v - defAvg));
    const defMax = Math.max(...defVals.map(v => v - defAvg));

    setTable(heatmapTable, headers, [offRow, defRow, edgeRow], (td, r, h) => {
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
        td.style.backgroundColor = getColor(v, rushEdgeMin, rushEdgeMax);
        return;
      }
    });
  }

  function renderPassStackedGrid() {
    if (!passHm.length || !passEdgeCol || !passTeamCol || !passOppCol) {
      meta.textContent = "Pass: missing required columns/data in heatmap_pass_matchup.csv";
      showMessageTable(heatmapTable, "Pass Heatmap", "Pass heatmap file missing required columns.");
      return;
    }

    const offT = offSel.value;
    const defT = defSel.value;

    // Filter to selected matchup
    const rows = passHm.filter(r => (r[passTeamCol] === offT) && (r[passOppCol] === defT));
    if (!rows.length) {
      meta.textContent = `Pass: no rows for ${offT} vs ${defT}`;
      showMessageTable(heatmapTable, "Pass Heatmap", `No pass heatmap rows found for ${offT} vs ${defT}.`);
      return;
    }

    // Depth categories (columns)
    const depthKey = passDepthCol || "depth";
    const depthOrder = ["Short", "Intermediate", "Deep"];
    const depths = uniq(rows.map(r => (r[depthKey] || "").trim())).filter(Boolean);

    // Try to map depths into Short/Intermediate/Deep
    function normDepth(s) {
      const t = (s || "").toLowerCase();
      if (t.includes("short")) return "Short";
      if (t.includes("inter")) return "Intermediate";
      if (t.includes("deep")) return "Deep";
      return s;
    }

    // Row categories (direction/location)
    const axisKey = passLocCol || passDirCol || null;
    const axisValsRaw = axisKey ? uniq(rows.map(r => (r[axisKey] || "").trim())).filter(Boolean) : [];
    const preferred = ["Left", "Middle", "Right", "L", "M", "R"];
    let axisVals = axisValsRaw;

    // If we have Left/Middle/Right style values, order them nicely
    const hasLMR = axisValsRaw.some(v => /left|middle|right|^l$|^m$|^r$/i.test(v));
    if (hasLMR) {
      const toLMR = (v) => {
        const t = v.toLowerCase();
        if (t === "l" || t.includes("left")) return "Left";
        if (t === "m" || t.includes("mid") || t.includes("middle")) return "Middle";
        if (t === "r" || t.includes("right")) return "Right";
        return v;
      };
      axisVals = uniq(axisValsRaw.map(toLMR));
      axisVals = ["Left","Middle","Right"].filter(x => axisVals.includes(x)).concat(axisVals.filter(x => !["Left","Middle","Right"].includes(x)));
    }

    if (!axisVals.length) axisVals = ["All"];

    // Build matrix values: axisVal x depth
    // We average if multiple rows exist per cell
    const cellMap = {}; // axis|depth -> {sum,count}
    rows.forEach(r => {
      const depth = normDepth(r[depthKey]);
      const axis = axisKey ? (r[axisKey] || "").trim() : "All";
      const axisNorm = hasLMR ? (
        axis.toLowerCase() === "l" || axis.toLowerCase().includes("left") ? "Left" :
        axis.toLowerCase() === "m" || axis.toLowerCase().includes("mid") || axis.toLowerCase().includes("middle") ? "Middle" :
        axis.toLowerCase() === "r" || axis.toLowerCase().includes("right") ? "Right" :
        axis
      ) : axis;

      const k = `${axisNorm}||${depth}`;
      if (!cellMap[k]) cellMap[k] = { sum: 0, count: 0 };
      cellMap[k].sum += num(r[passEdgeCol]);
      cellMap[k].count += 1;
    });

    // Determine depth columns to show: prefer Short/Intermediate/Deep if present
    const depthCols = depthOrder.filter(d => depths.map(normDepth).includes(d));
    const finalDepthCols = depthCols.length ? depthCols : uniq(depths.map(normDepth));

    // Create table rows
    const headers = ["Row"].concat(finalDepthCols);
    const outRows = axisVals.map(ax => {
      const o = { Row: ax };
      finalDepthCols.forEach(d => {
        const k = `${ax}||${d}`;
        const v = cellMap[k] ? (cellMap[k].sum / (cellMap[k].count || 1)) : 0;
        o[d] = v;
      });
      return o;
    });

    // Color scale based on current matchup’s values
    const allVals = outRows.flatMap(r => finalDepthCols.map(d => num(r[d])));
    const mn = Math.min(...allVals);
    const mx = Math.max(...allVals);

    meta.textContent = `Pass: ${offT} vs ${defT} (rows=${axisKey || "All"}, cols=Depth)`;

    setTable(heatmapTable, headers, outRows, (td, r, h) => {
      if (h === "Row") { td.style.fontWeight = "700"; return; }
      const v = num(r[h]);
      td.textContent = (v >= 0 ? "+" : "") + v.toFixed(3);
      td.style.backgroundColor = getColor(v, mn, mx);
    });
  }

  function renderHeatmaps() {
    if (!teamsAll.length) {
      meta.textContent = "Heatmaps: no teams detected";
      showMessageTable(heatmapTable, "Heatmaps", "No teams found. Check your games/rush/pass CSVs.");
      return;
    }
    if (currentHm === "rush") renderRushStacked();
    else renderPassStackedGrid();
  }

  passBtn.addEventListener("click", () => { currentHm = "pass"; renderHeatmaps(); });
  rushBtn.addEventListener("click", () => { currentHm = "rush"; renderHeatmaps(); });
  offSel.addEventListener("change", renderHeatmaps);
  defSel.addEventListener("change", renderHeatmaps);

  // initial
  renderHeatmaps();
})();
