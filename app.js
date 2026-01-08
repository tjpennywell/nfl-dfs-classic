  // ==========================
  // HEATMAPS
  // ==========================
  let currentHm = "pass";

  // PASS heatmap table (data-first)  [KEEPING YOUR ORIGINAL]
  function renderPassHeatmap() {
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

  // Create Off/Def selectors (used for BOTH pass + rush)
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
    heatCard.prepend(ctrlRow);
  }

  // ==========================
  // PASS PFF-STYLE 3x3 GRID  (NOW IN THE RIGHT PLACE)
  // ==========================
  function renderPassPFFGrid() {
    if (!passHm || !passHm.length) {
      showMessageTable(heatmapTable, "Heatmaps", "Missing pass heatmap data.");
      return;
    }

    // Flexible column detection (so it works with your CSV)
    const offCol   = guessCol(passHm[0], ["off_team","Team","team"]);
    const defCol   = guessCol(passHm[0], ["def_team","Opponent","opp"]);
    const locCol   = guessCol(passHm[0], ["location","loc"]);
    const depthCol = guessCol(passHm[0], ["depth_bucket","depth","Depth"]);
    const edgeCol  = guessCol(passHm[0], [
      "edge_off_minus_def","edge_off_minus_defproxy",
      "edge_success_off_minus_defproxy",
      "edge_success_off_minus_def",
      "Edge","edge"
    ]);
    const wtCol    = guessCol(passHm[0], ["off_pass_attempts","attempts","att","n"]);

    if (!offCol || !defCol || !locCol || !depthCol || !edgeCol) {
      // If your CSV isn't shaped for the grid, fall back to your original table
      renderPassHeatmap();
      return;
    }

    const offT = offSel.value;
    const defT = defSel.value;

    const rows = passHm.filter(r =>
      (r[offCol] === offT) &&
      (r[defCol] === defT)
    );

    if (!rows.length) {
      showMessageTable(heatmapTable, "Heatmaps", `No pass data for ${offT} vs ${defT}`);
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
          (String(r[locCol] || "").toLowerCase() === l) &&
          (String(r[depthCol] || "").toLowerCase() === d)
        );

        let nume = 0, deno = 0;
        cell.forEach(r => {
          const w = wtCol ? Math.max(1, num(r[wtCol])) : 1;
          nume += num(r[edgeCol]) * w;
          deno += w;
        });

        grid[l][d] = deno ? (nume / deno) : 0;
      });
    });

    // Color scaling
    const vals = [];
    LOCS.forEach(l => DEPTHS.forEach(d => vals.push(grid[l][d])));
    const vMin = Math.min(...vals);
    const vMax = Math.max(...vals);

    // Render in PFF spatial layout
    const headers = ["Row", "Short", "Intermediate", "Deep"];
    const rowsOut = LOCS.map(l => ({
      Row: l.toUpperCase(),
      Short: grid[l].short,
      Intermediate: grid[l].intermediate,
      Deep: grid[l].deep
    }));

    setTable(heatmapTable, headers, rowsOut, (td, r, h) => {
      if (h === "Row") {
        td.style.fontWeight = "700";
        return;
      }
      const v = num(r[h]);
      td.textContent = (v >= 0 ? "+" : "") + v.toFixed(3);
      td.style.backgroundColor = getColor(v, vMin, vMax);
    });
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
      ctrlRow.style.display = "flex";     // show Off/Def for PASS too
      renderPassPFFGrid();                // PASS uses the grid (fallback to table if needed)
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
