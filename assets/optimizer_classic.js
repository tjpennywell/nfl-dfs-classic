(function () {
  const state = {
    games: [],
    players: [],
    recommended: [],
  };

  const posOrder = { QB: 1, RB: 2, WR: 3, TE: 4, DST: 5 };

  function parseGames(rows) {
    return rows
      .map((row) => {
        const home = utils.normalizeTeam(row.home_team || row.Home || row.home || row.HOME);
        const away = utils.normalizeTeam(row.away_team || row.Away || row.away || row.AWAY);
        if (!home || !away) return null;
        return { home, away, label: `${away}@${home}` };
      })
      .filter(Boolean);
  }

  function parsePlayers(rows) {
    return rows
      .map((row) => ({
        name: row.name || row.Name,
        pos: String(row.pos || row.Pos || "").toUpperCase(),
        team: utils.normalizeTeam(row.team || row.Team),
        salary: utils.safeNumber(row.salary || row.Salary),
        proj: utils.safeNumber(row.proj || row.Proj),
      }))
      .filter((player) => player.name && player.pos && player.team);
  }

  function populateGames() {
    const select = document.getElementById("game-select");
    select.innerHTML = "";
    state.games.forEach((game, index) => {
      const option = document.createElement("option");
      option.value = index;
      option.textContent = game.label;
      select.appendChild(option);
    });
    updateFavoredTeams();
  }

  function updateFavoredTeams() {
    const gameSelect = document.getElementById("game-select");
    const favoredSelect = document.getElementById("favored-team");
    const index = Number(gameSelect.value || 0);
    const game = state.games[index];
    favoredSelect.innerHTML = "";
    if (!game) return;
    [game.home, game.away].forEach((team) => {
      const option = document.createElement("option");
      option.value = team;
      option.textContent = team;
      favoredSelect.appendChild(option);
    });
  }

  function handleEnvironmentChange() {
    const env = document.getElementById("environment").value;
    const wrap = document.getElementById("favored-wrap");
    wrap.style.display = env === "Blowout" ? "block" : "none";
    if (env === "Blowout") {
      updateFavoredTeams();
    }
  }

  function renderRecommended() {
    const tbody = document.querySelector("#recommended-table tbody");
    const note = document.getElementById("recommended-note");
    tbody.innerHTML = "";
    note.style.display = "none";

    if (!state.recommended.length) {
      note.textContent = "Recommended lineup file is empty or missing.";
      note.style.display = "block";
      return;
    }

    const first = state.recommended[0];
    const keys = Object.keys(first);
    const slotKeys = keys.filter((key) => /QB|RB|WR|TE|DST|FLEX/i.test(key));

    let rows = [];
    if (slotKeys.length) {
      const missing = [];
      slotKeys.forEach((slot) => {
        const name = String(first[slot] || "").trim();
        if (!name) return;
        const player = state.players.find((p) => p.name === name);
        if (!player) missing.push(name);
        rows.push({
          pos: slot.toUpperCase(),
          name,
          team: player ? player.team : "--",
          salary: player ? player.salary : 0,
          proj: player ? player.proj : 0,
        });
      });
      if (missing.length) {
        note.textContent = `Missing recommended players: ${missing.join(", ")}.`;
        note.style.display = "block";
      }
    } else {
      rows = state.recommended.map((row) => ({
        pos: String(row.pos || row.Pos || "").toUpperCase(),
        name: row.name || row.Name,
        team: utils.normalizeTeam(row.team || row.Team),
        salary: utils.safeNumber(row.salary || row.Salary),
        proj: utils.safeNumber(row.proj || row.Proj),
      }));
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.appendChild(utils.createCell(row.pos || ""));
      tr.appendChild(utils.createCell(row.name || ""));
      tr.appendChild(utils.createCell(row.team || ""));
      tr.appendChild(utils.createCell(row.salary || 0));
      tr.appendChild(utils.createCell(utils.formatNumber(row.proj || 0)));
      tbody.appendChild(tr);
    });
  }

  function buildClassicModel(players, cap, maxPerTeam, locks, excludes) {
    const glpk = window.glpk;
    const vars = [];
    const bounds = [];
    const binaries = [];
    const objective = [];

    players.forEach((player, index) => {
      const name = `p${index}`;
      vars.push({ name, player });
      objective.push({ name, coef: player.proj });
      const isLocked = locks.includes(player.name);
      const isExcluded = excludes.includes(player.name);
      if (isLocked) {
        bounds.push({ name, type: glpk.GLP_FX, lb: 1, ub: 1 });
      } else if (isExcluded) {
        bounds.push({ name, type: glpk.GLP_FX, lb: 0, ub: 0 });
      } else {
        bounds.push({ name, type: glpk.GLP_DB, lb: 0, ub: 1 });
        binaries.push(name);
      }
    });

    const constraints = [];

    constraints.push({
      name: "salary_cap",
      vars: vars.map((v) => ({ name: v.name, coef: v.player.salary })),
      bnds: { type: glpk.GLP_UP, ub: cap, lb: 0 },
    });

    constraints.push({
      name: "total_players",
      vars: vars.map((v) => ({ name: v.name, coef: 1 })),
      bnds: { type: glpk.GLP_FX, ub: 9, lb: 9 },
    });

    const posConstraint = (pos, type, value) => ({
      name: `pos_${pos}`,
      vars: vars
        .filter((v) => v.player.pos === pos)
        .map((v) => ({ name: v.name, coef: 1 })),
      bnds: { type, ub: value, lb: value },
    });

    constraints.push(posConstraint("QB", glpk.GLP_FX, 1));
    constraints.push(posConstraint("DST", glpk.GLP_FX, 1));

    constraints.push({
      name: "rb_min",
      vars: vars
        .filter((v) => v.player.pos === "RB")
        .map((v) => ({ name: v.name, coef: 1 })),
      bnds: { type: glpk.GLP_LO, lb: 2, ub: 0 },
    });

    constraints.push({
      name: "wr_min",
      vars: vars
        .filter((v) => v.player.pos === "WR")
        .map((v) => ({ name: v.name, coef: 1 })),
      bnds: { type: glpk.GLP_LO, lb: 3, ub: 0 },
    });

    constraints.push({
      name: "te_min",
      vars: vars
        .filter((v) => v.player.pos === "TE")
        .map((v) => ({ name: v.name, coef: 1 })),
      bnds: { type: glpk.GLP_LO, lb: 1, ub: 0 },
    });

    constraints.push({
      name: "skill_total",
      vars: vars
        .filter((v) => ["RB", "WR", "TE"].includes(v.player.pos))
        .map((v) => ({ name: v.name, coef: 1 })),
      bnds: { type: glpk.GLP_FX, lb: 7, ub: 7 },
    });

    const teams = Array.from(new Set(players.map((p) => p.team)));
    teams.forEach((team) => {
      constraints.push({
        name: `team_${team}`,
        vars: vars
          .filter((v) => v.player.team === team)
          .map((v) => ({ name: v.name, coef: 1 })),
        bnds: { type: glpk.GLP_UP, ub: maxPerTeam, lb: 0 },
      });
    });

    return {
      name: "classic",
      objective: { direction: glpk.GLP_MAX, name: "obj", vars: objective },
      subjectTo: constraints,
      bounds,
      binaries,
    };
  }

  function renderOptimized(players) {
    const tbody = document.querySelector("#optimized-table tbody");
    tbody.innerHTML = "";
    const totalSalaryEl = document.getElementById("opt-total-salary");
    const totalProjEl = document.getElementById("opt-total-proj");
    let totalSalary = 0;
    let totalProj = 0;

    players
      .sort((a, b) => (posOrder[a.pos] || 99) - (posOrder[b.pos] || 99))
      .forEach((player) => {
        totalSalary += player.salary;
        totalProj += player.proj;
        const tr = document.createElement("tr");
        tr.appendChild(utils.createCell(player.pos));
        tr.appendChild(utils.createCell(player.name));
        tr.appendChild(utils.createCell(player.team));
        tr.appendChild(utils.createCell(player.salary));
        tr.appendChild(utils.createCell(utils.formatNumber(player.proj)));
        tbody.appendChild(tr);
      });

    totalSalaryEl.textContent = totalSalary;
    totalProjEl.textContent = utils.formatNumber(totalProj);
  }

  async function optimize() {
    const glpkInstance = await utils.getGlpkInstance();
    if (!glpkInstance) return;

    const cap = utils.safeNumber(document.getElementById("salary-cap").value);
    const maxPerTeam = utils.safeNumber(document.getElementById("team-cap").value);
    const gameIndex = Number(document.getElementById("game-select").value || 0);
    const onlyGame = document.getElementById("only-game").checked;
    const env = document.getElementById("environment").value;
    const favoredTeam = document.getElementById("favored-team").value;

    const game = state.games[gameIndex];
    const gameTeams = game ? [game.home, game.away] : [];

    let pool = [...state.players];
    if (onlyGame && gameTeams.length) {
      pool = pool.filter((player) => gameTeams.includes(player.team));
    }

    pool = utils.applyEnvironment(pool, env, gameTeams, favoredTeam);

    const locks = utils.parseNameList(document.getElementById("locks").value);
    const excludes = utils.parseNameList(document.getElementById("excludes").value);

    window.glpk = glpkInstance;
    const lp = buildClassicModel(pool, cap, maxPerTeam, locks, excludes);
    const result = glpkInstance.solve(lp, { msgLevel: glpkInstance.GLP_MSG_OFF });

    if (!result || !result.result || result.result.status !== glpkInstance.GLP_OPT) {
      utils.showError("Optimization failed to find a lineup. Try adjusting constraints.");
      return;
    }

    const selected = [];
    Object.entries(result.result.vars).forEach(([name, value]) => {
      if (value === 1) {
        const index = Number(name.replace("p", ""));
        selected.push(pool[index]);
      }
    });

    renderOptimized(selected);
  }

  async function init() {
    utils.initDebugBar();
    try {
      const [games, players, recommended] = await Promise.all([
        utils.parseCsv("data/games_classic.csv"),
        utils.parseCsv("data/players_classic.csv"),
        utils.parseCsv("data/optimal_lineup_rec.csv"),
      ]);
      state.games = parseGames(games);
      state.players = parsePlayers(players);
      state.recommended = recommended;
      utils.logDebug(`Loaded ${state.games.length} games`);
      utils.logDebug(`Loaded ${state.players.length} players`);
      populateGames();
      renderRecommended();
    } catch (err) {
      utils.showError("Failed to load data files. Check console for details.");
      utils.logDebug(`Data load error: ${err}`);
    }

    document.getElementById("game-select").addEventListener("change", updateFavoredTeams);
    document.getElementById("environment").addEventListener("change", handleEnvironmentChange);
    document.getElementById("optimize-btn").addEventListener("click", optimize);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
