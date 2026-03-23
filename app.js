const el = (id) => document.getElementById(id);

function setStatus(text, ok = true) {
  el("statusText").textContent = text;
  el("statusDot").style.background = ok ? "var(--accent)" : "var(--bad)";
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
  box.innerHTML = "";

  if (!rows || !rows.length) {
    box.innerHTML = `<div class="muted">—</div>`;
    return;
  }

  for (const r of rows) {
    const div = document.createElement("div");
    div.className = "row";
    div.innerHTML = `<div class="k">${r.label}</div><div class="v">${r.value}</div>`;
    box.appendChild(div);
  }
}

function renderOtherMarkets(markets, usedMarketIds) {
  const box = el("marketOther");
  const rest = (markets || []).filter((m) => !usedMarketIds.has(String(m.marketId)));

  if (!rest.length) {
    box.textContent = "—";
    return;
  }

  const lines = [];
  for (const m of rest.slice(0, 60)) {
    const uniqOuts = uniqBy(m.outcomes || [], (o) => o.outcomeId);
    const prices = uniqOuts.slice(0, 6).map((o) => o.price).filter((x) => x != null);
    lines.push(`Market ${m.marketId}: [${prices.join(", ")}]`);
  }
  if (rest.length > 60) lines.push(`… plus ${rest.length - 60} more markets`);
  box.textContent = lines.join("\n");
}

/**
 * Config manual (opțional):
 * Dacă identifici un marketId care e mereu Total Goals O/U, îl poți seta aici.
 * Exemplu: const PREFERRED_OU_MARKET_ID = "1012";
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

// BTTS (heuristic): piață 2-way cu cote “normale” (nu extreme)
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

// Toate piețele 2-way
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

  // Preferăm piețe mai “balanced”
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
  box.innerHTML = "";

  const list = filteredMatches();

  if (!list.length) {
    box.innerHTML = `<div class="muted">Nu există meciuri pentru liga/ziua selectată.</div>`;
    return;
  }

  for (const m of list) {
    const div = document.createElement("div");
    div.className = "match-item" + (m.fixtureId === current.fixtureId ? " active" : "");
    div.addEventListener("click", () => {
      current.fixtureId = m.fixtureId;
      renderMatchesList();
      loadAndRenderMatch().catch((e) => setStatus(e.message || String(e), false));
    });

    div.innerHTML = `
      <div class="teams">${m.home} vs ${m.away}</div>
      <div class="meta">${m.tournamentName} • ${fmtTime(m.startTime)}</div>
    `;
    box.appendChild(div);
  }

  if (!current.fixtureId && list[0]?.fixtureId) {
    current.fixtureId = list[0].fixtureId;
    renderMatchesList();
  }
}

async function loadAndRenderMatch() {
  if (!current.fixtureId) {
    el("matchTitle").textContent = "Alege un meci";
    el("matchMeta").textContent = "—";
    el("openBookBtn").setAttribute("href", "#");
    renderRows("market1x2", []);
    renderRows("marketBtts", []);
    renderRows("marketOu", []);
    el("marketOther").textContent = "—";
    return;
  }

  setStatus("Loading match...");

  const m = UI.matches.find((x) => x.fixtureId === current.fixtureId);
  const data = await getJson(`./data/ui/match/${current.fixtureId}.json`);

  el("matchTitle").textContent = `${data.home || m.home} vs ${data.away || m.away}`;
  el("matchMeta").textContent =
    `${data.categoryName || m.categoryName} • ${data.tournamentName || m.tournamentName} • ${fmtTime(data.startTime || m.startTime)}`;

  const href = data.fixturePath || "#";
  el("openBookBtn").setAttribute("href", href);
  el("openBookBtn").style.opacity = href === "#" ? "0.5" : "1";

  const markets = data.markets || [];
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
      { label: "No", value: outs<source_id data="1" title="chat-️ Interfață fișier Excel.txt" />?.price != null ? String(outs<source_id data="1" title="chat-️ Interfață fișier Excel.txt" />.price) : "—" }
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
      { label: `Market ${ouMarket.marketId} • Option B`, value: outs<source_id data="1" title="chat-️ Interfață fișier Excel.txt" />?.price != null ? String(outs<source_id data="1" title="chat-️ Interfață fișier Excel.txt" />.price) : "—" }
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

    el("leagueSel").addEventListener("change", () => {
      current.leagueId = el("leagueSel").value;
      current.fixtureId = null;
      renderMatchesList();
      loadAndRenderMatch().catch((e) => setStatus(e.message || String(e), false));
    });

    el("daySel").addEventListener("change", () => {
      current.day = el("daySel").value;
      current.fixtureId = null;
      renderMatchesList();
      loadAndRenderMatch().catch((e) => setStatus(e.message || String(e), false));
    });

    el("refreshBtn").addEventListener("click", async () => {
      current.fixtureId = null;
      await loadUiData();
      renderLeagueSelect();
      renderDaySelect();
      renderMatchesList();
      await loadAndRenderMatch();
    });
  } catch (e) {
    setStatus(e.message || String(e), false);
  }
}

init();
