// CPS-ORACLE PRO (Web) — static JSON-driven dashboard
// Poisson model. HT derived from FT via k=0.45 when HT data missing.
// Corners/cards optional (computed from team averages in data/corners|cards).

const HT_FACTOR = 0.45;

// O/U lines
const GOALS_FT_LINES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
const GOALS_HT_LINES = [0.5, 1.5, 2.5, 3.5];

const CORNERS_LINES = [7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5];
const CARDS_LINES   = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];

const UPCOMING_WINDOWS = [3, 5, 7, 14];
const PAST_WINDOWS = [7, 14, 30, 60];

const el = (id) => document.getElementById(id);

function setStatus(text, ok=true){
  el("statusText").textContent = text;
  el("statusDot").style.background = ok ? "var(--accent)" : "var(--bad)";
}

function pct(x){
  if (!isFinite(x)) return "—";
  return `${(x*100).toFixed(1)}%`;
}

async function getJson(path){
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return r.json();
}

// ---------- Range/window helpers ----------
function parseISODate(s){
  const [y,m,d] = String(s).split("-").map(Number);
  return new Date(Date.UTC(y, m-1, d));
}
function todayUTC(){
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function withinRange(matchDateStr, rangeMode, windowDays){
  const dt = parseISODate(matchDateStr);
  const t0 = todayUTC();
  const oneDay = 24*60*60*1000;

  if (rangeMode === "upcoming"){
    const t1 = new Date(t0.getTime() + windowDays*oneDay);
    return dt >= t0 && dt <= t1;
  } else {
    const t1 = new Date(t0.getTime() - windowDays*oneDay);
    return dt <= t0 && dt >= t1;
  }
}
function populateWindowOptions(){
  const rangeMode = el("rangeSel").value;
  const winSel = el("windowSel");
  winSel.innerHTML = "";

  const options = (rangeMode === "upcoming") ? UPCOMING_WINDOWS : PAST_WINDOWS;
  for (const d of options){
    const opt = document.createElement("option");
    opt.value = String(d);
    opt.textContent = `${d} days`;
    winSel.appendChild(opt);
  }

  if (rangeMode === "upcoming" && options.includes(5)) winSel.value = "5";
  else if (rangeMode === "past" && options.includes(30)) winSel.value = "30";
  else winSel.value = String(options[0]);
}

// ---------- Poisson helpers ----------
function factorial(n){
  let f=1;
  for(let i=2;i<=n;i++) f*=i;
  return f;
}
function poissonPMF(k, lambda){
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}
function poissonCDF(k, lambda){
  let s=0;
  for(let i=0;i<=k;i++) s += poissonPMF(i, lambda);
  return s;
}

function scoreMatrix(lambdaHome, lambdaAway, maxG=10){
  const m = [];
  const ph = Array.from({length:maxG+1}, (_,i)=>poissonPMF(i, lambdaHome));
  const pa = Array.from({length:maxG+1}, (_,j)=>poissonPMF(j, lambdaAway));
  for(let i=0;i<=maxG;i++){
    m[i] = [];
    for(let j=0;j<=maxG;j++){
      m[i][j] = ph[i]*pa[j];
    }
  }
  return m;
}
function sumWhere(m, pred){
  let s=0;
  for(let i=0;i<m.length;i++){
    for(let j=0;j<m[i].length;j++){
      if (pred(i,j)) s += m[i][j];
    }
  }
  return s;
}
function prob1X2(m){
  const pH = sumWhere(m, (i,j)=>i>j);
  const pD = sumWhere(m, (i,j)=>i===j);
  const pA = sumWhere(m, (i,j)=>i<j);
  return { pH, pD, pA };
}
function probTotalOver(m, line){
  const threshold = Math.floor(line + 0.5) + 1; // 2.5 -> 3 etc
  return sumWhere(m, (i,j)=>(i+j)>=threshold);
}
function probBTS(m){
  const yes = sumWhere(m, (i,j)=>i>=1 && j>=1);
  return { yes, no: 1-yes };
}
function probHandicapHome(m, handicap){
  const win = sumWhere(m, (i,j)=>(i + handicap) > j);
  const push = sumWhere(m, (i,j)=>(i + handicap) === j);
  const lose = 1 - win - push;
  return { win, push, lose };
}

// ---------- Data loading ----------
async function loadIndex(){
  return getJson("../data/index.json");
}

async function loadLeagueFiles(leagueId){
  const idx = await loadIndex();
  const league = idx.leagues.find(x=>x.id===leagueId);
  if (!league) throw new Error(`League not found: ${leagueId}`);

  const [leagueMeta, matches, history] = await Promise.all([
    getJson(`../data/leagues/${leagueId}.json`),
    getJson(`../data/matches/${leagueId}.json`),
    getJson(`../data/history/${leagueId}.json`)
  ]);

  let corners = null, cards = null;
  if (leagueMeta.features?.corners){
    try { corners = await getJson(`../data/corners/${leagueId}.json`); } catch {}
  }
  if (leagueMeta.features?.cards){
    try { cards = await getJson(`../data/cards/${leagueId}.json`); } catch {}
  }

  return { idx, leagueMeta, matches, history, corners, cards };
}

function unique(arr){ return Array.from(new Set(arr)); }

// ---------- Calibration from history ----------
function buildTeamStats(historyMatches, lookback){
  const byHome = new Map();
  const byAway = new Map();

  for (const r of historyMatches){
    if (!byHome.has(r.home)) byHome.set(r.home, []);
    if (!byAway.has(r.away)) byAway.set(r.away, []);
    byHome.get(r.home).push(r);
    byAway.get(r.away).push(r);
  }

  function avg(arr, sel){
    if (!arr || arr.length===0) return NaN;
    const slice = arr.slice(-lookback);
    let s=0;
    for (const x of slice) s += sel(x);
    return s / slice.length;
  }

  const teams = unique(historyMatches.flatMap(x=>[x.home,x.away]));
  const stats = new Map();

  for (const t of teams){
    const homeArr = (byHome.get(t)||[]).sort((a,b)=>a.date.localeCompare(b.date));
    const awayArr = (byAway.get(t)||[]).sort((a,b)=>a.date.localeCompare(b.date));

    const HomeGF = avg(homeArr, x=>x.fthg);
    const HomeGA = avg(homeArr, x=>x.ftag);
    const AwayGF = avg(awayArr, x=>x.ftag);
    const AwayGA = avg(awayArr, x=>x.fthg);

    // HT if present
    const HomeGF_HT = avg(homeArr, x=> (Number.isFinite(x.hthg) ? x.hthg : 0));
    const HomeGA_HT = avg(homeArr, x=> (Number.isFinite(x.htag) ? x.htag : 0));
    const AwayGF_HT = avg(awayArr, x=> (Number.isFinite(x.htag) ? x.htag : 0));
    const AwayGA_HT = avg(awayArr, x=> (Number.isFinite(x.hthg) ? x.hthg : 0));

    stats.set(t, {
      HomeGF, HomeGA, AwayGF, AwayGA,
      HomeGF_HT, HomeGA_HT, AwayGF_HT, AwayGA_HT
    });
  }
  return stats;
}

function estimateLambdasFT(teamStats, home, away){
  const hs = teamStats.get(home);
  const as = teamStats.get(away);
  if (!hs || !as) return { lamHomeFT: NaN, lamAwayFT: NaN };
  const lamHomeFT = (hs.HomeGF + as.AwayGA) / 2;
  const lamAwayFT = (as.AwayGF + hs.HomeGA) / 2;
  return { lamHomeFT, lamAwayFT };
}

function estimateLambdasHT(teamStats, home, away, lamHomeFT, lamAwayFT){
  // We have HT goals in the dataset; still keep fallback via factor
  const hs = teamStats.get(home);
  const as = teamStats.get(away);
  const hasHT = hs && as && isFinite(hs.HomeGF_HT) && isFinite(as.AwayGA_HT) && isFinite(as.AwayGF_HT) && isFinite(hs.HomeGA_HT);

  if (hasHT){
    const lamHomeHT = (hs.HomeGF_HT + as.AwayGA_HT) / 2;
    const lamAwayHT = (as.AwayGF_HT + hs.HomeGA_HT) / 2;
    return { lamHomeHT, lamAwayHT, usedHTData: true };
  }

  return {
    lamHomeHT: lamHomeFT * HT_FACTOR,
    lamAwayHT: lamAwayFT * HT_FACTOR,
    usedHTData: false
  };
}

function estimateLambdaTotalOptional(optData, home, away){
  // optData format: { teams: { "Team": { for, against } } }
  if (!optData?.teams) return NaN;
  const h = optData.teams[home];
  const a = optData.teams[away];
  if (!h || !a) return NaN;

  // total lambda = expected corners/cards for both teams combined
  const lamHomePart = (h.for + a.against) / 2;
  const lamAwayPart = (a.for + h.against) / 2;
  return lamHomePart + lamAwayPart;
}

// ---------- Rendering ----------
function renderRows(containerId, rows){
  const box = el(containerId);
  box.innerHTML = "";
  for (const r of rows){
    const div = document.createElement("div");
    div.className = "row";
    div.innerHTML = `<div class="l">${r.label}</div><div class="r">${r.value}</div>`;
    box.appendChild(div);
  }
}

function renderTips(tips){
  const box = el("tips");
  box.innerHTML = "";
  if (!tips.length){
    box.innerHTML = `<div class="tip"><div class="tip-title">No tips</div><div class="tip-meta">No market passed thresholds.</div></div>`;
    return;
  }
  for (const t of tips){
    const div = document.createElement("div");
    div.className = "tip";
    div.innerHTML = `
      <div class="tip-top">
        <div>
          <div class="tip-title">${t.title}</div>
          <div class="tip-meta">${t.reason}</div>
        </div>
        <div class="tag ${t.tagClass}">${t.tag}</div>
      </div>
      <div class="row" style="margin-top:4px;">
        <div class="l">Probability</div>
        <div class="r">${pct(t.p)}</div>
      </div>`;
    box.appendChild(div);
  }
}

function buildTips(mode, probs){
  const safeP = 0.62;
  const aggP  = 0.55;
  const thr = (mode === "safe") ? safeP : aggP;

  const leanBand = 0.03;
  const tips = [];

  function add(title, p, reason){
    let tag="AVOID", tagClass="avoid";
    if (p >= thr){ tag="BET"; tagClass="bet"; }
    else if (p >= thr - leanBand){ tag="LEAN"; tagClass="lean"; }
    tips.push({ title, p, reason, tag, tagClass });
  }

  // FT
  add("FT 1X2: HOME", probs.ft1x2.pH, "Poisson FT: P(Home win)");
  add("FT 1X2: DRAW", probs.ft1x2.pD, "Poisson FT: P(Draw)");
  add("FT 1X2: AWAY", probs.ft1x2.pA, "Poisson FT: P(Away win)");

  add("FT DC: 1X", probs.ftDC.p1X, "P(Home or Draw)");
  add("FT DC: 12", probs.ftDC.p12, "P(Home or Away)");
  add("FT DC: X2", probs.ftDC.pX2, "P(Draw or Away)");

  for (const l of GOALS_FT_LINES){
    add(`FT Over ${l}`, probs.ftOU[`O${l}`], `P(total goals > ${l})`);
    add(`FT Under ${l}`, probs.ftOU[`U${l}`], `P(total goals <= ${l})`);
  }

  add("FT BTS: YES", probs.ftBTS.yes, "P(both teams score)");
  add("FT BTS: NO", probs.ftBTS.no, "P(not both teams score)");

  // HT
  add("HT 1X2: HOME", probs.ht1x2.pH, "Poisson HT: P(Home win)");
  add("HT 1X2: DRAW", probs.ht1x2.pD, "Poisson HT: P(Draw)");
  add("HT 1X2: AWAY", probs.ht1x2.pA, "Poisson HT: P(Away win)");

  add("HT DC: 1X", probs.htDC.p1X, "P(Home or Draw)");
  add("HT DC: 12", probs.htDC.p12, "P(Home or Away)");
  add("HT DC: X2", probs.htDC.pX2, "P(Draw or Away)");

  for (const l of GOALS_HT_LINES){
    add(`HT Over ${l}`, probs.htOU[`O${l}`], `P(HT goals > ${l})`);
    add(`HT Under ${l}`, probs.htOU[`U${l}`], `P(HT goals <= ${l})`);
  }

  add("HT BTS: YES", probs.htBTS.yes, "P(both score in HT)");
  add("HT BTS: NO", probs.htBTS.no, "P(not both score in HT)");

  // Handicap examples (FT)
  add("FT Home -0.5", probs.ftHcap["H-0.5"].win, "P(Home wins)");
  add("FT Home -1.0 (win)", probs.ftHcap["H-1.0"].win, "P(Home wins by 2+)");
  add("FT Away +0.5", probs.ftHcap["A+0.5"].win, "P(Away win or Draw)");

  // Optional corners/cards
  if (isFinite(probs.corners?.lamTotal)){
    for (const l of CORNERS_LINES){
      add(`Corners Over ${l}`, probs.corners.ou[`O${l}`], `Poisson total corners`);
      add(`Corners Under ${l}`, probs.corners.ou[`U${l}`], `Poisson total corners`);
    }
  }
  if (isFinite(probs.cards?.lamTotal)){
    for (const l of CARDS_LINES){
      add(`Cards Over ${l}`, probs.cards.ou[`O${l}`], `Poisson total cards`);
      add(`Cards Under ${l}`, probs.cards.ou[`U${l}`], `Poisson total cards`);
    }
  }

  return tips
    .filter(t => t.tag !== "AVOID")
    .sort((a,b)=>b.p-a.p)
    .slice(0, 10);
}

// ---------- Orchestration ----------
let currentLeagueId = null;
let cache = {};

async function populateLeagues(){
  setStatus("Loading leagues...");
  const idx = await loadIndex();
  const leagueSel = el("leagueSel");
  leagueSel.innerHTML = "";
  for (const l of idx.leagues){
    const opt = document.createElement("option");
    opt.value = l.id;
    opt.textContent = l.name;
    leagueSel.appendChild(opt);
  }
  leagueSel.value = idx.defaultLeagueId || idx.leagues[0]?.id;
  setStatus("Ready");
}

async function onLeagueChange(){
  const leagueId = el("leagueSel").value;
  currentLeagueId = leagueId;

  setStatus(`Loading ${leagueId}...`);
  const bundle = await loadLeagueFiles(leagueId);
  cache[leagueId] = bundle;

  const rangeMode = el("rangeSel").value;
  const windowDays = parseInt(el("windowSel").value, 10);

  const all = bundle.matches.matches;
  const filtered = all.filter(m => withinRange(m.date, rangeMode, windowDays));
  const list = filtered.length ? filtered : all;

  const matchSel = el("matchSel");
  matchSel.innerHTML = "";
  for (const m of list){
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.home} vs ${m.away} (${m.date})`;
    matchSel.appendChild(opt);
  }
  matchSel.value = list[0]?.id;

  await onMatchChange();
}

async function onMatchChange(){
  const mode = el("modeSel").value;
  const lookback = parseInt(el("lookbackSel").value, 10);

  const leagueId = currentLeagueId;
  const bundle = cache[leagueId] || await loadLeagueFiles(leagueId);

  const matchId = el("matchSel").value;
  const match = bundle.matches.matches.find(x=>x.id===matchId);
  if (!match){
    setStatus("Match not found", false);
    return;
  }

  setStatus("Computing...");
  el("htFactor").textContent = HT_FACTOR.toFixed(2);
  el("matchTitle").textContent = `${match.home} vs ${match.away}`;

  const histMatches = bundle.history.matches;
  const teamStats = buildTeamStats(histMatches, lookback);

  const { lamHomeFT, lamAwayFT } = estimateLambdasFT(teamStats, match.home, match.away);
  const { lamHomeHT, lamAwayHT } = estimateLambdasHT(teamStats, match.home, match.away, lamHomeFT, lamAwayFT);

  el("lamHomeFT").textContent = isFinite(lamHomeFT) ? lamHomeFT.toFixed(2) : "—";
  el("lamAwayFT").textContent = isFinite(lamAwayFT) ? lamAwayFT.toFixed(2) : "—";
  el("lamHomeHT").textContent = isFinite(lamHomeHT) ? lamHomeHT.toFixed(2) : "—";
  el("lamAwayHT").textContent = isFinite(lamAwayHT) ? lamAwayHT.toFixed(2) : "—";

  const maxG = 10;
  const mFT = scoreMatrix(lamHomeFT, lamAwayFT, maxG);
  const mHT = scoreMatrix(lamHomeHT, lamAwayHT, maxG);

  const ft1x2 = prob1X2(mFT);
  const ht1x2 = prob1X2(mHT);

  const ftDC = { p1X: ft1x2.pH + ft1x2.pD, p12: ft1x2.pH + ft1x2.pA, pX2: ft1x2.pD + ft1x2.pA };
  const htDC = { p1X: ht1x2.pH + ht1x2.pD, p12: ht1x2.pH + ht1x2.pA, pX2: ht1x2.pD + ht1x2.pA };

  const ftOU = {};
  for (const l of GOALS_FT_LINES){
    const over = probTotalOver(mFT, l);
    ftOU[`O${l}`] = over;
    ftOU[`U${l}`] = 1 - over;
  }

  const htOU = {};
  for (const l of GOALS_HT_LINES){
    const over = probTotalOver(mHT, l);
    htOU[`O${l}`] = over;
    htOU[`U${l}`] = 1 - over;
  }

  const ftBTS = probBTS(mFT);
  const htBTS = probBTS(mHT);

  const ftHcap = {};
  ftHcap["H-0.5"] = { win: ft1x2.pH, push: 0, lose: 1-ft1x2.pH };
  ftHcap["H-1.0"] = probHandicapHome(mFT, -1);
  ftHcap["A+0.5"] = { win: ft1x2.pA + ft1x2.pD, push: 0, lose: 1-(ft1x2.pA+ft1x2.pD) };

  let cornersProb = null;
  let cardsProb = null;

  const lamCornersTotal = estimateLambdaTotalOptional(bundle.corners, match.home, match.away);
  if (isFinite(lamCornersTotal)){
    const ou = {};
    for (const l of CORNERS_LINES){
      const thr = Math.floor(l + 0.5) + 1;
      const over = 1 - poissonCDF(thr-1, lamCornersTotal);
      ou[`O${l}`] = over;
      ou[`U${l}`] = 1 - over;
    }
    cornersProb = { lamTotal: lamCornersTotal, ou };
  }

  const lamCardsTotal = estimateLambdaTotalOptional(bundle.cards, match.home, match.away);
  if (isFinite(lamCardsTotal)){
    const ou = {};
    for (const l of CARDS_LINES){
      const thr = Math.floor(l + 0.5) + 1;
      const over = 1 - poissonCDF(thr-1, lamCardsTotal);
      ou[`O${l}`] = over;
      ou[`U${l}`] = 1 - over;
    }
    cardsProb = { lamTotal: lamCardsTotal, ou };
  }

  renderRows("ft1x2", [
    { label:"Home", value:pct(ft1x2.pH) },
    { label:"Draw", value:pct(ft1x2.pD) },
    { label:"Away", value:pct(ft1x2.pA) }
  ]);
  renderRows("ht1x2", [
    { label:"Home", value:pct(ht1x2.pH) },
    { label:"Draw", value:pct(ht1x2.pD) },
    { label:"Away", value:pct(ht1x2.pA) }
  ]);

  renderRows("ftDC", [
    { label:"1X", value:pct(ftDC.p1X) },
    { label:"12", value:pct(ftDC.p12) },
    { label:"X2", value:pct(ftDC.pX2) }
  ]);
  renderRows("htDC", [
    { label:"1X", value:pct(htDC.p1X) },
    { label:"12", value:pct(htDC.p12) },
    { label:"X2", value:pct(htDC.pX2) }
  ]);

  renderRows("ftOU", GOALS_FT_LINES.flatMap(l => ([
    { label:`Over ${l}`, value:pct(ftOU[`O${l}`]) },
    { label:`Under ${l}`, value:pct(ftOU[`U${l}`]) }
  ])));

  renderRows("htOU", GOALS_HT_LINES.flatMap(l => ([
    { label:`Over ${l}`, value:pct(htOU[`O${l}`]) },
    { label:`Under ${l}`, value:pct(htOU[`U${l}`]) }
  ])));

  renderRows("ftBTS", [
    { label:"Yes", value:pct(ftBTS.yes) },
    { label:"No", value:pct(ftBTS.no) }
  ]);
  renderRows("htBTS", [
    { label:"Yes", value:pct(htBTS.yes) },
    { label:"No", value:pct(htBTS.no) }
  ]);

  renderRows("ftHcap", [
    { label:"Home -0.5 (win)", value:pct(ftHcap["H-0.5"].win) },
    { label:"Home -1.0 (win)", value:pct(ftHcap["H-1.0"].win) },
    { label:"Home -1.0 (push)", value:pct(ftHcap["H-1.0"].push) },
    { label:"Away +0.5 (win)", value:pct(ftHcap["A+0.5"].win) }
  ]);

  el("cornersCard").style.display = isFinite(lamCornersTotal) ? "block" : "none";
  el("cardsCard").style.display = isFinite(lamCardsTotal) ? "block" : "none";

  if (isFinite(lamCornersTotal)){
    renderRows("ftCorners", [
      { label:`λ total`, value: lamCornersTotal.toFixed(2) },
      ...CORNERS_LINES.flatMap(l => ([
        { label:`Over ${l}`, value:pct(cornersProb.ou[`O${l}`]) },
        { label:`Under ${l}`, value:pct(cornersProb.ou[`U${l}`]) }
      ]))
    ]);
  }

  if (isFinite(lamCardsTotal)){
    renderRows("ftCards", [
      { label:`λ total`, value: lamCardsTotal.toFixed(2) },
      ...CARDS_LINES.flatMap(l => ([
        { label:`Over ${l}`, value:pct(cardsProb.ou[`O${l}`]) },
        { label:`Under ${l}`, value:pct(cardsProb.ou[`U${l}`]) }
      ]))
    ]);
  }

  const probsBundle = {
    ft1x2, ht1x2, ftDC, htDC, ftOU, htOU, ftBTS, htBTS, ftHcap,
    corners: cornersProb,
    cards: cardsProb
  };
  renderTips(buildTips(mode, probsBundle));

  setStatus("Ready");
}

// ---------- Bootstrap ----------
(async function init(){
  try{
    populateWindowOptions();
    await populateLeagues();

    el("leagueSel").addEventListener("change", () => onLeagueChange().catch(e=>setStatus(e.message,false)));
    el("matchSel").addEventListener("change",  () => onMatchChange().catch(e=>setStatus(e.message,false)));
    el("modeSel").addEventListener("change",   () => onMatchChange().catch(e=>setStatus(e.message,false)));
    el("lookbackSel").addEventListener("change",() => onMatchChange().catch(e=>setStatus(e.message,false)));

    el("rangeSel").addEventListener("change", () => {
      populateWindowOptions();
      onLeagueChange().catch(e=>setStatus(e.message,false));
    });
    el("windowSel").addEventListener("change", () => {
      onLeagueChange().catch(e=>setStatus(e.message,false));
    });

    await onLeagueChange();
  } catch (e){
    setStatus(e.message || String(e), false);
  }
})();
