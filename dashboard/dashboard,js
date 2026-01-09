// NFL DFS Dashboard Script
// This script combines lineup optimization with matchup heatmaps into a
// single dashboard. It loads CSV data (players, games, recommended
// lineup, pass and rush heatmaps), runs an ILP optimiser for DraftKings
// classic lineup construction, and renders pass and rush heatmaps along
// with a simple summary highlighting positional edges.

import GLPKModule from 'https://cdn.jsdelivr.net/npm/glpk.js/dist/glpk.min.js';

let glpk;

// Data container
const data = {
    players: [],
    games: [],
    optimal: [],
    heatmaps: {
        pass: [],
        rush: [],
        classic: []
    }
};

/**
 * Load a CSV file using PapaParse.
 * @param {string} path - Relative path to the CSV file.
 * @returns {Promise<Array<Object>>}
 */
function loadCsv(path) {
    return new Promise((resolve, reject) => {
        Papa.parse(path, {
            download: true,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: results => resolve(results.data),
            error: err => reject(err)
        });
    });
}

/** Normalize team abbreviations. */
function normalizeTeam(code) {
    if (!code) return '';
    const c = String(code).trim().toUpperCase();
    if (c === 'LAR' || c === 'RAMS') return 'LA';
    return c;
}

/**
 * Colour interpolation for heatmap cells. See optimizer.js for details.
 * @param {number} val
 * @returns {string}
 */
function heatColor(val) {
    const clamp = Math.max(-1, Math.min(1, val || 0));
    const base = { r: 19, g: 42, b: 68 };
    const pos = { r: 46, g: 204, b: 113 };
    const neg = { r: 231, g: 76, b: 60 };
    let r, g, b;
    if (clamp >= 0) {
        r = Math.round(base.r + (pos.r - base.r) * clamp);
        g = Math.round(base.g + (pos.g - base.g) * clamp);
        b = Math.round(base.b + (pos.b - base.b) * clamp);
    } else {
        const abs = Math.abs(clamp);
        r = Math.round(base.r + (neg.r - base.r) * abs);
        g = Math.round(base.g + (neg.g - base.g) * abs);
        b = Math.round(base.b + (neg.b - base.b) * abs);
    }
    return `rgb(${r}, ${g}, ${b})`;
}

/** Determine text colour for contrast. */
function textColorForBackground(rgbString) {
    const parts = rgbString.match(/\d+/g);
    let r = 0, g = 0, b = 0;
    if (parts && parts.length >= 3) {
        r = parseInt(parts[0], 10);
        g = parseInt(parts[1], 10);
        b = parseInt(parts[2], 10);
    }
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 140 ? '#0f1a2c' : '#f8f9fa';
}

/**
 * Load all CSV data. Determines the correct relative path based on
 * whether the dashboard is served from a subdirectory (e.g., /dashboard/)
 * or the site root. Normalizes team codes and sets classic heatmap to pass.
 */
async function loadAllCsv() {
    const pathName = window.location.pathname;
    const isSubDir = pathName.includes('/dashboard/');
    const prefix = isSubDir ? '../data/' : 'data/';
    data.players = await loadCsv(prefix + 'players_classic.csv');
    data.games = await loadCsv(prefix + 'games_classic.csv');
    data.optimal = await loadCsv(prefix + 'optimal_lineup_rec.csv');
    try {
        const passRows = await loadCsv(prefix + 'heatmap_pass_matchup.csv');
        data.heatmaps.pass = passRows.map(row => {
            const copy = { ...row };
            copy.off_team = normalizeTeam(row.off_team);
            copy.def_team = normalizeTeam(row.def_team);
            return copy;
        });
    } catch (err) {
        console.warn('Pass heatmap load error:', err);
    }
    try {
        const rushRows = await loadCsv(prefix + 'heatmap_rush_proxy.csv');
        data.heatmaps.rush = rushRows.map(row => {
            const copy = { ...row };
            copy.off_team = normalizeTeam(row.off_team);
            copy.def_team = normalizeTeam(row.def_team);
            return copy;
        });
    } catch (err) {
        console.warn('Rush heatmap load error:', err);
    }
    // Use pass heatmap for classic by default
    data.heatmaps.classic = data.heatmaps.pass;
}

