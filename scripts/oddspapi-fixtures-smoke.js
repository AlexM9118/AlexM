// scripts/oddspapi-fixtures-smoke.js
// Smoke test OddsPapi /v4/fixtures for FINISHED events (statusId=2)
// Saves raw + parsed JSON in data/ for inspection.

const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.oddspapi.io";

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

async function fetchText(url){
  const r = await fetch(url, { headers: { "user-agent": "alex-ai-bet/1.0" }});
  const text = await r.text();
  return { status: r.status, ok: r.ok, text };
}

async function main(){
  const key = process.env.ODDSPAPI_KEY;
  if (!key) throw new Error("Missing ODDSPAPI_KEY");

  // Pick ONE tournamentId from your list (default: 17 EPL)
  const tournamentId = process.env.TOURNAMENT_ID || "17";

  // Keep the range small (docs say constraints around from/to). We’ll try 48 hours.
  const from = process.env.FROM || "2026-03-20T00:00:00Z";
  const to   = process.env.TO   || "2026-03-22T00:00:00Z";

  // Finished only
  const statusId = process.env.STATUS_ID || "2";

  const url =
    `${API_BASE}/v4/fixtures` +
    `?tournamentId=${encodeURIComponent(tournamentId)}` +
    `&from=${encodeURIComponent(from)}` +
    `&to=${encodeURIComponent(to)}` +
    `&statusId=${encodeURIComponent(statusId)}` +
    `&apiKey=${encodeURIComponent(key)}`;

  console.log("Request:", url.replace(key, "***"));

  const { status, ok, text } = await fetchText(url);
  console.log("HTTP:", status);

  ensureDir("data");
  fs.writeFileSync(path.join("data", "oddspapi_fixtures_smoke_raw.txt"), text, "utf8");

  if (!ok){
    console.log("Body (first 600 chars):");
    console.log(text.slice(0, 600));
    throw new Error(`Fixtures request failed HTTP ${status}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Response is not JSON");
  }

  fs.writeFileSync(path.join("data", "oddspapi_fixtures_smoke.json"), JSON.stringify(data, null, 2), "utf8");

  const first = Array.isArray(data) ? data[0] : null;
  console.log("items:", Array.isArray(data) ? data.length : 0);

  if (first){
    console.log("FIRST KEYS:", Object.keys(first));
    console.log("FIRST SAMPLE:", {
      fixtureId: first.fixtureId,
      startTime: first.startTime,
      statusId: first.statusId,
      participant1Name: first.participant1Name,
      participant2Name: first.participant2Name,

      // These are what we hope exist (may be undefined):
      homeScore: first.homeScore,
      awayScore: first.awayScore,
      participant1Score: first.participant1Score,
      participant2Score: first.participant2Score,
      score: first.score,
      result: first.result
    });
  } else {
    console.log("No fixtures returned for that filter window.");
  }

  console.log("Saved:");
  console.log(" - data/oddspapi_fixtures_smoke_raw.txt");
  console.log(" - data/oddspapi_fixtures_smoke.json");
}

main().catch(e => { console.error(e); process.exit(1); });
