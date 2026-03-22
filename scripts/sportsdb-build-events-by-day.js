// scripts/sportsdb-build-events-by-day.js
// Downloads TheSportsDB events by day for Soccer and saves JSON files:
// data/events_by_day/YYYY-MM-DD.json
// data/events_by_day/index.json

const fs = require("fs");
const path = require("path");

const DAYS_AHEAD = 5;

// Put your V1 key here if you want (not recommended for public repos).
// Better: set env SPORTSDB_V1_KEY in GitHub Actions secrets.
const KEY = process.env.SPORTSDB_V1_KEY || "123";

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function todayUTCDate() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(d, n) {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

function toISODateUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "cps-oracle-pro/1.0" } });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}\n${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  const outDir = path.join(process.cwd(), "data", "events_by_day");
  ensureDir(outDir);

  const start = todayUTCDate();
  const days = [];

  console.log(`Downloading TheSportsDB eventsday for Soccer (today + ${DAYS_AHEAD} days) ...`);
  console.log(`Using V1 key: ${KEY}`);

  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const d = addDays(start, i);
    const iso = toISODateUTC(d);
    days.push(iso);

    const url = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(KEY)}/eventsday.php?d=${encodeURIComponent(iso)}&s=Soccer`;

    console.log(`Fetch: ${iso}`);
    const data = await fetchJson(url);

    fs.writeFileSync(
      path.join(outDir, `${iso}.json`),
      JSON.stringify(data, null, 2),
      "utf8"
    );

    const count = (data.events || []).length;
    console.log(`  saved data/events_by_day/${iso}.json (events: ${count})`);
  }

  fs.writeFileSync(
    path.join(outDir, "index.json"),
    JSON.stringify(
      {
        generatedAtUTC: new Date().toISOString(),
        days,
        daysAhead: DAYS_AHEAD
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
