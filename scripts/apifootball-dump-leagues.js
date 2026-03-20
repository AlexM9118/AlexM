const fs = require("fs");
const path = require("path");

async function main(){
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) throw new Error("Missing APIFOOTBALL_KEY");

  // NOTE: URL-ul exact depinde de providerul API-Football pe care l-ai ales.
  // Înlocuiește API_BASE cu cel din documentația ta.
  const API_BASE = "https://v3.football.api-sports.io";

  const url = `${API_BASE}/leagues`;

  const r = await fetch(url, {
    headers: {
      "x-apisports-key": key
    }
  });

  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,200)}`);

  const data = JSON.parse(text);

  fs.writeFileSync(path.join("data", "apifootball_leagues_dump.json"), JSON.stringify(data, null, 2));
  console.log("Saved: data/apifootball_leagues_dump.json");
}

main().catch(e => { console.error(e); process.exit(1); });