/** Populate the game selection dropdown. */
function populateGameSelect() {
    const select = document.getElementById('gameSelect');
    select.innerHTML = '';
    data.games.forEach(game => {
        const option = document.createElement('option');
        const gameId = game.GameId || game.gameId || game.game_id || '';
        const away = game.AwayTeam || game.awayTeam || game.away_team || '';
        const home = game.HomeTeam || game.homeTeam || game.home_team || '';
        const total = game.Total || game.total || '';
        const env = game.Env || game.env || '';
        option.value = gameId;
        option.textContent = `${away} @ ${home} (Total ${total} | Env ${env})`;
        select.appendChild(option);
    });
    if (select.options.length > 0) select.selectedIndex = 0;
}

/** Populate offence and defence team selectors. */
function populateTeamSelects() {
    const offSel = document.getElementById('offTeamSelect');
    const defSel = document.getElementById('defTeamSelect');
    offSel.innerHTML = '';
    defSel.innerHTML = '';
    const teams = new Set();
    ['pass', 'rush'].forEach(type => {
        data.heatmaps[type].forEach(row => {
            teams.add(normalizeTeam(row.off_team));
            teams.add(normalizeTeam(row.def_team));
        });
    });
    const sorted = Array.from(teams).filter(Boolean).sort();
    sorted.forEach(team => {
        const optOff = document.createElement('option');
        optOff.value = team;
        optOff.textContent = team;
        offSel.appendChild(optOff);
        const optDef = document.createElement('option');
        optDef.value = team;
        optDef.textContent = team;
        defSel.appendChild(optDef);
    });
    if (offSel.options.length > 0) offSel.selectedIndex = 0;
    if (defSel.options.length > 1) defSel.selectedIndex = 1;
}

/** Display the recommended lineup from the optimal CSV. */
function displayRecommendedLineup() {
    const tableBody = document.querySelector('#recLineup tbody');
    const totalsRow = document.getElementById('recTotals');
    tableBody.innerHTML = '';
    totalsRow.innerHTML = '';
    const names = data.optimal.map(r => r.Name || r.name || Object.values(r)[0]);
    let totalSalary = 0;
    let totalProj = 0;
    names.forEach((name, idx) => {
        const row = document.createElement('tr');
        const idxCell = document.createElement('td');
        idxCell.textContent = idx + 1;
        row.appendChild(idxCell);
        const nameCell = document.createElement('td');
        nameCell.textContent = name;
        row.appendChild(nameCell);
        const player = data.players.find(p => (p.Name || p.name) === name);
        const posCell = document.createElement('td');
        const teamCell = document.createElement('td');
        const salCell = document.createElement('td');
        const projCell = document.createElement('td');
        if (player) {
            posCell.textContent = player.Position || player.position;
            teamCell.textContent = player.Team || player.team;
            salCell.textContent = player.Salary || player.salary;
            projCell.textContent = player.Projection || player.projection;
            totalSalary += Number(player.Salary || player.salary || 0);
            totalProj += Number(player.Projection || player.projection || 0);
        } else {
            posCell.textContent = '-';
            teamCell.textContent = '-';
            salCell.textContent = '-';
            projCell.textContent = '-';
        }
        row.appendChild(posCell);
        row.appendChild(teamCell);
        row.appendChild(salCell);
        row.appendChild(projCell);
        tableBody.appendChild(row);
    });
    // Totals row
    const totalCells = [];
    totalCells.push(createCell('Totals'));
    totalCells.push(createCell(''));
    totalCells.push(createCell(''));
    totalCells.push(createCell(''));
    totalCells.push(createCell(totalSalary.toFixed(0)));
    totalCells.push(createCell(totalProj.toFixed(2)));
    totalCells.forEach(cell => totalsRow.appendChild(cell));
}

