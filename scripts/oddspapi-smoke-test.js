const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.oddspapi.io";

async function fetchText(url){
  const r = await fetch(url, { headers: { "user-agent": "cps-oracle-pro/1.0" }});
  const text = await r.text();
  return { status: r.status, ok: r.ok, text };
}

async function main(){
  const key = process.env.ODDSPAPI_KEY;
  if (!key) throw new Error("Missing ODDSPAPI_KEY");

  // Start with one known tournamentId from your example: 17 = Premier League
  const tournamentIds = "17";
  const bookmaker = "pinnacle";
  const oddsFormat = "decimal";
  const verbosity = 2;

  const url = `${API_BASE}/v4/odds-by-tournaments?bookmaker=${encodeURIComponent(bookmaker)}&tournamentIds=${encodeURIComponent(tournamentIds)}&oddsFormat=${encodeURIComponent(oddsFormat)}&verbosity=${encodeURIComponent(verbosity)}&apiKey=${encodeURIComponent(key)}`;

  console.log("Request:", url.replace(key, "***"));

  const { status, ok, text } = await fetchText(url);
  console.log("HTTP:", status);

  // save whatever we got (even errors) for inspection
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(path.join("data", "oddspapi_smoke_raw.txt"), text, "utf8");

  if (!ok){
    console.log("Not OK response. First 500 chars:");
    console.log(text.slice(0, 500));
    process.exit(1);
  }

  // parse JSON and store pretty
  const data = JSON.parse(text);
  fs.writeFileSync(path.join("data", "oddspapi_smoke.json"), JSON.stringify(data, null, 2), "utf8");

  const count = Array.isArray(data) ? data.length : 0;
  console.log("Fixtures returned:", count);
  if (count > 0){
    console.log("Sample fixture:", {
      fixtureId: data[0].fixtureId,
      startTime: data[0].startTime,
      home: data[0].participant1Name,
      away: data[0].participant2Name,
      tournamentName: data[0].tournamentName
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
