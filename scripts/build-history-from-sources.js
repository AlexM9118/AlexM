const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

async function fetchBuffer(url){
  const r = await fetch(url, { headers: { "user-agent": "alex-ai-bet/1.0" }});
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

async function fetchText(url){
  const r = await fetch(url, { headers: { "user-agent": "alex-ai-bet/1.0" }});
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

// simple CSV parser (quotes supported)
function parseCSV(text){
  const rows = [];
  let i=0, field="", row=[], inQuotes=false;

  const pushField = () => { row.push(field); field=""; };
  const pushRow = () => { rows.push(row); row=[]; };

  while (i < text.length){
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

  const header = rows.shift() || [];
  const cols = header.map(h => String(h || "").trim());
  const out = [];

  for (const r of rows){
    if (!r || !r.length) continue;
    const obj = {};
    for (let j=0; j<cols.length; j++){
      obj[cols[j]] = String(r[j] ?? "").trim();
    }
    out.push(obj);
  }
  return out;
}

function parseXLSX(buffer){
  const wb = XLSX.read(buffer, { type: "buffer" });

  // choose first sheet
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // Convert to JSON rows; defval keeps empty cells as empty string
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  // rows are objects keyed by column header
  return rows.map(r => {
    const o = {};
    for (const [k,v] of Object.entries(r)){
      o[String(k).trim()] = String(v ?? "").trim();
    }
    return o;
  });
}

function toISODate(d){
  const s = String(d || "").trim();
  if (!s) return null;

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // football-data often dd/mm/yy or dd/mm/yyyy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m){
    let dd = Number(m[1]);
    let mm = Number(m[2]);
    let yy = Number(m[3]);
    if (yy < 100) yy = 2000 + yy;
    const pad = (n) => String(n).padStart(2,"0");
    return `${yy}-${pad(mm)}-${pad(dd)}`;
  }

  // Sometimes xlsx may have "YYYY-MM-DD HH:MM:SS" or similar; take date part if present
  const m2 = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m2) return m2[1];

  return null;
}

function num(x){
  const n = Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

// Try to read a column by multiple possible names (case-insensitive)
function pick(row, names){
  const keys = Object.keys(row || {});
  for (const n of names){
    if (row[n] !== undefined) return row[n];
    const found = keys.find(k => k.toLowerCase() === String(n).toLowerCase());
    if (found) return row[found];
  }
  return undefined;
}

function normalizeMatches(rows){
  const matches = [];

  for (const r of rows){
    const date = toISODate(pick(r, ["Date", "date"]));
    const home = String(pick(r, ["HomeTeam", "Home", "Home Team", "HomeTeamName"]) || "").trim();
    const away = String(pick(r, ["AwayTeam", "Away", "Away Team", "AwayTeamName"]) || "").trim();

    const fthg = num(pick(r, ["FTHG", "HG", "HomeGoals", "Home Goals"]));
    const ftag = num(pick(r, ["FTAG", "AG", "AwayGoals", "Away Goals"]));

    // optional corners/cards (football-data)
    const hc = num(pick(r, ["HC", "HomeCorners", "Home Corners"]));
    const ac = num(pick(r, ["AC", "AwayCorners", "Away Corners"]));
    const hy = num(pick(r, ["HY", "HomeYellow", "Home Yellow"]));
    const ay = num(pick(r, ["AY", "AwayYellow", "Away Yellow"]));

    if (!date || !home || !away) continue;
    if (fthg == null || ftag == null) continue; // history only (finished)

    matches.push({ date, home, away, fthg, ftag, hc, ac, hy, ay });
  }

  // newest first
  matches.sort((a,b)=> String(b.date).localeCompare(String(a.date)));
  return matches;
}

function buildLastNStats(matches, teamName, n){
  const isTeam = (x) => String(x||"").trim().toLowerCase() === String(teamName||"").trim().toLowerCase();

  const home = matches.filter(m => isTeam(m.home) && m.fthg != null && m.ftag != null).slice(0, n);
  const away = matches.filter(m => isTeam(m.away) && m.fthg != null && m.ftag != null).slice(0, n);

  const avg = (arr, fn) => arr.length ? (arr.reduce((s,x)=>s+fn(x),0) / arr.length) : null;

  // goals
  const homeGF = avg(home, m => m.fthg);
  const homeGA = avg(home, m => m.ftag);
  const awayGF = avg(away, m => m.ftag);
  const awayGA = avg(away, m => m.fthg);

  // corners/cards optional
  const homeCornersFor = avg(home, m => m.hc ?? 0);
  const homeCornersAgainst = avg(home, m => m.ac ?? 0);
  const awayCornersFor = avg(away, m => m.ac ?? 0);
  const awayCornersAgainst = avg(away, m => m.hc ?? 0);

  const homeYCFor = avg(home, m => m.hy ?? 0);
  const homeYCAgainst = avg(home, m => m.ay ?? 0);
  const awayYCFor = avg(away, m => m.ay ?? 0);
  const awayYCAgainst = avg(away, m => m.hy ?? 0);

  return {
    homeMatches: home.length,
    awayMatches: away.length,
    homeGF, homeGA, awayGF, awayGA,
    homeCornersFor, homeCornersAgainst, awayCornersFor, awayCornersAgainst,
    homeYCFor, homeYCAgainst, awayYCFor, awayYCAgainst
  };
}

async function main(){
  const cfgPath = path.join("scripts", "history-sources.json");
  if (!fs.existsSync(cfgPath)) throw new Error("Missing scripts/history-sources.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));

  const lookback = Number(cfg.lookback || 5);
  const sources = cfg.sources || [];
  if (!Array.isArray(sources) || !sources.length) throw new Error("No sources in scripts/history-sources.json");

  ensureDir(path.join("data", "history"));
  ensureDir(path.join("data", "stats"));

  for (const s of sources){
    console.log("Source:", s.id, s.type, s.url);

    let rows = [];
    if (s.type === "csv"){
      const text = await fetchText(s.url);
      rows = parseCSV(text);
    } else if (s.type === "xlsx"){
      const buf = await fetchBuffer(s.url);
      rows = parseXLSX(buf);
    } else {
      console.log("Skip unknown type:", s.type);
      continue;
    }

    const matches = normalizeMatches(rows);

    // write history
    fs.writeFileSync(
      path.join("data", "history", `${s.id}.json`),
      JSON.stringify({ leagueId: s.id, name: s.name, matches }, null, 2),
      "utf8"
    );

    // team stats
    const teamSet = new Set();
    for (const m of matches){
      teamSet.add(m.home);
      teamSet.add(m.away);
    }
    const teams = Array.from(teamSet).sort((a,b)=>a.localeCompare(b));

    const teamStats = {};
    for (const t of teams){
      teamStats[t] = buildLastNStats(matches, t, lookback);
    }

    fs.writeFileSync(
      path.join("data", "stats", `${s.id}.json`),
      JSON.stringify({ leagueId: s.id, name: s.name, lookback, teamCount: teams.length, teamStats }, null, 2),
      "utf8"
    );

    console.log(`Saved ${s.id}: matches=${matches.length} teams=${teams.length}`);
  }

  console.log("Done history build.");
}

main().catch(e => { console.error(e); process.exit(1); });
