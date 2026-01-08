/**************************************************
 * NFL DFS CLASSIC — LOCKED BASE (RUSH + PASS)
 **************************************************/
const APP_VERSION = "CLASSIC-STABLE-v2026.01.07-LOCKED-02";

/* ---------------- DATA FILES ---------------- */
const FILES = {
  rushOff: "data/rush_lane_share_off.csv",
  rushDef: "data/rush_lane_share_def.csv",
  rushEdge: "data/heatmap_rush_proxy.csv",
  pass: "data/heatmap_pass_matchup.csv"
};

/* ---------------- RUSH LANES ---------------- */
const RUSH_LANES = [
  "Left End",
  "Left Tackle",
  "Left Guard",
  "Center",
  "Right Guard",
  "Right Tackle",
  "Right End"
];

/* =========================================================
   INIT
   ========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  stampVersion();

  try {
    const data = await loadAllCSVs(FILES);

    renderRushHeatmapStacked({
      rushOff: data.rushOff,
      rushDef: data.rushDef,
      rushEdge: data.rushEdge
    });

    initPassHeatmap(data.pass);
  } catch (err) {
    console.error(err);
    showDebug(String(err?.message || err));
  }
});

/* =========================================================
   LOADING
   ========================================================= */
async function loadAllCSVs(filesMap) {
  const out = {};
  for (const [key, path] of Object.entries(filesMap)) {
    const text = await fetchTextNoCache(path);
    out[key] = parseCSV(text);
  }
  return out;
}

async function fetchTextNoCache(path) {
  const url = `${path}${path.includes("?") ? "&" : "?"}v=${Date.now()}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${path} (${res.status})`);
  return await res.text();
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const cols = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => (obj[h] = cols[i] ?? ""));
    return obj;
  });
}

// handles quoted commas decently
function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"'; i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

/* =========================================================
   VERSION + DEBUG
   ========================================================= */
function stampVersion() {
  const el = document.getElementById("versionStamp");
  if (el) el.textContent = `Version: ${APP_VERSION}`;
}

function showDebug(msg) {
  const bar = document.getElementById("debugBar");
  if (!bar) return;
  bar.style.display = "block";
  bar.textContent = `Runtime error: ${msg}`;
}

/* =========================================================
   COLOR SCALE (DIVERGING, SIMPLE, STABLE)
   - Green for positive / Red for negative / Amber near 0
   ========================================================= */
function heatColor(v) {
  const x = Number(v);
  if (x >= 1) return "#2ecc71";
  if (x <= -1) return "#e74c3c";
  return "#f39c12";
}

function cleanNum(x) {
  return String(x ?? "").replace("%", "").trim();
}

function num(x) {
  const n = Number(cleanNum(x));
  return Number.isFinite(n) ? n : 0;
}

