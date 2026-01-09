// NFL DFS Classic Optimizer
// This script loads player and game data from CSV files, validates the
// recommended lineup, runs an ILP optimizer using glpk.js, and renders
// interactive heatmaps for pass and rush matchups. The optimizer is
// configurable via salary cap and maximum players per team.

import GLPKModule from 'https://cdn.jsdelivr.net/npm/glpk.js/dist/glpk.min.js';

let glpk;

// Data containers
const data = {
    players: [],
    games: [],
    optimal: [],
    heatmaps: {
        pass: [],
        rush: []
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
            complete: results => {
                resolve(results.data);
            },
            error: err => {
                console.error(`Error loading ${path}:`, err);
                reject(err);
            }
        });
    });
}

/**
 * Normalize team codes. Some datasets may label Los Angeles Rams as "LA" instead of "LAR".
 * @param {string} code - Team code from data.
 * @returns {string}
 */
function normalizeTeam(code) {
    if (!code) return '';
    const c = code.trim().toUpperCase();
    // Map Rams abbreviations to a common value (LA)
    if (c === 'LAR' || c === 'RAMS') return 'LA';
    return c;
}

/**
 * Load all CSV files into the data object.
 */
async function loadAllCsv() {
    /*
     * Determine the base path for CSV files relative to the current page.  On
     * GitHub Pages your HTML is usually served from the repository root (e.g.
     * `/nfl-dfs-classic/`), so data files live in `data/`.  In a local
     * development environment the optimizer page may be under `/optimizer/`,
     * meaning data files live one level up at `../data/`.  We test the
     * current pathname to infer the correct prefix.
     */
    const pathName = window.location.pathname;
    const isSubDir = pathName.includes('/optimizer/');
    const prefix = isSubDir ? '../data/' : 'data/';
    const getDataPath = (file) => `${prefix}${file}`;
    data.players = await loadCsv(getDataPath('players_classic.csv'));
    data.games = await loadCsv(getDataPath('games_classic.csv'));
    // optimal lineup can be simple list of names or a roster object
    data.optimal = await loadCsv(getDataPath('optimal_lineup_rec.csv'));
    // heatmaps
    try {
        data.heatmaps.pass = await loadCsv(getDataPath('heatmap_pass_matchup.csv'));
    } catch (err) {
        console.warn('Pass matchup heatmap CSV not found.', err);
        data.heatmaps.pass = [];
    }
    try {
        data.heatmaps.rush = await loadCsv(getDataPath('heatmap_rush_proxy.csv'));
    } catch (err) {
        console.warn('Rush proxy heatmap CSV not found.', err);
        data.heatmaps.rush = [];
    }
    // Normalize team names for heatmaps
    ['pass', 'rush'].forEach(type => {
        data.heatmaps[type] = data.heatmaps[type].map(row => {
            const copy = { ...row };
            copy.off_team = normalizeTeam(row.off_team);
            copy.def_team = normalizeTeam(row.def_team);
            return copy;
        });
    });
    // For the classic style, default to the pass heatmap if no dedicated data exists.
    data.heatmaps.classic = data.heatmaps.pass;
}

/**
 * Populate the game selection dropdown with games from data.games.
 */
function populateGameSelect() {
    const select = document.getElementById('gameSelect');
    // remove any existing options
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
    // trigger initial population for selected game if needed
    if (select.options.length > 0) {
        select.selectedIndex = 0;
    }
}

/**
 * Populate offense and defense team dropdowns based on heatmap data.
 */
function populateTeamSelects() {
    const offSel = document.getElementById('offTeamSelect');
    const defSel = document.getElementById('defTeamSelect');
    offSel.innerHTML = '';
    defSel.innerHTML = '';
    // collect unique team codes from both pass and rush heatmaps
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
    // default selections
    if (offSel.options.length > 0) offSel.selectedIndex = 0;
    if (defSel.options.length > 1) defSel.selectedIndex = 1;
}

/**
 * Display the recommended lineup from optimal_lineup_rec.csv.
 */
