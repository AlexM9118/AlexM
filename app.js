const el = (id) => document.getElementById(id);

function setStatus(text, ok = true) {
  const t = el("statusText");
  const d = el("statusDot");
  if (t) t.textContent = text;
  if (d) d.style.background = ok ? "var(--accent)" : "var(--bad)";
}

async function getJson(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return r.json();
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = String(iso).replace(".000Z", "Z");
  return d.replace("T", " ").replace("Z", " UTC");
}

function uniqBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr || []) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, x);
  }
  return Array.from(m.values());
}

function byStr(a, b) {
  return String(a).localeCompare(String(b));
}

function fmtNum(x, digits = 2) {
  if (x == null || !Number.isFinite(Number(x))) return "—";
  return Number(x).toFixed(digits);
}

function pct01(x) {
  if (x == null || !Number.isFinite(Number(x))) return "—";
  return `${(Number(x) * 100).toFixed(1)}%`;
}

function renderRows(containerId, rows) {
  const box = el(containerId);
  if (!box) return;

  box.innerHTML = "";
  if (!rows || !rows.length) {
    const d = document.createElement("div");
    d.className = "muted";
    d.textContent = "—";
    box.appendChild(d);
    return;
  }

  for (const r of rows) {
    const row = document.createElement("div");
    row.className = "row";

    const k = document.createElement("div");
    k.className = "k";
    k.textContent = r.label;

    const v = document.createElement("div");
    v.className = "v";
    v.textContent = r.value;

    row.appendChild(k);
    row.appendChild(v);
    box.appendChild(row);
  }
}

function renderOtherMarkets(markets, usedMarketIds) {
  const box = el("marketOther");
  if (!box) return;

  const rest = (markets || []).filter((m) => !usedMarketIds.has(String(m.marketId)));
  if (!rest.length) {
    box.textContent = "—";
    return;
  }

  const lines = [];
  for (const m of rest.slice(0, 60)) {
    const uniqOuts = uniqBy(m.outcomes || [], (o) => o.outcomeId);
    const prices = uniqOuts
      .slice(0, 6)
      .map((o) => o.price)
      .filter((x) => x != null);

    lines.push(`Market ${m.marketId}: [${prices.join(", ")}]`);
  }
  if (rest.length > 60) lines.push(`… plus ${rest.length - 60} more markets`);
  box.textContent = lines.join("\n");
}

/* -----------------------------
   Odds heuristics (unchanged)
------------------------------ */
function pickLikely1X2(markets) {
  for (const m of markets || []) {
    const uniqOutcomeIds = Array.from(new Set((m.outcomes || []).map((o) => o.outcomeId)));
    if (uniqOutcomeIds.length === 3) return m;
  }
  return null;
}

function pickLikelyBTTS(markets, excludeIds = new Set()) {
  for (const m of markets || []) {
    if (excludeIds.has(String(m.marketId))) continue;

    const uniqOuts = uniqBy(m.outcomes || [], (o) => o.outcomeId);
    const uniqOutcomeIds = Array.from(new Set(uniqOuts.map((o) => o.outcomeId)));
    if (uniqOutcomeIds.length !== 2) continue;

    const prices = uniqOuts.map((o) => o.price).filter((x) => typeof x === "number");
    if (prices.length !== 2) continue;

    const min = Math.min(...prices);
    const max = Math.max(...prices);

    if (min >= 1.15 && max <= 3.8) return m;
  }
  return null;
}

/* -----------------------------
   Poisson model helpers
------------------------------ */
function factorial(n) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}
function poissonPMF(k, lambda) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
function poissonCDF(k, lambda) {
  // P(X <= k)
  let s = 0;
  for (let i = 0; i <= k; i++) s += poissonPMF(i, lambda);
  return s;
}
function probTotalOver(line, lambdaTotal) {
  // Over 2.5 => total >= 3
  const threshold = Math.floor(line) + 1; // 1.5->2, 2.5->3, 3.5->4...
  return 1 - poissonCDF(threshold - 1, lambdaTotal);
}

