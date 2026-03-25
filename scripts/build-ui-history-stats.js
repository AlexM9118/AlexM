const fs = require("fs");
const path = require("path");

function readJson(p){ return JSON.parse(fs.readFileSync(p, "utf8")); }
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
const lc = (s) => String(s||"").trim().toLowerCase();

function findFootballDataId(mapCfg, categoryName, tournamentName){
  const maps = mapCfg.mappings || [];
  const c = lc(categoryName);
  const t = lc(tournamentName);

  for (const m of maps){
    const mc = lc(m.match?.categoryName);
    const mt = lc(m.match?.tournamentName);
    if (mc === c && mt === t) return m.footballDataId;
  }
  return null;
}

function pickTeamStats(statsFile, teamName){
  const teamStats = statsFile?.teamStats || {};
  // exact match first
  if (teamStats[teamName]) return teamStats[teamName];

  // fallback: case-insensitive key match
  const key = Object.keys(teamStats).find(k => lc(k) === lc(teamName));
  return key ? teamStats[key] : null;
}

function main(){
  const mapPath = path.join("scripts","league-map.json");
  const matchesPath = path.join("data","ui","matches.json");

  if (!fs.existsSync(mapPath)) throw new Error("Missing scripts/league-map.json");
  if (!fs.existsSync(matchesPath)) throw new Error("Missing data/ui/matches.json");

  const mapCfg = readJson(mapPath);
  const matchesObj = readJson(matchesPath);
  const matches = matchesObj.matches || [];

  const out = {
    generatedAtUTC: new Date().toISOString(),
    lookback: null,
    byFixtureId: {}
  };

  // cache stats per footballDataId
  const statsCache = new Map();

  for (const m of matches){
    const fixtureId = String(m.fixtureId);
    const categoryName = m.categoryName || "";
    const tournamentName = m.tournamentName || "";
    const home = m.home || "";
    const away = m.away || "";

    const fdId = findFootballDataId(mapCfg, categoryName, tournamentName);
    if (!fdId){
      out.byFixtureId[fixtureId] = { footballDataId: null, note: "No league mapping", home, away };
      continue;
    }

    if (!statsCache.has(fdId)){
      const p = path.join("data","stats",`${fdId}.json`);
      if (!fs.existsSync(p)){
        statsCache.set(fdId, null);
      } else {
        const statsFile = readJson(p);
        statsCache.set(fdId, statsFile);
        out.lookback = out.lookback ?? statsFile.lookback ?? null;
      }
    }

    const statsFile = statsCache.get(fdId);
    if (!statsFile){
      out.byFixtureId[fixtureId] = { footballDataId: fdId, note: "Missing data/stats file", home, away };
      continue;
    }

    const homeStats = pickTeamStats(statsFile, home);
    const awayStats = pickTeamStats(statsFile, away);

    out.byFixtureId[fixtureId] = {
      footballDataId: fdId,
      categoryName,
      tournamentName,
      home,
      away,
      homeStats: homeStats || null,
      awayStats: awayStats || null
    };
  }

  ensureDir(path.join("data","ui"));
  fs.writeFileSync(path.join("data","ui","history_stats.json"), JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote data/ui/history_stats.json");
}

main();
