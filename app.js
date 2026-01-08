// ===== Heatmaps (HARDENED) =====
const heatTable = document.getElementById("heatmapTable");
let currentHm = "pass";

function showHeatMessage(msg) {
  setTable(heatTable, ["Heatmaps"], [{ "Heatmaps": msg }]);
}

const passBtn = document.getElementById("showPassHm");
const rushBtn = document.getElementById("showRushHm");

if (!heatTable || !passBtn || !rushBtn) {
  // If HTML is out of sync, fail gracefully.
  console.warn("Heatmap elements missing. Check index.html ids: heatmapTable/showPassHm/showRushHm");
} else {

  // Attempt to load rush-lane files (optional)
  let rushLaneOff = [];
  let rushLaneDef = [];
  try { rushLaneOff = await loadCSV("data/rush_lane_share_off.csv"); } catch(e) {}
  try { rushLaneDef = await loadCSV("data/rush_lane_share_def.csv"); } catch(e) {}

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

  // Create rush controls (only used when Rush selected)
  const heatCard = heatTable.closest(".card");
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
    teamsAll.forEach(t=>{
      const o = document.createElement("option");
      o.value = t; o.textContent = t;
      sel.appendChild(o);
    });
  }

  if (teamsAll.length) {
    fillTeamSelect(offSel);
    fillTeamSelect(defSel);

    // Default: top Env game if available
    const defaultGame = gamesSorted[0] || {};
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

  // Insert controls above heatmap table
  if (heatCard) heatCard.insertBefore(ctrlRow, heatTable);

  // Precompute edge min/max for stable coloring
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

  function renderPassTable() {
    if (!passHm || !passHm.length) {
      showHeatMessage("Pass heatmap data not found (data/heatmap_pass_matchup.csv).");
      return;
    }
    const edgeCol = guessCol(passHm[0], ["edge_off_minus_def","Edge","edge"]);
    const teamCol = guessCol(passHm[0], ["off_team","Team","team"]);
    const oppCol  = guessCol(passHm[0], ["def_team","Opponent","opp"]);
    const locCol  = guessCol(passHm[0], ["location","Location","loc"]);
    const depthCol= guessCol(passHm[0], ["depth","Depth","dep"]);

    if (!edgeCol) {
      showHeatMessage("Pass heatmap is missing an edge column. Expected 'edge_off_minus_def' (or similar).");
      return;
    }

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
  }

  function renderRushGrid() {
    // If lane files missing, show message
    if (!teamsAll.length) {
      showHeatMessage(
        "Rush 7-lane files not found.\nUpload these two files into /data/:\n- rush_lane_share_off.csv\n- rush_lane_share_def.csv"
      );
      return;
    }

    ctrlRow.style.display = "flex";

    const offT = offSel.value;
    const defT = defSel.value;
    const metric = metricSel.value;

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
      row[laneLabels[l]] = v;
    });

    setTable(heatTable, headers, [row], (td,r,h)=>{
      if (headers.includes(h) && h !== "off_team" && h !== "def_team") {
        const v = num(r[h]);
        td.textContent = v.toFixed(2);
        if (metric === "edge") td.style.backgroundColor = getColor(v, edgeMin, edgeMax);
      }
    });
  }

  function renderHeatmap() {
    if (currentHm === "pass") {
      ctrlRow.style.display = "none";
      renderPassTable();
    } else {
      renderRushGrid();
    }
  }

  passBtn.addEventListener("click", ()=>{ currentHm = "pass"; renderHeatmap(); });
  rushBtn.addEventListener("click", ()=>{ currentHm = "rush"; renderHeatmap(); });
  [offSel, defSel, metricSel].forEach(el => el.addEventListener("change", renderHeatmap));

  // Initial render
  renderHeatmap();
}
