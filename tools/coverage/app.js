const el = (id) => document.getElementById(id);

// IMPORTANT: pagina e la /tools/coverage/ deci ca să ajungem la /data/... trebuie ../../data/...
const DATA_BASE = "../../data";

function setStatus(text, ok=true){
  el("statusText").textContent = text;
  el("statusDot").style.background = ok ? "var(--accent)" : "var(--bad)";
}

async function getJson(url){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

function uniqLeagues(events){
  const m = new Map();
  for (const e of events){
    if (!e.idLeague) continue;
    if (!m.has(e.idLeague)) m.set(e.idLeague, e.strLeague || e.idLeague);
  }
  return m;
}

function statusType(e){
  const st = String(e.strStatus || "").toLowerCase();
  const postponed = String(e.strPostponed || "").toLowerCase() === "yes";
  if (postponed || st.includes("postponed")) return "postponed";
  if (st.includes("not started")) return "upcoming";
  if (st.includes("finished")) return "finished";

  // fallback: if scores are null -> upcoming-ish
  if (e.intHomeScore == null && e.intAwayScore == null) return "upcoming";
  return "finished";
}

function renderLeaguesSelect(leagueMap){
  const sel = el("leagueSel");
  sel.innerHTML = "";

  const optAll = document.createElement("option");
  optAll.value = "__all__";
  optAll.textContent = "All leagues";
  sel.appendChild(optAll);

  const entries = [...leagueMap.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a,b) => String(a.name).localeCompare(String(b.name)));

  for (const x of entries){
    const o = document.createElement("option");
    o.value = String(x.id);
    o.textContent = `${x.name} (${x.id})`;
    sel.appendChild(o);
  }

  sel.value = "__all__";
}

function renderMatches(events, filterMode, leagueId){
  const box = el("matches");
  box.innerHTML = "";

  let list = Array.isArray(events) ? events : [];

  // filter by league
  if (leagueId && leagueId !== "__all__"){
    list = list.filter(e => String(e.idLeague) === String(leagueId));
  }

  // filter by status
  if (filterMode === "upcoming"){
    list = list.filter(e => statusType(e) === "upcoming");
  } else if (filterMode === "finished"){
    list = list.filter(e => statusType(e) === "finished");
  }

  // sort by time
  list = list.slice().sort((a,b) => {
    const ta = String(a.strTimestamp || ((a.dateEvent || "") + "T" + (a.strTime || "")));
    const tb = String(b.strTimestamp || ((b.dateEvent || "") + "T" + (b.strTime || "")));
    return ta.localeCompare(tb);
  });

  el("shownEvents").textContent = String(list.length);

  if (!list.length){
    box.innerHTML = `<div class="hint">No matches for the selected filters.</div>`;
    return;
  }

  for (const e of list){
    const typ = statusType(e);
    const badgeText =
      typ === "upcoming" ? "UPCOMING" :
      typ === "finished" ? "FINISHED" :
      "POSTPONED";

    const teams = `${e.strHomeTeam || "?"} vs ${e.strAwayTeam || "?"}`;
    const league = String(e.strLeague || "").trim();
    const date = e.dateEvent || "";
    const time = String(e.strTime || "").slice(0,5);
    const ts = time ? `${date} ${time}` : date;

    const score =
      (e.intHomeScore != null && e.intAwayScore != null)
        ? ` | ${e.intHomeScore}-${e.intAwayScore}`
        : "";

    const meta = `${league} | ${ts}${score}`;

    const div = document.createElement("div");
    div.className = "match";
    div.innerHTML = `
      <div class="left">
        <div class="teams">${teams}</div>
        <div class="meta">${meta}</div>
      </div>
      <div class="badge ${typ}">${badgeText}</div>
    `;
    box.appendChild(div);
  }
}

async function loadDay(day){
  setStatus(`Loading ${day}...`);

  const data = await getJson(`${DATA_BASE}/events_by_day/${day}.json`);
  const events = data.events || [];

  el("totalEvents").textContent = String(events.length);

  const leagueMap = uniqLeagues(events);
  el("uniqueLeagues").textContent = String(leagueMap.size);

  renderLeaguesSelect(leagueMap);

  const filterMode = el("filterSel").value;
  const leagueId = el("leagueSel").value;
  renderMatches(events, filterMode, leagueId);

  el("hint").textContent =
    `This file contains ${events.length} soccer events for ${day}. Use filters to validate coverage.`;

  setStatus("Ready");
  return { events };
}

async function init(){
  try{
    setStatus("Loading day index...");

    const idx = await getJson(`${DATA_BASE}/events_by_day/index.json`);

    const daySel = el("daySel");
    daySel.innerHTML = "";

    for (const d of (idx.days || [])){
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      daySel.appendChild(opt);
    }

    if (!idx.days || !idx.days.length){
      setStatus("No days in index.json", false);
      return;
    }

    daySel.value = idx.days[0];

    let current = await loadDay(daySel.value);

    el("reloadBtn").addEventListener("click", async () => {
      current = await loadDay(daySel.value);
    });

    el("daySel").addEventListener("change", async () => {
      current = await loadDay(daySel.value);
    });

    el("filterSel").addEventListener("change", () => {
      renderMatches(current.events || [], el("filterSel").value, el("leagueSel").value);
    });

    el("leagueSel").addEventListener("change", () => {
      renderMatches(current.events || [], el("filterSel").value, el("leagueSel").value);
    });

    setStatus("Ready");
  } catch (e){
    setStatus(e.message || String(e), false);
  }
}

init();
