import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "500kb" }));
app.use(express.urlencoded({ extended: true }));

// ===== Airtable config (env) =====
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;

// ===== Airtable fields =====
const FIELD_NAME = "Name";
const FIELD_LAT = "Lattitude";     // literówka celowo
const FIELD_LNG = "Longitude";
const FIELD_CAT = "Category";
const FIELD_SUB = "Subcategory";
const FIELD_NOTE = "Note";
const FIELD_NOTES = "Notatki";     // NEW long text

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

// ---------- Maps link parsing ----------
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

  // @lat,lng
  m = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  // ?q=lat,lng
  m = s.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  // /maps/search/lat,lng
  m = s.match(/\/maps\/search\/(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  // !3dLAT!4dLNG
  m = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

  // destination=lat,lng
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

  // canonical
  let m = s.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (m?.[1]) return resolveRelativeUrl(baseUrl, m[1].replace(/&amp;/g, "&"));

  // meta refresh
  m = s.match(/http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i);
  if (m?.[1]) return resolveRelativeUrl(baseUrl, m[1].trim().replace(/&amp;/g, "&"));

  // JS redirects
  m = s.match(/(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
  if (m?.[1]) return resolveRelativeUrl(baseUrl, m[1].replace(/&amp;/g, "&"));

  m = s.match(/location\.replace\(\s*["']([^"']+)["']\s*\)/i);
  if (m?.[1]) return resolveRelativeUrl(baseUrl, m[1].replace(/&amp;/g, "&"));

  // embedded URLs
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

    if (extractLatLngFromUrl(current)) {
      return { finalUrl: current, visited, lastHtml };
    }

    const res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      headers: browserHeaders(),
    });

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

    // google /url?q=...
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

  let coords = extractLatLngFromUrl(finalUrl);

  if (!coords && lastHtml) {
    const maybe = extractMapsUrlFromHtml(lastHtml, finalUrl);
    if (maybe) {
      const again = await resolveRedirectChain(maybe, 6);
      coords = extractLatLngFromUrl(again.finalUrl) || extractLatLngFromUrl(maybe);
      if (coords) return { mapsUrl: again.finalUrl, finalUrl: again.finalUrl, visited: [...visited, ...again.visited] };
    }
  }

  return { mapsUrl: finalUrl, finalUrl, visited };
}

// ---------- Airtable ----------
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

async function airtableUpdateRecord(recordId, fields) {
  return airtableRequest("PATCH", `${TABLE_ID}/${recordId}`, { fields });
}

// ---------- Static ----------
app.use(express.static(path.join(__dirname, "public"), { etag: false, maxAge: "0" }));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public/index.html")));
app.get("/form", (req, res) => res.sendFile(path.join(__dirname, "public/form.html")));

// ---------- API: list points ----------
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
          createdTime: r.createdTime,
        };
      })
      .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.category);

    res.json({ ok: true, count: points.length, points, categories: CATEGORIES });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---------- API: submit ----------
async function handleSubmitCore(body) {
  const name = String(body.name || "").trim();
  const link = String(body.link || "").trim();
  const category = String(body.category || "").trim();
  const subcategory = String(body.subcategory || "").trim(); // <- TU MA BYĆ TEKST
  const note = String(body.note || "").trim();

  if (!name) return { ok: false, status: 400, error: "Missing name" };
  if (!isValidCategory(category)) return { ok: false, status: 400, error: "Invalid category" };
  if (!link) return { ok: false, status: 400, error: "Missing google maps link" };

  const { mapsUrl, finalUrl, visited } = await resolveToMapsUrl(link);
  const debug = { mapsUrl, finalUrl, visited };

  const coords = extractLatLngFromUrl(mapsUrl) || extractLatLngFromUrl(finalUrl) || extractLatLngFromUrl(link);
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
    return { ok: false, status: 400, error: "Nie udało się wyciągnąć współrzędnych z linku.", debug };
  }

  const payload = {
    records: [
      {
        fields: {
          [FIELD_NAME]: name,
          [FIELD_CAT]: category,
          [FIELD_SUB]: subcategory, // <- zapisujemy string
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

app.post("/api/submit", async (req, res) => {
  try {
    const out = await handleSubmitCore(req.body);
    if (!out.ok) return res.status(out.status || 400).json(out);
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---------- Notes API ----------
function splitNotes(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return [];
  return txt.split("\n---\n").map(s => s.trim()).filter(Boolean);
}

function joinNotes(list) {
  return list.map(s => String(s).trim()).filter(Boolean).join("\n---\n");
}

function stamp() {
  const d = new Date();
  // ISO bez ms
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// list notes
app.get("/api/points/:id/notes", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

    const rec = await airtableRequest("GET", `${TABLE_ID}/${id}`, null);
    const raw = String(rec?.fields?.[FIELD_NOTES] || "");
    const notes = splitNotes(raw);

    res.json({ ok: true, notes });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// add note
app.post("/api/points/:id/notes", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const text = String(req.body?.text || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing id" });
    if (!text) return res.status(400).json({ ok: false, error: "Empty note" });

    const rec = await airtableRequest("GET", `${TABLE_ID}/${id}`, null);
    const raw = String(rec?.fields?.[FIELD_NOTES] || "");
    const list = splitNotes(raw);

    list.unshift(`[${stamp()}] ${text}`);
    const updated = joinNotes(list);

    await airtableUpdateRecord(id, { [FIELD_NOTES]: updated });
    res.json({ ok: true, notes: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// delete note by index
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
    const updated = joinNotes(list);

    await airtableUpdateRecord(id, { [FIELD_NOTES]: updated });
    res.json({ ok: true, notes: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MapYourPoints on :${PORT}`));
