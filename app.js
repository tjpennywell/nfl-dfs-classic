/**************************************************
 * NFL DFS CLASSIC — LOCKED STABLE BASE
 **************************************************/

const APP_VERSION = "CLASSIC-STABLE-v2026.01.07";

const LANES = [
  "Left End",
  "Left Tackle",
  "Left Guard",
  "Center",
  "Right Guard",
  "Right Tackle",
  "Right End"
];

const FILES = {
  rushOff: "data/rush_lane_share_off.csv",
  rushDef: "data/rush_lane_share_def.csv",
  rushEdge: "data/heatmap_rush_proxy.csv"
};

/* ================= INIT ================= */

document.addEventListener("DOMContentLoaded", async () => {
  stampVersion();
  const data = await loadAll();
  renderRushHeatmap(data);
});

/* ================= LOAD ================= */

async function loadAll() {
  const out = {};
  for (const [key, path] of Object.entries(FILES)) {
    const res = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    const text = await res.text();
    out[key] = parseCSV(text);
  }
  return out;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",");
  return lines.slice(1).map(line => {
    const obj = {};
    line.split(",").forEach((v, i) => {
      obj[headers[i]] = v;
    });
    return obj;
  });
}

/* ================= RENDER ================= */

function renderRushHeatmap({ rushOff, rushDef, rushEdge }) {
  const el = document.getElementById("rushHeatmap");
  el.innerHTML = "";

  el.appendChild(buildHeader());

  const rows = [
    { label: "OFFENSE", data: rushOff },
    { label: "DEFENSE", data: rushDef },
    { label: "EDGE", data: rushEdge }
  ];

  rows.forEach(row => el.appendChild(buildRow(row.label, row.data)));
}

function buildHeader() {
  const row = document.createElement("div");
  row.className = "heatmapHeader";

  row.appendChild(document.createElement("div"));

  LANES.forEach(l => {
    const c = document.createElement("div");
    c.className = "heatmapHeaderCell";
    c.textContent = l;
    row.appendChild(c);
  });

  return row;
}

function buildRow(label, data) {
  const row = document.createElement("div");
  row.className = "heatmapRow";

  const lab = document.createElement("div");
  lab.className = "heatmapLabel";
  lab.textContent = label;
  row.appendChild(lab);

  const map = laneMap(data);

  LANES.forEach(lane => {
    const v = map[lane] ?? 0;
    const cell = document.createElement("div");
    cell.className = "heatmapCell";
    cell.style.backgroundColor = color(v);
    cell.textContent = format(label, v);
    row.appendChild(cell);
  });

  return row;
}

/* ================= HELPERS ================= */

function laneMap(rows) {
  const m = {};
  LANES.forEach(l => (m[l] = 0));

  rows.forEach(r => {
    if (r.lane && LANES.includes(r.lane)) {
      m[r.lane] = parseFloat(r.value || r.edge || r.score || 0);
    }
  });
  return m;
}

function color(v) {
  if (v >= 1) return "#2ecc71";
  if (v <= -1) return "#e74c3c";
  return "#f39c12";
}

function format(label, v) {
  if (label !== "EDGE") return `${(v * 100).toFixed(1)}%`;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function stampVersion() {
  document.getElementById("versionStamp").textContent =
    `Version: ${APP_VERSION}`;
}