function safeAvg(a, b) {
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (x + y) / 2;
}

/**
 * Estimate lambdas from last5 stats:
 * home expected goals ≈ avg(home homeGF, away awayGA)
 * away expected goals ≈ avg(away awayGF, home homeGA)
 */
function estimateLambdasFromLast5(entry) {
  const hs = entry?.homeStats;
  const as = entry?.awayStats;
  if (!hs || !as) return null;

  // require some minimal sample
  const minHome = Number(hs.homeMatches || 0);
  const minAway = Number(as.awayMatches || 0);

  if (minHome < 1 || minAway < 1) return null;

  const lamHome = safeAvg(hs.homeGF, as.awayGA);
  const lamAway = safeAvg(as.awayGF, hs.homeGA);

  if (!Number.isFinite(lamHome) || !Number.isFinite(lamAway)) return null;

  return { lamHome, lamAway, lamTotal: lamHome + lamAway, minHome, minAway };
}

/* -----------------------------
   Data + UI state
------------------------------ */
let UI = { index: null, leagues: [], matches: [] };
let HIST = null;

let current = { leagueId: null, day: null, fixtureId: null };

async function loadUiData() {
  setStatus("Loading UI data...");

  const idx = await getJson("./data/ui/index.json");
  const leaguesObj = await getJson("./data/ui/leagues.json");
  const matchesObj = await getJson("./data/ui/matches.json");
  HIST = await getJson("./data/ui/history_stats.json");

  UI.index = idx;

  UI.leagues = (leaguesObj.leagues || []).map((l) => ({
    id: String(l.id),
    name: l.name || l.id,
    categoryName: l.categoryName || ""
  }));

  UI.matches = (matchesObj.matches || []).map((m) => ({
    fixtureId: String(m.fixtureId),
    tournamentId: m.tournamentId != null ? String(m.tournamentId) : null,
    tournamentName: m.tournamentName || "",
    categoryName: m.categoryName || "",
    startTime: m.startTime,
    day: m.day,
    home: m.home || "?",
    away: m.away || "?"
  }));

  current.leagueId = UI.leagues[0]?.id || null;
  current.day = idx.days?.[0] || null;

  setStatus("Ready");
}

function renderLeagueSelect() {
  const sel = el("leagueSel");
  if (!sel) return;

  sel.innerHTML = "";
  const list = UI.leagues.slice().sort((a, b) => byStr(a.categoryName + a.name, b.categoryName + b.name));

  for (const l of list) {
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.categoryName ? `${l.categoryName} - ${l.name}` : l.name;
    sel.appendChild(opt);
  }

  if (current.leagueId) sel.value = current.leagueId;
}

function renderDaySelect() {
  const sel = el("daySel");
  if (!sel) return;

  sel.innerHTML = "";
  const days = UI.index?.days || [];
  for (const d of days) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  }

  if (current.day) sel.value = current.day;
}

function filteredMatches() {
  return UI.matches.filter((m) => {
    if (current.leagueId && String(m.tournamentId) !== String(current.leagueId)) return false;
    if (current.day && String(m.day) !== String(current.day)) return false;
    return true;
  });
}

function renderMatchesList() {
  const box = el("matchesList");
  if (!box) return;

  box.innerHTML = "";
  const list = filteredMatches();

  if (!list.length) {
    const d = document.createElement("div");
    d.className = "muted";
    d.textContent = "Nu există meciuri pentru liga/ziua selectată.";
    box.appendChild(d);
    return;
  }

  for (const m of list) {
    const item = document.createElement("div");
    item.className = "match-item" + (m.fixtureId === current.fixtureId ? " active" : "");
    item.addEventListener("click", () => {
      current.fixtureId = m.fixtureId;
      renderMatchesList();
      loadAndRenderMatch().catch((e) => setStatus(e.message || String(e), false));
    });

    const teams = document.createElement("div");
    teams.className = "teams";
    teams.textContent = `${m.home} vs ${m.away}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${m.tournamentName} • ${fmtTime(m.startTime)}`;

    item.appendChild(teams);
    item.appendChild(meta);
    box.appendChild(item);
  }

  if (!current.fixtureId && list[0]?.fixtureId) {
    current.fixtureId = list[0].fixtureId;
    renderMatchesList();
  }
}

