// scripts/apisports-date-test.js
// Tests API-SPORTS fixtures-by-date and prints rate-limit headers + sample rows.

const API_BASE = "https://v3.football.api-sports.io";

function h(headers, name) {
  return headers.get(name) || headers.get(name.toLowerCase());
}

async function main() {
  const key = process.env.APISPORTS_KEY;
  if (!key) throw new Error("Missing APISPORTS_KEY env var.");

  // change the date you want to test:
  const date = process.env.TEST_DATE || "2026-03-20";

  const url = `${API_BASE}/fixtures?date=${encodeURIComponent(date)}`;

  const res = await fetch(url, {
    headers: { "x-apisports-key": key }
  });

  const rl = {
    perDayLimit: h(res.headers, "x-ratelimit-requests-limit"),
    perDayRemaining: h(res.headers, "x-ratelimit-requests-remaining"),
    perMinLimit: h(res.headers, "X-RateLimit-Limit"),
    perMinRemaining: h(res.headers, "X-RateLimit-Remaining")
  };

  const text = await res.text();

  console.log("HTTP:", res.status);
  console.log("URL:", url);
  console.log("RateLimit:", rl);

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.log("Body (first 800 chars):", text.slice(0, 800));
    throw new Error("Response is not JSON.");
  }

  console.log("results:", data.results);
  console.log("errors:", data.errors);

  const first = data.response?.[0];
  if (!first) {
    console.log("first: null (no fixtures returned for this date)");
    return;
  }

  // Print a small sample
  console.log("SAMPLE 1:");
  console.log({
    fixture_date: first.fixture?.date,
    league_id: first.league?.id,
    league_name: first.league?.name,
    country: first.league?.country,
    home: first.teams?.home?.name,
    away: first.teams?.away?.name,
    status: first.fixture?.status?.long
  });

  // Also print unique league count for that day (useful to know coverage)
  const leagues = new Set((data.response || []).map(x => String(x.league?.id || "")).filter(Boolean));
  console.log("unique_leagues_count:", leagues.size);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
