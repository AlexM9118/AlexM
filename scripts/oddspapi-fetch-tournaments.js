const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.oddspapi.io";

async function main(){
  const key = process.env.ODDSPAPI_KEY;
  if (!key) throw new Error("Missing ODDSPAPI_KEY");

  const sportId = 10; // soccer
  const url = `${API_BASE}/v4/tournaments?sportId=${sportId}&apiKey=${encodeURIComponent(key)}`;

  console.log("Request:", url.replace(key, "***"));

  const r = await fetch(url);
  const text = await r.text();
  console.log("HTTP:", r.status);

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(path.join("data","oddspapi_tournaments_raw.txt"), text, "utf8");

  if (!r.ok){
    console.log(text.slice(0, 500));
    process.exit(1);
  }

  const data = JSON.parse(text);
  fs.writeFileSync(path.join("data","oddspapi_tournaments.json"), JSON.stringify(data, null, 2), "utf8");

  console.log("Saved data/oddspapi_tournaments.json");
  console.log("Tournaments:", Array.isArray(data) ? data.length : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
