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

function shortDate(iso){
  if (!iso) return "—";
  // show only YYYY-MM-DD HH:mm if possible
  return String(iso).replace("T", " ").replace(".000Z","Z");
}

async function loadStatus(){
  try{
    setStatus("Loading data status...");
    const idx = await getJson("./data/oddspapi_odds_index.json");

    el("fxCount").textContent = String(idx.fixturesTotal ?? "—");
    el("bookmaker").textContent = String(idx.bookmaker ?? "—");
    el("generatedAt").textContent = shortDate(idx.generatedAtUTC);
    el("tIds").textContent = Array.isArray(idx.tournamentIds) ? String(idx.tournamentIds.length) : "—";

    setStatus("Ready");
  } catch (e){
    setStatus(e.message || String(e), false);
  }
}

document.getElementById("statusBtn").addEventListener("click", () => {
  loadStatus().catch(() => {});
});

// auto-load
loadStatus().catch(() => {});
