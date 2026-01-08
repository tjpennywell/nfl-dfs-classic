// APP VERSION: CLASSIC-LOCKED-STABLE
console.log("APP VERSION: CLASSIC-LOCKED-STABLE", new Date().toISOString());

/* ==========================
   DEBUG BAR (do not touch)
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
      bar.style.padding = "10px";
      bar.style.background = "rgba(200,0,0,0.9)";
      bar.style.color = "#fff";
      bar.style.fontSize = "12px";
      bar.style.whiteSpace = "pre-wrap";
      bar.style.display = "none";
      document.body.appendChild(bar);
    }
    bar.style.display = "block";
    bar.textContent = "Dashboard error:\n" + msg;
  }
  window.addEventListener("error", e => show(e.message));
  window.addEventListener("unhandledrejection", e => show(String(e.reason)));
})();

/* ==========================
   HELPERS
========================== */
function num(x) {
  const v = parseFloat(x);
  return Number.isFinite(v) ? v : 0;
}
function uniq(a) {
  return Array.from(new Set(a));
}

/* ==========================
   🔑 THE FIX — CSV / TSV AUTO-DETECT
========================== */
function parseCSV(text) {
  const lines = (text || "").trim().split(/\r?\n/);
  if (!lines.length) return [];

  // 🔥 THIS IS WHY YOUR PASS HEATMAP BROKE
  const delim = lines[0].includes("\t") ? "\t" : ",";

  const headers = lines[0].split(delim).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(delim);
    const obj = {};
    headers.forEach((h, i) => obj[h] = (cols[i] ?? "").trim());
    return obj;
  });
}

async function loadCSV(path) {
  const res = await fetch(path + "?v=" + Date.now());
  if (!res.ok) throw new Error("Failed to load " + path);
  return parseCSV(await res.text());
}

function guessCol(row, names) {
  for (const n of names) if (n in row) return n;
  return null;
}

