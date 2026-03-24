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

/**
 * Opțional: dacă descoperi că Total Goals O/U e mereu un marketId (ex: "1012"),
 * setează aici ca să fie stabil.
 */
const PREFERRED_OU_MARKET_ID = null;

// 1X2: piață cu 3 outcomes unice
function pickLikely1X2(markets) {
  for (const m of markets || []) {
    const uniqOutcomeIds = Array.from(new Set((m.outcomes || []).map((o) => o.outcomeId)));
    if (uniqOutcomeIds.length === 3) return m;
  }
  return null;
}

// BTTS (heuristic): piață 2-way cu cote ne-extreme
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

    // evită piețe extreme gen 1.04 vs 12
    if (min >= 1.15 && max <= 3.8) return m;
  }
  return null;
}

// 2-way candidates: potrivite pentru O/U (fără label-uri -> Option A/B)
function twoWayMarkets(markets, excludeIds = new Set()) {
  const out = [];

  for (const m of markets || []) {
    if (excludeIds.has(String(m.marketId))) continue;

    const uniqOuts = uniqBy(m.outcomes || [], (o) => o.outcomeId);
    const uniqOutcomeIds = Array.from(new Set(uniqOuts.map((o) => o.outcomeId)));
    if (uniqOutcomeIds.length !== 2) continue;

    const prices = uniqOuts.map((o) => o.price).filter((x) => typeof x === "number");
    if (prices.length !== 2) continue;

    out.push({ market: m, prices });
  }

  // prefer piețe “balanced”
  out.sort((a, b) => {
    const ra = Math.max(...a.prices) / Math.min(...a.prices);
    const rb = Math.max(...b.prices) / Math.min(...b.prices);
    return ra - rb;
  });

  return out;
}

let UI = {
  index: null,
  leagues: [],
  matches: []
};

let current = {
  leagueId: null,
  day: null,
  fixtureId: null
};

async function loadUiData() {
  setStatus("Loading UI data...");

  const idx = await getJson("./data/ui/index.json");
  const leaguesObj = await getJson("./data/ui/leagues.json");
  const matchesObj = await getJson("./data/ui/matches.json");

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

async function loadAndRenderMatch() {
  if (!current.fixtureId) {
    const t = el("matchTitle");
    const m = el("matchMeta");
    const b = el("openBookBtn");
    if (t) t.textContent = "Alege un meci";
    if (m) m.textContent = "—";
    if (b) b.setAttribute("href", "#");

    renderRows("market1x2", []);
    renderRows("marketBtts", []);
    renderRows("marketOu", []);
    const other = el("marketOther");
    if (other) other.textContent = "—";
    return;
  }

  setStatus("Loading match...");

  const baseMatch = UI.matches.find((x) => x.fixtureId === current.fixtureId);
  const matchData = await getJson(`./data/ui/match/${current.fixtureId}.json`);

  const title = el("matchTitle");
  const meta = el("matchMeta");
  if (title) title.textContent = `${matchData.home || baseMatch.home} vs ${matchData.away || baseMatch.away}`;
  if (meta) {
    meta.textContent =
      `${matchData.categoryName || baseMatch.categoryName} • ` +
      `${matchData.tournamentName || baseMatch.tournamentName} • ` +
      `${fmtTime(matchData.startTime || baseMatch.startTime)}`;
  }

  const btn = el("openBookBtn");
  const href = matchData.fixturePath || "#";
  if (btn) {
    btn.setAttribute("href", href);
    btn.style.opacity = href === "#" ? "0.5" : "1";
  }

  const markets = matchData.markets || [];
  const used = new Set();

  // 1X2
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

  // BTTS
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

  // O/U candidate
  let ouMarket = null;
  if (PREFERRED_OU_MARKET_ID) {
    ouMarket = markets.find((x) => String(x.marketId) === String(PREFERRED_OU_MARKET_ID)) || null;
  }
  if (!ouMarket) {
    const candidates = twoWayMarkets(markets, used);
    ouMarket = candidates[0]?.market || null;
  }

  if (ouMarket) {
    used.add(String(ouMarket.marketId));
    const outs = uniqBy(ouMarket.outcomes || [], (o) => o.outcomeId).slice(0, 2);
    outs.sort((a, b) => (a.price ?? 9e9) - (b.price ?? 9e9));

    renderRows("marketOu", [
      { label: `Market ${ouMarket.marketId} • Option A`, value: outs[0]?.price != null ? String(outs[0].price) : "—" },
      { label: `Market ${ouMarket.marketId} • Option B`, value: outs[1]?.price != null ? String(outs[1].price) : "—" }
    ]);
  } else {
    renderRows("marketOu", []);
  }

  renderOtherMarkets(markets, used);
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
