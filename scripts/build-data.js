const fs = require("fs");
const path = require("path");

async function fetchText(url){
  const res = await fetch(url, { headers: { "user-agent": "cps-oracle-pro/1.0" }});
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }

// Simple CSV parser with basic quoted-field support
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

function toISODate(d){
  if (!d) return null;
  d = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;

  // dd/mm/yy or dd/mm/yyyy (football-data common)
  const m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m){
    let [_, dd, mm, yy] = m;
    dd = dd.padStart(2,"0");
    mm = mm.padStart(2,"0");
    if (yy.length === 2) yy = "20" + yy;
    return `${yy}-${mm}-${dd}`;
  }
  return null;
}

const norm = (s) => (s || "").trim();

function toInt(x){
  const n = parseInt(String(x ?? "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function mean(arr){
  if (!arr.length) return null;
  return arr.reduce((a,b)=>a+b,0) / arr.length;
}

function buildLeagueHistory(rows, divCode){
  const hist = [];

  for (const r of rows){
    if (norm(r.Div) !== divCode) continue;

    const date = toISODate(r.Date);
    const home = norm(r.HomeTeam);
    const away = norm(r.AwayTeam);

    const fthg = toInt(r.FTHG);
    const ftag = toInt(r.FTAG);

    if (!date || !home || !away) continue;
    if (fthg === null || ftag === null) continue;

    const hthg = toInt(r.HTHG);
    const htag = toInt(r.HTAG);

    const hc = toInt(r.HC);
    const ac = toInt(r.AC);
    const hy = toInt(r.HY);
    const ay = toInt(r.AY);

    hist.push({ date, home, away, fthg, ftag, hthg, htag, hc, ac, hy, ay });
  }

  hist.sort((a,b)=>a.date.localeCompare(b.date));
  return hist;
}

function buildCornersAndCardsTeamAverages(history){
  const cornersFor = {}, cornersAgainst = {};
  const cardsFor = {}, cardsAgainst = {};

  for (const m of history){
    // corners
    if (m.hc !== null && m.ac !== null){
      cornersFor[m.home] = cornersFor[m.home] || [];
      cornersAgainst[m.home] = cornersAgainst[m.home] || [];
      cornersFor[m.away] = cornersFor[m.away] || [];
      cornersAgainst[m.away] = cornersAgainst[m.away] || [];

      cornersFor[m.home].push(m.hc);
      cornersAgainst[m.home].push(m.ac);

      cornersFor[m.away].push(m.ac);
      cornersAgainst[m.away].push(m.hc);
    }

    // yellow cards
    if (m.hy !== null && m.ay !== null){
      cardsFor[m.home] = cardsFor[m.home] || [];
      cardsAgainst[m.home] = cardsAgainst[m.home] || [];
      cardsFor[m.away] = cardsFor[m.away] || [];
      cardsAgainst[m.away] = cardsAgainst[m.away] || [];

      cardsFor[m.home].push(m.hy);
      cardsAgainst[m.home].push(m.ay);

      cardsFor[m.away].push(m.ay);
      cardsAgainst[m.away].push(m.hy);
    }
  }

  const teams = new Set([
    ...Object.keys(cornersFor),
    ...Object.keys(cardsFor)
  ]);

  const corners = { teams: {} };
  const cards = { teams: {} };

  for (const t of teams){
    const cf = mean(cornersFor[t] || []);
    const ca = mean(cornersAgainst[t] || []);
    if (cf !== null && ca !== null){
      corners.teams[t] = { for: +cf.toFixed(3), against: +ca.toFixed(3) };
    }

    const yf = mean(cardsFor[t] || []);
    const ya = mean(cardsAgainst[t] || []);
    if (yf !== null && ya !== null){
      cards.teams[t] = { for: +yf.toFixed(3), against: +ya.toFixed(3) };
    }
  }

  return { corners, cards };
}

async function main(){
  // inputs
  const sources = JSON.parse(fs.readFileSync(path.join("scripts","sources.json"), "utf8"));
  const csvUrl = sources.global.csvUrl;

  const active = JSON.parse(fs.readFileSync(path.join("scripts","active-leagues.json"), "utf8"));
  const leagues = active.leagues || [];

  if (!leagues.length) throw new Error("active-leagues.json has no leagues.");

  console.log(`Downloading CSV: ${csvUrl}`);
  const text = await fetchText(csvUrl);
  const rows = parseCSV(text);

  // outputs
  const dataDir = path.join(process.cwd(), "data");
  const outLeaguesDir = path.join(dataDir, "leagues");
  const outHistoryDir = path.join(dataDir, "history");
  const outCornersDir = path.join(dataDir, "corners");
  const outCardsDir   = path.join(dataDir, "cards");

  ensureDir(outLeaguesDir);
  ensureDir(outHistoryDir);
  ensureDir(outCornersDir);
  ensureDir(outCardsDir);

  const leaguesIndex = [];

  for (const l of leagues){
    const leagueId = l.id;
    const name = l.name;
    const div = l.footballDataDiv;

    if (!leagueId || !name || !div){
      console.log(`[SKIP] Missing id/name/footballDataDiv: ${JSON.stringify(l)}`);
      continue;
    }

    console.log(`Building history: ${leagueId} (${name}) from Div=${div}`);
    const history = buildLeagueHistory(rows, div);

    // slim history used by the model
    const historySlim = history.map(m => ({
      date: m.date,
      home: m.home,
      away: m.away,
      fthg: m.fthg,
      ftag: m.ftag,
      hthg: m.hthg,
      htag: m.htag
    }));

    fs.writeFileSync(
      path.join(outHistoryDir, `${leagueId}.json`),
      JSON.stringify({ leagueId, matches: historySlim }, null, 2)
    );

    // optional corners/cards averages
    const { corners, cards } = buildCornersAndCardsTeamAverages(history);
    const cornersCount = Object.keys(corners.teams).length;
    const cardsCount = Object.keys(cards.teams).length;

    if (cornersCount > 0){
      fs.writeFileSync(
        path.join(outCornersDir, `${leagueId}.json`),
        JSON.stringify({ leagueId, teams: corners.teams }, null, 2)
      );
    } else {
      const p = path.join(outCornersDir, `${leagueId}.json`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    if (cardsCount > 0){
      fs.writeFileSync(
        path.join(outCardsDir, `${leagueId}.json`),
        JSON.stringify({ leagueId, teams: cards.teams }, null, 2)
      );
    } else {
      const p = path.join(outCardsDir, `${leagueId}.json`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    const features = { corners: cornersCount > 0, cards: cardsCount > 0 };

    fs.writeFileSync(
      path.join(outLeaguesDir, `${leagueId}.json`),
      JSON.stringify({ id: leagueId, name, features }, null, 2)
    );

    leaguesIndex.push({ id: leagueId, name });
  }

  // index.json used by UI (must match fixtures leagueIds)
  const defaultLeagueId = leaguesIndex.find(x => x.id === "epl")?.id || leaguesIndex[0]?.id || null;

  fs.writeFileSync(
    path.join(dataDir, "index.json"),
    JSON.stringify({ defaultLeagueId, leagues: leaguesIndex }, null, 2)
  );

  console.log("Done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
