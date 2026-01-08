/* NFL DFS Classic Optimizer (separate page)
 * - Loads/validates optimal_lineup_rec.csv first
 * - Then runs a real DK Classic ILP optimizer using glpk.js
 */

const UI = {
  playersPath: document.getElementById("playersPath"),
  gamesPath: document.getElementById("gamesPath"),
  recPath: document.getElementById("recPath"),
  heatmapPath: document.getElementById("heatmapPath"),

  btnLoad: document.getElementById("btnLoad"),
  btnOptimize: document.getElementById("btnOptimize"),
  btnUseRecAsLocks: document.getElementById("btnUseRecAsLocks"),
  btnClearLocks: document.getElementById("btnClearLocks"),

  status: document.getElementById("status"),

  recSummary: document.getElementById("recSummary"),
  recTable: document.getElementById("recTable"),

  optSummary: document.getElementById("optSummary"),
  optTable: document.getElementById("optTable"),

  salaryCap: document.getElementById("salaryCap"),
  maxPerTeam: document.getElementById("maxPerTeam"),
  objective: document.getElementById("objective"),

  locks: document.getElementById("locks"),
  excludes: document.getElementById("excludes"),
};

let DATA = {
  players: [],
  games: [],
  heatmap: [],
  rec: [],
  recValidated: false,
};

// ---------- helpers ----------
function setStatus(msg) {
  UI.status.textContent = msg;
}

function parseCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      dynamicTyping: false,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: (err) => reject(err),
    });
  });
}

function norm(s) {
  return String(s ?? "").trim();
}

