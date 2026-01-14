(function () {
  const state = {
    games: [],
    players: [],
    salarySource: null,
  };

  const POSITION_REQUIREMENTS = [
    { pos: "QB", min: 1, max: 1 },
    { pos: "RB", min: 2, max: 3 },
    { pos: "WR", min: 3, max: 4 },
    { pos: "TE", min: 1, max: 2 },
    { pos: "DST", min: 1, max: 1 },
  ];

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
    wrap.style.display = env === "Blowout/Ugly" ? "block" : "none";
    if (env === "Blowout/Ugly") {
      updateFavoredTeams();
    }
  }

  function buildClassicModel(players, cap, maxPerTeam, locks, excludes) {
    const glpk = window.glpk;
    const bounds = [];
    const binaries = [];
    const objective = [];
    const vars = [];

    const lockSet = new Set(locks.map((name) => name.toLowerCase()));
    const excludeSet = new Set(excludes.map((name) => name.toLowerCase()));

    players.forEach((player, index) => {
      const varName = `p${index}`;
      vars.push({ name: varName, player });
      objective.push({ name: varName, coef: player.proj });

      let lb = 0;
      let ub = 1;
      const lowerName = player.name.toLowerCase();
      if (lockSet.has(lowerName)) {
        lb = 1;
        ub = 1;
      }
      if (excludeSet.has(lowerName)) {
        lb = 0;
        ub = 0;
      }

      bounds.push({ name: varName, type: glpk.GLP_DB, lb, ub });
      binaries.push(varName);
    });

    const constraints = [];

    constraints.push({
      name: "salary_cap",
      vars: vars.map((v) => ({ name: v.name, coef: v.player.salary })),
      bnds: { type: glpk.GLP_UP, ub: cap, lb: 0 },
    });

    constraints.push({
      name: "lineup_size",
      vars: vars.map((v) => ({ name: v.name, coef: 1 })),
      bnds: { type: glpk.GLP_FX, lb: 9, ub: 9 },
    });

    POSITION_REQUIREMENTS.forEach((req) => {
      constraints.push({
        name: `pos_${req.pos}`,
        vars: vars.filter((v) => v.player.pos === req.pos).map((v) => ({
          name: v.name,
          coef: 1,
        })),
        bnds: { type: glpk.GLP_DB, lb: req.min, ub: req.max },
      });
    });

    const teams = Array.from(new Set(players.map((p) => p.team)));
    teams.forEach((team) => {
      constraints.push({
        name: `team_${team}`,
        vars: vars.filter((v) => v.player.team === team).map((v) => ({
          name: v.name,
          coef: 1,
        })),
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

  function renderLineup(tableId, lineup) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    tbody.innerHTML = "";
    lineup.forEach((player) => {
      const tr = document.createElement("tr");
      tr.appendChild(utils.createCell(player.pos));
      tr.appendChild(utils.createCell(player.name));
      tr.appendChild(utils.createCell(player.team));
      tr.appendChild(utils.createCell(player.salary));
      tr.appendChild(utils.createCell(utils.formatNumber(player.proj)));
      tbody.appendChild(tr);
    });
  }

  function renderOptimized(lineup) {
    renderLineup("optimized-table", lineup);
    const totalSalaryEl = document.getElementById("opt-total-salary");
    const totalProjEl = document.getElementById("opt-total-proj");
    const totals = lineup.reduce(
      (acc, player) => {
        acc.salary += player.salary;
        acc.proj += player.proj;
        return acc;
      },
      { salary: 0, proj: 0 }
    );

    totalSalaryEl.textContent = totals.salary;
    totalProjEl.textContent = utils.formatNumber(totals.proj);
  }

  function renderRecommended(pool) {
    const note = document.getElementById("recommended-note");
    if (!pool.length) {
      note.style.display = "block";
      note.textContent = "No players found for the selected filters.";
      return;
    }

    const sorted = [...pool].sort((a, b) => b.proj - a.proj);
    const lineup = [];
    const needs = {
      QB: 1,
      RB: 2,
      WR: 3,
      TE: 1,
      DST: 1,
    };

    sorted.forEach((player) => {
      if (needs[player.pos] > 0) {
        lineup.push(player);
        needs[player.pos] -= 1;
      }
    });

    const flexPool = sorted.filter((p) => ["RB", "WR", "TE"].includes(p.pos) && !lineup.includes(p));
    if (flexPool.length) {
      lineup.push(flexPool[0]);
    }

    note.style.display = "block";
    note.textContent = "Baseline recommendation uses top projections before salary cap filtering.";
    renderLineup("recommended-table", lineup);
  }

  async function optimize() {
    const glpkInstance = await utils.getGlpkInstance();
    if (!glpkInstance) return;

    const cap = utils.safeNumber(document.getElementById("salary-cap").value);
    const maxPerTeam = utils.safeNumber(document.getElementById("team-cap").value);
    const gameIndex = Number(document.getElementById("game-select").value || 0);
    const env = document.getElementById("environment").value;
    const favoredTeam = document.getElementById("favored-team").value;
    const onlyGame = document.getElementById("only-game").checked;

    const game = state.games[gameIndex];
    if (!game) {
      utils.showError("Select a game before optimizing.");
      return;
    }

    const gameTeams = [game.home, game.away];
    let pool = [...state.players];
    if (onlyGame) {
      pool = pool.filter((player) => gameTeams.includes(player.team));
    }
    pool = utils.applyEnvironment(pool, env, gameTeams, favoredTeam);

    renderRecommended(pool);

    const locks = utils.parseNameList(document.getElementById("locks").value);
    const excludes = utils.parseNameList(document.getElementById("excludes").value);

    window.glpk = glpkInstance;
    const lp = buildClassicModel(pool, cap, maxPerTeam, locks, excludes);
    const result = glpkInstance.solve(lp, { msgLevel: glpkInstance.GLP_MSG_OFF });

    if (!result || !result.result || result.result.status !== glpkInstance.GLP_OPT) {
      utils.showError("Optimization failed to find a lineup. Try adjusting constraints.");
      return;
    }

    const lineup = [];
    Object.entries(result.result.vars).forEach(([name, value]) => {
      if (value !== 1) return;
      const index = Number(name.slice(1));
      const player = pool[index];
      if (!player) return;
      lineup.push(player);
    });

    renderOptimized(lineup);
  }

  function renderSourceNote() {
    const note = document.getElementById("data-source");
    if (note && state.salarySource) {
      note.style.display = "block";
      note.textContent = `Salary data source: ${state.salarySource.label}`;
    }
  }

  async function init() {
    utils.initDebugBar();
    try {
      const [gamesData, salaryData] = await Promise.all([
        utils.loadScoreboard(),
        utils.loadSalaries(),
      ]);
      state.games = gamesData;
      state.players = salaryData.players;
      state.salarySource = salaryData.source;
      utils.logDebug(`Loaded ${state.games.length} games from ESPN`);
      utils.logDebug(`Loaded ${state.players.length} players from salary feed`);
      populateGames();
      renderSourceNote();
    } catch (err) {
      utils.showError("Failed to load live data feeds. Check console for details.");
      utils.logDebug(`Data load error: ${err}`);
    }

    document.getElementById("game-select").addEventListener("change", updateFavoredTeams);
    document.getElementById("environment").addEventListener("change", handleEnvironmentChange);
    document.getElementById("optimize-btn").addEventListener("click", optimize);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
