const el = (id) => document.getElementById(id);

function setStatus(text, ok=true){
  el("statusText").textContent = text;
  el("statusDot").style.background = ok ? "var(--accent)" : "var(--bad)";
}

async function getJson(path){
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return r.json();
}

function fmtTime(iso){
  if (!iso) return "—";
  // "2026-04-10T19:00:00.000Z" -> "2026-04-10 19:00 UTC"
  const d = String(iso).replace(".000Z", "Z");
  return d.replace("T", " ").replace("Z", " UTC");
}

function uniqBy(arr, keyFn){
  const m = new Map();
  for (const x of arr){
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, x);
  }
  return Array.from(m.values());
}

function byStr(a,b){ return String(a).localeCompare(String(b)); }

// Heuristic: find a 3-way market (1X2) by detecting exactly 3 outcomes with distinct prices
function pickLikely1X2(markets){
  for (const m of markets){
    const outs = (m.outcomes || []).filter(o => o.price != null);
    // count unique outcomes (outcomeId)
    const uniqOutcomeIds = Array.from(new Set(outs.map(o => o.outcomeId)));
    if (uniqOutcomeIds.length === 3) return m;
  }
  return null;
}

// Heuristic: find BTTS by 2 outcomes, often "Yes/No" (we don't have labels), just 2 prices
function pickLikelyBTTS(markets){
  for (const m of markets){
    const uniqOutcomeIds = Array.from(new Set((m.outcomes || []).map(o => o.outcomeId)));
    if (uniqOutcomeIds.length === 2) return m;
  }
  return null;
}

// Heuristic: O/U usually has many lines; without labels we can’t be sure.
// We'll just show the first market that has > 4 outcomes.
function pickLikelyOU(markets){
  for (const m of markets){
    const outs = (m.outcomes || []);
    const uniqOutcomeIds = Array.from(new Set(outs.map(o => o.outcomeId)));
    if (uniqOutcomeIds.length >= 6) return m;
  }
  return null;
}

function renderRows(containerId, rows){
  const box = el(containerId);
  box.innerHTML = "";
  if (!rows || !rows.length){
    box.innerHTML = `<div class="muted">—</div>`;
    return;
  }
  for (const r of rows){
    const div = document.createElement("div");
    div.className = "row";
    div.innerHTML = `<div class="k">${r.label}</div><div class="v">${r.value}</div>`;
    box.appendChild(div);
  }
}

function renderOtherMarkets(markets, usedMarketIds){
  const box = el("marketOther");
  const rest = (markets || []).filter(m => !usedMarketIds.has(String(m.marketId)));
  if (!rest.length){
    box.textContent = "—";
    return;
  }

  // show a compact summary: marketId + first few prices
  const lines = [];
  for (const m of rest.slice(0, 40)){
    const prices = (m.outcomes || []).slice(0, 6).map(o => o.price).filter(x => x != null);
    lines.push(`Market ${m.marketId}: [${prices.join(", ")}]`);
  }
  if (rest.length > 40) lines.push(`… plus ${rest.length - 40} more markets`);
  box.textContent = lines.join("\n");
}

let UI = {
  index: null,
  leagues: [],
  matches: [],
  matchById: new Map()
};

let current = {
  leagueId: null,
  day: null,
  fixtureId: null
};

async function loadUiData(){
  setStatus("Loading UI data...");

  const idx = await getJson("./data/ui/index.json");
  const leaguesObj = await getJson("./data/ui/leagues.json");
  const matchesObj = await getJson("./data/ui/matches.json");

  UI.index = idx;
  UI.leagues = (leaguesObj.leagues || []).map(l => ({
    id: String(l.id),
    name: l.name || l.id,
    categoryName: l.categoryName || ""
  }));

  UI.matches = (matchesObj.matches || []).map(m => ({
    fixtureId: String(m.fixtureId),
    tournamentId: m.tournamentId != null ? String(m.tournamentId) : null,
    tournamentName: m.tournamentName || "",
    categoryName: m.categoryName || "",
    startTime: m.startTime,
    day: m.day,
    home: m.home || "?",
    away: m.away || "?"
  }));

  // default selections
  current.leagueId = UI.leagues[0]?.id || null;
  current.day = idx.days?.[0] || null;

  setStatus("Ready");
}

function renderLeagueSelect(){
  const sel = el("leagueSel");
  sel.innerHTML = "";

  for (const l of UI.leagues.sort((a,b)=>byStr(a.categoryName + a.name, b.categoryName + b.name))){
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.categoryName ? `${l.categoryName} - ${l.name}` : l.name;
    sel.appendChild(opt);
  }

  if (current.leagueId) sel.value = current.leagueId;
}