function toNum(x) {
  const n = Number(String(x ?? "").replace(/[$,]/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function uniq(arr) {
  return [...new Set(arr)];
}

function renderTable(tableEl, rows, columns) {
  const thead = tableEl.querySelector("thead");
  const tbody = tableEl.querySelector("tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";

  // header
  const trh = document.createElement("tr");
  columns.forEach((c) => {
    const th = document.createElement("th");
    th.textContent = c;
    trh.appendChild(th);
  });
  thead.appendChild(trh);

  // body
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    columns.forEach((c) => {
      const td = document.createElement("td");
      td.textContent = r[c] ?? "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

// Try to infer common column names across your CSVs
function pickColumn(obj, candidates) {
  const keys = Object.keys(obj || {}).map(k => k.toLowerCase());
  for (const cand of candidates) {
    const idx = keys.indexOf(cand.toLowerCase());
    if (idx >= 0) return Object.keys(obj)[idx];
  }
  return null;
}

// ---------- validation: optimal_lineup_rec.csv ----------
function validateRecLineup(recRows) {
  // We accept either:
  // A) 9 rows, one per roster slot
  // B) 1 row with columns like QB,RB1,RB2,... (we’ll attempt to expand if present)
  if (!recRows || recRows.length === 0) {
    return { ok: false, errors: ["optimal_lineup_rec.csv is empty."] };
  }

  // detect format A: row-per-player (common)
  const first = recRows[0];

  const colName = pickColumn(first, ["name", "player_name", "player", "full_name"]);
  const colId   = pickColumn(first, ["id", "player_id", "dk_id", "draftkings_id"]);
  const colPos  = pickColumn(first, ["pos", "position", "roster_position", "slot"]);
  const colSal  = pickColumn(first, ["salary", "sal", "dk_salary"]);
  const colTeam = pickColumn(first, ["team", "team_abbr", "abbr", "teamabbr"]);
  const colProj = pickColumn(first, ["proj", "projection", "fpts", "points"]);

  // If we have at least name/id and something for pos, assume row-per-player
  const looksLikeRows = (colName || colId) && (colPos || colTeam || colSal || colProj);

  let lineup = [];

  if (looksLikeRows && recRows.length >= 2) {
    lineup = recRows.map(r => ({
      Name: norm(colName ? r[colName] : ""),
      ID: norm(colId ? r[colId] : ""),
      Pos: norm(colPos ? r[colPos] : ""),
      Team: norm(colTeam ? r[colTeam] : ""),
      Salary: toNum(colSal ? r[colSal] : null),
      Proj: toNum(colProj ? r[colProj] : null),
    })).filter(x => x.Name || x.ID);
  } else {
    // Attempt format B: single row with slot columns
    const slotCols = ["QB","RB1","RB2","WR1","WR2","WR3","TE","FLEX","DST"];
    const row0 = recRows[0];
    const hasSlots = slotCols.some(sc => Object.keys(row0).some(k => k.toUpperCase() === sc));
    if (!hasSlots) {
      return { ok:false, errors:[
        "Could not infer format of optimal_lineup_rec.csv.",
        "Expected either 9 player-rows with Name/Pos/etc, or 1 row with columns QB,RB1,RB2,WR1,WR2,WR3,TE,FLEX,DST."
      ]};
    }
    lineup = slotCols.map(sc => {
      const key = Object.keys(row0).find(k => k.toUpperCase() === sc);
      return { Name: norm(row0[key]), ID:"", Pos: sc, Team:"", Salary:null, Proj:null };
    }).filter(x => x.Name);
  }

  const errors = [];
  if (lineup.length !== 9) errors.push(`Rec lineup should have 9 players, found ${lineup.length}.`);

  // Basic DK slot sanity (we allow Pos to be missing; you might only have name)
  // If Pos is present and already roster slots, validate roster slot counts
  const rosterSlots = ["QB","RB","WR","TE","FLEX","DST","D/ST","DEF"];
  const posVals = lineup.map(p => p.Pos.toUpperCase()).filter(Boolean);

  const hasRosterLikePos = posVals.some(p => rosterSlots.includes(p));
  if (hasRosterLikePos) {
    const counts = {};
    posVals.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
    // Accept either RB=2/WR=3 style or RB1/RB2 style; we keep it loose but check totals
    const qb = (counts["QB"]||0);
    const te = (counts["TE"]||0);
    const dst = (counts["DST"]||0) + (counts["D/ST"]||0) + (counts["DEF"]||0);
    const flex = (counts["FLEX"]||0);
    // RB/WR could be encoded as RB and WR, or roster_position might already be RB/WR.
    if (qb !== 1) errors.push(`Expected 1 QB, got ${qb}.`);
    if (te !== 1) errors.push(`Expected 1 TE, got ${te}.`);
    if (dst !== 1) errors.push(`Expected 1 DST, got ${dst}.`);
    if (flex !== 1) errors.push(`Expected 1 FLEX, got ${flex}.`);
  }

  // Duplicates by ID or Name
  const ids = lineup.map(p => p.ID).filter(Boolean);
  const names = lineup.map(p => p.Name).filter(Boolean);
  if (ids.length && uniq(ids).length !== ids.length) errors.push("Duplicate player IDs found in rec lineup.");
  if (!ids.length && uniq(names).length !== names.length) errors.push("Duplicate player names found in rec lineup.");

  // Salary cap check only if salaries exist
  const salNums = lineup.map(p => p.Salary).filter(n => Number.isFinite(n));
  if (salNums.length >= 6) {
    const total = salNums.reduce((a,b)=>a+b,0);
    if (total > 50000) errors.push(`Rec lineup salary ${total} exceeds 50000.`);
  }

  return { ok: errors.length === 0, errors, lineup };
}

// ---------- players normalization ----------
function normalizePlayers(playersRows) {
  if (!playersRows || !playersRows.length) return [];

  const f = playersRows[0];

  const cName = pickColumn(f, ["name", "player_name", "player", "full_name"]);
  const cId   = pickColumn(f, ["id", "player_id", "dk_id", "draftkings_id"]);
  const cPos  = pickColumn(f, ["pos", "position"]);
  const cTeam = pickColumn(f, ["team", "team_abbr", "abbr", "teamabbr"]);
  const cSal  = pickColumn(f, ["salary", "sal", "dk_salary"]);
  const cProj = pickColumn(f, ["proj", "projection", "fpts", "points"]);
  const cOpp  = pickColumn(f, ["opp", "opponent", "opponent_abbr"]);
  const cGame = pickColumn(f, ["game_id", "gameid", "game"]);

  // NOTE: If your players_classic.csv uses different headers, add them above.
  const out = playersRows.map(r => {
    const name = norm(cName ? r[cName] : "");
    const id = norm(cId ? r[cId] : "");
    const pos = norm(cPos ? r[cPos] : "").toUpperCase();
    const team = norm(cTeam ? r[cTeam] : "").toUpperCase();
    const salary = toNum(cSal ? r[cSal] : null);
    const proj = toNum(cProj ? r[cProj] : null);
    const opp = norm(cOpp ? r[cOpp] : "").toUpperCase();
    const gameId = norm(cGame ? r[cGame] : "");
    return { id, name, pos, team, salary, proj, opp, gameId };
  }).filter(p => (p.id || p.name) && p.pos && Number.isFinite(p.salary) && Number.isFinite(p.proj));

  return out;
}

function parseLockList(s) {
  return norm(s)
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

function matchesPlayer(p, token) {
  const t = token.trim().toLowerCase();
  if (!t) return false;
  return (p.id && p.id.toLowerCase() === t) || (p.name && p.name.toLowerCase() === t);
}

// ---------- optimizer (ILP) ----------
async function runOptimizer(players) {
  const salaryCap = Number(UI.salaryCap.value || 50000);
  const maxPerTeam = Number(UI.maxPerTeam.value || 4);
  const objective = UI.objective.value;

  const lockTokens = parseLockList(UI.locks.value);
  const excludeTokens = parseLockList(UI.excludes.value);

  // Exclude invalid positions or projections/salary
  const pool = players.filter(p =>
    ["QB","RB","WR","TE","DST"].includes(p.pos) &&
    Number.isFinite(p.salary) &&
    Number.isFinite(p.proj)
  );

  // Apply excludes
  const pool2 = pool.filter(p => !excludeTokens.some(tok => matchesPlayer(p, tok)));

  // Resolve locks
  const locked = pool2.filter(p => lockTokens.some(tok => matchesPlayer(p, tok)));
  const lockedIds = new Set(locked.map(p => p.id || p.name));

  // DK roster requirements:
  // QB 1
  // RB >=2
  // WR >=3
  // TE >=1
  // DST 1
  // Total 9
  // Additionally, RB/WR/TE total must be 7 (RB2 + WR3 + TE1 + FLEX1)
  const GLPK = await glpk(); // from CDN

  // Variables: x_i in {0,1} for each player i
  const vars = pool2.map((p, i) => ({
    name: `x_${i}`,
    p,
  }));

  // Objective coefficients
  const objCoefs = {};
  vars.forEach(v => {
    if (objective === "value") {
      // Max proj, but slightly favor value by adding a tiny proj/salary component
      objCoefs[v.name] = v.p.proj + (v.p.proj / Math.max(1000, v.p.salary)) * 0.01;
    } else {
      objCoefs[v.name] = v.p.proj;
    }
  });

  // Constraints builder
  const subjectTo = [];

  function addEq(name, coefMap, rhs) {
    subjectTo.push({ name, vars: Object.entries(coefMap).map(([n, c]) => ({ name: n, coef: c })), bnds: { type: GLPK.GLP_FX, ub: rhs, lb: rhs } });
  }
  function addLe(name, coefMap, rhs) {
    subjectTo.push({ name, vars: Object.entries(coefMap).map(([n, c]) => ({ name: n, coef: c })), bnds: { type: GLPK.GLP_UP, ub: rhs, lb: 0 } });
  }
  function addGe(name, coefMap, rhs) {
    subjectTo.push({ name, vars: Object.entries(coefMap).map(([n, c]) => ({ name: n, coef: c })), bnds: { type: GLPK.GLP_LO, ub: 0, lb: rhs } });
  }

  // Total players = 9
  {
    const coef = {};
    vars.forEach(v => coef[v.name] = 1);
    addEq("total_players", coef, 9);
  }

  // Salary cap
  {
    const coef = {};
    vars.forEach(v => coef[v.name] = v.p.salary);
    addLe("salary_cap", coef, salaryCap);
  }

  // Position constraints
  const posCoef = (pos) => {
    const coef = {};
    vars.forEach(v => { if (v.p.pos === pos) coef[v.name] = 1; });
    return coef;
  };

  addEq("QB_eq_1", posCoef("QB"), 1);
  addEq("DST_eq_1", posCoef("DST"), 1);
  addGe("RB_ge_2", posCoef("RB"), 2);
  addGe("WR_ge_3", posCoef("WR"), 3);
  addGe("TE_ge_1", posCoef("TE"), 1);

  // RB+WR+TE must equal 7 (because QB + DST = 2, total 9, leaving 7)
  {
    const coef = {};
    vars.forEach(v => { if (["RB","WR","TE"].includes(v.p.pos)) coef[v.name] = 1; });
    addEq("skill_eq_7", coef, 7);
  }

  // Team max constraint (default 4)
  if (Number.isFinite(maxPerTeam) && maxPerTeam > 0) {
    const teams = uniq(vars.map(v => v.p.team).filter(Boolean));
    teams.forEach(team => {
      const coef = {};
      vars.forEach(v => { if (v.p.team === team) coef[v.name] = 1; });
      addLe(`team_max_${team}`, coef, maxPerTeam);
    });
  }

  // Locks: each locked player must be selected
  locked.forEach(lockP => {
    const v = vars.find(vv => (vv.p.id && vv.p.id === lockP.id) || (vv.p.name === lockP.name));
    if (v) {
      const coef = {}; coef[v.name] = 1;
      addEq(`lock_${v.name}`, coef, 1);
    }
  });

  // Build model
  const binaries = vars.map(v => v.name);

  const model = {
    name: "dk_classic_optimizer",
    objective: {
      direction: GLPK.GLP_MAX,
      name: "obj",
      vars: Object.entries(objCoefs).map(([name, coef]) => ({ name, coef })),
    },
    subjectTo,
    binaries,
  };

  const result = GLPK.solve(model, { msgLevel: GLPK.GLP_MSG_OFF });

  if (!result || !result.result) {
    return { ok: false, error: "Solver returned no result." };
  }

  const status = result.result.status;
  // GLPK: 5 = optimal (commonly), but statuses can vary; treat feasible/optimal similarly
  const sol = result.result.vars || {};
  const picked = vars.filter(v => (sol[v.name] || 0) > 0.5).map(v => v.p);

  if (picked.length !== 9) {
    return { ok: false, error: `Infeasible or incomplete lineup. Picked ${picked.length} players. Try relaxing locks/excludes.` };
  }

  // Post-check skill positions: determine FLEX slot assignment for display
  // We’ll pick:
  // QB (1), DST (1), TE (1), then RB (2), WR (3), remaining skill is FLEX
  const lineup = [];
  const qb = picked.find(p => p.pos === "QB");
  const dst = picked.find(p => p.pos === "DST");
  const tes = picked.filter(p => p.pos === "TE");
  const rbs = picked.filter(p => p.pos === "RB");
  const wrs = picked.filter(p => p.pos === "WR");

  if (!qb || !dst || tes.length < 1 || rbs.length < 2 || wrs.length < 3) {
    return { ok:false, error:"Solver produced a lineup that fails DK roster rules (unexpected). Check player position labels." };
  }

  lineup.push({ Slot:"QB", ...qb });
  lineup.push({ Slot:"RB", ...rbs[0] });
  lineup.push({ Slot:"RB", ...rbs[1] });
  lineup.push({ Slot:"WR", ...wrs[0] });
  lineup.push({ Slot:"WR", ...wrs[1] });
  lineup.push({ Slot:"WR", ...wrs[2] });
  lineup.push({ Slot:"TE", ...tes[0] });

  // Remaining skill player is FLEX
  const used = new Set(lineup.map(p => p.id || p.name));
  const flex = picked.filter(p => ["RB","WR","TE"].includes(p.pos)).find(p => !used.has(p.id || p.name));
  if (!flex) {
    return { ok:false, error:"Could not assign FLEX (unexpected)."};
  }
  lineup.push({ Slot:"FLEX", ...flex });
  lineup.push({ Slot:"DST", ...dst });

  // Totals
  const totalSalary = lineup.reduce((a,p)=>a+(p.salary||0),0);
  const totalProj = lineup.reduce((a,p)=>a+(p.proj||0),0);

  return { ok:true, lineup, totalSalary, totalProj, status };
}

// ---------- UI wiring ----------
UI.btnLoad.addEventListener("click", async () => {
  try {
    setStatus("Loading CSVs…");

    const [players, games, rec, heatmap] = await Promise.all([
      parseCSV(UI.playersPath.value),
      parseCSV(UI.gamesPath.value),
      parseCSV(UI.recPath.value),
      parseCSV(UI.heatmapPath.value),
    ]);

    DATA.players = normalizePlayers(players);
    DATA.games = games;
    DATA.heatmap = heatmap;
    DATA.rec = rec;

    setStatus(`Loaded players=${DATA.players.length}, games=${DATA.games.length}, rec_rows=${DATA.rec.length}, heatmap_rows=${DATA.heatmap.length}`);

    const v = validateRecLineup(DATA.rec);
    DATA.recValidated = v.ok;

    if (!v.ok) {
      UI.recSummary.textContent = `❌ Validation failed:\n- ${v.errors.join("\n- ")}`;
      UI.btnOptimize.disabled = true;
      UI.btnUseRecAsLocks.disabled = true;
      renderTable(UI.recTable, [], [""]);
      setStatus("Rec lineup validation failed.");
      return;
    }

    // Render rec lineup table
    const lineup = v.lineup.map((p, idx) => ({
      "#": idx + 1,
      Name: p.Name,
      ID: p.ID,
      Pos: p.Pos,
      Team: p.Team,
      Salary: p.Salary ?? "",
      Proj: p.Proj ?? "",
    }));

    const salTotal = lineup.reduce((a,r)=>a+(Number(r.Salary)||0),0);
    const projTotal = lineup.reduce((a,r)=>a+(Number(r.Proj)||0),0);

    UI.recSummary.textContent =
      `✅ Valid rec lineup • players=${lineup.length} • salary=${salTotal || "n/a"} • proj=${projTotal || "n/a"}\n` +
      `Next: click “Run Optimizer (DK Classic)”.`;

    renderTable(UI.recTable, lineup, ["#","Name","ID","Pos","Team","Salary","Proj"]);

    UI.btnOptimize.disabled = false;
    UI.btnUseRecAsLocks.disabled = false;

    setStatus("Rec lineup validated. Ready to optimize.");
  } catch (e) {
    console.error(e);
    setStatus("Error loading CSVs. Open console for details.");
    UI.recSummary.textContent = `❌ Load error: ${e?.message || e}`;
  }
});

UI.btnUseRecAsLocks.addEventListener("click", () => {
  const v = validateRecLineup(DATA.rec);
  if (!v.ok) return;

  // Use rec players as locks by trying to match by ID first, otherwise name
  // We set tokens as either IDs if present or names
  const tokens = v.lineup.map(p => p.ID || p.Name).filter(Boolean);
  UI.locks.value = tokens.join(", ");
  setStatus("Rec lineup copied into Locks.");
});

UI.btnClearLocks.addEventListener("click", () => {
  UI.locks.value = "";
  UI.excludes.value = "";
  setStatus("Locks/excludes cleared.");
});

UI.btnOptimize.addEventListener("click", async () => {
  try {
    if (!DATA.players.length) {
      setStatus("Load CSVs first.");
      return;
    }

    setStatus("Running ILP optimizer…");

    const res = await runOptimizer(DATA.players);

    if (!res.ok) {
      UI.optSummary.textContent = `❌ ${res.error}`;
      renderTable(UI.optTable, [], [""]);
      setStatus("Optimizer failed.");
      return;
    }

    UI.optSummary.textContent = `✅ Optimized lineup • salary=${res.totalSalary} • proj=${res.totalProj.toFixed(2)} • solver_status=${res.status}`;

    const rows = res.lineup.map((p, i) => ({
      "#": i + 1,
      Slot: p.Slot,
      Name: p.name,
      ID: p.id,
      Pos: p.pos,
      Team: p.team,
      Salary: p.salary,
      Proj: p.proj,
      Opp: p.opp || "",
      Game: p.gameId || "",
    }));

    renderTable(UI.optTable, rows, ["#","Slot","Name","ID","Pos","Team","Opp","Salary","Proj","Game"]);
    setStatus("Optimizer finished.");
  } catch (e) {
    console.error(e);
    setStatus("Optimizer crashed. Open console for details.");
    UI.optSummary.textContent = `❌ Optimize error: ${e?.message || e}`;
  }
});
