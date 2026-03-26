const fs = require("fs");
const path = require("path");

function readJson(p){ return JSON.parse(fs.readFileSync(p, "utf8")); }
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function lc(s){ return String(s||"").toLowerCase(); }

// Remove common “noise” tokens that appear in football team names
const STOPWORDS = new Set([
  "fc","cf","sc","ac","afc","cd","ad","ud","sd","rc","bc","sv","ss","fk",
  "club","de","la","del","da","do","dos","das","the",
  "real","atletico","athletic",
  "san","santa","saint","st",
  "sporting","deportivo",
  "a","b","c", // reserve team letters often unhelpful, but keep "b" sometimes; we'll treat separately
  "ii","iii"
]);

function normalizeName(s){
  return lc(s)
    .replace(/&/g, "and")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensForMatch(s){
  const n = normalizeName(s);
  if (!n) return [];

  // keep "b" only if name contains " b" at end or "team b" patterns; otherwise treat as stopword
  const raw = n.split(" ").filter(Boolean);

  const out = [];
  for (const tok of raw){
    if (STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

function tokenSet(s){
  return new Set(tokensForMatch(s));
}

function jaccard(aSet, bSet){
  if (!aSet.size && !bSet.size) return 1;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const union = aSet.size + bSet.size - inter;
  return union ? inter / union : 0;
}

// bonus if one normalized string contains the other (helps "Sporting Gijon" vs "Sp Gijon")
function containmentBonus(aNorm, bNorm){
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 0.3;
  if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.15;
  return 0;
}

function bestMatch(name, candidates){
  const aSet = tokenSet(name);
  const aNorm = normalizeName(name);

  let best = null;

  for (const c of candidates){
    const bSet = tokenSet(c);
    const bNorm = normalizeName(c);

    let score = jaccard(aSet, bSet);
    score += containmentBonus(aNorm, bNorm);

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

function main(){
  const mapPath = path.join("scripts", "league-map.json");
  const matchesPath = path.join("data", "ui", "matches.json");
  if (!fs.existsSync(mapPath)) throw new Error("Missing scripts/league-map.json");
  if (!fs.existsSync(matchesPath)) throw new Error("Missing data/ui/matches.json");

  const mapCfg = readJson(mapPath);
  const matches = readJson(matchesPath).matches || [];

  // Group odds teams by footballDataId
  const byFd = new Map();
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
    algo: {
      stopwords: Array.from(STOPWORDS).slice(0, 40),
      autoMinScore: 0.70,
      reviewMinScore: 0.55
    },
    leagues: []
  };

  const AUTO_MIN = 0.70;
  const REVIEW_MIN = 0.55;

  const aliasesAuto = {};
  const review = [];

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

      const s = {
        oddsName: t,
        bestMatch: best?.candidate || null,
        score: best?.score ?? null,
        exactNormalizedMatch: exact
      };
      suggestions.push(s);

      // auto alias rules
      if (!s.bestMatch || s.score == null) continue;

      const n1 = normalizeName(s.oddsName);
      const n2 = normalizeName(s.bestMatch);

      // only if different
      if (n1 === n2) continue;

      if (s.score >= AUTO_MIN){
        aliasesAuto[s.oddsName] = s.bestMatch;
      } else if (s.score >= REVIEW_MIN){
        review.push({ footballDataId: fdId, categoryName: obj.categoryName, tournamentName: obj.tournamentName, ...s });
      }
    }

    // sort per league: lowest confidence first
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

  fs.writeFileSync(
    path.join("scripts","team-aliases.generated.json"),
    JSON.stringify({ generatedAtUTC: new Date().toISOString(), autoMinScore: AUTO_MIN, aliases: aliasesAuto, review }, null, 2),
    "utf8"
  );
  console.log("Wrote scripts/team-aliases.generated.json (auto + review list)");
}

main();
