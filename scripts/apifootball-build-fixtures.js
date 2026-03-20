const fs = require("fs");
const path = require("path");

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function toISODate(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,"0");
  const day = String(d.getUTCDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function addDays(d, n){
  return new Date(d.getTime() + n*24*60*60*1000);
}

async function fetchJson(url, key){
  const r = await fetch(url, { headers: { "x-apisports-key": key }});
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,200)}`);
  return JSON.parse(text);
}

async function main(){
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) throw new Error("Missing APIFOOTBALL_KEY");

  const API_BASE = "https://v3.football.api-sports.io";

  const cfg = JSON.parse(fs.readFileSync(path.join("scripts","apifootball-leagues.json"), "utf8"));
  const windowDays = cfg.windowDays || 5;
  const leagues = cfg.leagues || [];

  ensureDir(path.join("data","fixtures"));

  const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const end = addDays(start, windowDays);

  const from = toISODate(start);
  const to = toISODate(end);

  for (const l of leagues){
    if (!l.apiLeagueId || l.apiLeagueId === 0){
      console.log(`[SKIP] ${l.id} has apiLeagueId=0`);
      continue;
    }

    // Endpoint tipic: /fixtures?league=...&season=...&from=...&to=...
    // Dar parametrii exacti depind de API. Îl ajustăm după ce confirmi providerul.
    const url = `${API_BASE}/fixtures?league=${encodeURIComponent(l.apiLeagueId)}&from=${from}&to=${to}`;
    console.log(`Fetching fixtures for ${l.id}: ${url}`);

    const data = await fetchJson(url, key);

    // Normalize: încearcă să găsească lista de fixtures în structura providerului
    const items = data.response || data.fixtures || [];

    const matches = items.map((it, idx) => {
      const date = (it.fixture?.date || it.date || "").slice(0,10); // YYYY-MM-DD
      const home = it.teams?.home?.name || it.home?.name || it.home || "";
      const away = it.teams?.away?.name || it.away?.name || it.away || "";

      return {
        id: `${l.id}_${date}_${home}_vs_${away}`.replace(/\s+/g,"_"),
        date,
        home,
        away
      };
    }).filter(m => m.date && m.home && m.away);

    fs.writeFileSync(
      path.join("data","fixtures",`${l.id}.json`),
      JSON.stringify({
        leagueId: l.id,
        leagueName: l.name,
        generatedAtUTC: new Date().toISOString(),
        from, to,
        matches
      }, null, 2)
    );

    console.log(`Saved data/fixtures/${l.id}.json: ${matches.length} matches`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