function displayRecommendedLineup() {
    const tableBody = document.querySelector('#recLineup tbody');
    const totalsRow = document.getElementById('recTotals');
    tableBody.innerHTML = '';
    totalsRow.innerHTML = '';
    const names = data.optimal.map(r => {
        // If the CSV has a Name column (uppercase or lowercase), use it; otherwise read the first column.
        return r.Name || r.name || Object.values(r)[0];
    });
    let totalSalary = 0;
    let totalProj = 0;
    names.forEach((name, idx) => {
        const row = document.createElement('tr');
        const cellIndex = document.createElement('td');
        cellIndex.textContent = idx + 1;
        row.appendChild(cellIndex);
        const cellName = document.createElement('td');
        cellName.textContent = name;
        row.appendChild(cellName);
        // find corresponding player info
        const p = data.players.find(pl => (pl.Name || pl.name) === name);
        const posCell = document.createElement('td');
        const teamCell = document.createElement('td');
        const salCell = document.createElement('td');
        const projCell = document.createElement('td');
        if (p) {
            posCell.textContent = p.Position || p.position;
            teamCell.textContent = p.Team || p.team;
            salCell.textContent = p.Salary || p.salary;
            projCell.textContent = p.Projection || p.projection;
            totalSalary += Number(p.Salary || p.salary || 0);
            totalProj += Number(p.Projection || p.projection || 0);
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
    // totals row
    const totalCells = [];
    totalCells.push(createCell('Totals'));
    totalCells.push(createCell(''));
    totalCells.push(createCell(''));
    totalCells.push(createCell(''));
    totalCells.push(createCell(totalSalary.toFixed(0)));
    totalCells.push(createCell(totalProj.toFixed(2)));
    totalCells.forEach(cell => totalsRow.appendChild(cell));
}

/**
 * Helper to create a table cell with text.
 * @param {string} text
 * @returns {HTMLTableCellElement}
 */
function createCell(text) {
    const td = document.createElement('td');
    td.textContent = text;
    return td;
}

/**
 * Attach event listeners for user interactions.
 */
function attachEventHandlers() {
    document.getElementById('optimizeBtn').addEventListener('click', optimizeLineup);
    document.getElementById('styleSelect').addEventListener('change', updateHeatmap);
    document.getElementById('offTeamSelect').addEventListener('change', updateHeatmap);
    document.getElementById('defTeamSelect').addEventListener('change', updateHeatmap);
    document.getElementById('gameSelect').addEventListener('change', () => {
        // update recommended lineup totals when game changes (not strictly needed for rec lineup)
        displayRecommendedLineup();
    });
}

/**
 * Build and solve the lineup optimization problem.
 */
async function optimizeLineup() {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = '';
    const salaryCap = Number(document.getElementById('salaryCap').value) || 50000;
    const maxTeam = Number(document.getElementById('maxTeam').value) || 4;
    const selectedGameId = document.getElementById('gameSelect').value;
    // filter players by selected game (if GameId available)
    const players = data.players.filter(p => {
        const gameId = p.GameId || p.gameId || p.Game || '';
        return gameId === selectedGameId;
    });
    if (!players || players.length === 0) {
        statusDiv.textContent = 'No players found for the selected game.';
        return;
    }
    // Build LP model
    const vars = players.map(p => ({ name: String(p.Id || p.id), coef: Number(p.Projection || p.projection || 0) }));
    // Subject constraints list
    const subjectTo = [];
    // Salary constraint (<= salaryCap)
    subjectTo.push({
        name: 'salary_cap',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: Number(p.Salary || p.salary || 0) })),
        bnds: { type: glpk.GLP_UP, ub: salaryCap, lb: 0 }
    });
    // Total players = 9
    subjectTo.push({
        name: 'roster_size',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: 1 })),
        bnds: { type: glpk.GLP_FX, ub: 9, lb: 9 }
    });
    // Position constraints
    // QB exactly 1
    subjectTo.push({
        name: 'qb_count',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: (p.Position || p.position) === 'QB' ? 1 : 0 })),
        bnds: { type: glpk.GLP_FX, ub: 1, lb: 1 }
    });
    // DST exactly 1
    subjectTo.push({
        name: 'dst_count',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: (p.Position || p.position) === 'DST' ? 1 : 0 })),
        bnds: { type: glpk.GLP_FX, ub: 1, lb: 1 }
    });
    // RB >= 2
    subjectTo.push({
        name: 'rb_min',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: (p.Position || p.position) === 'RB' ? 1 : 0 })),
        bnds: { type: glpk.GLP_LO, ub: 0, lb: 2 }
    });
    // WR >= 3
    subjectTo.push({
        name: 'wr_min',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: (p.Position || p.position) === 'WR' ? 1 : 0 })),
        bnds: { type: glpk.GLP_LO, ub: 0, lb: 3 }
    });
    // TE >= 1
    subjectTo.push({
        name: 'te_min',
        vars: players.map(p => ({ name: String(p.Id || p.id), coef: (p.Position || p.position) === 'TE' ? 1 : 0 })),
        bnds: { type: glpk.GLP_LO, ub: 0, lb: 1 }
    });
    // RB + WR + TE = 7 (flex positions) >= 7
    subjectTo.push({
        name: 'skill_count',
        vars: players.map(p => {
            const pos = p.Position || p.position;
            return { name: String(p.Id || p.id), coef: (pos === 'RB' || pos === 'WR' || pos === 'TE') ? 1 : 0 };
        }),
        bnds: { type: glpk.GLP_LO, ub: 0, lb: 7 }
    });
    // Team maximum constraint
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
    // Create LP model
    const lp = {
        name: 'lineup',
        objective: {
            direction: glpk.GLP_MAX,
            name: 'proj',
            vars
        },
        subjectTo,
        binaries: players.map(p => String(p.Id || p.id))
    };
    try {
        const result = await glpk.solve(lp, { msglev: glpk.GLP_MSG_OFF });
        if (!result || !result.result || !result.result.vars) {
            statusDiv.textContent = 'Solver returned no result.';
            return;
        }
        // Extract selected players
        const solutionVars = result.result.vars;
        const selectedPlayers = players.filter(p => {
            const v = solutionVars[String(p.Id || p.id)];
            return v && v > 0.5;
        });
        // Sanity check: if not 9 players selected, warn user
        if (selectedPlayers.length !== 9) {
            statusDiv.textContent = `Warning: expected 9 players but selected ${selectedPlayers.length}`;
        }
        // Render optimized lineup table
        renderOptimizedLineup(selectedPlayers);
    } catch (err) {
        console.error('Optimization error:', err);
        statusDiv.textContent = 'Optimization failed: ' + (err.message || err.toString());
    }
}

