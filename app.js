// === DEBUG BANNER (shows errors on the page) ===
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
      document.body.appendChild(bar);
    }
    bar.textContent = "Dashboard error:\n" + msg;
  }

  window.addEventListener("error", (e) => show(e.message || String(e.error || e)));
  window.addEventListener("unhandledrejection", (e) => show(String(e.reason || e)));
})();
// Minimal, dependency-free CSV parser (handles simple CSVs)
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(","); // assumes no embedded commas
    const obj = {};
    headers.forEach((h, i) => obj[h] = (cols[i] ?? "").trim());
    return obj;
  });
}

async function loadCSV(path) {
  const res = await fetch(path + "?v=" + Date.now()); // cache-bust
  const text = await res.text();
  return parseCSV(text);
}

function num(x) {
  const v = parseFloat(x);
  return Number.isFinite(v) ? v : 0;
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

function setTable(el, headers, rows, cellFn) {
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
      td.textContent = r[h] ?? "";
      if (cellFn) cellFn(td, r, h);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  el.appendChild(tbody);
}

function uniq(arr) { return Array.from(new Set(arr)); }

function guessCol(row, candidates) {
  for (const c of candidates) if (c in row) return c;
  return null;
}

(async function main(){
  // Load data
  const players = await loadCSV("data/players_classic.csv");
  const games = await loadCSV("data/games_classic.csv");
  const passHm = await loadCSV("data/heatmap_pass_matchup.csv");
  const rushHm = await loadCSV("data/heatmap_rush_proxy.csv");

  // NEW: Rush lane share files (from matchup workbook)
  // If these files don't exist, Rush grid will still fail gracefully.
  let rushLaneOff = [];
  let rushLaneDef = [];
  try { rushLaneOff = await loadCSV("data/rush_lane_share_off.csv"); } catch(e) {}
  try { rushLaneDef = await loadCSV("data/rush_lane_share_def.csv"); } catch(e) {}

  // Column mapping (best-effort)
  const pName = guessCol(players[0] || {}, ["Name","Player","player_name","PLAYER","PlayerName"]);
  const pTeam = guessCol(players[0] || {}, ["Team","team","Tm"]);
  const pPos  = guessCol(players[0] || {}, ["Pos","Position","position"]);
  const pSal  = guessCol(players[0] || {}, ["Salary","salary","Sal"]);
  const pProj = guessCol(players[0] || {}, ["Proj","Projection","proj","ProjectedPoints","FPTS"]);
  const pOwn  = guessCol(players[0] || {}, ["Own","Ownership","own","ProjectedOwnership"]);
  const pInj  = guessCol(players[0] || {}, ["Injury_Status","injury_status","Status"]);

  const gHome = guessCol(games[0] || {}, ["HomeTeam","Home","home_team"]);
  const gAway = guessCol(games[0] || {}, ["AwayTeam","Away","away_team"]);
  const gTotal= guessCol(games[0] || {}, ["Total","Vegas_Total","vegas_total","Game_Total"]);
  const gEnv  = guessCol(games[0] || {}, ["Env_Score","env_score","EnvScore"]);

  // Populate team filter
  const teamSel = document.getElementById("teamFilter");
  uniq(players.map(p => p[pTeam]).filter(Boolean)).sort().forEach(t=>{
    const opt = document.createElement("option");
    opt.value = t; opt.textContent = t;
    teamSel.appendChild(opt);
  });

  // Games table + primary game select
  const gamesSorted = [...games].sort((a,b)=>num(b[gEnv]) - num(a[gEnv]));
  const primarySelect = document.getElementById("primaryGameSelect");
  gamesSorted.forEach((g, idx)=>{
    const opt = document.createElement("option");
    const label = `${g[gAway]} @ ${g[gHome]} (Env ${num(g[gEnv]).toFixed(2)})`;
    opt.value = idx;
    opt.textContent = label;
    primarySelect.appendChild(opt);
  });

  const gamesHeaders = [gAway, gHome, gTotal, gEnv].filter(Boolean);
  setTable(document.getElementById("gamesTable"), gamesHeaders, gamesSorted, (td,row,h)=>{
    if (h === gEnv) td.innerHTML = `<span class="badge">${num(row[h]).toFixed(2)}</span>`;
  });

  // Players table rendering
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

    if (sortBy === "proj_desc") rows.sort((a,b)=>num(b[pProj])-num(a[pProj]));
    if (sortBy === "value_desc") rows.sort((a,b)=>b.__value-a.__value);
    if (sortBy === "own_asc") rows.sort((a,b)=>num(a[pOwn])-num(b[pOwn]));
    if (sortBy === "salary_desc") rows.sort((a,b)=>num(b[pSal])-num(a[pSal]));

    return rows.slice(0, 250);
  }

  function renderPlayers() {
    setTable(playersTable, playerHeaders, filteredPlayers(), (td,row,h)=>{
      if (h === pProj) td.innerHTML = `<span class="badge">${num(row[h]).toFixed(2)}</span>`;
      if (h === pInj && (row[h]||"").toUpperCase().includes("OUT")) td.innerHTML = `<span class="badge">OUT</span>`;
    });
  }

  ["playerSearch","posFilter","teamFilter","sortBy"].forEach(id=>{
    document.getElementById(id).addEventListener("input", renderPlayers);
    document.getElementById(id).addEventListener("change", renderPlayers);
  });
  renderPlayers();

  // ===== Heatmaps =====
  const heatTable = document.getElementById("heatmapTable");
  let currentHm = "pass";

  // Rush 7 lanes setup (team -> lane -> share)
  const laneOrder = ["left_end","left_tackle","left_guard","center","right_guard","right_tackle","right_end"];

  const rushOffMap = {};
  rushLaneOff.forEach(r=>{
    const t = r.off_team;
    if (!rushOffMap[t]) rushOffMap[t] = {};
    rushOffMap[t][r.lane] = num(r.off_rush_share);
  });

  const rushDefMap = {};
  rushLaneDef.forEach(r=>{
    const t = r.def_team;
    if (!rushDefMap[t]) rushDefMap[t] = {};
    rushDefMap[t][r.lane] = num(r.def_rush_share_allowed);
  });

  const teamsAll = uniq(Object.keys(rushOffMap).concat(Object.keys(rushDefMap))).sort();

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
  }

  // Add Rush controls (only if lane files exist)
  const heatCard = document.getElementById("heatmapTable").closest(".card");
  const ctrlRow = document.createElement("div");
  ctrlRow.className = "row";
  ctrlRow.id = "rushCtrlRow";
  ctrlRow.style.display = "none";

  const offSel = document.createElement("select");
  offSel.id = "rushOffTeam";
  const defSel = document.createElement("select");
  defSel.id = "rushDefTeam";
  const metricSel = document.createElement("select");
  metricSel.id = "rushMetric";
  metricSel.innerHTML = `
    <option value="edge">Edge (Off share − Def allowed share)</option>
    <option value="off">Off rush share (by lane)</option>
    <option value="def">Def allowed share (by lane)</option>
  `;

  function fillTeamSelect(sel) {
    sel.innerHTML = "";
    (teamsAll.length ? teamsAll : [""]).forEach(t=>{
      const o = document.createElement("option");
      o.value = t; o.textContent = t || "—";
      sel.appendChild(o);
    });
  }
  fillTeamSelect(offSel);
  fillTeamSelect(defSel);

  // Default selection: top Env game teams if possible
  const defaultGame = gamesSorted[0] || {};
  if (teamsAll.length) {
    offSel.value = defaultGame[gAway] || teamsAll[0];
    defSel.value = defaultGame[gHome] || teamsAll[0];
  }

  const offLabel = document.createElement("span"); offLabel.textContent = "Off:"; offLabel.style.opacity = "0.8";
  const defLabel = document.createElement("span"); defLabel.textContent = "Def:"; defLabel.style.opacity = "0.8";

  ctrlRow.appendChild(offLabel);
  ctrlRow.appendChild(offSel);
  ctrlRow.appendChild(defLabel);
  ctrlRow.appendChild(defSel);
  ctrlRow.appendChild(metricSel);

  heatCard.insertBefore(ctrlRow, document.getElementById("heatmapTable"));

  function renderHeatmap() {
    if (currentHm === "pass") {
      ctrlRow.style.display = "none";

      const edgeCol = guessCol(passHm[0] || {}, ["edge_off_minus_def","Edge","edge"]);
      const teamCol = guessCol(passHm[0] || {}, ["off_team","Team","team"]);
      const oppCol  = guessCol(passHm[0] || {}, ["def_team","Opponent","opp"]);
      const locCol  = guessCol(passHm[0] || {}, ["location","Location","loc"]);
      const depthCol= guessCol(passHm[0] || {}, ["depth","Depth","dep"]);

      const edges = passHm.map(r=>num(r[edgeCol]));
      const mn = Math.min(...edges), mx = Math.max(...edges);
      const headers = [teamCol, oppCol, depthCol, locCol, edgeCol].filter(Boolean);

      setTable(heatTable, headers, passHm.slice(0,300), (td,row,h)=>{
        if (h === edgeCol) {
          const v = num(row[h]);
          td.textContent = v.toFixed(3);
          td.style.backgroundColor = getColor(v, mn, mx);
        }
      });
      return;
    }

    // Rush
    // If lane files missing, show a helpful message
    if (!teamsAll.length) {
      ctrlRow.style.display = "none";
      setTable(heatTable, ["Rush heatmap files missing"], [{ "Rush heatmap files missing": "Upload data/rush_lane_share_off.csv and data/rush_lane_share_def.csv" }]);
      return;
    }

    ctrlRow.style.display = "flex";

    const offT = offSel.value;
    const defT = defSel.value;
    const metric = metricSel.value;

    // Build one-row grid
    const headers = ["off_team","def_team",
      "Left End","Left Tackle","Left Guard","Center","Right Guard","Right Tackle","Right End"
    ];

    const row = { "off_team": offT, "def_team": defT };

    laneOrder.forEach(l=>{
      const offV = (rushOffMap[offT]?.[l] ?? 0);
      const defV = (rushDefMap[defT]?.[l] ?? 0);
      let v = 0;
      if (metric === "edge") v = offV - defV;
      if (metric === "off") v = offV;
      if (metric === "def") v = defV;

      const label =
        l === "left_end" ? "Left End" :
        l === "left_tackle" ? "Left Tackle" :
        l === "left_guard" ? "Left Guard" :
        l === "center" ? "Center" :
        l === "right_guard" ? "Right Guard" :
        l === "right_tackle" ? "Right Tackle" :
        "Right End";

      row[label] = v;
    });

    setTable(heatTable, headers, [row], (td,r,h)=>{
      if (["Left End","Left Tackle","Left Guard","Center","Right Guard","Right Tackle","Right End"].includes(h)) {
        const v = num(r[h]);
        td.textContent = v.toFixed(2);

        if (metric === "edge") td.style.backgroundColor = getColor(v, edgeMin, edgeMax);
        else td.style.backgroundColor = `rgba(255,255,255, ${Math.min(Math.max(v/35,0),0.35)})`;
      }
    });
  }

  // Hook buttons
  document.getElementById("showPassHm").addEventListener("click", ()=>{ currentHm="pass"; renderHeatmap(); });
  document.getElementById("showRushHm").addEventListener("click", ()=>{ currentHm="rush"; renderHeatmap(); });

  // Hook rush controls
  [offSel, defSel, metricSel].forEach(el=> el.addEventListener("change", renderHeatmap));

  // Initial render
  renderHeatmap();

  // Classic lineup builder (simple + injury-aware)
  function isOut(p) {
    const s = (p[pInj]||"").toUpperCase();
    return s.includes("OUT");
  }

  function topBy(rows, col, n=1, filterFn=null) {
    let r = rows;
    if (filterFn) r = r.filter(filterFn);
    return r.sort((a,b)=>num(b[col])-num(a[col])).slice(0,n);
  }

  function buildClassic() {
    const idx = parseInt(primarySelect.value, 10) || 0;
    const g = gamesSorted[idx];
    const home = g[gHome], away = g[gAway];

    // Pick QB from primary game: choose higher projected QB between the two teams if possible
    const qbs = players.filter(p => (p[pPos]==="QB") && (p[pTeam]===home || p[pTeam]===away) && !isOut(p));
    const qb = topBy(qbs, pProj, 1)[0];

    if (!qb) return { players: [], meta: { note:"No QB found in primary game." } };

    const qbTeam = qb[pTeam];
    const oppTeam = qbTeam === home ? away : home;

    const passCatchers = topBy(
      players.filter(p => (p[pTeam]===qbTeam) && ["WR","TE"].includes(p[pPos]) && !isOut(p)),
      pProj,
      2
    );

    const bringBack = topBy(
      players.filter(p => (p[pTeam]===oppTeam) && ["RB","WR","TE"].includes(p[pPos]) && !isOut(p)),
      pProj,
      1
    )[0];

    const chosen = [qb, ...passCatchers, bringBack].filter(Boolean);
    const chosenNames = new Set(chosen.map(p=>p[pName]));

    const pool = players
      .filter(p => !chosenNames.has(p[pName]) && !isOut(p))
      .map(p => {
        const proj = num(p[pProj]);
        const sal = num(p[pSal]);
        const value = sal ? proj/(sal/1000) : 0;
        return { ...p, __value: value };
      });

    const rbs = pool.filter(p=>p[pPos]==="RB").sort((a,b)=>b.__value-a.__value);
    const others = pool.filter(p=>p[pPos]!=="RB").sort((a,b)=>b.__value-a.__value);

    const fills = [...rbs.slice(0,2), ...others.slice(0,3)].slice(0,5);

    const final = [...chosen, ...fills].slice(0,9);
    const salary = final.reduce((s,p)=>s+num(p[pSal]),0);
    const proj = final.reduce((s,p)=>s+num(p[pProj]),0);

    return {
      players: final,
      meta: {
        primaryGame: `${away} @ ${home}`,
        env: num(g[gEnv]).toFixed(2),
        salary,
        proj: proj.toFixed(2),
        qbTeam,
        bringBackTeam: oppTeam
      }
    };
  }

  const lineupTable = document.getElementById("lineupTable");
  const lineupSummary = document.getElementById("lineupSummary");

  function renderLineup(result) {
    const meta = result.meta || {};
    lineupSummary.innerHTML = `
      <div class="pill"><b>Primary:</b> ${meta.primaryGame || "-"}</div>
      <div class="pill"><b>Env:</b> ${meta.env || "-"}</div>
      <div class="pill"><b>Proj:</b> ${meta.proj || "-"}</div>
      <div class="pill"><b>Salary:</b> ${meta.salary || "-"}</div>
      <div class="pill"><b>QB Team:</b> ${meta.qbTeam || "-"}</div>
      <div class="pill"><b>Bring-back:</b> ${meta.bringBackTeam || "-"}</div>
    `;

    const headers = [pPos, pName, pTeam, pSal, pProj, pOwn, pInj].filter(Boolean);
    setTable(lineupTable, headers, result.players, (td,row,h)=>{
      if (h === pProj) td.innerHTML = `<span class="badge">${num(row[h]).toFixed(2)}</span>`;
      if (h === pInj && (row[h]||"").toUpperCase().includes("OUT")) td.innerHTML = `<span class="badge">OUT</span>`;
    });
  }

  document.getElementById("buildLineupBtn").addEventListener("click", ()=>{
    const result = buildClassic();
    renderLineup(result);
  });

  renderLineup(buildClassic());
})();
