const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.oddspapi.io";

async function main(){
  const key = process.env.ODDSPAPI_KEY;
  if (!key) throw new Error("Missing ODDSPAPI_KEY (GitHub Secret).");

  const url = `${API_BASE}/v4/bookmakers?apiKey=${encodeURIComponent(key)}`;
  console.log("Request:", url.replace(key, "***"));

  const r = await fetch(url);
  const text = await r.text();

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(path.join("data","oddspapi_bookmakers_raw.txt"), text, "utf8");

  console.log("HTTP:", r.status);

  if (!r.ok){
    console.log(text.slice(0, 800));
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.log("Response not JSON. First 800 chars:");
    console.log(text.slice(0, 800));
    process.exit(1);
  }

  fs.writeFileSync(path.join("data","oddspapi_bookmakers.json"), JSON.stringify(data, null, 2), "utf8");

  // Print a small hint in logs
  const count = Array.isArray(data) ? data.length : (data?.bookmakers?.length || 0);
  console.log("Saved data/oddspapi_bookmakers.json");
  console.log("Bookmakers count (approx):", count);
}

main().catch(e => { console.error(e); process.exit(1); });
