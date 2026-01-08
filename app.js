  // ==========================
  // HEATMAPS (uses HTML hmOffTeam/hmDefTeam)
  // ==========================
  let currentHm = "pass";

  // Use the dropdowns that already exist in index.html
  const hmOffTeam = ensureId("hmOffTeam");
  const hmDefTeam = ensureId("hmDefTeam");

  // ---- Helpers for selects ----
  function fillSelect(sel, teams) {
    const cur = sel.value;
    sel.innerHTML = "";
    teams.forEach(t => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      sel.appendChild(o);
    });
    // keep previous selection if possible
    if (teams.includes(cur)) sel.value = cur;
  }

  // ==========================
  // PASS: PFF-style 3x3 grid
  // ==========================
  function renderPassPFFGrid() {
    if (!passHm || !passHm.length) {
      showMessageTable(heatmapTable, "Heatmaps", "Missing data/heatmap_pass_matchup.csv");
      return;
    }

    // Try to detect columns (robust)
    const offCol = guessCol(passHm[0], ["off_team","off","team","Team"]);
    const defCol = guessCol(passHm[0], ["def_team","def","opp","Opponent"]);
    const locCol = guessCol(passHm[0], ["location","loc","side"]);
    const depthCol = guessCol(passHm[0], ["depth_bucket","depth","Depth","range_bucket"]);
    const edgeCol = guessCol(passHm[0], [
      "edge_off_minus_def",
      "edge_off_minus_defproxy",
      "edge_success_off_minus_defproxy",
      "edge_success_off_minus_def",
      "Edge","edge"
    ]);
    const wtCol = guessCol(passHm[0], ["off_pass_attempts","attempts","n","count","plays"]);

    if (!offCol || !defCol || !edgeCol) {
      showMessageTable(
        heatmapTable,
        "Heatmaps",
        "Pass heatmap is missing required columns. Need off_team + def_team + edge_*."
      );
      return;
    }

    const offT = hmOffTeam.value;
    const defT = hmDefTeam.value;

    // Filter to matchup
    const rows = passHm.filter(r => (r[offCol] === offT && r[defCol] === defT));
    if (!rows.length) {
      showMessageTable(heatmapTable, "Heatmaps", `No pass data for ${offT} vs ${defT}`);
      return;
    }

    // Normalize buckets
    const LOCS = ["left","middle","right"];
    const DEPTHS = ["short","intermediate","deep"];

    function norm(x) {
      return String(x || "").trim().toLowerCase();
    }

    // If your file doesn’t have location/depth, fall back gracefully
    const hasLoc = !!locCol;
    const hasDepth = !!depthCol;

    const grid = {};
    LOCS.forEach(l => {
      grid[l] = {};
      DEPTHS.forEach(d => (grid[l][d] = 0));
    });

    // weighted avg per cell
    LOCS.forEach(l => {
      DEPTHS.forEach(d => {
        const cell = rows.filter(r => {
          const locOk = !hasLoc || norm(r[locCol]) === l;
          const depOk = !hasDepth || norm(r[depthCol]) === d;
          return locOk && depOk;
        });

        let nume = 0, deno = 0;
        cell.forEach(r => {
          const w = wtCol ? Math.max(1, num(r[wtCol])) : 1;
          nume += num(r[edgeCol]) * w;
          deno += w;
        });

        grid[l][d] = deno ? (nume / deno) : 0;
      });
    });

    // Flatten values for coloring
    const vals = [];
    LOCS.forEach(l => DEPTHS.forEach(d => vals.push(grid[l][d])));
    const vMin = Math.min(...vals);
    const vMax = Math.max(...vals);

    // Render table
    const headers = ["", "Short", "Intermediate", "Deep"];
    const outRows = LOCS.map(l => ({
      "": l.toUpperCase(),
      "Short": grid[l].short,
      "Intermediate": grid[l].intermediate,
      "Deep": grid[l].deep
    }));

    setTable(heatmapTable, headers, outRows, (td, r, h) => {
      if (h === "") {
        td.style.fontWeight = "700";
        td.style.whiteSpace = "nowrap";
        return;
      }
      const v = num(r[h]);
      td.textContent = (v >= 0 ? "+" : "") + v.toFixed(3);
      td.style.backgroundColor = getColor(v, vMin, vMax);
    });
  }

  // ==========================
  // RUSH stacked rows (OFF / DEF / EDGE), color ALL rows
  // ==========================
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

  function renderRushHeatmap() {
    const offT = hmOffTeam.value;
    const defT = hmDefTeam.value;

    const headers = [
      "Row","off_team","def_team",
      "Left End","Left Tackle","Left Guard","Center","Right Guard","Right Tackle","Right End"
    ];

    if (!rushOffMap[offT] || !rushDefMap[defT]) {
      showMessageTable(
        heatmapTable,
        "Heatmaps",
        "Rush lane data missing for this matchup. Check rush_lane_share_off/def csv team labels."
      );
      return;
    }

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

    // Stable EDGE scaling
    const edgeMin = Math.min(...edgeVals);
    const edgeMax = Math.max(...edgeVals);

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

  // ==========================
  // Populate hmOffTeam/hmDefTeam (union of teams from pass + rush)
  // ==========================
  const passOffCol = passHm?.[0] ? guessCol(passHm[0], ["off_team","off","team","Team"]) : null;
  const passDefCol = passHm?.[0] ? guessCol(passHm[0], ["def_team","def","opp","Opponent"]) : null;

  const passTeams = uniq(
    (passOffCol ? passHm.map(r => r[passOffCol]) : [])
      .concat(passDefCol ? passHm.map(r => r[passDefCol]) : [])
      .filter(Boolean)
  );

  const rushTeams = uniq(Object.keys(rushOffMap).concat(Object.keys(rushDefMap)));

  const allTeams = uniq(passTeams.concat(rushTeams)).sort();

  fillSelect(hmOffTeam, allTeams);
  fillSelect(hmDefTeam, allTeams);

  // Default to top env game teams if possible
  const topG = gamesSorted[0] || {};
  if (topG[gAway] && allTeams.includes(topG[gAway])) hmOffTeam.value = topG[gAway];
  if (topG[gHome] && allTeams.includes(topG[gHome])) hmDefTeam.value = topG[gHome];

  // ==========================
  // Render switch
  // ==========================
  function renderHeatmap() {
    if (currentHm === "pass") renderPassPFFGrid();
    else renderRushHeatmap();
  }

  showPassHm.addEventListener("click", ()=>{ currentHm = "pass"; renderHeatmap(); });
  showRushHm.addEventListener("click", ()=>{ currentHm = "rush"; renderHeatmap(); });

  hmOffTeam.addEventListener("change", renderHeatmap);
  hmDefTeam.addEventListener("change", renderHeatmap);

  renderHeatmap();