/**
 * Render the optimized lineup in the table.
 * @param {Array<Object>} players
 */
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

/**
 * Update the heatmap table based on selected offense and defense teams and style.
 */
function updateHeatmap() {
    const style = document.getElementById('styleSelect').value;
    const offTeam = normalizeTeam(document.getElementById('offTeamSelect').value);
    const defTeam = normalizeTeam(document.getElementById('defTeamSelect').value);
    const tbody = document.querySelector('#heatmapTable tbody');
    tbody.innerHTML = '';
    // determine which heatmap to use
    const heatmapData = data.heatmaps[style] || [];
    if (!heatmapData || heatmapData.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 8;
        td.textContent = `No ${style} heatmap data available.`;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }
    // find offense row (off_team vs defTeam)
    let offRow = heatmapData.find(r => normalizeTeam(r.off_team) === offTeam && normalizeTeam(r.def_team) === defTeam);
    let defRow = heatmapData.find(r => normalizeTeam(r.off_team) === defTeam && normalizeTeam(r.def_team) === offTeam);
    // Fallback: if not found, use first matching offense regardless of defense
    if (!offRow) {
        offRow = heatmapData.find(r => normalizeTeam(r.off_team) === offTeam);
    }
    if (!defRow) {
        defRow = heatmapData.find(r => normalizeTeam(r.off_team) === defTeam);
    }
    const positions = ['left_end', 'left_tackle', 'left_guard', 'center', 'right_guard', 'right_tackle', 'right_end'];
    // Offense row
    if (offRow) {
        const trOff = document.createElement('tr');
        const label = document.createElement('td');
        label.textContent = 'OFFENSE (share %)';
        trOff.appendChild(label);
        positions.forEach(pos => {
            const val = Number(offRow[pos] || 0);
            const td = document.createElement('td');
            td.classList.add('offense');
            td.textContent = `${(val * 100).toFixed(1)}%`;
            const bg = heatColor(val);
            td.style.backgroundColor = bg;
            td.style.color = textColorForBackground(bg);
            trOff.appendChild(td);
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
            const td = document.createElement('td');
            td.classList.add('defense');
            td.textContent = `${(val * 100).toFixed(1)}%`;
            const bgDef = heatColor(-val); // negative values highlight defense differently
            td.style.backgroundColor = bgDef;
            td.style.color = textColorForBackground(bgDef);
            trDef.appendChild(td);
        });
        tbody.appendChild(trDef);
    }
    // Edge row (offense - defense)
    if (offRow && defRow) {
        const trEdge = document.createElement('tr');
        const label = document.createElement('td');
        label.textContent = 'EDGE (Off − Def)';
        trEdge.appendChild(label);
        positions.forEach(pos => {
            const offVal = Number(offRow[pos] || 0);
            const defVal = Number(defRow[pos] || 0);
            const diff = offVal - defVal;
            const td = document.createElement('td');
            td.classList.add('edge');
            td.textContent = `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)}`;
            const bgEdge = heatColor(diff);
            td.style.backgroundColor = bgEdge;
            td.style.color = textColorForBackground(bgEdge);
            trEdge.appendChild(td);
        });
        tbody.appendChild(trEdge);
    }
}

