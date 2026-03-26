const fs = require("fs");
const path = require("path");

function readJson(p){ return JSON.parse(fs.readFileSync(p, "utf8")); }
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function main(){
  const matchesPath = path.join("data","ui","matches.json");
  const histPath = path.join("data","ui","history_stats.json");

  if (!fs.existsSync(matchesPath)) throw new Error("Missing data/ui/matches.json");
  if (!fs.existsSync(histPath)) throw new Error("Missing data/ui/history_stats.json");

  const matches = readJson(matchesPath).matches || [];
  const hist = readJson(histPath);
  const byFixture = hist.byFixtureId || {};

  const leagueKey = (m) => `${m.categoryName || ""} | ${m.tournamentName || ""}`;

  const leagues = new Map(); // key -> counters
  const missingTeams = new Map(); // JSON-key -> count

  function bumpMissingTeam(lk, team){
    const keyObj = { leagueKey: lk, teamName: String(team || "").trim() };
    const key = JSON.stringify(keyObj);
    missingTeams.set(key, (missingTeams.get(key) || 0) + 1);
  }

  for (const m of matches){
    const fx = String(m.fixtureId);
    const lk = leagueKey(m);

    if (!leagues.has(lk)){
      leagues.set(lk, {
        leagueKey: lk,
        categoryName: m.categoryName || "",
        tournamentName: m.tournamentName || "",
        total: 0,
        ok: 0,
        noLeagueMap: 0,
        missingStatsFile: 0,
        missingTeams: 0,
        notEnoughSamples: 0,
        other: 0,
        footballDataIds: new Set()
      });
    }
    const L = leagues.get(lk);
    L.total++;

    const e = byFixture[fx];
    if (!e){
      L.other++;
      continue;
    }
    if (e.footballDataId) L.footballDataIds.add(String(e.footballDataId));

    if (e.note === "No league mapping" || e.footballDataId == null){
      L.noLeagueMap++;
      continue;
    }
    if (e.note === "Missing data/stats file"){
      L.missingStatsFile++;
      continue;
    }

    if (e.note && e.note.includes("team not found in stats")){
      L.missingTeams++;

      // Count missing team names (use RAW to know what OddsPapi shows)
      if (e.note.includes("home team not found")){
        bumpMissingTeam(lk, e.homeRaw || e.home || "");
      }
      if (e.note.includes("away team not found")){
        bumpMissingTeam(lk, e.awayRaw || e.away || "");
      }
      continue;
    }

    const hs = e.homeStats;
    const as = e.awayStats;
    const homeMatches = Number(hs?.homeMatches || 0);
    const awayMatches = Number(as?.awayMatches || 0);

    if (homeMatches < 1 || awayMatches < 1){
      L.notEnoughSamples++;
      continue;
    }

    L.ok++;
  }

  const leagueRows = Array.from(leagues.values()).map(L => ({
    leagueKey: L.leagueKey,
    categoryName: L.categoryName,
    tournamentName: L.tournamentName,
    footballDataIds: Array.from(L.footballDataIds),
    total: L.total,
    ok: L.ok,
    okPct: L.total ? +(100 * L.ok / L.total).toFixed(1) : 0,
    noLeagueMap: L.noLeagueMap,
    missingStatsFile: L.missingStatsFile,
    missingTeams: L.missingTeams,
    notEnoughSamples: L.notEnoughSamples,
    other: L.other
  }))
  .sort((a,b)=> b.total - a.total);

  const missingTeamRows = Array.from(missingTeams.entries())
    .map(([k, count]) => {
      const obj = JSON.parse(k);
      return { leagueKey: obj.leagueKey, teamName: obj.teamName, count };
    })
    .sort((a,b)=> b.count - a.count)
    .slice(0, 200);

  const out = {
    generatedAtUTC: new Date().toISOString(),
    lookback: hist.lookback ?? null,
    matchesTotal: matches.length,
    leagues: leagueRows,
    topMissingTeams: missingTeamRows
  };

  ensureDir(path.join("data","ui"));
  fs.writeFileSync(
    path.join("data","ui","history_coverage_report.json"),
    JSON.stringify(out, null, 2),
    "utf8"
  );
  console.log("Wrote data/ui/history_coverage_report.json");
}

main();