function renderHistoryPanels(fixtureId) {
  const entry = HIST?.byFixtureId?.[String(fixtureId)] || null;

  const homeNote = el("histHomeNote");
  const awayNote = el("histAwayNote");

  if (!entry || !entry.homeStats || !entry.awayStats) {
    renderRows("histHome", []);
    renderRows("histAway", []);
    const msg = entry?.note ? `Note: ${entry.note}` : "No stats available (mapping/team mismatch).";
    if (homeNote) homeNote.textContent = msg;
    if (awayNote) awayNote.textContent = msg;
    return null;
  }

  const hs = entry.homeStats;
  const as = entry.awayStats;

  renderRows("histHome", [
    { label: `Home matches (last ${HIST.lookback || 5})`, value: String(hs.homeMatches ?? "—") },
    { label: "GF (home)", value: fmtNum(hs.homeGF, 2) },
    { label: "GA (home)", value: fmtNum(hs.homeGA, 2) },
    { label: "Corners For (home)", value: fmtNum(hs.homeCornersFor, 2) },
    { label: "Corners Against (home)", value: fmtNum(hs.homeCornersAgainst, 2) },
    { label: "YC For (home)", value: fmtNum(hs.homeYCFor, 2) },
    { label: "YC Against (home)", value: fmtNum(hs.homeYCAgainst, 2) }
  ]);

  renderRows("histAway", [
    { label: `Away matches (last ${HIST.lookback || 5})`, value: String(as.awayMatches ?? "—") },
    { label: "GF (away)", value: fmtNum(as.awayGF, 2) },
    { label: "GA (away)", value: fmtNum(as.awayGA, 2) },
    { label: "Corners For (away)", value: fmtNum(as.awayCornersFor, 2) },
    { label: "Corners Against (away)", value: fmtNum(as.awayCornersAgainst, 2) },
    { label: "YC For (away)", value: fmtNum(as.awayYCFor, 2) },
    { label: "YC Against (away)", value: fmtNum(as.awayYCAgainst, 2) }
  ]);

  const mapInfo = entry.footballDataId ? `League mapping: ${entry.footballDataId}` : "";
  if (homeNote) homeNote.textContent = mapInfo;
  if (awayNote) awayNote.textContent = mapInfo;

  return entry;
}

function renderModelTotals(entry) {
  const noteEl = el("modelTotalsNote");

  if (!entry) {
    renderRows("modelTotals", []);
    if (noteEl) noteEl.textContent = "";
    return;
  }

  const est = estimateLambdasFromLast5(entry);
  if (!est) {
    renderRows("modelTotals", []);
    if (noteEl) noteEl.textContent = "Not enough history samples to compute model (need at least 1 home + 1 away in last 5).";
    return;
  }

  const lines = [1.5, 2.5, 3.5, 4.5];
  const rows = [];

  for (const L of lines) {
    const pOver = probTotalOver(L, est.lamTotal);
    const pUnder = 1 - pOver;
    const rec = (pOver >= pUnder) ? "OVER" : "UNDER";
    const conf = Math.max(pOver, pUnder);

    rows.push({
      label: `Total Goals ${L} — ${rec}`,
      value: `Over ${pct01(pOver)} | Under ${pct01(pUnder)} | Conf ${pct01(conf)}`
    });
  }

  renderRows("modelTotals", rows);

  if (noteEl) {
    noteEl.textContent = `λHome≈${est.lamHome.toFixed(2)}  λAway≈${est.lamAway.toFixed(2)}  λTotal≈${est.lamTotal.toFixed(2)} (based on last5: homeHome=${est.minHome}, awayAway=${est.minAway})`;
  }
}

