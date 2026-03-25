const fs = require("fs");
const path = require("path");

const API_BASE = "https://v3.football.api-sports.io";

async function fetchJson(url, key){
  const r = await fetch(url, { headers: { "x-apisports-key": key }});
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { __raw: text }; }

  return {
    ok: r.ok,
    status: r.status,
    headers: {
      // useful if present
      dayLimit: r.headers.get("x-ratelimit-requests-limit"),
      dayRemaining: r.headers.get("x-ratelimit-requests-remaining"),
      minLimit: r.headers.get("x-ratelimit-limit"),
      minRemaining: r.headers.get("x-ratelimit-remaining")
    },
    data
  };
}

function write(p, obj){
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

async function main(){
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) throw new Error("Missing APIFOOTBALL_KEY");

  // Test 1: fixtures by date (season-independent)
  const date = process.env.DATE || "2026-04-12";
  const url1 = `${API_BASE}/fixtures?date=${encodeURIComponent(date)}`;
  const r1 = await fetchJson(url1, key);
  write("data/apifootball_smoke_fixtures_by_date.json", r1);

  // Test 2: pick one league and test fixtures by league+season
  const league = process.env.LEAGUE || "39";     // EPL often 39 in API-Sports
  const season = process.env.SEASON || "2025";   // try season current
  const url2 = `${API_BASE}/fixtures?league=${encodeURIComponent(league)}&season=${encodeURIComponent(season)}&from=${date}&to=${date}`;
  const r2 = await fetchJson(url2, key);
  write("data/apifootball_smoke_fixtures_by_league.json", r2);

  // Print quick summary to logs
  console.log("by-date status:", r1.status, "results:", r1.data?.results, "errors:", r1.data?.errors);
  console.log("by-league status:", r2.status, "results:", r2.data?.results, "errors:", r2.data?.errors);
  console.log("rate headers:", r1.headers);

  // Basic sanity: do we see scores fields in fixture response?
  const sample = r1.data?.response?.[0] || r2.data?.response?.[0] || null;
  if (sample){
    console.log("sample keys:", Object.keys(sample));
    console.log("sample fixture.score:", sample.score || null);
    console.log("sample goals:", sample.goals || null);
  } else {
    console.log("no sample fixture found in responses");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
