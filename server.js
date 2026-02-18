import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "300kb" }));
app.use(express.urlencoded({ extended: true }));

// === Airtable config (env) ===
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;

// === Airtable fields (dokładnie jak w tabeli) ===
const FIELD_NAME = "Name";
const FIELD_LAT = "Lattitude";   // (literówka celowo)
const FIELD_LNG = "Longitude";
const FIELD_CAT = "Category";
const FIELD_SUB = "Subcategory";
const FIELD_NOTE = "Note";

// === Categories (walidacja) ===
const CATEGORIES = [
  "Stacja benzynowa",
  "Warsztat",
  "Parking",
  "Ważne Miejsce",
  "Agencja celna / weterynarz",
];

function isValidCategory(cat) {
  const c = String(cat || "").trim();
  return CATEGORIES.includes(c);
}

// ----------------- URL helpers -----------------
function looksLikeHttpUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveRelativeUrl(base, maybeRel) {
  try {
    return new URL(maybeRel, base).toString();
  } catch {
    return maybeRel;
  }
}

function extractLatLngFromUrl(url) {
  try {
    const s = String(url || "").trim();
    let m;

    // /maps/search/lat,+lng
    m = s.match(/\/maps\/search\/(-?\d+(?:\.\d+)?),\+(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

    // /maps/search/lat,lng
    m = s.match(/\/maps\/search\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

    // @lat,lng
    m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

    // ?q=lat,lng
    m = s.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

    // !3dLAT!4dLNG
    m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

    // ?ll=lat,lng
    m = s.match(/[?&]ll=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

    // query=lat,lng
    m = s.match(/[?&](?:query|destination)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

    return null;
  } catch {
    return null;
  }
}

function extractMapsUrlFromHtml(html, baseUrl) {
  const s = String(html || "");

  // canonical
  let m = s.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (m && m[1]) return resolveRelativeUrl(baseUrl, m[1].replace(/&amp;/g, "&"));

  // meta refresh url=
  m = s.match(/http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i);
  if (m && m[1]) return resolveRelativeUrl(baseUrl, m[1].trim().replace(/&amp;/g, "&"));

  // JS redirect: window.location / location.href / location.replace
  m = s.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
  if (m && m[1]) return resolveRelativeUrl(baseUrl, m[1].replace(/&amp;/g, "&"));

  m = s.match(/location\.replace\(\s*["']([^"']+)["']\s*\)/i);
  if (m && m[1]) return resolveRelativeUrl(baseUrl, m[1].replace(/&amp;/g, "&"));

  // direct google maps URL in HTML
  m = s.match(/https:\/\/www\.google\.com\/maps[^"'\s<]+/i);
  if (m) return m[0].replace(/&amp;/g, "&");

  m = s.match(/https:\/\/maps\.app\.goo\.gl\/[^"'\s<]+/i);
  if (m) return m[0].replace(/&amp;/g, "&");

  // google redirect wrappers: https://www.google.com/url?q=...
  m = s.match(/https:\/\/www\.google\.com\/url\?[^"'\s<]+/i);
  if (m) return m[0].replace(/&amp;/g, "&");

  return null;
}

function browserHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
  };
}

// Manual redirect resolver (czyta Location nawet jeśli fetch nie chce follow)
async function resolveRedirectChain(startUrl, maxHops = 8) {
  let current = String(startUrl || "").trim();
  const visited = [];
  let lastHtml = null;

  for (let i = 0; i < maxHops; i++) {
    if (!current || !looksLikeHttpUrl(current)) break;
    if (visited.includes(current)) break;
    visited.push(current);

    // Szybki sukces: coords już są
    if (extractLatLngFromUrl(current)) {
      return { finalUrl: current, visited, lastHtml };
    }

    // HEAD bywa blokowany, więc od razu GET, ale redirect manual
    const res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: browserHeaders(),
    });

    const status = res.status;
    const loc = res.headers.get("location");

    // 3xx -> idziemy dalej po Location
    if (status >= 300 && status < 400 && loc) {
      current = resolveRelativeUrl(current, loc);
      continue;
    }

    // 200/4xx/5xx -> spróbujmy HTML parser
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (ctype.includes("text/html")) {
      const html = await res.text();
      lastHtml = html;

      const fromHtml = extractMapsUrlFromHtml(html, current);
      if (fromHtml && fromHtml !== current) {
        current = fromHtml;
        continue;
      }
    }

    // jeśli google url wrapper (/url?q=...) to spróbuj wyciągnąć q=
    try {
      const u = new URL(current);
      if (u.hostname === "www.google.com" && u.pathname === "/url") {
        const q = u.searchParams.get("q");
        if (q && looksLikeHttpUrl(q)) {
          current = q;
          continue;
        }
      }
    } catch {}

    // w tym punkcie nie ma gdzie iść dalej
    return { finalUrl: current, visited, lastHtml };
  }

  return { finalUrl: current, visited, lastHtml };
}

async function resolveToMapsUrl(inputUrl) {
  const inUrl = String(inputUrl || "").trim();
  const { finalUrl, visited, lastHtml } = await resolveRedirectChain(inUrl, 10);

  // 1) spróbuj coords z final
  let coords = extractLatLngFromUrl(finalUrl);

  // 2) jeżeli final to google url wrapper, wyciągnij q= i spróbuj
  if (!coords) {
    try {
      const u = new URL(finalUrl);
      if (u.hostname === "www.google.com" && u.pathname === "/url") {
        const q = u.searchParams.get("q");
        if (q) coords = extractLatLngFromUrl(q);
        if (coords) return { mapsUrl: q, finalUrl, visited };
      }
    } catch {}
  }

  // 3) spróbuj ostatni HTML (czasem coords siedzą w treści)
  if (!coords && lastHtml) {
    const maybe = extractMapsUrlFromHtml(lastHtml, finalUrl);
    if (maybe) {
      coords = extractLatLngFromUrl(maybe);
      if (coords) return { mapsUrl: maybe, finalUrl: maybe, visited };
      // jeśli to maps.app.goo.gl – rozwiń jeszcze raz
      const again = await resolveRedirectChain(maybe, 6);
      const coords2 = extractLatLngFromUrl(again.finalUrl);
      if (coords2) return { mapsUrl: again.finalUrl, finalUrl: again.finalUrl, visited: [...visited, ...again.visited] };
    }
  }

  return { mapsUrl: finalUrl, finalUrl, visited };
}

// ----------------- Airtable -----------------
async function airtableRequest(method, pathPart, body) {
  if (!AIRTABLE_TOKEN) throw new Error("Missing AIRTABLE_TOKEN (env)");
  if (!BASE_ID) throw new Error("Missing AIRTABLE_BASE_ID (env)");
  if (!TABLE_ID) throw new Error("Missing AIRTABLE_TABLE_ID (env)");

  const url = `https://api.airtable.com/v0/${BASE_ID}/${pathPart}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}

  if (!res.ok) {
    const msg = json?.error?.message || json?.error || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// --- static ---
app.use(express.static(path.join(__dirname, "public"), { etag: false, maxAge: "0" }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));
app.get("/form", (req, res) => res.sendFile(path.join(__dirname, "public/form.html")));

// --- API: points ---
app.get("/api/points", async (req, res) => {
  try {
    const maxRecords = Math.min(Number(req.query.max || 2000), 5000);
    const data = await airtableRequest("GET", `${TABLE_ID}?maxRecords=${encodeURIComponent(String(maxRecords))}`, null);

    const points = (data.records || [])
      .map((r) => {
        const f = r.fields || {};
        return {
          id: r.id,
          name: String(f[FIELD_NAME] || "").trim(),
          lat: Number(f[FIELD_LAT]),
          lng: Number(f[FIELD_LNG]),
          category: String(f[FIELD_CAT] || "").trim(),
          subcategory: String(f[FIELD_SUB] || "").trim(),
          note: String(f[FIELD_NOTE] || "").trim(),
          createdTime: r.createdTime,
        };
      })
      .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.category);

    res.json({ ok: true, count: points.length, points, categories: CATEGORIES });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// --- submit core ---
async function handleSubmitCore(body) {
  const name = String(body.name || "").trim();
  const link = String(body.link || "").trim();
  const category = String(body.category || "").trim();
  const subcategory = String(body.subcategory || "").trim();
  const note = String(body.note || "").trim();

  if (!name) return { ok: false, status: 400, error: "Missing name" };
  if (!isValidCategory(category)) return { ok: false, status: 400, error: "Invalid category" };

  let coords = null;
  let debug = {};

  if (!link) return { ok: false, status: 400, error: "Missing google maps link" };

  const { mapsUrl, finalUrl, visited } = await resolveToMapsUrl(link);
  debug = { mapsUrl, finalUrl, visited };

  coords =
    extractLatLngFromUrl(mapsUrl) ||
    extractLatLngFromUrl(finalUrl) ||
    extractLatLngFromUrl(link);

  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
    return {
      ok: false,
      status: 400,
      error:
        "Nie udało się wyciągnąć współrzędnych z linku. Jeśli to możliwe: w Google Maps dotknij pinezki miejsca → Udostępnij → skopiuj link (często maps.app.goo.gl działa najlepiej).",
      debug,
    };
  }

  const payload = {
    records: [
      {
        fields: {
          [FIELD_NAME]: name,
          [FIELD_CAT]: category,
          [FIELD_SUB]: subcategory, // <- nie zerujemy, zapisujemy nawet jak pusty string
          [FIELD_NOTE]: note,
          [FIELD_LAT]: String(coords.lat),
          [FIELD_LNG]: String(coords.lng),
        },
      },
    ],
  };

  const created = await airtableRequest("POST", `${TABLE_ID}`, payload);
  return { ok: true, created, coords, debug };
}

// AJAX submit
app.post("/api/submit", async (req, res) => {
  try {
    const out = await handleSubmitCore(req.body);
    if (!out.ok) return res.status(out.status || 400).json(out);
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Fallback submit (gdyby JS był off)
app.post("/submit", async (req, res) => {
  try {
    const out = await handleSubmitCore(req.body);
    if (!out.ok) return res.redirect(`/form?err=${encodeURIComponent(out.error || "Submit failed")}`);
    return res.redirect("/form?ok=1");
  } catch (e) {
    return res.redirect(`/form?err=${encodeURIComponent(String(e.message || e))}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`road-map on :${PORT}`));
