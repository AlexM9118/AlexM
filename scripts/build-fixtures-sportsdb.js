const fs = require("fs");
const path = require("path");

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function parseISODate(s){
  if (!s) return null;
  const t = String(s).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

function todayUTC(){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function withinNextDays(date, 14){
  const dt = new Date(dateStr + "T00:00:00Z");
  const t0 = todayUTC();
  const t1 = new Date(t0.getTime() + days*24*60*60*1000);
  return dt >= t0 && dt <= t1;
}

async function getJson(url){
  const r = await fetch(url, { headers: { "user-agent": "cps-oracle-pro/1.0" }});
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function main(){
  const key = process.env.SPORTSDB_KEY;
  if (!key) throw new Error("Missing SPORTSDB_KEY env var (GitHub Secret).");

  const cfg = JSON.parse(fs.readFileSync(path.join("scripts","active-leagues.json"), "utf8"));
  const leagues = cfg.leagues || [];

  const outDir = path.join("data","fixtures");
  ensureDir(outDir);

  for (const l of leagues){
    if (!l.sportsDbLeagueId || l.sportsDbLeagueId === "PUT_ID_HERE"){
      console.log(`[SKIP] ${l.id}: sportsDbLeagueId not set`);
      continue;
    }

    const url = `https://www.thesportsdb.com/api/v1/json/${key}/eventsnextleague.php?id=${encodeURIComponent(l.sportsDbLeagueId)}`;
    console.log(`Fetching fixtures: ${l.id} (${l.name})`);

    const data = await getJson(url);
    const events = data?.events || data?.event || [];
    const matches = [];

    for (const ev of events){
      const date = parseISODate(ev.dateEvent || ev.strDate);
      const home = (ev.strHomeTeam || "").trim();
      const away = (ev.strAwayTeam || "").trim();
      if (!date || !home || !away) continue;
      if (!withinNextDays(date, 5)) continue;

      matches.push({
        id: `${l.id}_${date}_${home}_vs_${away}`.replace(/\s+/g,"_"),
        date, home, away
      });
    }

    fs.writeFileSync(
      path.join(outDir, `${l.id}.json`),
      JSON.stringify({ leagueId: l.id, leagueName: l.name, matches }, null, 2)
    );
  }

  console.log("Fixtures done.");
}

main().catch(e => { console.error(e); process.exit(1); });
