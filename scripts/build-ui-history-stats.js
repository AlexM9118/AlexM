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
  return { ...generatedAliases, ...manualAliases }; // manual overrides generated
}

// generic cleanup (helps Italy/others)
function normalizeTeamGeneric(name){
  let s = String(name || "").trim();
  if (!s) return s;

  s = s.replace(/[’'.]/g, "");
  // remove leading tokens
  const lead = ["SSC ", "US ", "AS ", "ACF ", "FC ", "CF "];
  for (const p of lead){
    if (s.toLowerCase().startsWith(p.toLowerCase())){
      s = s.slice(p.length).trim();
    }
  }
  // remove trailing tokens
  const drop = [" Calcio"," FC"," CF"," AC"," AFC"," SC"," CFC"," HSC"," OSC"," BC"," FK"," SK"," BK"];
  for (const t of drop){
    if (s.toLowerCase().endsWith(t.trim().toLowerCase())){
      s = s.slice(0, s.length - t.length).trim();
    }
  }
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function applyAliases(rawName, aliases){
  const raw = String(rawName || "").trim();
  return aliases[raw] || raw;
}

function pickTeamStatsExactOrCI(teamStats, name){
  if (!name) return null;
  if (teamStats[name]) return teamStats[name];
  const key = Object.keys(teamStats).find(k => lc(k) === lc(name));
  return key ? teamStats[key] : null;
}

function pickTeamStatsMulti(statsFile, rawName){
  const teamStats = statsFile?.teamStats || {};
  if (!rawName) return null;

  // 1) exact/raw (after aliases), no normalization
  const a1 = pickTeamStatsExactOrCI(teamStats, rawName);
  if (a1) return { stats: a1, pickedName: rawName, method: "raw" };

  // 2) normalized generic
  const n = normalizeTeamGeneric(rawName);
  if (n && n !== rawName){
    const a2 = pickTeamStatsExactOrCI(teamStats, n);
    if (a2) return { stats: a2, pickedName: n, method: "normalized" };
  }

  return null;
}

function main(){
  const mapPath = path.join("scripts","league-map.json");
  const matchesPath = path.join("data","ui","matches.json");

  if (!fs.existsSync(mapPath)) throw new Error("Missing scripts/league-map.json");
  if (!fs.existsSync(matchesPath)) throw new Error("Missing data/ui/matches.json");

  const mapCfg = readJson(mapPath);
  const matches = readJson(matchesPath).matches || [];

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

    const fdId = findFootballDataId(mapCfg, categoryName, tournamentName);
    const homeRaw = String(m.home || "").trim();
    const awayRaw = String(m.away || "").trim();

    // Apply aliases (manual + generated). IMPORTANT: don't normalize yet.
    const homeAliased = applyAliases(homeRaw, aliases);
    const awayAliased = applyAliases(awayRaw, aliases);

    if (!fdId){
      out.byFixtureId[fixtureId] = {
        footballDataId: null,
        note: "No league mapping",
        categoryName,
        tournamentName,
        homeRaw,
        awayRaw,
        home: homeAliased,
        away: awayAliased
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
        home: homeAliased,
        away: awayAliased
      };
      continue;
    }

    const hPick = pickTeamStatsMulti(statsFile, homeAliased);
    const aPick = pickTeamStatsMulti(statsFile, awayAliased);

    let note = null;
    if (!hPick || !aPick){
      const miss = [];
      if (!hPick) miss.push(`home team not found in stats: "${homeAliased}"`);
      if (!aPick) miss.push(`away team not found in stats: "${awayAliased}"`);
      note = miss.join(" | ");
    }

    out.byFixtureId[fixtureId] = {
      footballDataId: fdId,
      categoryName,
      tournamentName,
      homeRaw,
      awayRaw,
      home: homeAliased,
      away: awayAliased,
      homePicked: hPick?.pickedName || null,
      awayPicked: aPick?.pickedName || null,
      homePickMethod: hPick?.method || null,
      awayPickMethod: aPick?.method || null,
      homeStats: hPick?.stats || null,
      awayStats: aPick?.stats || null,
      note
    };
  }

  ensureDir(path.join("data","ui"));
  fs.writeFileSync(path.join("data","ui","history_stats.json"), JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote data/ui/history_stats.json");
}

main();
