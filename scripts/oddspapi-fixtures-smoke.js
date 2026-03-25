// scripts/oddspapi-fixtures-smoke.js
// Smoke test OddsPapi /v4/fixtures for FINISHED events (statusId=2)

const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.oddspapi.io";

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function normalizeIso(x, fallback){
  // Accept:
  // - YYYY-MM-DDTHH:MM:SSZ  (ok)
  // - YYYY-MM-DD            (convert to T00:00:00Z)
  // - empty/undefined       (use fallback)
  let s = String(x || "").trim();
  if (!s) s = fallback;

  // If only date, convert
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s}T00:00:00Z`;
  }

  // If missing Z but looks like full timestamp, try add Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) {
    return `${s}Z`;
  }

  return s;
}

function isIso8601Z(s){
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(s||"").trim());
}

async function fetchText(url){
  const r = await fetch(url, { headers: { "user-agent": "alex-ai-bet/1.0" }});
  const text = await r.text();
  return { status: r.status, ok: r.ok, text };
}

async function main(){
  const key = process.env.ODDSPAPI_KEY;
  if (!key) throw new Error("Missing ODDSPAPI_KEY");

  const tournamentId = process.env.TOURNAMENT_ID || "17";

  // Robust defaults
  const from = normalizeIso(process.env.FROM, "2026-03-20T00:00:00Z");
  const to   = normalizeIso(process.env.TO,   "2026-03-22T00:00:00Z");

  if (!isIso8601Z(from)) throw new Error(`FROM is not ISO8601 (YYYY-MM-DDTHH:MM:SSZ): ${from}`);
  if (!isIso8601Z(to))   throw new Error(`TO is not ISO8601 (YYYY-MM-DDTHH:MM:SSZ): ${to}`);

  const statusId = process.env.STATUS_ID || "2";

  const url =
    `${API_BASE}/v4/fixtures` +
    `?tournamentId=${encodeURIComponent(tournamentId)}` +
    `&from=${encodeURIComponent(from)}` +
    `&to=${encodeURIComponent(to)}` +
    `&statusId=${encodeURIComponent(statusId)}` +
    `&apiKey=${encodeURIComponent(key)}`;

  console.log("tournamentId:", tournamentId);
  console.log("from:", from);
  console.log("to:", to);
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

  const data = JSON.parse(text);
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

      // possible score fields (may be undefined):
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
