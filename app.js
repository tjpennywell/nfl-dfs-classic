// APP VERSION: CLASSIC-SIMPLE-REWRITE-V1
const APP_VERSION = "CLASSIC-SIMPLE-REWRITE-V1";
console.log("APP VERSION:", APP_VERSION, new Date().toISOString());

/* ==========================
   Error banner (visible)
========================== */
(function () {
  function show(msg) {
    let bar = document.getElementById("debugBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "debugBar";
      bar.style.position = "fixed";
      bar.style.left = "0";
      bar.style.right = "0";
      bar.style.bottom = "0";
      bar.style.zIndex = "99999";
      bar.style.padding = "10px 12px";
      bar.style.background = "rgba(200,0,0,0.92)";
      bar.style.color = "#fff";
      bar.style.fontFamily = "system-ui, Arial";
      bar.style.fontSize = "12px";
      bar.style.whiteSpace = "pre-wrap";
      bar.style.display = "none";
      document.body.appendChild(bar);
    }
    bar.style.display = "block";
    bar.textContent = "Dashboard error:\n" + msg;
  }
  window.addEventListener("error", (e) => show(e.message || String(e.error || e)));
  window.addEventListener("unhandledrejection", (e) => show(String(e.reason || e)));
})();

/* ==========================
   Helpers
========================== */
const $ = (id) => document.getElementById(id) || null;

function num(x) {
  const v = parseFloat(x);
  return Number.isFinite(v) ? v : 0;
}
function uniq(arr) {
  return Array.from(new Set(arr));
}

/* ==========================
   🔒 ADDED (NO OTHER CHANGES)
   Canonical team mapping
========================== */
function canonTeam(t) {
  const x = (t || "").trim().toUpperCase();
  const map = {
    SFO: "SF",
    KAN: "KC",
    NOR: "NO",
    NWE: "NE",
    TAM: "TB",
    GNB: "GB",
    LVR: "LV",
    OAK: "LV",
    SD: "LAC",
    STL: "LAR",
    LA: "LAR"
  };
  return map[x] || x;
}

function parseCSV(text) {
  const lines = (text || "").trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => (obj[h] = (cols[i] ?? "").trim()));
    return obj;
  });
}

async function loadCSV(path) {
  const url = path + (path.includes("?") ? "&" : "?") + "v=" + APP_VERSION + "&t=" + Date.now();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return parseCSV(await res.text());
}

function guessCol(row, candidates) {
  if (!row) return null;
  for (const c of candidates) if (c in row) return c;
  return null;
}

function setTable(el, headers, rows, cellFn) {
  if (!el) return;
  el.innerHTML = "";

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  el.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((r) => {
    const tr = document.createElement("tr");
    headers.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = r[h] ?? "";
      if (cellFn) cellFn(td, r, h);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  el.appendChild(tbody);
}

function showMessageTable(el, title, msg) {
  setTable(el, [title], [{ [title]: msg }]);
}

function getColor(value, min, max) {
  const mid = 0;
  if (value >= mid) {
    const denom = (max - mid) || 1;
    const t = Math.min((value - mid) / denom, 1);
    return `rgba(0, 200, 0, ${0.12 + 0.78 * t})`;
  } else {
    const denom = (mid - min) || 1;
    const t = Math.min((mid - value) / denom, 1);
    return `rgba(220, 0, 0, ${0.12 + 0.78 * t})`;
  }
}

function ensureRowContainer(heatmapTable) {
  const card = heatmapTable?.closest(".card") || heatmapTable?.parentElement || document.body;
  let ctrl = card.querySelector("#hmCtrlRow");
  if (!ctrl) {
    ctrl = document.createElement("div");
    ctrl.id = "hmCtrlRow";
    ctrl.className = "row";
    ctrl.style.margin = "6px 0 10px";
    card.insertBefore(ctrl, heatmapTable);
  }
  return ctrl;
}

/* ==========================
   MAIN
========================== */
(async function main() {

  const gamesTable = $("gamesTable");
  const playersTable = $("playersTable");
  const heatmapTable = $("heatmapTable");

  const showPassHm = $("showPassHm");
  const showRushHm = $("showRushHm");

  const players = await loadCSV("data/players_classic.csv");
  const games = await loadCSV("data/games_classic.csv");
  const passHm = await loadCSV("data/heatmap_pass_matchup.csv");

  let rushLaneOff = [];
  let rushLaneDef = [];
  try { rushLaneOff = await loadCSV("data/rush_lane_share_off.csv"); } catch {}
  try { rushLaneDef = await loadCSV("data/rush_lane_share_def.csv"); } catch {}

  const ctrlRow = ensureRowContainer(heatmapTable);

  const offSel = document.createElement("select");
  const defSel = document.createElement("select");

  ctrlRow.append("Off:", offSel, "Def:", defSel);

  const passTeamCol = guessCol(passHm[0], ["off_team","team"]);
  const passOppCol  = guessCol(passHm[0], ["def_team","opp"]);
  const passDepthCol= guessCol(passHm[0], ["depth"]);
  const passDirCol  = guessCol(passHm[0], ["direction","location"]);
  const passEdgeCol = guessCol(passHm[0], ["edge","edge_off_minus_def"]);

  let teams = uniq(passHm.map(r => canonTeam(r[passTeamCol]))).sort();
  teams.forEach(t => {
    offSel.add(new Option(t,t));
    defSel.add(new Option(t,t));
  });

  function renderPass() {
    const offT = offSel.value;
    const defT = defSel.value;

    /* ==========================
       🔒 ONLY CHANGE APPLIED
       Normalized team filter
    ========================== */
    const rows = passHm.filter(r =>
      canonTeam(r[passTeamCol]) === canonTeam(offT) &&
      canonTeam(r[passOppCol]) === canonTeam(defT)
    );

    if (!rows.length) {
      showMessageTable(heatmapTable, "Pass Heatmap", `No data for ${offT} vs ${defT}`);
      return;
    }

    const depths = uniq(rows.map(r => r[passDepthCol]));
    const dirs = uniq(rows.map(r => r[passDirCol]));

    const vals = rows.map(r => num(r[passEdgeCol]));
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);

    const headers = ["", ...depths];
    const out = dirs.map(d => {
      const o = { "": d };
      depths.forEach(dep => {
        const cell = rows.find(r => r[passDirCol] === d && r[passDepthCol] === dep);
        o[dep] = cell ? num(cell[passEdgeCol]) : 0;
      });
      return o;
    });

    setTable(heatmapTable, headers, out, (td,r,h)=>{
      if (h === "") return;
      const v = num(r[h]);
      td.textContent = (v>=0?"+":"")+v.toFixed(3);
      td.style.backgroundColor = getColor(v,mn,mx);
    });
  }

  showPassHm.addEventListener("click", renderPass);

})();
