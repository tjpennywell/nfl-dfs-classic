// Case-insensitive column getter (handles Game vs game, Home vs home, etc.)
function getCol(row, ...keys) {
  if (!row) return undefined;
  const map = {};
  for (const k of Object.keys(row)) map[k.toLowerCase()] = row[k];
  for (const k of keys) {
    const v = map[String(k).toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function normTeam(t) {
  if (!t) return "";
  const x = String(t).trim().toUpperCase();
  if (x === "LAR") return "LA";   // your key mapping request
  return x;
}

// Map your depth buckets to the app’s buckets
function normDepthBucket(b) {
  const x = String(b || "").trim().toLowerCase();
  if (x === "short") return "Short";
  if (x === "medium" || x === "intermediate" || x === "mid") return "Intermediate";
  if (x === "deep") return "Deep";
  return "";
}

// Normalize a game row from your games_classic.csv
function normGameRow(g) {
  const game = getCol(g, "Game", "game");
  const home = normTeam(getCol(g, "Home", "home", "home_team"));
  const away = normTeam(getCol(g, "Away", "away", "away_team"));
  return { game, home, away };
}

(function () {
  const utils = {};
  const debugMessages = [];
  let debugVisible = true;

  utils.normalizeTeam = function (team) {
    if (!team) return "";
    const cleaned = String(team).trim().toUpperCase();
    if (cleaned === "LAR") return "LA";
    return cleaned;
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

  utils.parseCsv = function (url) {
    return new Promise((resolve, reject) => {
      Papa.parse(url, {
        download: true,
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

  utils.applyEnvironment = function (players, env, gameTeams, favoredTeam) {
    return players.map((player) => {
      const updated = { ...player };
      const pos = player.pos;
      const team = utils.normalizeTeam(player.team);
      let multiplier = 1;

      if (env === "Shootout") {
        if (pos === "QB") multiplier = 1.08;
        if (pos === "WR") multiplier = 1.08;
        if (pos === "TE") multiplier = 1.06;
        if (pos === "RB") multiplier = 0.98;
        if (pos === "DST") multiplier = 0.92;
      } else if (env === "Ugly/Defensive") {
        if (pos === "QB") multiplier = 0.92;
        if (pos === "WR") multiplier = 0.92;
        if (pos === "TE") multiplier = 0.94;
        if (pos === "RB") multiplier = 1.05;
        if (pos === "DST") multiplier = 1.08;
      } else if (env === "Blowout" && gameTeams && favoredTeam) {
        const favored = utils.normalizeTeam(favoredTeam);
        if (team === favored) {
          if (pos === "RB") multiplier = 1.1;
          if (pos === "DST") multiplier = 1.1;
          if (pos === "WR") multiplier = 1.03;
          if (pos === "TE") multiplier = 0.98;
          if (pos === "QB") multiplier = 1.0;
        } else if (gameTeams.includes(team)) {
          if (pos === "QB") multiplier = 1.03;
          if (pos === "WR") multiplier = 1.03;
          if (pos === "TE") multiplier = 1.01;
          if (pos === "RB") multiplier = 0.92;
          if (pos === "DST") multiplier = 0.85;
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

  utils.safeNumber = function (value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
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

  utils.formatNumber = function (value, digits = 2) {
    return Number(value).toFixed(digits);
  };

  utils.createCell = function (text, className) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  };

  window.utils = utils;
})();
