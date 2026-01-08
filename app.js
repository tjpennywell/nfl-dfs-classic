// APP VERSION: CLASSIC-RUSH-STACKED-V1
console.log("APP VERSION: CLASSIC-RUSH-STACKED-V1", new Date().toISOString());

/* ==========================
   Debug banner
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
function num(x) {
  const v = parseFloat(x);
  return Number.isFinite(v) ? v : 0;
}
function uniq(arr) {
  return Array.from(new Set(arr));
}

/* 🔒 ADDITION — canonical team mapping (ONLY ADDITION) */
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
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => obj[h] = (cols[i] ?? "").trim());
    return obj;
  });
}

async function loadCSV(path) {
  const url = path + "?v=" + Date.now();
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
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
  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  el.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach(r => {
    const tr = document.createElement("tr");
    headers.forEach(h => {
      const td = document.createElement("td");
      td.textContent = r[h] ?? "";
      if (cellFn) cellFn(td, r, h);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  el.appendChild(tbody);
}

function getColor(value, min, max) {
  const mid = 0;
  if (value >= mid) {
    const t = Math.min((value - mid) / ((max - mid) || 1), 1);
    return `rgba(0,200,0,${0.12 + 0.78 * t})`;
  } else {
    const t = Math.min((mid - value) / ((mid - min) || 1), 1);
    return `rgba(220,0,0,${0.12 + 0.78 * t})`;
  }
}

/* ==========================
   MAIN
========================== */
(async function main() {

  const gamesTable = document.getElementById("gamesTable");
  const playersTable = document.getElementById("playersTable");
  const heatmapTable = document.getElementById("heatmapTable");
  const showPassHm = document.getElementById("showPassHm");
  const showRushHm = document.getElementById("showRushHm");

  const players = await loadCSV("data/players_classic.csv");
  const games = await loadCSV("data/games_classic.csv");
  const passHm = await loadCSV("data/heatmap_pass_matchup.csv");

  let rushLaneOff = [];
  let rushLaneDef = [];
  try { rushLaneOff = await loadCSV("data/rush_lane_share_off.csv"); } catch {}
  try { rushLaneDef = await loadCSV("data/rush_lane_share_def.csv"); } catch {}

  /* ==========================
     PASS HEATMAP (FIXED)
  ========================== */
  function renderPassHeatmap() {

    const offCol = guessCol(passHm[0], ["off_team","team"]);
    const defCol = guessCol(passHm[0], ["def_team","opp"]);
    const dirCol = guessCol(passHm[0], ["direction","location"]);
    const depthCol = guessCol(passHm[0], ["depth"]);
    const edgeCol = guessCol(passHm[0], ["edge","edge_off_minus_def"]);

    const offT = canonTeam(document.getElementById("hmOffTeam").value);
    const defT = canonTeam(document.getElementById("hmDefTeam").value);

    const rows = passHm.filter(r =>
      canonTeam(r[offCol]) === offT &&
      canonTeam(r[defCol]) === defT
    );

    if (!rows.length) {
      setTable(heatmapTable, ["Pass Heatmap"], [{ "Pass Heatmap": `No data for ${offT} vs ${defT}` }]);
      return;
    }

    const depths = uniq(rows.map(r => r[depthCol]));
    const dirs = uniq(rows.map(r => r[dirCol]));
    const vals = rows.map(r => num(r[edgeCol]));
    const mn = Math.min(...vals);
    const mx = Math.max(...vals);

    const headers = ["", ...depths];
    const out = dirs.map(d => {
      const o = { "": d };
      depths.forEach(dep => {
        const cell = rows.find(r => r[dirCol] === d && r[depthCol] === dep);
        o[dep] = cell ? num(cell[edgeCol]) : 0;
      });
      return o;
    });

    setTable(heatmapTable, headers, out, (td,r,h)=>{
      if (h === "") return;
      const v = num(r[h]);
      td.textContent = (v >= 0 ? "+" : "") + v.toFixed(3);
      td.style.backgroundColor = getColor(v, mn, mx);
    });
  }

  showPassHm.addEventListener("click", renderPassHeatmap);

})();