/**
 * Convert a numeric value into a background color for heatmap cells.
 * Positive values produce green shades, negative values produce red shades.
 * @param {number} val - The value to convert (assumed within roughly -1 to +1).
 * @returns {string} CSS color string.
 */
function heatColor(val) {
    /*
     * Generate a smooth gradient colour for the heatmap based on the
     * passed value in the range [-1, 1]. Values closer to 0 use the
     * table's base colour. Positive values blend towards a bright green,
     * while negative values blend towards a rich red. This interpolation
     * produces saturated colours suitable for a dark theme.
     */
    const clamp = Math.max(-1, Math.min(1, val || 0));
    // Define base (neutral), positive and negative colours in RGB
    const base = { r: 19, g: 42, b: 68 };      // #132a44 dark blue
    const pos = { r: 46, g: 204, b: 113 };     // #2ecc71 green
    const neg = { r: 231, g: 76, b: 60 };      // #e74c3c red
    let r, g, b;
    if (clamp >= 0) {
        // interpolate towards positive colour
        r = Math.round(base.r + (pos.r - base.r) * clamp);
        g = Math.round(base.g + (pos.g - base.g) * clamp);
        b = Math.round(base.b + (pos.b - base.b) * clamp);
    } else {
        // interpolate towards negative colour
        const abs = Math.abs(clamp);
        r = Math.round(base.r + (neg.r - base.r) * abs);
        g = Math.round(base.g + (neg.g - base.g) * abs);
        b = Math.round(base.b + (neg.b - base.b) * abs);
    }
    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Choose an appropriate text colour (light or dark) based on the provided
 * RGB background colour. Uses luminance to decide whether white or dark
 * text will be more legible.
 * @param {string} rgbString - colour string in the form 'rgb(r, g, b)'
 * @returns {string}
 */
function textColorForBackground(rgbString) {
    // Extract numeric values from the rgb string
    const parts = rgbString.match(/\d+/g);
    let r = 0, g = 0, b = 0;
    if (parts && parts.length >= 3) {
        r = parseInt(parts[0], 10);
        g = parseInt(parts[1], 10);
        b = parseInt(parts[2], 10);
    }
    // compute relative luminance (0-255 scale)
    // Using simple brightness formula: https://www.w3.org/TR/AERT/#color-contrast
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;
    return brightness > 140 ? '#0f1a2c' : '#f8f9fa';
}

/**
 * Validate the recommended lineup for duplicates and length.
 */
function validateRecommendedLineup() {
    const names = data.optimal.map(r => r.Name || r.name || Object.values(r)[0]);
    const uniqueNames = new Set(names);
    const statusDiv = document.getElementById('status');
    if (names.length === 0) {
        statusDiv.textContent = 'Recommended lineup is empty.';
    } else if (names.length !== uniqueNames.size) {
        statusDiv.textContent = 'Recommended lineup contains duplicate players.';
    } else if (names.length !== 9) {
        statusDiv.textContent = `Recommended lineup should have 9 players, found ${names.length}.`;
    }
}

/**
 * Initialization function: loads glpk, data and sets up UI.
 */
async function init() {
    glpk = await GLPKModule();
    await loadAllCsv();
    populateGameSelect();
    populateTeamSelects();
    displayRecommendedLineup();
    validateRecommendedLineup();
    attachEventHandlers();
    updateHeatmap();
}

// Start initialization once the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    init().catch(err => {
        console.error('Initialization error:', err);
        const statusDiv = document.getElementById('status');
        if (statusDiv) statusDiv.textContent = 'Initialization error: ' + err.message;
    });
});