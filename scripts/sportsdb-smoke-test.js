// scripts/sportsdb-smoke-test.js
// Smoke test TheSportsDB V1:
// - searchteams.php?t=...
// - eventslast.php?id=...
// Writes outputs to data/sportsdb_smoke/

const fs = require("fs");
const path = require("path");

const KEY = process.env.SPORTSDB_V1_KEY || "123";
const BASE = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(KEY)}`;

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

async function fetchJson(url){
  const r = await fetch(url, { headers: { "user-agent": "alex-ai-bet/1.0" }});
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { __raw: text }; }
  return { status: r.status, ok: r.ok, data };
}

function pickSoccerTeam(teams){
  // pick first Soccer team
  if (!Array.isArray(teams)) return null;
  return teams.find(t => String(t?.strSport || "").toLowerCase() === "soccer") || teams[0] || null;
}

function summarizeLastEvents(events, teamName){
  const evs = Array.isArray(events) ? events : [];
  const rows = evs.slice(0, 8).map(e => ({
    dateEvent: e.dateEvent,
    strSport: e.strSport,
    strHomeTeam: e.strHomeTeam,
    strAwayTeam: e.strAwayTeam,
    intHomeScore: e.intHomeScore,
    intAwayScore: e.intAwayScore,
    strStatus: e.strStatus
  }));

  // basic sanity: any soccer events? any scores present?
  const soccerCount = evs.filter(e => String(e?.strSport || "").toLowerCase() === "soccer").length;
  const scoredCount = evs.filter(e => e.intHomeScore != null && e.intAwayScore != null).length;

  // last5 home/away averages (if names match)
  const isTeam = (x) => String(x || "").trim().toLowerCase() === String(teamName || "").trim().toLowerCase();

  const home = evs.filter(e => isTeam(e.strHomeTeam) && e.intHomeScore != null && e.intAwayScore != null).slice(0, 5);
  const away = evs.filter(e => isTeam(e.strAwayTeam) && e.intHomeScore != null && e.intAwayScore != null).slice(0, 5);

  const avg = (arr, fn) => arr.length ? (arr.reduce((s,x)=>s+fn(x),0) / arr.length) : null;

  const homeGF = avg(home, e => Number(e.intHomeScore));
  const homeGA = avg(home, e => Number(e.intAwayScore));
  const awayGF = avg(away, e => Number(e.intAwayScore));
  const awayGA = avg(away, e => Number(e.intHomeScore));

  return {
    soccerCount,
    scoredCount,
    sampleEvents: rows,
    last5: {
      homeMatches: home.length,
      awayMatches: away.length,
      homeGF, homeGA, awayGF, awayGA
    }
  };
}

async function testOneTeam(teamQuery){
  const out = { teamQuery };

  // A) searchteams
  const urlSearch = `${BASE}/searchteams.php?t=${encodeURIComponent(teamQuery)}`;
  const s = await fetchJson(urlSearch);

  out.search = {
    url: urlSearch,
    http: s.status,
    ok: s.ok
  };

  const teams = s.data?.teams || null;
  out.search.teamsCount = Array.isArray(teams) ? teams.length : 0;

  const picked = pickSoccerTeam(teams);
  if (!picked){
    out.error = "No team found from searchteams";
    return out;
  }

  out.team = {
    idTeam: picked.idTeam,
    strTeam: picked.strTeam,
    strSport: picked.strSport,
    strCountry: picked.strCountry,
    strLeague: picked.strLeague
  };

  // B) eventslast
  const urlLast = `${BASE}/eventslast.php?id=${encodeURIComponent(picked.idTeam)}`;
  const l = await fetchJson(urlLast);

  out.eventslast = {
    url: urlLast,
    http: l.status,
    ok: l.ok
  };

  // API may return "results" or "events"
  const events = l.data?.results || l.data?.events || null;
  out.eventslast.eventsCount = Array.isArray(events) ? events.length : 0;

  out.summary = summarizeLastEvents(events, picked.strTeam);

  return out;
}

async function main(){
  const outDir = path.join("data", "sportsdb_smoke");
  ensureDir(outDir);

  const teamQueries = (process.env.TEAMS || "Liverpool,Arsenal,Real Madrid")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const results = [];
  for (const q of teamQueries){
    console.log("Testing team:", q);
    const r = await testOneTeam(q);
    results.push(r);
  }

  const out = {
    generatedAtUTC: new Date().toISOString(),
    keyUsed: KEY,
    teamQueries,
    results
  };

  fs.writeFileSync(path.join(outDir, "sportsdb_smoke.json"), JSON.stringify(out, null, 2), "utf8");
  console.log("Saved:", path.join(outDir, "sportsdb_smoke.json"));
}

main().catch(e => { console.error(e); process.exit(1); });
