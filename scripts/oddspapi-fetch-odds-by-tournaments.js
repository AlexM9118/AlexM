const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.oddspapi.io";

async function main(){
  const key = process.env.ODDSPAPI_KEY;
  if (!key) throw new Error("Missing ODDSPAPI_KEY");

  // IMPORTANT: pune aici lista ta de tournamentIds (watchlist)
  // Exemplu: "17,8"
  const tournamentIds = process.env.TOURNAMENT_IDS || "17";
  const bookmaker = process.env.BOOKMAKER || "pinnacle";
  const oddsFormat = process.env.ODDS_FORMAT || "decimal";
  const verbosity = process.env.VERBOSITY || "1";

  const url =
    `${API_BASE}/v4/odds-by-tournaments` +
    `?bookmaker=${encodeURIComponent(bookmaker)}` +
    `&tournamentIds=${encodeURIComponent(tournamentIds)}` +
    `&oddsFormat=${encodeURIComponent(oddsFormat)}` +
    `&verbosity=${encodeURIComponent(verbosity)}` +
    `&apiKey=${encodeURIComponent(key)}`;

  console.log("Request:", url.replace(key, "***"));

  const r = await fetch(url);
  const text = await r.text();
  console.log("HTTP:", r.status);

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(path.join("data","oddspapi_odds_raw.txt"), text, "utf8");

  if (!r.ok){
    console.log(text.slice(0, 800));
    process.exit(1);
  }

  const data = JSON.parse(text);
  fs.writeFileSync(path.join("data","oddspapi_odds.json"), JSON.stringify(data, null, 2), "utf8");

  console.log("Saved data/oddspapi_odds.json");
  console.log("Fixtures:", Array.isArray(data) ? data.length : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
