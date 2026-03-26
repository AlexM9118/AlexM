const el = (id) => document.getElementById(id);

const SAFE_THRESHOLD = 0.62;
const GOALS_LINES = [1.5, 2.5, 3.5, 4.5];
const CORNERS_LINES = [8.5, 9.5, 10.5];
const CARDS_LINES = [3.5, 4.5, 5.5];

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

function pct01(x) {
  if (!Number.isFinite(Number(x))) return "—";
  return `${(Number(x) * 100).toFixed(1)}%`;
}

function oddsFromProb(p) {
  const x = Number(p);
  if (!Number.isFinite(x) || x <= 0) return null;
  return 1 / x;
}

function fmtOdds(x) {
  if (!Number.isFinite(Number(x))) return "—";
  return Number(x).toFixed(2);
}

function uniqBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr || []) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, x);
  }
  return Array.from(m.values());
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

/* odds heuristics */
function pickLikely1X2(markets) {
  for (const m of markets || []) {
    const uniqOutcomeIds = Array.from(new Set((m.outcomes || []).map((o) => o.outcomeId)));
    if (uniqOutcomeIds.length === 3) return m;
  }
  return null;
}
function pickLikelyBTTS(markets) {
  for (const m of markets || []) {
    const uniqOuts = uniqBy(m.outcomes || [], (o) => o.outcomeId);
    if (uniqOuts.length !== 2) continue;
    const prices = uniqOuts.map((o) => o.price).filter((x) => typeof x === "number");
    if (prices.length !== 2) continue;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min >= 1.15 && max <= 3.8) return m;
  }
  return null;
}

/* Poisson */
function factorial(n) { let f = 1; for (let i=2;i<=n;i++) f*=i; return f; }
function poissonPMF(k, lambda) { return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k); }
function poissonCDF(k, lambda) { let s=0; for (let i=0;i<=k;i++) s+=poissonPMF(i,lambda); return s; }
function probTotalOver(line, lambdaTotal) {
  const threshold = Math.floor(line) + 1;
  return 1 - poissonCDF(threshold - 1, lambdaTotal);
}
function probBTTS(lh, la) {
  const pH0 = Math.exp(-lh);
  const pA0 = Math.exp(-la);
  const p00 = Math.exp(-(lh+la));
  return 1 - pH0 - pA0 + p00;
}
function safeAvg(a,b){
  const x=Number(a), y=Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (x+y)/2;
}
function estGoals(entry){
  const hs = entry?.homeStats, as = entry?.awayStats;
  if (!hs || !as) return null;
  if ((hs.homeMatches||0) < 1 || (as.awayMatches||0) < 1) return null;
  const lh = safeAvg(hs.homeGF, as.awayGA);
  const la = safeAvg(as.awayGF, hs.homeGA);
  if (!Number.isFinite(lh) || !Number.isFinite(la)) return null;
  return { lh, la, lt: lh+la };
}
function estCorners(entry){
  const hs = entry?.homeStats, as = entry?.awayStats;
  if (!hs || !as) return null;
  const lh = safeAvg(hs.homeCornersFor, as.awayCornersAgainst);
  const la = safeAvg(as.awayCornersFor, hs.homeCornersAgainst);
  if (!Number.isFinite(lh) || !Number.isFinite(la)) return null;
  if (lh===0 && la===0) return null;
  return { lt: lh+la };
}
function estCards(entry){
  const hs = entry?.homeStats, as = entry?.awayStats;
  if (!hs || !as) return null;
  const lh = safeAvg(hs.homeYCFor, as.awayYCAgainst);
  const la = safeAvg(as.awayYCFor, hs.homeYCAgainst);
  if (!Number.isFinite(lh) || !Number.isFinite(la)) return null;
  if (lh===0 && la===0) return null;
  return { lt: lh+la };
}

/* UI state */
let UI = { index:null, leagues:[], matches:[] };
let HIST = null;
let current = { leagueId:null, day:null, fixtureId:null };

function getHistEntry(fixtureId){
  return HIST?.byFixtureId?.[String(fixtureId)] || null;
}

async function loadAll(){
  setStatus("Loading...");
  UI.index = await getJson("./data/ui/index.json");
  const leaguesObj = await getJson("./data/ui/leagues.json");
  const matchesObj = await getJson("./data/ui/matches.json");
  HIST = await getJson("./data/ui/history_stats.json");

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

  current.leagueId = UI.leagues[0]?.id || null;
  current.day = UI.index.days?.[0] || null;

  setStatus("Ready");
}

