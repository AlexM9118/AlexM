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

function loadAliasesFile(p){
  if (!fs.existsSync(p)) return { aliases: {} };
  const obj = readJson(p);
  if (obj && obj.aliases && typeof obj.aliases === "object") return obj;
  return { aliases: {} };
}

function mergeAliases(manualAliases, generatedAliases){
  // manual overrides generated
  return { ...generatedAliases, ...manualAliases };
}

// --- NEW: generic cleanup for common team suffix/prefix noise ---
function normalizeTeamGeneric(name){
  let s = String(name || "").trim();
  if (!s) return s;

  // remove punctuation variants
  s = s.replace(/[’'.]/g, "");

  // remove common trailing tokens (mostly harmless, big impact for Italy)
  const drop = [
    " Calcio",
    " FC",
    " CF",
    " AC",
    " AFC",
    " SC",
    " CFC",
    " HSC",
    " OSC",
    " BC",
    " FK",
    " SK",
    " BK"
  ];

  for (const t of drop){
    if (s.toLowerCase().endsWith(t.trim().toLowerCase())){
      s = s.slice(0, s.length - t.length).trim();
    }
  }

  // remove common leading tokens (optional)
  const lead = ["SSC ", "US ", "AS ", "ACF ", "FC ", "CF "];
  for (const p of lead){
    if (s.toLowerCase().startsWith(p.toLowerCase())){
      s = s.slice(p.length).trim();
    }
  }

  // compress spaces
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function normTeamName(name, aliases){
  const raw = String(name || "").trim();
  const aliased = aliases[raw] || raw;
  return normalizeTeamGeneric(aliased);
}

function pickTeamStats(statsFile, teamName){
  const teamStats = statsFile?.teamStats || {};
  if (!teamName) return null;

  // exact match first
  if (teamStats[teamName]) return teamStats[teamName];

  // case-insensitive key match
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

  const manual = loadAliasesFile(path.join("scripts", "team-aliases.json")).aliases;
  const generated = loadAliasesFile(path.join("scripts", "team-aliases.generated.json")).aliases;
  const aliases = mergeAliases(manual, generated);

  const out = {
    generatedAtUTC: new Date().toISOString(),
    lookback: null,
    aliasesUsed: Object.keys(aliases).length,
    byFixtureId: {}
  };

  const statsCache = new Map();

  for (const m of matches){
    const fixtureId = String(m.fixtureId);
    const categoryName = m.categoryName || "";
    const tournamentName = m.tournamentName || "";

    const homeRaw = m.home || "";
    const awayRaw = m.away || "";
    const home = normTeamName(homeRaw, aliases);
    const away = normTeamName(awayRaw, aliases);

    const fdId = findFootballDataId(mapCfg, categoryName, tournamentName);
    if (!fdId){
      out.byFixtureId[fixtureId] = {
        footballDataId: null,
        note: "No league mapping",
        categoryName,
        tournamentName,
        homeRaw,
        awayRaw,
        home,
        away
      };
      continue;
    }

    if (!statsCache.has(fdId)){
      const p = path.join("data","stats",`${fdId}.json`);
      statsCache.set(fdId, fs.existsSync(p) ? readJson(p) : null);
      out.lookback = out.lookback ?? statsCache.get(fdId)?.lookback ?? null;
    }

    const statsFile = statsCache.get(fdId);
    if (!statsFile){
      out.byFixtureId[fixtureId] = {
        footballDataId: fdId,
        note: "Missing data/stats file",
        categoryName,
        tournamentName,
        homeRaw,
        awayRaw,
        home,
        away
      };
      continue;
    }

    const homeStats = pickTeamStats(statsFile, home);
    const awayStats = pickTeamStats(statsFile, away);

    let note = null;
    if (!homeStats || !awayStats){
      const miss = [];
      if (!homeStats) miss.push(`home team not found in stats: "${home}"`);
      if (!awayStats) miss.push(`away team not found in stats: "${away}"`);
      note = miss.join(" | ");
    }

    out.byFixtureId[fixtureId] = {
      footballDataId: fdId,
      categoryName,
      tournamentName,
      homeRaw,
      awayRaw,
      home,
      away,
      homeStats: homeStats || null,
      awayStats: awayStats || null,
      note
    };
  }

  ensureDir(path.join("data","ui"));
  fs.writeFileSync(path.join("data","ui","history_stats.json"), JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote data/ui/history_stats.json");
}

main();
