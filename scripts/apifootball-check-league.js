async function main(){
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) throw new Error("Missing APIFOOTBALL_KEY");

  const API_BASE = "https://v3.football.api-sports.io";
  const leagueId = process.argv[2];

  if (!leagueId) throw new Error("Usage: node scripts/apifootball-check-league.js <leagueId>");

  const url = `${API_BASE}/leagues?id=${encodeURIComponent(leagueId)}`;
  const r = await fetch(url, { headers: { "x-apisports-key": key }});

  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,300)}`);

  const data = JSON.parse(text);

  console.log("leagueId:", leagueId);
  console.log("results:", data.results);
  console.log("errors:", data.errors);

  const first = data.response?.[0] || null;
  if (first){
    const seasons = (first.seasons || []).map(s => s.year).sort();
    console.log("league.name:", first.league?.name);
    console.log("country.name:", first.country?.name);
    console.log("seasons (years):", seasons.slice(-10)); // last 10
  } else {
    console.log("first: null");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