function renderLeagueSel(){
  const sel = el("leagueSel");
  sel.innerHTML = "";
  const list = UI.leagues.slice().sort((a,b)=>(a.categoryName+a.name).localeCompare(b.categoryName+b.name));
  for (const l of list){
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.categoryName ? `${l.categoryName} - ${l.name}` : l.name;
    sel.appendChild(opt);
  }
  sel.value = current.leagueId || list[0]?.id;
}

function renderDaySel(){
  const sel = el("daySel");
  sel.innerHTML = "";
  for (const d of (UI.index.days || [])){
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  }
  sel.value = current.day || UI.index.days?.[0];
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
    box.innerHTML = `<div class="muted">No matches for selected filters.</div>`;
    return;
  }

  for (const m of list){
    const div = document.createElement("div");
    div.className = "match-item" + (m.fixtureId === current.fixtureId ? " active":"");
    div.innerHTML = `<div class="teams">${m.home} vs ${m.away}</div><div class="meta">${m.tournamentName} • ${fmtTime(m.startTime)}</div>`;
    div.addEventListener("click", async () => {
      current.fixtureId = m.fixtureId;
      renderMatchesList();
      await loadAndRenderMatch();
    });
    box.appendChild(div);
  }

  if (!current.fixtureId && list[0]?.fixtureId){
    current.fixtureId = list[0].fixtureId;
  }
}

function setTabs(){
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
    });
  });
}

function bar(labelLeft, p, labelRight){
  const div = document.createElement("div");
  div.className = "bar";

  const top = document.createElement("div");
  top.className = "bar-top";
  top.innerHTML = `<div>${labelLeft}</div><div>${labelRight}</div>`;

  const sub = document.createElement("div");
  sub.className = "bar-sub";
  sub.innerHTML = `<div>p=${pct01(p)}</div><div>odds≈${fmtOdds(oddsFromProb(p))}</div>`;

  const meter = document.createElement("div");
  meter.className = "meter";
  const fill = document.createElement("div");
  fill.style.width = `${Math.max(0, Math.min(100, p*100))}%`;
  meter.appendChild(fill);

  div.appendChild(top);
  div.appendChild(sub);
  div.appendChild(meter);
  return div;
}

function renderModelPanels(entry){
  // goals
  const goalsBox = el("goalsBox"); goalsBox.innerHTML = "";
  const bttsBox = el("bttsBox"); bttsBox.innerHTML = "";
  const cornersBox = el("cornersBox"); cornersBox.innerHTML = "";
  const cardsBox = el("cardsBox"); cardsBox.innerHTML = "";

  const goals = estGoals(entry);
  if (goals){
    for (const L of GOALS_LINES){
      const pOver = probTotalOver(L, goals.lt);
      const pUnder = 1 - pOver;
      const best = Math.max(pOver, pUnder);
      const rec = pOver >= pUnder ? "Over" : "Under";
      goalsBox.appendChild(bar(`Total Goals ${L} — ${rec}`, best, best >= SAFE_THRESHOLD ? "SAFE" : "AVOID"));
    }
    const pYes = probBTTS(goals.lh, goals.la);
    const pNo = 1 - pYes;
    const best = Math.max(pYes, pNo);
    const rec = pYes >= pNo ? "Yes" : "No";
    bttsBox.appendChild(bar(`BTTS — ${rec}`, best, best >= SAFE_THRESHOLD ? "SAFE" : "AVOID"));
    el("modelNote").textContent = `Goals λT≈${goals.lt.toFixed(2)} (λH≈${goals.lh.toFixed(2)} λA≈${goals.la.toFixed(2)})`;
  } else {
    goalsBox.innerHTML = `<div class="muted small">Model goals unavailable (insufficient last5 samples).</div>`;
    bttsBox.innerHTML = `<div class="muted small">BTTS model unavailable.</div>`;
  }

  const corners = estCorners(entry);
  if (corners){
    el("cornersHint").textContent = `λT≈${corners.lt.toFixed(2)} (from corners stats)`;
    for (const L of CORNERS_LINES){
      const pOver = probTotalOver(L, corners.lt);
      const pUnder = 1 - pOver;
      const best = Math.max(pOver, pUnder);
      const rec = pOver >= pUnder ? "Over" : "Under";
      cornersBox.appendChild(bar(`Corners ${L} — ${rec}`, best, best >= SAFE_THRESHOLD ? "SAFE" : "AVOID"));
    }
  } else {
    el("cornersHint").textContent = "No corners data in CSV (or zeros).";
    cornersBox.innerHTML = `<div class="muted small">N/A</div>`;
  }

  const cards = estCards(entry);
  if (cards){
    el("cardsHint").textContent = `λT≈${cards.lt.toFixed(2)} (from cards stats)`;
    for (const L of CARDS_LINES){
      const pOver = probTotalOver(L, cards.lt);
      const pUnder = 1 - pOver;
      const best = Math.max(pOver, pUnder);
      const rec = pOver >= pUnder ? "Over" : "Under";
      cardsBox.appendChild(bar(`Cards ${L} — ${rec}`, best, best >= SAFE_THRESHOLD ? "SAFE" : "AVOID"));
    }
  } else {
    el("cardsHint").textContent = "No cards data in CSV (or zeros).";
    cardsBox.innerHTML = `<div class="muted small">N/A</div>`;
  }
}