function isFiniteNum(x) {
  const n = Number(cleanNum(x));
  return Number.isFinite(n);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

/* =========================================================
   RUSH HEATMAP (LOCKED)
   - Stacked rows: OFFENSE / DEFENSE / EDGE
   - Color ALL rows
   - Lanes: LE LT LG C RG RT RE
   ========================================================= */
function renderRushHeatmapStacked({ rushOff, rushDef, rushEdge }) {
  const container = document.getElementById("rushHeatmap");
  if (!container) return;

  container.innerHTML = "";

  // grid columns: label + 7 lanes
  container.appendChild(buildHeatHeader(["", ...RUSH_LANES], 8));

  const offMap = laneMapFromRows(rushOff);
  const defMap = laneMapFromRows(rushDef);
  const edgeMap = laneMapFromRows(rushEdge);

  container.appendChild(buildRushRow("OFFENSE", offMap, "pct"));
  container.appendChild(buildRushRow("DEFENSE", defMap, "pct"));
  container.appendChild(buildRushRow("EDGE", edgeMap, "edge"));
}

function buildRushRow(label, laneMap, mode) {
  const row = document.createElement("div");
  row.className = "heatRow";
  row.style.gridTemplateColumns = "120px repeat(7, 1fr)";

  const lab = document.createElement("div");
  lab.className = "heatLabel";
  lab.textContent = label;
  row.appendChild(lab);

  RUSH_LANES.forEach(lane => {
    const v = num(laneMap[lane] ?? 0);
    const cell = document.createElement("div");
    cell.className = "heatCell";
    cell.style.backgroundColor = heatColor(v);
    cell.textContent = (mode === "pct")
      ? `${(v >= 0 && v <= 1 ? v * 100 : v).toFixed(1)}%`
      : `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
    cell.title = `${label} • ${lane}: ${v}`;
    row.appendChild(cell);
  });

  return row;
}

function laneMapFromRows(rows) {
  const map = {};
  RUSH_LANES.forEach(l => (map[l] = 0));
  if (!rows || !rows.length) return map;

  // Find the best numeric column automatically (not lane/team)
  const keys = Object.keys(rows[0]);
  const ignore = new Set(["lane", "team", "abbr", "opponent", "opp", "off_team", "def_team"]);

  const numericKey =
    keys.find(k => !ignore.has(k) && rows.some(r => isFiniteNum(r[k]))) ||
    keys.find(k => k !== "lane"); // fallback

  rows.forEach(r => {
    const lane = (r.lane || "").trim();
    if (RUSH_LANES.includes(lane)) map[lane] = num(r[numericKey]);
  });

  return map;
}


function pickExistingKey(obj, keys) {
  for (const k of keys) if (k in obj) return k;
  const first = Object.keys(obj).find(k => k !== "lane");
  return first || "value";
}

/* =========================================================
   PASS HEATMAP (AUTO-DETECT)
   - Dropdown offense/defense based on team columns
   - Direction columns auto-detected from numeric columns
   - Color ALL cells
   ========================================================= */
function initPassHeatmap(passRows) {
  const offSel = document.getElementById("passOffSelect");
  const defSel = document.getElementById("passDefSelect");
  const container = document.getElementById("passHeatmap");
  if (!offSel || !defSel || !container) return;

  if (!passRows || !passRows.length) {
    container.innerHTML = `<div style="opacity:.8">No pass data found (heatmap_pass_matchup.csv empty).</div>`;
    return;
  }

  const schema = detectPassSchema(passRows);
  if (!schema) {
    container.innerHTML = `<div style="opacity:.8">Pass heatmap schema not detected. Check CSV columns for OFF/DEF teams + numeric direction columns.</div>`;
    return;
  }

  const { offKey, defKey, valueKeys } = schema;

  const offTeams = uniq(passRows.map(r => (r[offKey] || "").trim()).filter(Boolean)).sort();
  const defTeams = uniq(passRows.map(r => (r[defKey] || "").trim()).filter(Boolean)).sort();

  fillSelect(offSel, offTeams);
  fillSelect(defSel, defTeams);

  offSel.value = offTeams[0] || "";
  defSel.value = defTeams[0] || "";

  const rerender = () => {
    renderPassHeatmap(container, passRows, {
      offKey,
      defKey,
      cols: orderPassColumns(valueKeys),
      off: offSel.value,
      def: defSel.value
    });
  };

  offSel.addEventListener("change", rerender);
  defSel.addEventListener("change", rerender);

  rerender();
}

function detectPassSchema(rows) {
  const keys = Object.keys(rows[0]);

  // common team column guesses
  const offKey = findKey(keys, ["off_team", "off", "offense", "team", "offTeam", "OFF"]);
  const defKey = findKey(keys, ["def_team", "def", "defense", "opp", "opponent", "defTeam", "DEF"]);

  let inferredOff = offKey;
  let inferredDef = defKey;

  // Heuristic fallback: pick 2 abbrev-like string columns (<=4 chars) if needed
  if (!inferredOff || !inferredDef) {
    const candidateTextKeys = keys.filter(k => {
      const sample = (rows[0][k] || "").trim();
      return sample && isNaN(Number(cleanNum(sample))) && sample.length <= 4;
    });
    if (!inferredOff && candidateTextKeys.length) inferredOff = candidateTextKeys[0];
    if (!inferredDef && candidateTextKeys.length > 1) inferredDef = candidateTextKeys[1];
  }

  if (!inferredOff || !inferredDef) return null;

  // value columns = numeric-ish columns other than team keys
  const valueKeys = keys
    .filter(k => k !== inferredOff && k !== inferredDef)
    .filter(k => rows.some(r => isFiniteNum(r[k])));

  // prefer directional-like columns
  const directional = valueKeys.filter(k => looksDirectional(k));
  const finalKeys = directional.length ? directional : valueKeys;

  if (!finalKeys.length) return null;

  return { offKey: inferredOff, defKey: inferredDef, valueKeys: finalKeys };
}

function renderPassHeatmap(container, rows, { offKey, defKey, cols, off, def }) {
  // Exact matchup row
  const match = rows.find(r =>
    (r[offKey] || "").trim() === off &&
    (r[defKey] || "").trim() === def
  );

  if (!match) {
    container.innerHTML = `<div style="opacity:.8">No pass matchup row for ${off} vs ${def}.</div>`;
    return;
  }

  // Layout: label + N cols
  container.innerHTML = "";
  container.appendChild(buildHeatHeader(["", ...cols.map(prettyCol)], 1 + cols.length));

  // If your CSV has split columns (off_/def_/edge_), we render stacked rows.
  const blocks = buildPassRowBlocks(match, cols);

  blocks.forEach(({ label, values, mode }) => {
    const row = document.createElement("div");
    row.className = "heatRow";
    row.style.gridTemplateColumns = `120px repeat(${cols.length}, 1fr)`;

    const lab = document.createElement("div");
    lab.className = "heatLabel";
    lab.textContent = label;
    row.appendChild(lab);

    cols.forEach(c => {
      const v = num(values[c] ?? 0);
      const cell = document.createElement("div");
      cell.className = "heatCell";
      cell.style.backgroundColor = heatColor(v);
      cell.textContent = formatPass(v, mode);
      cell.title = `${label} • ${prettyCol(c)}: ${v}`;
      row.appendChild(cell);
    });

    container.appendChild(row);
  });
}

function buildPassRowBlocks(matchRow, cols) {
  const keys = Object.keys(matchRow);

  const hasOff = cols.some(c => keys.includes(`off_${c}`) || keys.includes(`OFF_${c}`));
  const hasDef = cols.some(c => keys.includes(`def_${c}`) || keys.includes(`DEF_${c}`));
  const hasEdge = cols.some(c => keys.includes(`edge_${c}`) || keys.includes(`EDGE_${c}`));

  if (hasOff || hasDef || hasEdge) {
    const offVals = {}, defVals = {}, edgeVals = {};
    cols.forEach(c => {
      offVals[c] = num(matchRow[`off_${c}`] ?? matchRow[`OFF_${c}`] ?? 0);
      defVals[c] = num(matchRow[`def_${c}`] ?? matchRow[`DEF_${c}`] ?? 0);
      edgeVals[c] = num(matchRow[`edge_${c}`] ?? matchRow[`EDGE_${c}`] ?? 0);
    });

    const blocks = [];
    if (hasOff) blocks.push({ label: "OFFENSE", values: offVals, mode: "pct" });
    if (hasDef) blocks.push({ label: "DEFENSE", values: defVals, mode: "pct" });

    if (hasEdge) {
      blocks.push({ label: "EDGE", values: edgeVals, mode: "edge" });
    } else if (hasOff && hasDef) {
      const proxy = {};
      cols.forEach(c => proxy[c] = offVals[c] - defVals[c]);
      blocks.push({ label: "EDGE", values: proxy, mode: "edge" });
    }

    return blocks;
  }

  // Single row of matchup direction values
  const vals = {};
  cols.forEach(c => vals[c] = num(matchRow[c] ?? 0));
  return [{ label: "MATCHUP", values: vals, mode: "edge" }];
}

function buildHeatHeader(labels, colCount) {
  const row = document.createElement("div");
  row.className = "heatHeader";
  row.style.gridTemplateColumns = `120px repeat(${colCount - 1}, 1fr)`;

  labels.forEach((t, idx) => {
    const cell = document.createElement("div");
    cell.className = idx === 0 ? "heatLabel" : "heatHeaderCell";
    cell.textContent = t;
    row.appendChild(cell);
  });

  return row;
}

/* ---------- pass column helpers ---------- */

function looksDirectional(k) {
  const s = k.toLowerCase();
  return (
    s.includes("left") || s.includes("right") || s.includes("middle") || s.includes("mid") ||
    s.includes("short") || s.includes("deep") ||
    s.includes("sideline") || s.includes("center") ||
    s.includes("out") || s.includes("in") || s.includes("go") || s.includes("post") || s.includes("corner") ||
    s.includes("flat") || s.includes("curl") || s.includes("cross")
  );
}

function orderPassColumns(cols) {
  const normalized = cols.map(c => c.trim());
  const lowerMap = new Map(normalized.map(c => [c.toLowerCase().replace(/\s+/g,"_"), c]));

  // prefer classic grid if present
  const preferred = [
    "left_short","middle_short","right_short",
    "left_deep","middle_deep","right_deep"
  ];

  const ordered = [];
  preferred.forEach(p => {
    if (lowerMap.has(p)) ordered.push(lowerMap.get(p));
  });

  normalized.forEach(c => {
    if (!ordered.includes(c)) ordered.push(c);
  });

  return ordered;
}

function prettyCol(c) {
  return c
    .replace(/_/g, " ")
    .replace(/\bmid\b/ig, "Middle")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPass(v, mode) {
  if (mode === "pct") {
    const pct = (v >= 0 && v <= 1) ? v * 100 : v;
    return `${pct.toFixed(1)}%`;
  }
  return `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}`;
}

function findKey(keys, candidates) {
  const lower = keys.map(k => k.toLowerCase());
  for (const c of candidates) {
    const i = lower.indexOf(c.toLowerCase());
    if (i !== -1) return keys[i];
  }
  return null;
}

function fillSelect(sel, items) {
  sel.innerHTML = "";
  items.forEach(x => {
    const opt = document.createElement("option");
    opt.value = x;
    opt.textContent = x;
    sel.appendChild(opt);
  });
}
