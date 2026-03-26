const fs = require("fs");
const path = require("path");

function readJson(p){ return JSON.parse(fs.readFileSync(p, "utf8")); }
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function lc(s){ return String(s||"").toLowerCase(); }

function normalizeName(s){
  return lc(s)
    .replace(/&/g, "and")
    .replace(/['’.]/g, "")          // remove apostrophes
    .replace(/[^a-z0-9\s]/g, " ")   // remove punctuation
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s){
  const n = normalizeName(s);
  if (!n) return new Set();
  return new Set(n.split(" ").filter(Boolean));
}

function jaccard(aSet, bSet){
  if (!aSet.size && !bSet.size) return 1;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const union = aSet.size + bSet.size - inter;
  return union ? inter / union : 0;
}

function bestMatch(name, candidates){
  const a = tokenSet(name);
  let best = null;

  for (const c of candidates){
    const b = tokenSet(c);
    const score = jaccard(a, b);

    if (!best || score > best.score){
      best = { candidate: c, score };
    }
  }
  return best;
}

function findFootballDataId(mapCfg, categoryName, tournamentName){
  const maps = mapCfg.mappings || [];
  const c = normalizeName(categoryName);
  const t = normalizeName(tournamentName);

  for (const m of maps){
    const mc = normalizeName(m.match?.categoryName);
    const mt = normalizeName(m.match?.tournamentName);
    if (mc === c && mt === t) return m.footballDataId;
  }
  return null;
}

function uniq(arr){ return Array.from(new Set(arr)); }

function main(){
  const mapPath = path.join("scripts", "league-map.json");
  const matchesPath = path.join("data", "ui", "matches.json");
  if (!fs.existsSync(mapPath)) throw new Error("Missing scripts/league-map.json");
  if (!fs.existsSync(matchesPath)) throw new Error("Missing data/ui/matches.json");

  const mapCfg = readJson(mapPath);
  const matches = readJson(matchesPath).matches || [];

  // Group odds teams by (category,tournament)->footballDataId
  const byFd = new Map(); // fdId -> { meta, oddsTeams:Set }
  for (const m of matches){
    const fdId = findFootballDataId(mapCfg, m.categoryName, m.tournamentName);
    if (!fdId) continue;
    if (!byFd.has(fdId)){
      byFd.set(fdId, {
        footballDataId: fdId,
        categoryName: m.categoryName,
        tournamentName: m.tournamentName,
        oddsTeams: new Set()
      });
    }
    const obj = byFd.get(fdId);
    obj.oddsTeams.add(String(m.home||"").trim());
    obj.oddsTeams.add(String(m.away||"").trim());
  }

  const out = {
    generatedAtUTC: new Date().toISOString(),
    leagues: []
  };

  for (const [fdId, obj] of byFd.entries()){
    const statsPath = path.join("data", "stats", `${fdId}.json`);
    if (!fs.existsSync(statsPath)){
      out.leagues.push({ footballDataId: fdId, error: `Missing ${statsPath}` });
      continue;
    }

    const stats = readJson(statsPath);
    const fdTeams = Object.keys(stats.teamStats || {});
    const oddsTeams = Array.from(obj.oddsTeams).filter(Boolean).sort((a,b)=>a.localeCompare(b));

    const suggestions = [];
    for (const t of oddsTeams){
      const best = bestMatch(t, fdTeams);
      const exact = fdTeams.find(x => normalizeName(x) === normalizeName(t)) || null;
      suggestions.push({
        oddsName: t,
        bestMatch: best?.candidate || null,
        score: best?.score ?? null,
        exactNormalizedMatch: exact
      });
    }

    // sort by lowest confidence first to review
    suggestions.sort((a,b)=>(a.score??0)-(b.score??0));

    out.leagues.push({
      footballDataId: fdId,
      categoryName: obj.categoryName,
      tournamentName: obj.tournamentName,
      oddsTeamsCount: oddsTeams.length,
      fdTeamsCount: fdTeams.length,
      suggestions
    });
  }

  ensureDir(path.join("data","ui"));
  fs.writeFileSync(path.join("data","ui","team_alias_suggestions.json"), JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote data/ui/team_alias_suggestions.json");

  // Also generate a candidate aliases file for HIGH confidence matches only
  const ALIAS_MIN_SCORE = 0.70;

  const aliases = {};
  for (const lg of out.leagues){
    for (const s of (lg.suggestions || [])){
      if (!s.bestMatch || s.score == null) continue;
      // Only create alias if normalized names differ (to avoid noise)
      const n1 = normalizeName(s.oddsName);
      const n2 = normalizeName(s.bestMatch);
      if (n1 === n2) continue;
      if (s.score >= ALIAS_MIN_SCORE){
        aliases[s.oddsName] = s.bestMatch;
      }
    }
  }

  fs.writeFileSync(path.join("scripts","team-aliases.generated.json"), JSON.stringify({ aliases }, null, 2), "utf8");
  console.log("Wrote scripts/team-aliases.generated.json (high confidence only)");
}

main();