async function renderRecommendation(day){
  const recTitle = el("recTitle");
  const recSub = el("recSub");
  const recList = el("recList");

  recTitle.textContent = `Ziua: ${day}`;
  recSub.textContent = `Selecții doar dacă p ≥ ${(SAFE_THRESHOLD*100).toFixed(0)}%.`;
  recList.innerHTML = "";

  const list = UI.matches.filter(m => String(m.day) === String(day));
  const picks = [];

  for (const m of list){
    const entry = getHistEntry(m.fixtureId);
    const goals = estGoals(entry);
    if (!goals) continue;

    // BTTS
    const pYes = probBTTS(goals.lh, goals.la);
    const pNo = 1 - pYes;
    const best = Math.max(pYes, pNo);
    if (best >= SAFE_THRESHOLD){
      picks.push({ fixtureId: m.fixtureId, match: `${m.home} vs ${m.away}`, market: "BTTS", sel: (pYes>=pNo)?"YES":"NO", p: best });
    }

    // Goals lines
    for (const L of GOALS_LINES){
      const pOver = probTotalOver(L, goals.lt);
      const pUnder = 1 - pOver;
      const best2 = Math.max(pOver, pUnder);
      if (best2 >= SAFE_THRESHOLD){
        picks.push({ fixtureId: m.fixtureId, match: `${m.home} vs ${m.away}`, market: `Goals ${L}`, sel: (pOver>=pUnder)?"OVER":"UNDER", p: best2 });
      }
    }
  }

  picks.sort((a,b)=>b.p-a.p);
  const top = picks.slice(0, 6);

  el("recCount").textContent = String(top.length);

  if (!top.length){
    el("recAvgP").textContent = "—";
    el("recFairOdds").textContent = "—";
    el("recNote").textContent = "No SAFE picks for this day.";
    return;
  }

  const avgP = top.reduce((s,x)=>s+x.p,0) / top.length;
  el("recAvgP").textContent = pct01(avgP);

  // fair combined odds = product(1/p)
  let fair = 1;
  for (const x of top) fair *= oddsFromProb(x.p);
  el("recFairOdds").textContent = fmtOdds(fair);

  // build cards (need fixturePath)
  for (const p of top){
    let link = null;
    try {
      const fx = await getJson(`./data/ui/match/${p.fixtureId}.json`);
      link = fx.fixturePath || null;
    } catch {}

    const div = document.createElement("div");
    div.className = "pick";

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "pick-title";
    title.textContent = `${p.match}`;

    const meta = document.createElement("div");
    meta.className = "pick-meta";
    meta.textContent = `${p.market}: ${p.sel} • p=${pct01(p.p)} • odds≈${fmtOdds(oddsFromProb(p.p))}`;

    left.appendChild(title);
    left.appendChild(meta);

    const right = document.createElement("div");
    right.className = "pick-right";
    right.innerHTML = `<div class="p">${pct01(p.p)}</div>`;
    if (link){
      const a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = "Open";
      right.appendChild(a);
    }

    const topRow = document.createElement("div");
    topRow.className = "pick-top";
    topRow.appendChild(left);
    topRow.appendChild(right);

    div.appendChild(topRow);
    recList.appendChild(div);
  }

  el("recNote").textContent = "Odds≈ sunt fair odds din model (1/p), nu cotele Superbet.";
}

