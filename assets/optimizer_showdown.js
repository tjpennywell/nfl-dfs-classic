(function () {
  const state = {
    games: [],
    players: [],
    salarySource: null,
  };

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

  function buildShowdownModel(players, cap, maxPerTeam) {
    const glpk = window.glpk;
    const bounds = [];
    const binaries = [];
    const objective = [];
    const vars = [];

    players.forEach((player, index) => {
      const flexName = `f${index}`;
      const cptName = `c${index}`;
      vars.push({ flexName, cptName, player });
      objective.push({ name: flexName, coef: player.proj });
      objective.push({ name: cptName, coef: player.proj * 1.5 });
      bounds.push({ name: flexName, type: glpk.GLP_DB, lb: 0, ub: 1 });
      bounds.push({ name: cptName, type: glpk.GLP_DB, lb: 0, ub: 1 });
      binaries.push(flexName, cptName);
    });

    const constraints = [];

    constraints.push({
      name: "salary_cap",
      vars: vars.flatMap((v) => [
        { name: v.flexName, coef: v.player.salary },
        { name: v.cptName, coef: v.player.salary * 1.5 },
      ]),
      bnds: { type: glpk.GLP_UP, ub: cap, lb: 0 },
    });

    constraints.push({
      name: "cpt_count",
      vars: vars.map((v) => ({ name: v.cptName, coef: 1 })),
      bnds: { type: glpk.GLP_FX, lb: 1, ub: 1 },
    });

    constraints.push({
      name: "flex_count",
      vars: vars.map((v) => ({ name: v.flexName, coef: 1 })),
      bnds: { type: glpk.GLP_FX, lb: 5, ub: 5 },
    });

    vars.forEach((v) => {
      constraints.push({
        name: `unique_${v.flexName}`,
        vars: [
          { name: v.flexName, coef: 1 },
          { name: v.cptName, coef: 1 },
        ],
        bnds: { type: glpk.GLP_UP, ub: 1, lb: 0 },
      });
    });

    const teams = Array.from(new Set(players.map((p) => p.team)));
    teams.forEach((team) => {
      constraints.push({
        name: `team_${team}`,
        vars: vars.flatMap((v) =>
          v.player.team === team
            ? [
                { name: v.flexName, coef: 1 },
                { name: v.cptName, coef: 1 },
              ]
            : []
        ),
        bnds: { type: glpk.GLP_UP, ub: maxPerTeam, lb: 0 },
      });
    });

    return {
      name: "showdown",
      objective: { direction: glpk.GLP_MAX, name: "obj", vars: objective },
      subjectTo: constraints,
      bounds,
      binaries,
    };
  }

  function renderOptimized(lineup) {
    const tbody = document.querySelector("#optimized-table tbody");
    tbody.innerHTML = "";
    const totalSalaryEl = document.getElementById("opt-total-salary");
    const totalProjEl = document.getElementById("opt-total-proj");

    let totalSalary = 0;
    let totalProj = 0;

    lineup.forEach((slot) => {
      totalSalary += slot.salary;
      totalProj += slot.proj;
      const tr = document.createElement("tr");
      tr.appendChild(utils.createCell(slot.slot));
      tr.appendChild(utils.createCell(slot.name));
      tr.appendChild(utils.createCell(slot.team));
      tr.appendChild(utils.createCell(slot.salary));
      tr.appendChild(utils.createCell(utils.formatNumber(slot.proj)));
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
    const env = document.getElementById("environment").value;
    const favoredTeam = document.getElementById("favored-team").value;

    const game = state.games[gameIndex];
    if (!game) {
      utils.showError("Select a game before optimizing.");
      return;
    }

    const gameTeams = [game.home, game.away];
    let pool = state.players.filter((player) => gameTeams.includes(player.team));
    pool = utils.applyEnvironment(pool, env, gameTeams, favoredTeam);

    window.glpk = glpkInstance;
    const lp = buildShowdownModel(pool, cap, maxPerTeam);
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
      if (name.startsWith("c")) {
        lineup.unshift({
          slot: "CPT",
          name: player.name,
          team: player.team,
          salary: player.salary * 1.5,
          proj: player.proj * 1.5,
        });
      } else {
        lineup.push({
          slot: "FLEX",
          name: player.name,
          team: player.team,
          salary: player.salary,
          proj: player.proj,
        });
      }
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