/** Helper to create a table cell with text. */
function createCell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

/** Run the ILP optimizer to generate an optimal lineup. */
async function optimizeLineup() {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = '';
    const salaryCap = Number(document.getElementById('salaryCap').value) || 50000;
    const maxTeam = Number(document.getElementById('maxTeam').value) || 4;
    const selectedGameId = document.getElementById('gameSelect').value;
    const players = data.players.filter(p => {
        const gameId = p.GameId || p.gameId || p.Game || '';
        return gameId === selectedGameId;
    });
    if (!players || players.length === 0) {
        statusDiv.textContent = 'No players found for the selected game.';
        return;
    }
    const vars = players.map(p => ({ name: String(p.Id || p.id), coef: Number(p.Projection || p.projection || 0) }));
    const subjectTo = [];
    // Salary constraint
    subjectTo.push({
        name: 'salary_cap',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: Number(p.Salary || p.salary || 0) })),
        bnds: { type: glpk.GLP_UP, ub: salaryCap, lb: 0 }
    });
    // Roster size
    subjectTo.push({
        name: 'roster_size',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: 1 })),
        bnds: { type: glpk.GLP_FX, ub: 9, lb: 9 }
    });
    // Position constraints
    subjectTo.push({
        name: 'qb_count',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: (p.Position || p.position) === 'QB' ? 1 : 0 })),
        bnds: { type: glpk.GLP_FX, ub: 1, lb: 1 }
    });
    subjectTo.push({
        name: 'dst_count',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: (p.Position || p.position) === 'DST' ? 1 : 0 })),
        bnds: { type: glpk.GLP_FX, ub: 1, lb: 1 }
    });
    subjectTo.push({
        name: 'rb_min',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: (p.Position || p.position) === 'RB' ? 1 : 0 })),
        bnds: { type: glpk.GLP_LO, ub: 0, lb: 2 }
    });
    subjectTo.push({
        name: 'wr_min',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: (p.Position || p.position) === 'WR' ? 1 : 0 })),
        bnds: { type: glpk.GLP_LO, ub: 0, lb: 3 }
    });
    subjectTo.push({
        name: 'te_min',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: (p.Position || p.position) === 'TE' ? 1 : 0 })),
        bnds: { type: glpk.GLP_LO, ub: 0, lb: 1 }
    });
    subjectTo.push({
        name: 'skill_count',
        vars: players.map(p => {
            const pos = p.Position || p.position;
            return { name: String(p.Id || p.id), coef: (pos === 'RB' || pos === 'WR' || pos === 'TE') ? 1 : 0 };
        }),
        bnds: { type: glpk.GLP_LO, ub: 0, lb: 7 }
    });
    // Team max constraint
    const teams = {};
    players.forEach(p => {
        const team = normalizeTeam(p.Team || p.team);
        if (!teams[team]) teams[team] = [];
        teams[team].push(p);
    });
    Object.keys(teams).forEach(team => {
        subjectTo.push({
            name: `team_max_${team}`,
            vars: teams[team].map(p => ({ name: String(p.Id || p.id), coef: 1 })),
            bnds: { type: glpk.GLP_UP, ub: maxTeam, lb: 0 }
        });
    });
    const lp = {
        name: 'lineup',
        objective: { direction: glpk.GLP_MAX, name: 'proj', vars },
        subjectTo,
        binaries: players.map(p => String(p.Id || p.id))
    };
    try {
        const result = await glpk.solve(lp, { msglev: glpk.GLP_MSG_OFF });
        if (!result || !result.result || !result.result.vars) {
            statusDiv.textContent = 'Solver returned no result.';
            return;
        }
        const solutionVars = result.result.vars;
        const selectedPlayers = players.filter(p => {
            const val = solutionVars[String(p.Id || p.id)];
            return val && val > 0.5;
        });
        if (selectedPlayers.length !== 9) {
            statusDiv.textContent = `Warning: expected 9 players but selected ${selectedPlayers.length}`;
        }
        renderOptimizedLineup(selectedPlayers);
    } catch (err) {
        console.error('Optimization error:', err);
        statusDiv.textContent = 'Optimization failed: ' + (err.message || err.toString());
    }
}

