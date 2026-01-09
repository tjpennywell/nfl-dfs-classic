// Case-insensitive column getter (handles Game vs game, Home vs home, etc.)
function getCol(row, ...keys) {
  if (!row) return undefined;
  const map = {};
  for (const k of Object.keys(row)) map[k.toLowerCase()] = row[k];
  for (const k of keys) {
    const v = map[String(k).toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

function normTeam(t) {
  if (!t) return "";
  const x = String(t).trim().toUpperCase();
  if (x === "LAR") return "LA";   // your key mapping request
  return x;
}

// Map your depth buckets to the app’s buckets
function normDepthBucket(b) {
  const x = String(b || "").trim().toLowerCase();
  if (x === "short") return "Short";
  if (x === "medium" || x === "intermediate" || x === "mid") return "Intermediate";
  if (x === "deep") return "Deep";
  return "";
}

// Normalize a game row from your games_classic.csv
function normGameRow(g) {
  const game = getCol(g, "Game", "game");
  const home = normTeam(getCol(g, "Home", "home", "home_team"));
  const away = normTeam(getCol(g, "Away", "away", "away_team"));
  return { game, home, away };
}
