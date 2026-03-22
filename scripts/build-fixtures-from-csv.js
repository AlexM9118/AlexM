const fs = require("fs");
const path = require("path");

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

function parseCSV(text){
  const rows = [];
  let i=0, field="", row=[], inQuotes=false;

  const pushField = () => { row.push(field); field=""; };
  const pushRow = () => { rows.push(row); row=[]; };

  while(i < text.length){
    const c = text[i];

    if (c === '"'){
      if (inQuotes && text[i+1] === '"'){ field += '"'; i += 2; continue; }
      inQuotes = !inQuotes; i++; continue;
    }
    if (!inQuotes && c === ","){ pushField(); i++; continue; }
    if (!inQuotes && c === "\n"){ pushField(); pushRow(); i++; continue; }
    if (c === "\r"){ i++; continue; }

    field += c; i++;
  }
  if (field.length || row.length){ pushField(); pushRow(); }

  const header = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.length === header.length)
    .map(r => Object.fromEntries(header.map((h,idx)=>[h, r[idx]])));
}

function isISODate(s){
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s||"").trim());
}

function safe(s){ return String(s||"").trim(); }

async function main(){
  const inPath = path.join(process.cwd(), "data", "fixtures_manual", "all.csv");
  if (!fs.existsSync(inPath)) {
    throw new Error(`Missing fixtures file: ${inPath}`);
  }

  const text = fs.readFileSync(inPath, "utf8");
  const rows = parseCSV(text);

  const outDir = path.join(process.cwd(), "data", "fixtures");
  ensureDir(outDir);

  const buckets = new Map(); // leagueId -> { leagueId, leagueName?, matches: [] }

  for (const r of rows){
    const leagueId = safe(r.leagueId);
    const date = safe(r.date);
    const home = safe(r.home);
    const away = safe(r.away);

    if (!leagueId || !date || !home || !away) continue;
    if (!isISODate(date)) {
      console.log(`[SKIP] Bad date format (need YYYY-MM-DD): ${date}`);
      continue;
    }

    if (!buckets.has(leagueId)){
      buckets.set(leagueId, { leagueId, leagueName: leagueId, matches: [] });
    }

    buckets.get(leagueId).matches.push({
      id: `${leagueId}_${date}_${home}_vs_${away}`.replace(/\s+/g,"_"),
      date, home, away
    });
  }

  // Write one JSON per leagueId
  for (const [leagueId, obj] of buckets.entries()){
    // dedupe
    const seen = new Set();
    obj.matches = obj.matches.filter(m => {
      const k = `${m.date}|${m.home}|${m.away}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a,b)=>(a.date+a.home+a.away).localeCompare(b.date+b.home+b.away));

    const out = {
      leagueId,
      leagueName: obj.leagueName,
      generatedAtUTC: new Date().toISOString(),
      source: { type: "manual_csv", file: "data/fixtures_manual/all.csv" },
      matches: obj.matches
    };

    fs.writeFileSync(path.join(outDir, `${leagueId}.json`), JSON.stringify(out, null, 2), "utf8");
    console.log(`Wrote data/fixtures/${leagueId}.json (${obj.matches.length} matches)`);
  }

  // Also write an index of fixtures leagues (optional)
  const leagues = Array.from(buckets.keys()).sort();
  fs.writeFileSync(
    path.join(process.cwd(), "data", "fixtures_index.json"),
    JSON.stringify({ generatedAtUTC: new Date().toISOString(), leagues }, null, 2),
    "utf8"
  );
  console.log("Wrote data/fixtures_index.json");
}

main().catch(e => { console.error(e); process.exit(1); });