/** Render the optimized lineup into the table. */
function renderOptimizedLineup(players) {
    const tbody = document.querySelector('#optLineup tbody');
    const totalsRow = document.getElementById('optTotals');
    tbody.innerHTML = '';
    totalsRow.innerHTML = '';
    let totalSalary = 0;
    let totalProj = 0;
    players.forEach((p, idx) => {
        const row = document.createElement('tr');
        row.appendChild(createCell(idx + 1));
        row.appendChild(createCell(p.Name || p.name));
        row.appendChild(createCell(p.Position || p.position));
        row.appendChild(createCell(p.Team || p.team));
        row.appendChild(createCell(p.Salary || p.salary));
        row.appendChild(createCell(Number(p.Projection || p.projection || 0).toFixed(2)));
        totalSalary += Number(p.Salary || p.salary || 0);
        totalProj += Number(p.Projection || p.projection || 0);
        tbody.appendChild(row);
    });
    const totalCells = [];
    totalCells.push(createCell('Totals'));
    totalCells.push(createCell(''));
    totalCells.push(createCell(''));
    totalCells.push(createCell(''));
    totalCells.push(createCell(totalSalary.toFixed(0)));
    totalCells.push(createCell(totalProj.toFixed(2)));
    totalCells.forEach(cell => totalsRow.appendChild(cell));
}

/** Render a heatmap (pass or rush) into a table for the selected teams. */
function renderHeatmap(tableId, offTeam, defTeam, type) {
    const table = document.getElementById(tableId);
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    const heatmapData = data.heatmaps[type] || [];
    if (!heatmapData || heatmapData.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 8;
        td.textContent = `No ${type} data available.`;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }
    let offRow = heatmapData.find(r => normalizeTeam(r.off_team) === offTeam && normalizeTeam(r.def_team) === defTeam);
    let defRow = heatmapData.find(r => normalizeTeam(r.off_team) === defTeam && normalizeTeam(r.def_team) === offTeam);
    if (!offRow) offRow = heatmapData.find(r => normalizeTeam(r.off_team) === offTeam);
    if (!defRow) defRow = heatmapData.find(r => normalizeTeam(r.off_team) === defTeam);
    const positions = ['left_end', 'left_tackle', 'left_guard', 'center', 'right_guard', 'right_tackle', 'right_end'];
    // Offense row
    if (offRow) {
        const trOff = document.createElement('tr');
        const label = document.createElement('td');
        label.textContent = 'OFFENSE (share %)';
        trOff.appendChild(label);
        positions.forEach(pos => {
            const val = Number(offRow[pos] || 0);
            const cell = document.createElement('td');
            cell.textContent = `${(val * 100).toFixed(1)}%`;
            const bg = heatColor(val);
            cell.style.backgroundColor = bg;
            cell.style.color = textColorForBackground(bg);
            trOff.appendChild(cell);
        });
        tbody.appendChild(trOff);
    }
    // Defense row
    if (defRow) {
        const trDef = document.createElement('tr');
        const label = document.createElement('td');
        label.textContent = 'DEFENSE (allowed %)';
        trDef.appendChild(label);
        positions.forEach(pos => {
            const val = Number(defRow[pos] || 0);
            const cell = document.createElement('td');
            cell.textContent = `${(val * 100).toFixed(1)}%`;
            const bg = heatColor(-val);
            cell.style.backgroundColor = bg;
            cell.style.color = textColorForBackground(bg);
            trDef.appendChild(cell);
        });
        tbody.appendChild(trDef);
    }
    // Edge row
    if (offRow && defRow) {
        const trEdge = document.createElement('tr');
        const label = document.createElement('td');
        label.textContent = 'EDGE (Off − Def)';
        trEdge.appendChild(label);
        positions.forEach(pos => {
            const offVal = Number(offRow[pos] || 0);
            const defVal = Number(defRow[pos] || 0);
            const diff = offVal - defVal;
            const cell = document.createElement('td');
            cell.textContent = `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)}`;
            const bg = heatColor(diff);
            cell.style.backgroundColor = bg;
            cell.style.color = textColorForBackground(bg);
            trEdge.appendChild(cell);
        });
        tbody.appendChild(trEdge);
    }
}