async function loadAndRenderMatch(){
  if (!current.fixtureId) return;

  const m = UI.matches.find(x => x.fixtureId === current.fixtureId);
  const fx = await getJson(`./data/ui/match/${current.fixtureId}.json`);

  el("matchTitle").textContent = `${fx.home || m.home} vs ${fx.away || m.away}`;
  el("matchMeta").textContent = `${fx.categoryName || m.categoryName} • ${fx.tournamentName || m.tournamentName} • ${fmtTime(fx.startTime || m.startTime)}`;
  const href = fx.fixturePath || "#";
  el("openBookBtn").href = href;
  el("openBookBtn").style.opacity = href === "#" ? "0.5" : "1";

  // odds panels (small)
  const markets = fx.markets || [];
  const m1x2 = pickLikely1X2(markets);
  if (m1x2){
    const outs = uniqBy(m1x2.outcomes || [], o=>o.outcomeId).slice(0,3);
    renderRows("market1x2", outs.map((o,i)=>({ label: i===0?"Home":i===1?"Draw":"Away", value: String(o.price ?? "—") })));
  } else renderRows("market1x2", []);

  const mb = pickLikelyBTTS(markets);
  if (mb){
    const outs = uniqBy(mb.outcomes || [], o=>o.outcomeId).slice(0,2).sort((a,b)=>(a.price??9e9)-(b.price??9e9));
    renderRows("marketBtts", [
      { label:"Yes", value:String(outs[0]?.price ?? "—") },
      { label:"No",  value:String(outs[1]?.price ?? "—") }
    ]);
  } else renderRows("marketBtts", []);

  // raw
  const used = new Set();
  renderOtherMarkets(markets, used);

  // model panels
  const entry = getHistEntry(current.fixtureId);
  renderModelPanels(entry);

  // history panels on right
  const hs = entry?.homeStats;
  const as = entry?.awayStats;
  if (hs && as){
    renderRows("histHome", [
      { label:`Home matches (last ${HIST.lookback||5})`, value:String(hs.homeMatches ?? "—") },
      { label:"GF(home)", value:fmtNum(hs.homeGF,2) },
      { label:"GA(home)", value:fmtNum(hs.homeGA,2) },
      { label:"Corners For", value:fmtNum(hs.homeCornersFor,2) },
      { label:"YC For", value:fmtNum(hs.homeYCFor,2) }
    ]);
    renderRows("histAway", [
      { label:`Away matches (last ${HIST.lookback||5})`, value:String(as.awayMatches ?? "—") },
      { label:"GF(away)", value:fmtNum(as.awayGF,2) },
      { label:"GA(away)", value:fmtNum(as.awayGA,2) },
      { label:"Corners For", value:fmtNum(as.awayCornersFor,2) },
      { label:"YC For", value:fmtNum(as.awayYCFor,2) }
    ]);
    el("histHomeNote").textContent = entry.footballDataId ? `League: ${entry.footballDataId}` : "";
    el("histAwayNote").textContent = entry.footballDataId ? `League: ${entry.footballDataId}` : "";
  } else {
    renderRows("histHome", []);
    renderRows("histAway", []);
    el("histHomeNote").textContent = entry?.note || "No stats for this match.";
    el("histAwayNote").textContent = entry?.note || "No stats for this match.";
  }
}

async function init(){
  try{
    await loadAll();

    renderLeagueSel();
    renderDaySel();
    setTabs();

    // initial list
    renderMatchesList();

    // pick first match
    const list = filteredMatches();
    if (!current.fixtureId && list[0]?.fixtureId) current.fixtureId = list[0].fixtureId;
    renderMatchesList();

    await renderRecommendation(current.day);
    await loadAndRenderMatch();

    el("leagueSel").addEventListener("change", async () => {
      current.leagueId = el("leagueSel").value;
      current.fixtureId = null;
      renderMatchesList();
      const list2 = filteredMatches();
      if (list2[0]?.fixtureId) current.fixtureId = list2[0].fixtureId;
      renderMatchesList();
      await loadAndRenderMatch();
    });

    el("daySel").addEventListener("change", async () => {
      current.day = el("daySel").value;
      current.fixtureId = null;
      renderMatchesList();
      const list2 = filteredMatches();
      if (list2[0]?.fixtureId) current.fixtureId = list2[0].fixtureId;
      renderMatchesList();
      await renderRecommendation(current.day);
      await loadAndRenderMatch();
    });

    el("refreshBtn").addEventListener("click", async () => {
      current.fixtureId = null;
      await loadAll();
      renderLeagueSel();
      renderDaySel();
      renderMatchesList();
      const list2 = filteredMatches();
      if (list2[0]?.fixtureId) current.fixtureId = list2[0].fixtureId;
      renderMatchesList();
      await renderRecommendation(current.day);
      await loadAndRenderMatch();
    });

  } catch(e){
    setStatus(e.message || String(e), false);
  }
}

init();
