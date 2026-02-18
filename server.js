import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "800kb" }));
app.use(express.urlencoded({ extended: true }));

// ===== Airtable env =====
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;

// ===== Airtable fields =====
const FIELD_NAME = "Name";
const FIELD_LAT = "Lattitude";
const FIELD_LNG = "Longitude";
const FIELD_CAT = "Category";
const FIELD_SUB = "Subcategory";
const FIELD_NOTE = "Note";
const FIELD_NOTES = "Notatki";

const CATEGORIES = [
  "Stacja benzynowa",
  "Warsztat",
  "Parking",
  "Ważne Miejsce",
  "Agencja celna / weterynarz",
];

function isValidCategory(cat) {
  return CATEGORIES.includes(String(cat || "").trim());
}

// ---------------- URL helpers ----------------
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
  const s = String(url || "").trim();
  let m;

  m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = s.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = s.match(/\/maps\/search\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  m = s.match(/[?&](?:destination|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  return null;
}

function browserHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
  };
}

function extractMapsUrlFromHtml(html, baseUrl) {
  const s = String(html || "");

  let m = s.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (m?.[1]) return resolveRelativeUrl(baseUrl, m[1].replace(/&amp;/g, "&"));

  m = s.match(/http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i);
  if (m?.[1]) return resolveRelativeUrl(baseUrl, m[1].trim().replace(/&amp;/g, "&"));

  m = s.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
  if (m?.[1]) return resolveRelativeUrl(baseUrl, m[1].replace(/&amp;/g, "&"));

  m = s.match(/location\.replace\(\s*["']([^"']+)["']\s*\)/i);
  if (m?.[1]) return resolveRelativeUrl(baseUrl, m[1].replace(/&amp;/g, "&"));

  m = s.match(/https:\/\/www\.google\.com\/maps[^"'\s<]+/i);
  if (m) return m[0].replace(/&amp;/g, "&");

  m = s.match(/https:\/\/maps\.app\.goo\.gl\/[^"'\s<]+/i);
  if (m) return m[0].replace(/&amp;/g, "&");

  m = s.match(/https:\/\/www\.google\.com\/url\?[^"'\s<]+/i);
  if (m) return m[0].replace(/&amp;/g, "&");

  return null;
}

async function resolveRedirectChain(startUrl, maxHops = 10) {
  let current = String(startUrl || "").trim();
  const visited = [];
  let lastHtml = null;

  for (let i = 0; i < maxHops; i++) {
    if (!current || !looksLikeHttpUrl(current)) break;
    if (visited.includes(current)) break;
    visited.push(current);

    if (extractLatLngFromUrl(current)) return { finalUrl: current, visited, lastHtml };

    const res = await fetch(current, { method: "GET", redirect: "manual", headers: browserHeaders() });
    const loc = res.headers.get("location");

    if (res.status >= 300 && res.status < 400 && loc) {
      current = resolveRelativeUrl(current, loc);
      continue;
    }

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

    return { finalUrl: current, visited, lastHtml };
  }

  return { finalUrl: current, visited, lastHtml };
}

async function resolveToMapsUrl(inputUrl) {
  const inUrl = String(inputUrl || "").trim();
  const { finalUrl, visited, lastHtml } = await resolveRedirectChain(inUrl, 10);

  if (lastHtml) {
    const maybe = extractMapsUrlFromHtml(lastHtml, finalUrl);
    if (maybe) {
      const again = await resolveRedirectChain(maybe, 6);
      return { mapsUrl: again.finalUrl || maybe, finalUrl: again.finalUrl || maybe, visited: [...visited, ...again.visited] };
    }
  }

  return { mapsUrl: finalUrl, finalUrl, visited };
}

// ---------------- Address geocoding (Nominatim) ----------------
async function geocodeAddress(query) {
  const q = String(query || "").trim();
  if (!q) return null;

  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=0&q=" +
    encodeURIComponent(q);

  const res = await fetch(url, {
    headers: {
      "User-Agent": "MapYourPoints/1.0",
      "Accept-Language": "pl,en",
    },
  });

  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const hit = Array.isArray(data) ? data[0] : null;
  if (!hit) return null;

  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng, provider: "nominatim" };
}

// ---------------- Airtable ----------------
async function airtableRequest(method, pathPart, body) {
  if (!AIRTABLE_TOKEN) throw new Error("Missing AIRTABLE_TOKEN");
  if (!BASE_ID) throw new Error("Missing AIRTABLE_BASE_ID");
  if (!TABLE_ID) throw new Error("Missing AIRTABLE_TABLE_ID");

  const url = `https://api.airtable.com/v0/${BASE_ID}/${pathPart}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
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

async function airtableUpdateRecord(recordId, fields) {
  return airtableRequest("PATCH", `${TABLE_ID}/${recordId}`, { fields });
}

// ---------------- Notes helpers ----------------
function splitNotes(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return [];
  return txt.split("\n---\n").map(s => s.trim()).filter(Boolean);
}
function joinNotes(list) {
  return list.map(s => String(s).trim()).filter(Boolean).join("\n---\n");
}

// ---------------- Static ----------------
app.use(express.static(path.join(__dirname, "public"), { etag: false, maxAge: "0" }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));
app.get("/form", (req, res) => res.sendFile(path.join(__dirname, "public/form.html")));

// ---------------- API: points ----------------
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
          notatki: String(f[FIELD_NOTES] || "").trim(),
        };
      })
      .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.category);

    res.json({ ok: true, count: points.length, points, categories: CATEGORIES });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---------------- API: meta (categories -> subcategories from Airtable) ----------------
app.get("/api/meta", async (req, res) => {
  try {
    const maxRecords = Math.min(Number(req.query.max || 2000), 5000);
    const data = await airtableRequest("GET", `${TABLE_ID}?maxRecords=${encodeURIComponent(String(maxRecords))}`, null);

    const map = {};
    for (const c of CATEGORIES) map[c] = new Set();

    for (const r of (data.records || [])) {
      const f = r.fields || {};
      const cat = String(f[FIELD_CAT] || "").trim();
      const sub = String(f[FIELD_SUB] || "").trim();
      if (!cat) continue;
      if (!map[cat]) map[cat] = new Set();
      if (sub) map[cat].add(sub);
    }

    const out = {};
    for (const [k, set] of Object.entries(map)) {
      out[k] = Array.from(set).sort((a, b) => a.localeCompare(b, "pl"));
    }

    res.json({ ok: true, categories: CATEGORIES, subcategories: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---------------- API: submit (link OR address) ----------------
async function handleSubmitCore(body) {
  const name = String(body.name || "").trim();
  const linkOrAddr = String(body.link || "").trim();
  const category = String(body.category || "").trim();
  const subcategory = String(body.subcategory || "").trim();
  const note = String(body.note || "").trim();

  if (!name) return { ok: false, status: 400, error: "Brak nazwy" };
  if (!isValidCategory(category)) return { ok: false, status: 400, error: "Nieprawidłowa kategoria" };
  if (!linkOrAddr) return { ok: false, status: 400, error: "Brak linku lub adresu" };

  let coords = null;

  if (looksLikeHttpUrl(linkOrAddr)) {
    const { mapsUrl, finalUrl } = await resolveToMapsUrl(linkOrAddr);
    coords = extractLatLngFromUrl(mapsUrl) || extractLatLngFromUrl(finalUrl) || extractLatLngFromUrl(linkOrAddr);
  } else {
    const geo = await geocodeAddress(linkOrAddr);
    if (geo) coords = { lat: geo.lat, lng: geo.lng };
  }

  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
    return { ok: false, status: 400, error: "Nie udało się wyciągnąć współrzędnych. Wklej link z Google Maps albo pełny adres." };
  }

  const payload = {
    records: [
      {
        fields: {
          [FIELD_NAME]: name,
          [FIELD_CAT]: category,
          [FIELD_SUB]: subcategory,
          [FIELD_NOTE]: note,
          [FIELD_LAT]: String(coords.lat),
          [FIELD_LNG]: String(coords.lng),
        },
      },
    ],
  };

  const created = await airtableRequest("POST", `${TABLE_ID}`, payload);
  return { ok: true, created, coords };
}

app.post("/api/submit", async (req, res) => {
  try {
    const out = await handleSubmitCore(req.body);
    if (!out.ok) return res.status(out.status || 400).json(out);
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---------------- Notes API: list/add/delete ----------------
app.get("/api/points/:id/notes", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

    const rec = await airtableRequest("GET", `${TABLE_ID}/${id}`, null);
    const raw = String(rec?.fields?.[FIELD_NOTES] || "");
    res.json({ ok: true, notes: splitNotes(raw) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/points/:id/notes", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const text = String(req.body?.text || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing id" });
    if (!text) return res.status(400).json({ ok: false, error: "Pusta notatka" });

    const rec = await airtableRequest("GET", `${TABLE_ID}/${id}`, null);
    const raw = String(rec?.fields?.[FIELD_NOTES] || "");
    const list = splitNotes(raw);

    // BEZ TIMESTAMPÓW
    list.unshift(text);

    await airtableUpdateRecord(id, { [FIELD_NOTES]: joinNotes(list) });
    res.json({ ok: true, notes: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.delete("/api/points/:id/notes/:idx", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const idx = Number(req.params.idx);
    if (!id) return res.status(400).json({ ok: false, error: "Missing id" });
    if (!Number.isInteger(idx) || idx < 0) return res.status(400).json({ ok: false, error: "Bad idx" });

    const rec = await airtableRequest("GET", `${TABLE_ID}/${id}`, null);
    const raw = String(rec?.fields?.[FIELD_NOTES] || "");
    const list = splitNotes(raw);

    if (idx >= list.length) return res.status(400).json({ ok: false, error: "Idx out of range" });

    list.splice(idx, 1);
    await airtableUpdateRecord(id, { [FIELD_NOTES]: joinNotes(list) });
    res.json({ ok: true, notes: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MapYourPoints on :${PORT}`));
