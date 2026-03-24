const fs = require("fs");
const path = require("path");

function readJson(p){ return JSON.parse(fs.readFileSync(p, "utf8")); }
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function uniqBy(arr, keyFn){
  const m = new Map();
  for (const x of arr || []){
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, x);
  }
  return Array.from(m.values());
}

function main(){
  const matchesPath = path.join("data", "ui", "matches.json");
  if (!fs.existsSync(matchesPath)) throw new Error("Missing data/ui/matches.json. Run odds workflow first.");

  const matches = readJson(matchesPath).matches || [];
  const counts = {};       // marketId -> count appearances
  const samples = {};      // marketId -> sample fixtureId + 2 prices

  // scan first N matches (limit to keep it fast)
  const N = Math.min(matches.length, 80);

  for (let i=0; i<N; i++){
    const fxId = String(matches[i].fixtureId);
    const p = path.join("data", "ui", "match", `${fxId}.json`);
    if (!fs.existsSync(p)) continue;

    const m = readJson(p);
    const markets = m.markets || [];

    for (const mk of markets){
      const outs = uniqBy(mk.outcomes || [], o => o.outcomeId);
      if (outs.length !== 2) continue;

      const prices = outs.map(o => o.price).filter(x => typeof x === "number");
      if (prices.length !== 2) continue;

      const id = String(mk.marketId);
      counts[id] = (counts[id] || 0) + 1;

      if (!samples[id]){
        const sorted = prices.slice().sort((a,b)=>a-b);
        samples[id] = { fixtureId: fxId, prices: sorted };
      }
    }
  }

  const rows = Object.keys(counts)
    .map(id => ({ marketId: id, seen: counts[id], sample: samples[id] }))
    .sort((a,b)=>b.seen - a.seen);

  ensureDir(path.join("data", "ui"));
  fs.writeFileSync(
    path.join("data", "ui", "two_way_report.json"),
    JSON.stringify({ generatedAtUTC: new Date().toISOString(), scannedMatches: N, markets: rows }, null, 2),
    "utf8"
  );

  console.log("Wrote data/ui/two_way_report.json");
}

main();