function renderDaySelect(){
  const sel = el("daySel");
  sel.innerHTML = "";

  const days = UI.index?.days || [];
  for (const d of days){
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  }

  if (current.day) sel.value = current.day;
}

function filteredMatches(){
  return UI.matches.filter(m => {
    if (current.leagueId && String(m.tournamentId) !== String(current.leagueId)) return false;
    if (current.day && String(m.day) !== String(current.day)) return false;
    return true;
  });
}

function renderMatchesList(){
  const box = el("matchesList");
  box.innerHTML = "";

  const list = filteredMatches();

  if (!list.length){
    box.innerHTML = `<div class="muted">Nu există meciuri pentru liga/ziua selectată.</div>`;
    return;
  }

  for (const m of list){
    const div = document.createElement("div");
    div.className = "match-item" + (m.fixtureId === current.fixtureId ? " active" : "");
    div.addEventListener("click", () => {
      current.fixtureId = m.fixtureId;
      renderMatchesList();
      loadAndRenderMatch().catch(e => setStatus(e.message || String(e), false));
    });

    div.innerHTML = `
      <div class="teams">${m.home} vs ${m.away}</div>
      <div class="meta">${m.tournamentName} • ${fmtTime(m.startTime)}</div>
    `;
    box.appendChild(div);
  }

  // auto-pick first if none selected
  if (!current.fixtureId && list[0]?.fixtureId){
    current.fixtureId = list[0].fixtureId;
    renderMatchesList();
  }
}

async function loadAndRenderMatch(){
  if (!current.fixtureId){
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

  const m = UI.matches.find(x => x.fixtureId === current.fixtureId);
  const data = await getJson(`./data/ui/match/${current.fixtureId}.json`);

  el("matchTitle").textContent = `${data.home || m.home} vs ${data.away || m.away}`;
  el("matchMeta").textContent = `${data.categoryName || m.categoryName} • ${data.tournamentName || m.tournamentName} • ${fmtTime(data.startTime || m.startTime)}`;

  const href = data.fixturePath || "#";
  el("openBookBtn").setAttribute("href", href);
  el("openBookBtn").style.opacity = href === "#" ? "0.5" : "1";

  const markets = data.markets || [];
  const used = new Set();

  const m1x2 = pickLikely1X2(markets);
  if (m1x2){
    used.add(String(m1x2.marketId));
    const outs = uniqBy(m1x2.outcomes || [], o => o.outcomeId).slice(0,3);
    renderRows("market1x2", outs.map((o, idx) => ({
      label: idx === 0 ? "Home" : idx === 1 ? "Draw" : "Away",
      value: o.price != null ? String(o.price) : "—"
    })));
  } else {
    renderRows("market1x2", []);
  }

  const mb = pickLikelyBTTS(markets);
  if (mb){
    used.add(String(mb.marketId));
    const outs = uniqBy(mb.outcomes || [], o => o.outcomeId).slice(0,2);
    renderRows("marketBtts", outs.map((o, idx) => ({
      label: idx === 0 ? "Yes" : "No",
      value: o.price != null ? String(o.price) : "—"
    })));
  } else {
    renderRows("marketBtts", []);
  }

  const mou = pickLikelyOU(markets);
  if (mou){
    used.add(String(mou.marketId));
    // we don’t have line labels yet, show first 10 outcomes as raw
    const outs = uniqBy(mou.outcomes || [], o => o.bookmakerOutcomeId || (o.outcomeId + ":" + o.playerKey)).slice(0,10);
    renderRows("marketOu", outs.map((o, idx) => ({
      label: `Outcome ${idx+1}`,
      value: o.price != null ? String(o.price) : "—"
    })));
  } else {
    renderRows("marketOu", []);
  }

  renderOtherMarkets(markets, used);

  setStatus("Ready");
}

async function init(){
  try{
    await loadUiData();

    renderLeagueSelect();
    renderDaySelect();
    renderMatchesList();
    await loadAndRenderMatch();

    el("leagueSel").addEventListener("change", () => {
      current.leagueId = el("leagueSel").value;
      current.fixtureId = null;
      renderMatchesList();
      loadAndRenderMatch().catch(e => setStatus(e.message || String(e), false));
    });

    el("daySel").addEventListener("change", () => {
      current.day = el("daySel").value;
      current.fixtureId = null;
      renderMatchesList();
      loadAndRenderMatch().catch(e => setStatus(e.message || String(e), false));
    });

    el("refreshBtn").addEventListener("click", async () => {
      current.fixtureId = null;
      await loadUiData();
      renderLeagueSelect();
      renderDaySelect();
      renderMatchesList();
      await loadAndRenderMatch();
    });

  } catch (e){
    setStatus(e.message || String(e), false);
  }
}

init();