/** Generate a summary of positional edges for pass and rush. */
function updateSummary(offTeam, defTeam) {
    const positions = ['left_end', 'left_tackle', 'left_guard', 'center', 'right_guard', 'right_tackle', 'right_end'];
    const passRowOff = data.heatmaps.pass.find(r => normalizeTeam(r.off_team) === offTeam && normalizeTeam(r.def_team) === defTeam) || {};
    const passRowDef = data.heatmaps.pass.find(r => normalizeTeam(r.off_team) === defTeam && normalizeTeam(r.def_team) === offTeam) || {};
    const rushRowOff = data.heatmaps.rush.find(r => normalizeTeam(r.off_team) === offTeam && normalizeTeam(r.def_team) === defTeam) || {};
    const rushRowDef = data.heatmaps.rush.find(r => normalizeTeam(r.off_team) === defTeam && normalizeTeam(r.def_team) === offTeam) || {};
    const passDiffs = positions.map(pos => ({ pos, diff: (passRowOff[pos] || 0) - (passRowDef[pos] || 0) }));
    const rushDiffs = positions.map(pos => ({ pos, diff: (rushRowOff[pos] || 0) - (rushRowDef[pos] || 0) }));
    const topPass = passDiffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 2);
    const topRush = rushDiffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 2);
    let summary = '';
    if (topPass.length > 0) {
        summary += `Pass edge: ${topPass.map(t => `${t.pos.replace(/_/g, ' ')} (${(t.diff * 100).toFixed(1)}%)`).join(' and ')}. `;
    }
    if (topRush.length > 0) {
        summary += `Rush edge: ${topRush.map(t => `${t.pos.replace(/_/g, ' ')} (${(t.diff * 100).toFixed(1)}%)`).join(' and ')}.`;
    }
    if (!summary) summary = 'No matchup data available for the selected teams.';
    document.getElementById('teamSummary').textContent = summary;
}

/** Analyze the matchup for selected teams and render heatmaps and summary. */
function analyzeMatchup() {
    const offTeam = document.getElementById('offTeamSelect').value;
    const defTeam = document.getElementById('defTeamSelect').value;
    if (!offTeam || !defTeam) return;
    renderHeatmap('passTable', offTeam, defTeam, 'pass');
    renderHeatmap('rushTable', offTeam, defTeam, 'rush');
    updateSummary(offTeam, defTeam);
}

/** Attach event handlers for UI elements. */
function attachEventHandlers() {
    document.getElementById('optimizeBtn').addEventListener('click', optimizeLineup);
    document.getElementById('analyzeBtn').addEventListener('click', analyzeMatchup);
    document.getElementById('offTeamSelect').addEventListener('change', analyzeMatchup);
    document.getElementById('defTeamSelect').addEventListener('change', analyzeMatchup);
    // Optionally update recommended lineup when game changes
    document.getElementById('gameSelect').addEventListener('change', displayRecommendedLineup);
}

/** Initialize dashboard: load GLPK and CSVs, populate UI, and attach handlers. */
async function init() {
    glpk = await GLPKModule();
    await loadAllCsv();
    populateGameSelect();
    populateTeamSelects();
    displayRecommendedLineup();
    attachEventHandlers();
    // initial matchup analysis
    if (document.getElementById('offTeamSelect').value && document.getElementById('defTeamSelect').value) {
        analyzeMatchup();
    }
}

// Start initialization on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
        console.error('Dashboard initialization error:', err);
        const status = document.getElementById('status');
        if (status) status.textContent = 'Initialization error: ' + err.message;
    });
});