async function loadAndRenderMatch() {
  if (!current.fixtureId) {
    if (el("matchTitle")) el("matchTitle").textContent = "Alege un meci";
    if (el("matchMeta")) el("matchMeta").textContent = "—";
    if (el("openBookBtn")) el("openBookBtn").setAttribute("href", "#");

    renderRows("market1x2", []);
    renderRows("marketBtts", []);
    renderRows("modelTotals", []);
    if (el("modelTotalsNote")) el("modelTotalsNote").textContent = "";
    if (el("marketOther")) el("marketOther").textContent = "—";
    renderRows("histHome", []);
    renderRows("histAway", []);
    return;
  }

  setStatus("Loading match...");

  const baseMatch = UI.matches.find((x) => x.fixtureId === current.fixtureId);
  const matchData = await getJson(`./data/ui/match/${current.fixtureId}.json`);

  if (el("matchTitle")) el("matchTitle").textContent = `${matchData.home || baseMatch.home} vs ${matchData.away || baseMatch.away}`;
  if (el("matchMeta")) {
    el("matchMeta").textContent =
      `${matchData.categoryName || baseMatch.categoryName} • ` +
      `${matchData.tournamentName || baseMatch.tournamentName} • ` +
      `${fmtTime(matchData.startTime || baseMatch.startTime)}`;
  }

  const href = matchData.fixturePath || "#";
  if (el("openBookBtn")) {
    el("openBookBtn").setAttribute("href", href);
    el("openBookBtn").style.opacity = href === "#" ? "0.5" : "1";
  }

  const markets = matchData.markets || [];
  const used = new Set();

  // 1X2 odds
  const m1x2 = pickLikely1X2(markets);
  if (m1x2) {
    used.add(String(m1x2.marketId));
    const outs = uniqBy(m1x2.outcomes || [], (o) => o.outcomeId).slice(0, 3);
    renderRows("market1x2", outs.map((o, idx) => ({
      label: idx === 0 ? "Home" : idx === 1 ? "Draw" : "Away",
      value: o.price != null ? String(o.price) : "—"
    })));
  } else {
    renderRows("market1x2", []);
  }

  // BTTS odds
  const mbtts = pickLikelyBTTS(markets, used);
  if (mbtts) {
    used.add(String(mbtts.marketId));
    const outs = uniqBy(mbtts.outcomes || [], (o) => o.outcomeId).slice(0, 2);
    outs.sort((a, b) => (a.price ?? 9e9) - (b.price ?? 9e9));
    renderRows("marketBtts", [
      { label: "Yes", value: outs[0]?.price != null ? String(outs[0].price) : "—" },
      { label: "No", value: outs[1]?.price != null ? String(outs[1].price) : "—" }
    ]);
  } else {
    renderRows("marketBtts", []);
  }

  renderOtherMarkets(markets, used);

  // history + model
  const entry = renderHistoryPanels(current.fixtureId);
  renderModelTotals(entry);

  setStatus("Ready");
}

async function init() {
  try {
    await loadUiData();
    renderLeagueSelect();
    renderDaySelect();
    renderMatchesList();
    await loadAndRenderMatch();

    const leagueSel = el("leagueSel");
    const daySel = el("daySel");
    const refreshBtn = el("refreshBtn");

    if (leagueSel) {
      leagueSel.addEventListener("change", () => {
        current.leagueId = leagueSel.value;
        current.fixtureId = null;
        renderMatchesList();
        loadAndRenderMatch().catch((e) => setStatus(e.message || String(e), false));
      });
    }

    if (daySel) {
      daySel.addEventListener("change", () => {
        current.day = daySel.value;
        current.fixtureId = null;
        renderMatchesList();
        loadAndRenderMatch().catch((e) => setStatus(e.message || String(e), false));
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        current.fixtureId = null;
        await loadUiData();
        renderLeagueSelect();
        renderDaySelect();
        renderMatchesList();
        await loadAndRenderMatch();
      });
    }
  } catch (e) {
    setStatus(e.message || String(e), false);
  }
}

init();
