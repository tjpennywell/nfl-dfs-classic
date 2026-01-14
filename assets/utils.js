(function () {
  const utils = {};
  const debugMessages = [];
  let debugVisible = true;

  const TEAM_ALIASES = {
    LAR: "LA",
    STL: "LA",
    JAC: "JAX",
    WAS: "WSH",
    OAK: "LV",
    SD: "LAC",
  };

  const SALARY_SOURCES = [
    {
      label: "DraftKings (community mirror)",
      url: "https://raw.githubusercontent.com/rotowire/dk-nfl-salaries/master/dk_nfl_salaries.csv",
      type: "draftkings",
    },
    {
      label: "DraftKings (backup mirror)",
      url: "https://raw.githubusercontent.com/markuswarner/dk-nfl-salaries/main/DKSalaries.csv",
      type: "draftkings",
    },
  ];

  utils.normalizeTeam = function (team) {
    if (!team) return "";
    const cleaned = String(team).trim().toUpperCase();
    return TEAM_ALIASES[cleaned] || cleaned;
  };

  utils.logDebug = function (message) {
    debugMessages.push(message);
    const logEl = document.getElementById("debug-log");
    if (logEl) {
      const div = document.createElement("div");
      div.textContent = message;
      logEl.appendChild(div);
      logEl.scrollTop = logEl.scrollHeight;
    }
  };

  utils.initDebugBar = function () {
    const bar = document.createElement("div");
    bar.className = "debug-bar";
    bar.innerHTML = `
      <div id="debug-log" class="debug-log"></div>
      <button class="debug-toggle" id="debug-toggle">Hide</button>
    `;
    document.body.appendChild(bar);
    const toggle = document.getElementById("debug-toggle");
    toggle.addEventListener("click", () => {
      debugVisible = !debugVisible;
      document.getElementById("debug-log").style.display = debugVisible ? "block" : "none";
      toggle.textContent = debugVisible ? "Hide" : "Show";
    });
    debugMessages.forEach((msg) => utils.logDebug(msg));
  };

  utils.showError = function (message) {
    const container = document.getElementById("error-banner");
    if (!container) return;
    container.textContent = message;
    container.style.display = "block";
  };

  utils.safeNumber = function (value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  utils.formatNumber = function (value, digits = 2) {
    return Number(value).toFixed(digits);
  };

  utils.createCell = function (text, className) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  };

  utils.fetchJson = async function (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    return response.json();
  };

  utils.parseCsvText = function (text) {
    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors && results.errors.length) {
            reject(results.errors);
          } else {
            resolve(results.data);
          }
        },
        error: (err) => reject(err),
      });
    });
  };

  utils.fetchCsv = async function (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`CSV request failed (${response.status}) for ${url}`);
    }
    const text = await response.text();
    return utils.parseCsvText(text);
  };

  utils.fetchFirstCsv = async function (sources) {
    let lastError = null;
    for (const source of sources) {
      try {
        const rows = await utils.fetchCsv(source.url);
        return { rows, source };
      } catch (err) {
        lastError = err;
        utils.logDebug(`Salary source failed: ${source.label}`);
      }
    }
    throw lastError || new Error("No salary sources available");
  };

  utils.loadScoreboard = async function () {
    const data = await utils.fetchJson(
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
    );
    const games = [];
    (data.events || []).forEach((event) => {
      const competition = event.competitions && event.competitions[0];
      if (!competition || !competition.competitors) return;
      const home = competition.competitors.find((team) => team.homeAway === "home");
      const away = competition.competitors.find((team) => team.homeAway === "away");
      if (!home || !away) return;
      const homeAbbr = utils.normalizeTeam(home.team.abbreviation);
      const awayAbbr = utils.normalizeTeam(away.team.abbreviation);
      games.push({
        home: homeAbbr,
        away: awayAbbr,
        label: `${awayAbbr}@${homeAbbr}`,
      });
    });
    return games;
  };

  function parseGameInfo(gameInfo) {
    if (!gameInfo) return null;
    const raw = String(gameInfo).split(" ")[0];
    if (!raw || !raw.includes("@")) return null;
    const [away, home] = raw.split("@");
    return {
      away: utils.normalizeTeam(away),
      home: utils.normalizeTeam(home),
      label: `${utils.normalizeTeam(away)}@${utils.normalizeTeam(home)}`,
    };
  }

  function parseSalaryRow(row) {
    const name = row.Name || row.name || row.Player || row.player || row.Nickname || row.PlayerName;
    const pos = row.Position || row.position || row.Pos || row.pos || row.RosterPosition;
    const team = row.TeamAbbrev || row.team || row.Team || row.Tm;
    const salary = row.Salary || row.salary || row.Sal;
    const avg =
      row.AvgPointsPerGame ||
      row.AvgPoints ||
      row.FPPG ||
      row.FantasyPointsPerGame ||
      row.Proj;
    if (!name || !pos || !team || !salary) return null;

    const normalizedPos = String(pos).toUpperCase().replace("D/ST", "DST");
    const normalizedTeam = utils.normalizeTeam(team);
    const projection = utils.safeNumber(avg) || utils.safeNumber(salary) / 1000 * 3;
    const gameInfo = parseGameInfo(row["Game Info"] || row.GameInfo || row.game);

    return {
      name: String(name).trim(),
      pos: normalizedPos,
      team: normalizedTeam,
      salary: utils.safeNumber(salary),
      proj: projection,
      gameInfo,
    };
  }

  utils.loadSalaries = async function () {
    const { rows, source } = await utils.fetchFirstCsv(SALARY_SOURCES);
    const players = rows.map(parseSalaryRow).filter(Boolean);
    return { players, source };
  };

  utils.applyEnvironment = function (players, env, gameTeams, favoredTeam) {
    return players.map((player) => {
      const updated = { ...player };
      const pos = player.pos;
      const team = utils.normalizeTeam(player.team);
      let multiplier = 1;

      if (env === "Shootout") {
        if (pos === "QB") multiplier = 1.08;
        if (pos === "WR") multiplier = 1.08;
        if (pos === "TE") multiplier = 1.05;
        if (pos === "RB") multiplier = 0.99;
        if (pos === "DST") multiplier = 0.94;
      } else if (env === "Blowout/Ugly") {
        if (gameTeams && favoredTeam) {
          const favored = utils.normalizeTeam(favoredTeam);
          if (team === favored) {
            if (pos === "RB") multiplier = 1.12;
            if (pos === "DST") multiplier = 1.1;
            if (pos === "WR") multiplier = 0.98;
            if (pos === "TE") multiplier = 0.98;
            if (pos === "QB") multiplier = 0.97;
          } else if (gameTeams.includes(team)) {
            if (pos === "QB") multiplier = 0.95;
            if (pos === "WR") multiplier = 0.93;
            if (pos === "TE") multiplier = 0.95;
            if (pos === "RB") multiplier = 0.9;
            if (pos === "DST") multiplier = 0.85;
          }
        } else {
          if (pos === "QB") multiplier = 0.95;
          if (pos === "WR") multiplier = 0.95;
          if (pos === "TE") multiplier = 0.96;
          if (pos === "RB") multiplier = 1.05;
          if (pos === "DST") multiplier = 1.08;
        }
      }

      updated.proj = Number(player.proj || 0) * multiplier;
      return updated;
    });
  };

  utils.parseNameList = function (value) {
    if (!value) return [];
    return value
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
  };

  utils.getGlpkInstance = async function () {
    if (window.glpk) return window.glpk;
    if (window.GLPK) {
      try {
        window.glpk = await window.GLPK();
        return window.glpk;
      } catch (err) {
        utils.showError("GLPK failed to initialize.");
        return null;
      }
    }
    utils.showError("GLPK failed to load. Please check your connection.");
    return null;
  };

  window.utils = utils;
})();
