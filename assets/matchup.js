(function () {
  const state = {
    pass: [],
    rushOff: [],
    rushDef: [],
    teams: [],
  };

  const depthOrder = ["Short", "Intermediate", "Deep"];
  const rushLanes = [
    "Left End",
    "Left Tackle",
    "Left Guard",
    "Center",
    "Right Guard",
    "Right Tackle",
    "Right End",
  ];

  const laneKeyMap = {
    "LE": "Left End",
    "Left End": "Left End",
    "LeftEnd": "Left End",
    "LT": "Left Tackle",
    "Left Tackle": "Left Tackle",
    "LeftTackle": "Left Tackle",
    "LG": "Left Guard",
    "Left Guard": "Left Guard",
    "LeftGuard": "Left Guard",
    "C": "Center",
    "Center": "Center",
    "RG": "Right Guard",
    "Right Guard": "Right Guard",
    "RightGuard": "Right Guard",
    "RT": "Right Tackle",
    "Right Tackle": "Right Tackle",
    "RightTackle": "Right Tackle",
    "RE": "Right End",
    "Right End": "Right End",
    "RightEnd": "Right End",
  };

  function normalizeDepth(value) {
    if (!value) return "";
    const cleaned = String(value).toLowerCase();
    if (cleaned.startsWith("short")) return "Short";
    if (cleaned.startsWith("inter")) return "Intermediate";
    if (cleaned.startsWith("deep")) return "Deep";
    return value;
  }

  function divergingColor(value, maxAbs) {
    if (!Number.isFinite(value)) return "transparent";
    const ratio = Math.min(Math.abs(value) / maxAbs, 1);
    if (value >= 0) {
      return `rgba(82, 210, 115, ${0.2 + ratio * 0.6})`;
    }
    return `rgba(255, 107, 107, ${0.2 + ratio * 0.6})`;
  }

  function greenColor(value, maxValue) {
    if (!Number.isFinite(value)) return "transparent";
    const ratio = Math.min(value / maxValue, 1);
    return `rgba(82, 210, 115, ${0.15 + ratio * 0.5})`;
  }

  function getLaneValue(row, lane) {
    const key = Object.keys(laneKeyMap).find((col) => laneKeyMap[col] === lane && row[col] !== undefined);
    if (!key) return 0;
    return utils.safeNumber(row[key]);
  }

  function buildTeamList() {
    const set = new Set();
    state.pass.forEach((row) => {
      set.add(utils.normalizeTeam(row.off_team || row.OFF_TEAM));
      set.add(utils.normalizeTeam(row.def_team || row.DEF_TEAM));
    });
    state.rushOff.forEach((row) => set.add(utils.normalizeTeam(row.off_team || row.team || row.Team)));
    state.rushDef.forEach((row) => set.add(utils.normalizeTeam(row.def_team || row.team || row.Team)));
    state.teams = Array.from(set).filter(Boolean).sort();
  }

  function populateTeams() {
    const offSelect = document.getElementById("off-team");
    const defSelect = document.getElementById("def-team");
    offSelect.innerHTML = "";
    defSelect.innerHTML = "";
    state.teams.forEach((team) => {
      const option1 = document.createElement("option");
      option1.value = team;
      option1.textContent = team;
      const option2 = document.createElement("option");
      option2.value = team;
      option2.textContent = team;
      offSelect.appendChild(option1);
      defSelect.appendChild(option2);
    });
  }

  function renderPassHeatmap(offTeam, defTeam) {
    const tbody = document.querySelector("#pass-table tbody");
    const message = document.getElementById("pass-message");
    tbody.innerHTML = "";
    message.style.display = "none";

    const rows = state.pass.filter(
      (row) =>
        utils.normalizeTeam(row.off_team || row.OFF_TEAM) === offTeam &&
        utils.normalizeTeam(row.def_team || row.DEF_TEAM) === defTeam
    );

    if (!rows.length) {
      message.textContent = "No pass matchup data available for this pairing.";
      message.style.display = "block";
      return;
    }

    const passMap = {
      OFFENSE: {},
      DEFENSE: {},
      EDGE: {},
    };

    rows.forEach((row) => {
      const bucket = normalizeDepth(row.depth_bucket || row.Depth || row.bucket);
      passMap.OFFENSE[bucket] = utils.safeNumber(row.off_epa_per_att);
      passMap.DEFENSE[bucket] = utils.safeNumber(row.def_epa_allowed_per_play);
      passMap.EDGE[bucket] = utils.safeNumber(row.edge_off_minus_def);
    });

    const allValues = Object.values(passMap).flatMap((row) =>
      depthOrder.map((depth) => row[depth] || 0)
    );
    const maxAbs = Math.max(...allValues.map((v) => Math.abs(v)), 1);

    ["OFFENSE", "DEFENSE", "EDGE"].forEach((label) => {
      const tr = document.createElement("tr");
      tr.appendChild(utils.createCell(label));
      depthOrder.forEach((depth) => {
        const value = passMap[label][depth] ?? 0;
        const cell = utils.createCell(utils.formatNumber(value, 3));
        cell.style.background = divergingColor(value, maxAbs);
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });

    const best = depthOrder
      .map((depth) => ({ depth, value: passMap.EDGE[depth] ?? 0 }))
      .sort((a, b) => b.value - a.value)[0];
    document.getElementById("best-pass").textContent = best
      ? `${best.depth} (${utils.formatNumber(best.value, 3)})`
      : "--";
  }

  function renderRushHeatmap(offTeam, defTeam) {
    const tbody = document.querySelector("#rush-table tbody");
    const message = document.getElementById("rush-message");
    tbody.innerHTML = "";
    message.style.display = "none";

    const offRow = state.rushOff.find(
      (row) => utils.normalizeTeam(row.off_team || row.team || row.Team) === offTeam
    );
    const defRow = state.rushDef.find(
      (row) => utils.normalizeTeam(row.def_team || row.team || row.Team) === defTeam
    );

    if (!offRow || !defRow) {
      message.textContent = "No rush lane data available for this matchup.";
      message.style.display = "block";
      document.getElementById("best-rush").textContent = "--";
      return;
    }

    const offenseValues = {};
    const defenseValues = {};
    const edgeValues = {};

    rushLanes.forEach((lane) => {
      const offValue = getLaneValue(offRow, lane);
      const defValue = getLaneValue(defRow, lane);
      offenseValues[lane] = offValue;
      defenseValues[lane] = defValue;
      edgeValues[lane] = offValue - defValue;
    });

    const maxOff = Math.max(...Object.values(offenseValues), 1);
    const maxDef = Math.max(...Object.values(defenseValues), 1);
    const maxEdgeAbs = Math.max(...Object.values(edgeValues).map((v) => Math.abs(v)), 1);

    const rows = [
      { label: "OFFENSE", values: offenseValues, color: (v) => greenColor(v, maxOff) },
      { label: "DEFENSE", values: defenseValues, color: (v) => greenColor(v, maxDef) },
      { label: "EDGE", values: edgeValues, color: (v) => divergingColor(v, maxEdgeAbs) },
    ];

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(utils.createCell(row.label));
      rushLanes.forEach((lane) => {
        const value = row.values[lane] ?? 0;
        const cell = utils.createCell(utils.formatNumber(value, 3));
        cell.style.background = row.color(value);
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });

    const best = rushLanes
      .map((lane) => ({ lane, value: edgeValues[lane] }))
      .sort((a, b) => b.value - a.value)[0];

    document.getElementById("best-rush").textContent = best
      ? `${best.lane} (${utils.formatNumber(best.value, 3)})`
      : "--";
  }

  function analyze() {
    const offTeam = document.getElementById("off-team").value;
    const defTeam = document.getElementById("def-team").value;
    renderPassHeatmap(offTeam, defTeam);
    renderRushHeatmap(offTeam, defTeam);
  }

  async function init() {
    utils.initDebugBar();
    try {
      const [pass, rushOff, rushDef] = await Promise.all([
        utils.parseCsv("data/heatmap_pass_matchup.csv"),
        utils.parseCsv("data/rush_lane_share_off.csv"),
        utils.parseCsv("data/rush_lane_share_def.csv"),
      ]);
      state.pass = pass;
      state.rushOff = rushOff;
      state.rushDef = rushDef;
      buildTeamList();
      populateTeams();
      utils.logDebug(`Loaded ${state.pass.length} pass matchup rows`);
      utils.logDebug(`Loaded ${state.rushOff.length} rush offense rows`);
      utils.logDebug(`Loaded ${state.rushDef.length} rush defense rows`);
    } catch (err) {
      utils.showError("Failed to load matchup data. Check console for details.");
      utils.logDebug(`Data load error: ${err}`);
    }

    document.getElementById("analyze-btn").addEventListener("click", analyze);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