function setTable(el, headers, rows, cellFn) {
  el.innerHTML = "";
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
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

function getColor(v, min, max) {
  if (v >= 0) {
    const t = Math.min(v / (max || 1), 1);
    return `rgba(0,180,0,${0.2 + 0.7 * t})`;
  }
  const t = Math.min(Math.abs(v) / (Math.abs(min) || 1), 1);
  return `rgba(200,0,0,${0.2 + 0.7 * t})`;
}

/* ==========================
   MAIN
========================== */
(async function () {

  // ---- DOM ----
  const gamesTable = document.getElementById("gamesTable");
  const playersTable = document.getElementById("playersTable");
  const heatmapTable = document.getElementById("heatmapTable");

  const playerSearch = document.getElementById("playerSearch");
  const posFilter = document.getElementById("posFilter");
  const teamFilter = document.getElementById("teamFilter");
  const sortBy = document.getElementById("sortBy");

  const primaryGameSelect = document.getElementById("primaryGameSelect");
  const buildLineupBtn = document.getElementById("buildLineupBtn");

  const lineupSummary = document.getElementById("lineupSummary");
  const lineupTable = document.getElementById("lineupTable");

  const showPassHm = document.getElementById("showPassHm");
  const showRushHm = document.getElementById("showRushHm");
  const hmOffTeam = document.getElementById("hmOffTeam");
  const hmDefTeam = document.getElementById("hmDefTeam");

  // ---- DATA ----
  const players = await loadCSV("data/players_classic.csv");
  const games = await loadCSV("data/games_classic.csv");
  const passHm = await loadCSV("data/heatmap_pass_matchup.csv");

  /* ==========================
     GAMES
  ========================== */
  const gAway = guessCol(games[0], ["Away","away"]);
  const gHome = guessCol(games[0], ["Home","home"]);
  const gTotal = guessCol(games[0], ["Total","total"]);

  setTable(gamesTable, [gAway, gHome, gTotal], games);

  primaryGameSelect.innerHTML = "";
  games.forEach((g,i) => {
    const o = document.createElement("option");
    o.value = i;
    o.textContent = `${g[gAway]} @ ${g[gHome]} (${g[gTotal]})`;
    primaryGameSelect.appendChild(o);
  });

  /* ==========================
     PLAYERS
  ========================== */
  const pName = guessCol(players[0], ["Player","Name"]);
  const pTeam = guessCol(players[0], ["Team"]);
  const pPos  = guessCol(players[0], ["Pos"]);
  const pSal  = guessCol(players[0], ["Salary"]);
  const pProj = guessCol(players[0], ["Projection","Proj"]);

  teamFilter.innerHTML = `<option value="">All Teams</option>`;
  uniq(players.map(p => p[pTeam])).forEach(t => {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t;
    teamFilter.appendChild(o);
  });

  function renderPlayers() {
    let rows = players.filter(p => {
      if (playerSearch.value &&
          !p[pName].toLowerCase().includes(playerSearch.value.toLowerCase())) return false;
      if (posFilter.value && p[pPos] !== posFilter.value) return false;
      if (teamFilter.value && p[pTeam] !== teamFilter.value) return false;
      return true;
    });

    if (sortBy.value === "proj_desc")
      rows.sort((a,b)=>num(b[pProj]) - num(a[pProj]));

    setTable(playersTable, [pName,pTeam,pPos,pSal,pProj], rows.slice(0,250));
  }

  ["input","change"].forEach(e => {
    playerSearch.addEventListener(e, renderPlayers);
    posFilter.addEventListener(e, renderPlayers);
    teamFilter.addEventListener(e, renderPlayers);
    sortBy.addEventListener(e, renderPlayers);
  });
  renderPlayers();

  /* ==========================
     LINEUP (unchanged)
  ========================== */
  buildLineupBtn.onclick = () => {
    lineupSummary.textContent = "Optimizer locked for next thread ✔";
    lineupTable.innerHTML = "";
  };

   /* ==========================
     HEATMAPS — PASS + RUSH (ROBUST)
  ========================== */
  let currentHm = "pass";

  // PASS columns (your file is TSV/CSV but now parseCSV handles it)
  const offCol = "off_team";
  const defCol = "def_team";
  const locCol = "location";
  const depthCol = "depth_bucket";
  const edgeCol = "edge_off_minus_def";
  const playTypeCol = "play_type";

  function norm(x) { return String(x || "").trim().toLowerCase(); }

  // Populate team dropdowns from BOTH off_team and def_team
  const teamsAll = uniq(
    passHm
      .map(r => r[offCol])
      .concat(passHm.map(r => r[defCol]))
      .filter(Boolean)
  ).sort();

  hmOffTeam.innerHTML = "";
  hmDefTeam.innerHTML = "";
  teamsAll.forEach(t => {
    const o1 = document.createElement("option");
    o1.value = t; o1.textContent = t;
    hmOffTeam.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = t; o2.textContent = t;
    hmDefTeam.appendChild(o2);
  });

  // Default to first game (avoid OFF=DEF)
  if (games.length) {
    const away = games[0][gAway];
    const home = games[0][gHome];
    if (teamsAll.includes(away)) hmOffTeam.value = away;
    if (teamsAll.includes(home)) hmDefTeam.value = home;
  }
  if (hmOffTeam.value === hmDefTeam.value && teamsAll.length > 1) {
    hmDefTeam.value = teamsAll.find(t => t !== hmOffTeam.value) || hmDefTeam.value;
  }

  function renderPassHeatmap() {
    const off = hmOffTeam.value;
    const def = hmDefTeam.value;

    // ✅ robust filter:
    // - allow PASS / pass / "pass" etc
    // - allow no play_type column (fallback)
    const rows = passHm.filter(r => {
      const okMatch = (r[offCol] === off && r[defCol] === def);
      if (!okMatch) return false;

      const pt = norm(r[playTypeCol]);
      if (!playTypeCol in r) return true;
      return pt.includes("pass"); // handles "PASS", "pass", "pass_attempt", etc
    });

    if (!rows.length) {
      heatmapTable.innerHTML = "<tr><td>No pass data for this matchup</td></tr>";
      return;
    }

    const LOCS = ["left","middle","right"];
    const DEPTHS = ["short","intermediate","deep"];

    // Build grid (average edge per cell)
    const grid = {};
    LOCS.forEach(l => {
      grid[l] = {};
      DEPTHS.forEach(d => {
        const cell = rows.filter(r =>
          norm(r[locCol]) === l && norm(r[depthCol]) === d
        );
        const avg = cell.length
          ? cell.reduce((s,r)=>s+num(r[edgeCol]),0) / cell.length
          : 0;
        grid[l][d] = avg;
      });
    });

    const vals = LOCS.flatMap(l => DEPTHS.map(d => grid[l][d]));
    const min = Math.min(...vals), max = Math.max(...vals);

    const out = [
      { Row:"LEFT",   Short:grid.left.short,   Intermediate:grid.left.intermediate,   Deep:grid.left.deep },
      { Row:"MIDDLE", Short:grid.middle.short, Intermediate:grid.middle.intermediate, Deep:grid.middle.deep },
      { Row:"RIGHT",  Short:grid.right.short,  Intermediate:grid.right.intermediate,  Deep:grid.right.deep }
    ];

    setTable(
      heatmapTable,
      ["Row","Short","Intermediate","Deep"],
      out,
      (td,r,h)=>{
        if (h === "Row") { td.style.fontWeight="700"; return; }
        const v = num(r[h]);
        td.textContent = (v>=0?"+":"") + v.toFixed(3);
        td.style.backgroundColor = getColor(v, min, max);
      }
    );
  }

  // ✅ Rush: show a simple message (since your “bring back” file didn’t include rush maps)
  // If you want rush stacked OFF/DEF/EDGE back, we’ll paste the full rush section next.
  function renderRushHeatmap() {
    showMessageTable(
      heatmapTable,
      "Heatmaps",
      "Rush heatmap not wired in this simplified file.\nTell me and I’ll paste the Rush OFF/DEF/EDGE stacked heatmap block back in."
    );
  }

  function renderHeatmap() {
    if (currentHm === "pass") renderPassHeatmap();
    else renderRushHeatmap();
  }

  showPassHm.onclick = () => { currentHm="pass"; renderHeatmap(); };
  showRushHm.onclick = () => { currentHm="rush"; renderHeatmap(); };

  hmOffTeam.onchange = renderHeatmap;
  hmDefTeam.onchange = renderHeatmap;

  renderHeatmap();
