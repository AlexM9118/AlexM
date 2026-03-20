const fs = require("fs");
const path = require("path");

const DAYS_AHEAD = 5;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
}

function parseISODate(s) {
  const t = String(s || "").trim();
  return isISODate(t) ? t : null;
}

function todayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function withinNextDays(dateStr, daysAhead) {
  // dateStr must be YYYY-MM-DD
  const dt = new Date(`${dateStr}T00:00:00Z`);
  const t0 = todayUTC();
  const t1 = new Date(t0.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  return dt >= t0 && dt <= t1;
}

async function fetchJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "cps-oracle-pro/1.0" } });

  // Make workflow resilient: never crash whole run for one league
  if (r.status === 404) {
    return { __httpStatus: 404, events: [] };
  }

  const text = await r.text();

  if (!r.ok) {
    // return structured error instead of throwing hard
    return { __httpStatus: r.status, __body: text, events: [] };
  }

  try {
    const obj = JSON.parse(text);
    obj.__httpStatus = r.status;
    return obj;
  } catch (e) {
    return { __httpStatus: r.status, __parseError: String(e), __body: text, events: [] };
  }
}

function safeStr(x) {
  return String(x || "").trim();
}

async function main() {
  const key = process.env.SPORTSDB_KEY;
  if (!key) {
    throw new Error("Missing SPORTSDB_KEY env var. Add it in GitHub Secrets (Settings → Secrets → Actions).");
  }

  const cfgPath = path.join(process.cwd(), "scripts", "active-leagues.json");
  if (!fs.existsSync(cfgPath)) {
    throw new Error(`Missing config file: ${cfgPath}`);
  }

  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const leagues = cfg.leagues || [];
  if (!Array.isArray(leagues) || leagues.length === 0) {
    throw new Error("active-leagues.json has no leagues.");
  }

  const outDir = path.join(process.cwd(), "data", "fixtures");
  ensureDir(outDir);

  console.log(`Building fixtures for ${leagues.length} leagues (today + ${DAYS_AHEAD} days)...`);

  for (const l of leagues) {
    const leagueId = safeStr(l.id);
    const leagueName = safeStr(l.name);
    const idLeague = safeStr(l.sportsDbLeagueId);

    if (!leagueId || !idLeague) {
      console.log(`[SKIP] Missing id or sportsDbLeagueId for league: ${JSON.stringify(l)}`);
      continue;
    }

    // If someone accidentally puts non-numeric IDs, we still try, but warn
    if (!/^\d+$/.test(idLeague)) {
      console.log(`[WARN] sportsDbLeagueId for ${leagueId} is not numeric: "${idLeague}" (will still try)`);
    }

    const url = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(key)}/eventsnextleague.php?id=${encodeURIComponent(idLeague)}`;
    console.log(`Fetching fixtures: ${leagueId} (${leagueName}) idLeague=${idLeague}`);

    const data = await fetchJson(url);

    // TheSportsDB may return under different keys; normalize
    const events = data?.events || data?.event || [];

    console.log(`  HTTP ${data.__httpStatus} | events returned: ${Array.isArray(events) ? events.length : 0}`);

    const matches = [];
    if (Array.isArray(events)) {
      for (const ev of events) {
        const date = parseISODate(ev.dateEvent || ev.strDate);
        const home = safeStr(ev.strHomeTeam);
        const away = safeStr(ev.strAwayTeam);

        if (!date || !home || !away) continue;
        if (!withinNextDays(date, DAYS_AHEAD)) continue;

        matches.push({
          id: `${leagueId}_${date}_${home}_vs_${away}`.replace(/\s+/g, "_"),
          date,
          home,
          away
        });
      }
    }

    const out = {
      leagueId,
      leagueName,
      generatedAtUTC: new Date().toISOString(),
      daysAhead: DAYS_AHEAD,
      source: {
        provider: "TheSportsDB",
        endpoint: "eventsnextleague.php",
        idLeague
      },
      matches
    };

    fs.writeFileSync(path.join(outDir, `${leagueId}.json`), JSON.stringify(out, null, 2), "utf8");
    console.log(`  saved: data/fixtures/${leagueId}.json | matches in window: ${matches.length}`);
  }

  console.log("Fixtures done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
