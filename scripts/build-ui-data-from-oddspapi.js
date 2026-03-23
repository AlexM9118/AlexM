const fs = require("fs");
const path = require("path");

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function readJson(p){
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj){
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function safeStr(x){ return String(x ?? "").trim(); }

function getFirstBookmakerKey(fx){
  const bo = fx?.bookmakerOdds || {};
  const keys = Object.keys(bo);
  return keys[0] || null;
}

function extractMarketsNormalized(fx, bookmakerKey){
  const mk = fx?.bookmakerOdds?.[bookmakerKey]?.markets || {};
  const out = [];

  // We don’t know market semantics (1X2, O/U etc.) yet; store raw IDs with prices.
  for (const [marketId, market] of Object.entries(mk)){
    const outcomes = market?.outcomes || {};
    const o2 = [];

    for (const [outcomeId, outcome] of Object.entries(outcomes)){
      const players = outcome?.players || {};
      // Usually only player "0" exists for standard outcomes
      for (const [playerKey, p] of Object.entries(players)){
        if (!p || p.active === false) continue;
        const price = p.price;
        if (price == null) continue;

        o2.push({
          outcomeId: String(outcomeId),
          playerKey: String(playerKey),
          playerName: p.playerName ?? null,
          price: price,
          changedAt: p.changedAt ?? null,
          bookmakerOutcomeId: p.bookmakerOutcomeId ?? null
        });
      }
    }

    // sort by price asc (optional)
    o2.sort((a,b) => (a.price ?? 9e9) - (b.price ?? 9e9));

    out.push({
      marketId: String(marketId),
      bookmakerMarketId: market?.bookmakerMarketId ?? null,
      outcomes: o2
    });
  }

  // stable order: numeric marketId if possible
  out.sort((a,b) => {
    const na = Number(a.marketId), nb = Number(b.marketId);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a.marketId).localeCompare(String(b.marketId));
  });

  return out;
}

function toDayKey(iso){
  // iso: "2026-04-10T19:00:00.000Z"
  return String(iso || "").slice(0, 10);
}

function main(){
  const oddsIndexPath = path.join("data", "oddspapi_odds_index.json");
  const oddsPath = path.join("data", "oddspapi_odds.json");
  const tournamentsPath = path.join("data", "oddspapi_tournaments.json");

  if (!fs.existsSync(oddsIndexPath)) throw new Error(`Missing ${oddsIndexPath}`);
  if (!fs.existsSync(oddsPath)) throw new Error(`Missing ${oddsPath}`);
  if (!fs.existsSync(tournamentsPath)) throw new Error(`Missing ${tournamentsPath}`);

  const oddsIndex = readJson(oddsIndexPath);
  const fixtures = readJson(oddsPath);
  const tournaments = readJson(tournamentsPath);

  // Map tournamentId -> tournament object (name/category)
  const tMap = new Map();
  for (const t of (Array.isArray(tournaments) ? tournaments : [])){
    if (t && t.tournamentId != null) tMap.set(String(t.tournamentId), t);
  }

  // Determine bookmakerKey from first fixture (e.g. "superbet.ro")
  const first = Array.isArray(fixtures) ? fixtures.find(x => x && x.bookmakerOdds) : null;
  const bookmakerKey = first ? getFirstBookmakerKey(first) : null;

  const uiBase = path.join("data", "ui");
  ensureDir(uiBase);
  ensureDir(path.join(uiBase, "match"));

  // Build leagues list from tournamentIds in index (ordered)
  const leagueIds = Array.isArray(oddsIndex.tournamentIds) ? oddsIndex.tournamentIds.map(String) : [];
  const leagues = leagueIds.map(id => {
    const t = tMap.get(String(id));
    return {
      tournamentId: Number(id),
      id: String(id),
      name: t?.tournamentName || `Tournament ${id}`,
      slug: t?.tournamentSlug || null,
      categoryName: t?.categoryName || null,
      categorySlug: t?.categorySlug || null
    };
  });

  // Normalize matches
  const matches = [];
  const daysSet = new Set();

  for (const fx of (Array.isArray(fixtures) ? fixtures : [])){
    if (!fx || !fx.fixtureId) continue;

    const tournamentId = fx.tournamentId != null ? String(fx.tournamentId) : null;
    const t = tournamentId ? tMap.get(tournamentId) : null;

    const startTime = fx.startTime || fx.trueStartTime || null;
    const dayKey = startTime ? toDayKey(startTime) : null;
    if (dayKey) daysSet.add(dayKey);

    const home = fx.participant1Name || null;
    const away = fx.participant2Name || null;

    matches.push({
      fixtureId: String(fx.fixtureId),
      tournamentId: fx.tournamentId ?? null,
      tournamentName: fx.tournamentName || t?.tournamentName || null,
      categoryName: fx.categoryName || t?.categoryName || null,
      startTime: startTime,
      day: dayKey,
      home,
      away,
      hasOdds: !!fx.hasOdds,
      bookmakerKey
    });

    // per-match file (odds normalized)
    if (bookmakerKey){
      const markets = extractMarketsNormalized(fx, bookmakerKey);

      writeJson(path.join(uiBase, "match", `${String(fx.fixtureId)}.json`), {
        fixtureId: String(fx.fixtureId),
        startTime,
        day: dayKey,
        tournamentId: fx.tournamentId ?? null,
        tournamentName: fx.tournamentName || t?.tournamentName || null,
        categoryName: fx.categoryName || t?.categoryName || null,
        home,
        away,
        bookmakerKey,
        fixturePath: fx?.bookmakerOdds?.[bookmakerKey]?.fixturePath || null,
        markets
      });
    }
  }

  // Sort matches by startTime asc
  matches.sort((a,b) => String(a.startTime || "").localeCompare(String(b.startTime || "")));

  const days = Array.from(daysSet).sort((a,b) => b.localeCompare(a)); // newest first

  writeJson(path.join(uiBase, "index.json"), {
    generatedAtUTC: new Date().toISOString(),
    source: "oddspapi",
    bookmaker: safeStr(oddsIndex.bookmaker) || null,
    bookmakerKey,
    oddsFormat: oddsIndex.oddsFormat || null,
    verbosity: oddsIndex.verbosity || null,
    fixturesTotal: oddsIndex.fixturesTotal ?? null,
    days
  });

  writeJson(path.join(uiBase, "leagues.json"), {
    generatedAtUTC: new Date().toISOString(),
    leagues
  });

  writeJson(path.join(uiBase, "matches.json"), {
    generatedAtUTC: new Date().toISOString(),
    matchesCount: matches.length,
    matches
  });

  console.log("Built data/ui/* successfully.");
}

main();
