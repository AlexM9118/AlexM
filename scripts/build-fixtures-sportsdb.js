const fs = require("fs");
const path = require("path");

const DAYS_AHEAD = 5;

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function todayUTCDate(){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(d, days){
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function toISODateUTC(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchJson(url){
  const r = await fetch(url, { headers: { "user-agent": "cps-oracle-pro/1.0" }});
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}\n${text.slice(0,200)}`);
  return JSON.parse(text);
}

function safeStr(x){ return String(x || "").trim(); }

async function main(){
  const key = process.env.SPORTSDB_KEY;
  if (!key) throw new Error("Missing SPORTSDB_KEY env var (GitHub Secret).");

  const cfgPath = path.join(process.cwd(), "scripts", "active-leagues.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const leagues = cfg.leagues || [];

  // Map SportsDB leagueId -> our leagueId (epl/champ/...)
  const sportsIdToOur = new Map();
  const ourToName = new Map();

  for (const l of leagues){
    const ourId = safeStr(l.id);
    const name = safeStr(l.name);
    const sportsLeagueId = safeStr(l.sportsDbLeagueId);

    if (!ourId || !sportsLeagueId) continue;
    sportsIdToOur.set(sportsLeagueId, ourId);
    ourToName.set(ourId, name);
  }

  if (sportsIdToOur.size === 0) {
    throw new Error("No sportsDbLeagueId mappings found in active-leagues.json.");
  }

  const outDir = path.join(process.cwd(), "data", "fixtures");
  ensureDir(outDir);

  // Collect matches per our leagueId
  const buckets = {};
  for (const ourId of ourToName.keys()){
    buckets[ourId] = [];
  }

  const start = todayUTCDate();

  console.log(`Building fixtures using eventsday for today + ${DAYS_AHEAD} days...`);
  console.log(`Leagues tracked: ${Array.from(ourToName.keys()).join(", ")}`);

  for (let i = 0; i <= DAYS_AHEAD; i++){
    const day = addDays(start, i);
    const iso = toISODateUTC(day);

    // Endpoint that worked for you (events day)
    const url = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/eventsday.php?d=${encodeURIComponent(iso)}&s=Soccer`;
    console.log(`Fetching events for ${iso}`);

    const data = await fetchJson(url);
    const events = data.events || [];
    console.log(`  events returned: ${events.length}`);

    for (const ev of events){
      const idLeague = safeStr(ev.idLeague);
      const ourId = sportsIdToOur.get(idLeague);
      if (!ourId) continue; // not one of our tracked leagues

      const date = safeStr(ev.dateEvent || iso);
      const home = safeStr(ev.strHomeTeam);
      const away = safeStr(ev.strAwayTeam);
      if (!date || !home || !away) continue;

      buckets[ourId].push({
        id: `${ourId}_${date}_${home}_vs_${away}`.replace(/\s+/g, "_"),
        date,
        home,
        away
      });
    }
  }

  // De-duplicate and write files
  for (const [ourId, matches] of Object.entries(buckets)){
    const seen = new Set();
    const deduped = [];
    for (const m of matches){
      const k = `${m.date}|${m.home}|${m.away}`;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(m);
    }

    deduped.sort((a,b) => (a.date + a.home + a.away).localeCompare(b.date + b.home + b.away));

    const out = {
      leagueId: ourId,
      leagueName: ourToName.get(ourId) || ourId,
      generatedAtUTC: new Date().toISOString(),
      daysAhead: DAYS_AHEAD,
      source: { provider: "TheSportsDB", endpoint: "eventsday.php" },
      matches: deduped
    };

    fs.writeFileSync(path.join(outDir, `${ourId}.json`), JSON.stringify(out, null, 2), "utf8");
    console.log(`Saved data/fixtures/${ourId}.json: ${deduped.length} matches`);
  }

  console.log("Fixtures done.");
}

main().catch(e => { console.error(e); process.exit(1); });
