(function () {
  const state = {
    teams: [],
    stats: new Map(),
    loaded: false,
  };

  const PASS_BUCKETS = ["Short", "Intermediate", "Deep"];
  const RUSH_LANES = [
    "Left End",
    "Left Tackle",
    "Left Guard",
    "Center",
    "Right Guard",
    "Right Tackle",
    "Right End",
  ];

  const PBP_URL =
    "https://github.com/nflverse/nflverse-data/releases/download/pbp/pbp_2023.csv.gz";
  const MAX_PLAYS = 220000;

  function ensureTeam(team) {
    if (!state.stats.has(team)) {
      state.stats.set(team, {
        passOff: createBucketMap(PASS_BUCKETS),
        passDef: createBucketMap(PASS_BUCKETS),
        rushOff: createBucketMap(RUSH_LANES),
        rushDef: createBucketMap(RUSH_LANES),
        totalsOff: { yards: 0, plays: 0 },
        totalsDef: { yards: 0, plays: 0 },
      });
    }
    return state.stats.get(team);
  }

  function createBucketMap(keys) {
    const map = {};
    keys.forEach((key) => {
      map[key] = { yards: 0, plays: 0 };
    });
    return map;
  }

  function addStat(container, key, yards) {
    if (!container[key]) {
      container[key] = { yards: 0, plays: 0 };
    }
    container[key].yards += yards;
    container[key].plays += 1;
  }

  function passBucket(row) {
    const airYards = utils.safeNumber(row.air_yards);
    if (Number.isFinite(airYards) && airYards !== 0) {
      if (airYards < 10) return "Short";
      if (airYards < 20) return "Intermediate";
      return "Deep";
    }
    const passLength = String(row.pass_length || "").toLowerCase();
    if (passLength === "short") return "Short";
    if (passLength === "deep") return "Deep";
    return null;
  }

  function rushLane(row) {
    const location = String(row.run_location || "").toLowerCase();
    const gap = String(row.run_gap || "").toLowerCase();
    if (!location) return null;

    if (location === "left") {
      if (gap === "end") return "Left End";
      if (gap === "tackle") return "Left Tackle";
      if (gap === "guard") return "Left Guard";
      return "Left Guard";
    }

    if (location === "right") {
      if (gap === "end") return "Right End";
      if (gap === "tackle") return "Right Tackle";
      if (gap === "guard") return "Right Guard";
      return "Right Guard";
    }

    return "Center";
  }

  function isPass(row) {
    return row.play_type === "pass" || utils.safeNumber(row.pass_attempt) === 1;
  }

  function isRush(row) {
    return row.play_type === "run" || row.play_type === "rush" || utils.safeNumber(row.rush_attempt) === 1;
  }

  async function loadPbp() {
    const response = await fetch(PBP_URL);
    if (!response.ok) {
      throw new Error(`Failed to load play-by-play data (${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    const csvText = pako.ungzip(new Uint8Array(buffer), { to: "string" });

    await new Promise((resolve, reject) => {
      let processed = 0;
      Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        step: (results, parser) => {
          const row = results.data;
          const posteam = utils.normalizeTeam(row.posteam || row.possession_team);
          const defteam = utils.normalizeTeam(row.defteam);
          if (!posteam || !defteam) return;

          const yards = utils.safeNumber(row.yards_gained);
          if (!Number.isFinite(yards)) return;

          const offStats = ensureTeam(posteam);
          const defStats = ensureTeam(defteam);

          offStats.totalsOff.yards += yards;
          offStats.totalsOff.plays += 1;
          defStats.totalsDef.yards += yards;
          defStats.totalsDef.plays += 1;

          if (isPass(row)) {
            const bucket = passBucket(row);
            if (bucket) {
              addStat(offStats.passOff, bucket, yards);
              addStat(defStats.passDef, bucket, yards);
            }
          } else if (isRush(row)) {
            const lane = rushLane(row);
            if (lane) {
              addStat(offStats.rushOff, lane, yards);
              addStat(defStats.rushDef, lane, yards);
            }
          }

          processed += 1;
          if (processed >= MAX_PLAYS) {
            parser.abort();
          }
        },
        complete: () => resolve(),
        error: (err) => reject(err),
      });
    });

    state.teams = Array.from(state.stats.keys()).sort();
    state.loaded = true;
  }

  function populateTeams() {
    const offSelect = document.getElementById("off-team");
    const defSelect = document.getElementById("def-team");
    offSelect.innerHTML = "";
    defSelect.innerHTML = "";

    state.teams.forEach((team) => {
      const offOption = document.createElement("option");
      offOption.value = team;
      offOption.textContent = team;
      offSelect.appendChild(offOption);

      const defOption = document.createElement("option");
      defOption.value = team;
      defOption.textContent = team;
      defSelect.appendChild(defOption);
    });
  }

  function averageValue(stat) {
    if (!stat || stat.plays === 0) return 0;
    return stat.yards / stat.plays;
  }

  function buildEdgeMap(offStats, defStats, keys, offKey, defKey) {
    return keys.map((key) => {
      const offValue = averageValue(offStats[offKey][key]);
      const defValue = averageValue(defStats[defKey][key]);
      return {
        key,
        offValue,
        defValue,
        edge: offValue - defValue,
      };
    });
  }

  function renderHeatmap(tableId, edges) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    tbody.innerHTML = "";

    const maxAbs = Math.max(...edges.map((item) => Math.abs(item.edge)), 1);

    const tr = document.createElement("tr");
    tr.appendChild(utils.createCell("Edge"));
    edges.forEach((item) => {
      const intensity = Math.min(Math.abs(item.edge) / maxAbs, 1);
      const hue = item.edge >= 0 ? 120 : 0;
      const cell = utils.createCell(utils.formatNumber(item.edge, 2));
      cell.style.backgroundColor = `hsla(${hue}, 70%, 35%, ${0.2 + intensity * 0.6})`;
      cell.title = `Offense ${utils.formatNumber(item.offValue, 2)} vs Defense ${utils.formatNumber(
        item.defValue,
        2
      )}`;
      tr.appendChild(cell);
    });
    tbody.appendChild(tr);
  }

  function summarizeEdge(edges) {
    const sorted = [...edges].sort((a, b) => b.edge - a.edge);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    return { best, worst };
  }

  function determineGameScript(offTeam, defTeam) {
    const offStats = state.stats.get(offTeam);
    const defStats = state.stats.get(defTeam);
    const offYpp = averageValue(offStats.totalsOff);
    const defAllowed = averageValue(defStats.totalsDef);

    const defOff = state.stats.get(defTeam);
    const offDef = state.stats.get(offTeam);
    const defYpp = averageValue(defOff.totalsOff);
    const offAllowed = averageValue(offDef.totalsDef);

    const offEdge = offYpp - defAllowed;
    const defEdge = defYpp - offAllowed;

    if (offEdge > 0.7 && defEdge < -0.2) {
      return `${offTeam} favored blowout`; 
    }
    if (defEdge > 0.7 && offEdge < -0.2) {
      return `${defTeam} favored blowout`;
    }
    if (offEdge > 0.4 && defEdge > 0.4) {
      return "Shootout";
    }
    if (offEdge < -0.1 && defEdge < -0.1) {
      return "Ugly/defensive";
    }
    return "Balanced matchup";
  }

  function updateSummary(passEdges, rushEdges, offTeam, defTeam) {
    const passSummary = summarizeEdge(passEdges);
    const rushSummary = summarizeEdge(rushEdges);

    document.getElementById("best-pass").textContent = `${passSummary.best.key} (${utils.formatNumber(
      passSummary.best.edge,
      2
    )} edge)`;
    document.getElementById("best-rush").textContent = `${rushSummary.best.key} (${utils.formatNumber(
      rushSummary.best.edge,
      2
    )} edge)`;

    const bestOverall = passSummary.best.edge >= rushSummary.best.edge ? passSummary.best : rushSummary.best;
    const worstOverall = passSummary.worst.edge <= rushSummary.worst.edge ? passSummary.worst : rushSummary.worst;

    document.getElementById("off-strength").textContent = `${offTeam} offense edge: ${bestOverall.key}`;
    document.getElementById("off-weakness").textContent = `${offTeam} offense concern: ${worstOverall.key}`;
    document.getElementById("def-strength").textContent = `${defTeam} defense strength: ${worstOverall.key}`;
    document.getElementById("def-weakness").textContent = `${defTeam} defense vulnerability: ${bestOverall.key}`;
    document.getElementById("game-script").textContent = determineGameScript(offTeam, defTeam);
  }

  function analyze() {
    const offTeam = document.getElementById("off-team").value;
    const defTeam = document.getElementById("def-team").value;

    if (!state.stats.has(offTeam) || !state.stats.has(defTeam)) {
      utils.showError("Select valid teams before analyzing.");
      return;
    }

    const offStats = state.stats.get(offTeam);
    const defStats = state.stats.get(defTeam);

    const passEdges = buildEdgeMap(offStats, defStats, PASS_BUCKETS, "passOff", "passDef");
    const rushEdges = buildEdgeMap(offStats, defStats, RUSH_LANES, "rushOff", "rushDef");

    renderHeatmap("pass-table", passEdges);
    renderHeatmap("rush-table", rushEdges);
    updateSummary(passEdges, rushEdges, offTeam, defTeam);
  }

  async function init() {
    utils.initDebugBar();
    const passMessage = document.getElementById("pass-message");
    const rushMessage = document.getElementById("rush-message");
    passMessage.style.display = "block";
    rushMessage.style.display = "block";
    passMessage.textContent = "Loading play-by-play data and building heatmaps…";
    rushMessage.textContent = "Parsing NFL play-by-play data (limited to latest 220k plays)…";

    try {
      await loadPbp();
      utils.logDebug(`Loaded ${state.teams.length} teams from play-by-play feed`);
      populateTeams();
      passMessage.textContent = "Play-by-play data loaded from nflverse. Select teams to analyze.";
      rushMessage.textContent = "Heatmaps use per-play yards from nflverse play-by-play.";
    } catch (err) {
      utils.showError("Failed to load play-by-play data. Check console for details.");
      utils.logDebug(`PBP load error: ${err}`);
    }

    document.getElementById("analyze-btn").addEventListener("click", analyze);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
