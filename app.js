/**************************************************
 * NFL DFS CLASSIC — STABLE CORE
 **************************************************/

const FILES = {
  games: "data/games_classic.csv",
  players: "data/players_classic.csv",
  optimal: "data/optimal_lineup_rec.csv",
  rush: "data/heatmap_rush_proxy.csv",
  pass: "data/heatmap_pass_matchup.csv",
  rushOff: "data/rush_lane_share_off.csv",
  rushDef: "data/rush_lane_share_def.csv"
};

const LANES = [
  "Left End",
  "Left Tackle",
  "Left Guard",
  "Center",
  "Right Guard",
  "Right Tackle",
  "Right End"
];

const APP_VERSION = "CLASSIC-STABLE-v2026.01.07";

/* ---------------- INIT ---------------- */

document.addEventListener("DOMContentLoaded", async () => {
  stampVersion();
  const data = await loadAllData();
  renderAll(data);
});

/* ---------------- CORE ---------------- */

async function loadAllData() {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([k, path]) => {
      const res = await fetch(`${path}?v=${Date.now()}`);
      const text = await res.text();
      return [k, parseCSV(text)];
    })
  );
  return Object.fromEntries(entries);
}

function renderAll(data) {
  renderGamesTable(data.games);
  renderPlayersTable(data.players);
  renderLineupBuilder(data.optimal);
  renderRushHeatmap(data);
}

/* ---------------- UTIL ---------------- */

function stampVersion() {
  const el = document.getElementById("versionStamp");
  if (el) el.innerText = `Version: ${APP_VERSION}`;
}

function parseCSV(text) {
  const [header, ...rows] = text.trim().split("\n");
  const keys = header.split(",");
  return rows.map(r => {
    const obj = {};
    r.split(",").forEach((v, i) => obj[keys[i]] = v);
    return obj;
  });
}
