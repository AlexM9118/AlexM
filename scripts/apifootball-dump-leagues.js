const fs = require("fs");
const path = require("path");

async function main(){
  const key = process.env.APIFOOTBALL_KEY;
  if (!key) throw new Error("Missing APIFOOTBALL_KEY");

  const API_BASE = "https://v3.football.api-sports.io";
  const url = `${API_BASE}/leagues`;

  const r = await fetch(url, {
    headers: { "x-apisports-key": key }
  });

  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,300)}`);

  const data = JSON.parse(text);

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(path.join("data", "apifootball_leagues_dump.json"), JSON.stringify(data, null, 2));
  console.log("Saved: data/apifootball_leagues_dump.json");
  console.log("Tip: open the dump and search for league.name + country to get league.id");
}

main().catch(e => { console.error(e); process.exit(1); });
