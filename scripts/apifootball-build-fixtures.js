const fs = require("fs");
const path = require("path");

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function todayUTC(){
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}
function addDays(d, n){
  return new Date(d.getTime() + n*24*60*60*1000);
}
function isoDate(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

async function fetchJson(url, key){
  const r = await fetch(url, { headers: { "x-apisports-key": key }});
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,300)} | url=${url}`);
  return JSON.parse(text);
}

function safeStr(x){ return String(x || "").trim(); }

async function main(){
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) throw new Error("Missing APIFOOTBALL_KEY");

  const API_BASE = "https://v3.football.api-sports.io";

  const cfg = JSON.parse(fs.readFileSync(path.join("scripts","apifootball-leagues.json"), "utf8"));
  const windowDays = cfg.windowDays ?? 5;
  const season = cfg.season; // e.g. 2025
  const leagues = cfg.leagues || [];

  if (!season) throw new Error("Missing season in scripts/apifootball-leagues.json");

  const fromD = todayUTC();
  const toD = addDays(fromD, windowDays);
  const from = isoDate(fromD);
  const to = isoDate(toD);

  ensureDir(path.join("data","fixtures"));

  for (const l of leagues){
    const ourId = safeStr(l.id);
    const leagueId = Number(l.apiLeagueId);

    if (!ourId) continue;
    if (!Number.isFinite(leagueId) || leagueId <= 0){
      console.log(`[SKIP] ${ourId} apiLeagueId not set`);
      continue;
    }

    // API-Football fixtures endpoint:
    // /fixtures?league=XX&season=YYYY&from=YYYY-MM-DD&to=YYYY-MM-DD
    const url = `${API_BASE}/fixtures?league=${encodeURIComponent(leagueId)}&season=${encodeURIComponent(season)}&from=${from}&to=${to}`;

    console.log(`Fetching fixtures for ${ourId} (league=${leagueId}, season=${season}) ${from}..${to}`);
    const data = await fetchJson(url, key);

    const items = data.response || [];
    const matches = items.map(it => {
      const date = (it.fixture?.date || "").slice(0,10);
      const home = it.teams?.home?.name || "";
      const away = it.teams?.away?.name || "";
      return {
        id: `${ourId}_${date}_${home}_vs_${away}`.replace(/\s+/g,"_"),
        date,
        home,
        away
      };
    }).filter(m => m.date && m.home && m.away);

    fs.writeFileSync(
      path.join("data","fixtures",`${ourId}.json`),
      JSON.stringify({
        leagueId: ourId,
        leagueName: l.name || ourId,
        apiLeagueId: leagueId,
        season,
        generatedAtUTC: new Date().toISOString(),
        from, to,
        matches
      }, null, 2)
    );

    console.log(`Saved data/fixtures/${ourId}.json: ${matches.length} matches`);
  }

  console.log("Done fixtures.");
}

main().catch(e => { console.error(e); process.exit(1); });
