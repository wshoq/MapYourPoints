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

// --- helpers ---
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

    // ?ll=lat,lng (czasem bywa %2C)
    m = s.match(/[?&]ll=(-?\d+(?:\.\d+)?)(?:%2C|,)(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };

    return null;
  } catch {
    return null;
  }
}

function looksLikeHttpUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === "http:" || x.protocol === "https:";
  } catch {
    return false;
  }
}

// wyciąga z HTML potencjalny „prawdziwy” link do maps
function extractMapsUrlFromHtml(html) {
  const s = String(html || "");

  // canonical
  let m = s.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
  if (m && looksLikeHttpUrl(m[1])) return m[1];

  // meta refresh
  m = s.match(/http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/i);
  if (m) {
    const u = m[1].trim().replace(/&amp;/g, "&");
    if (looksLikeHttpUrl(u)) return u;
  }

  // szukaj pierwszego sensownego URL do google maps
  m = s.match(/https:\/\/www\.google\.com\/maps[^"'\s<]+/i);
  if (m) return m[0].replace(/&amp;/g, "&");

  m = s.match(/https:\/\/maps\.app\.goo\.gl\/[^"'\s<]+/i);
  if (m) return m[0].replace(/&amp;/g, "&");

  // czasem jest encoded url=...
  m = s.match(/url=([^&"'<> ]+)/i);
  if (m) {
    const decoded = decodeURIComponent(m[1]).replace(/&amp;/g, "&");
    if (looksLikeHttpUrl(decoded)) return decoded;
  }

  return null;
}

// fetch, ale tak żeby shortlinki zadziałały „jak w przeglądarce”
async function fetchWithBrowserHeaders(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      // share.google lubi wyglądać jak browser
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  return res;
}

// rozwiązuje shortlink -> final URL (a jeśli final to HTML, wyciąga z niego link do maps)
async function resolveToMapsUrl(inputUrl) {
  const u = String(inputUrl || "").trim();
  if (!u) return { finalUrl: u, mapsUrl: null };

  // 1) spróbuj klasycznie: fetch i redirect follow
  let res = await fetchWithBrowserHeaders(u);
  let finalUrl = res.url || u;

  // 2) jeśli finalUrl już ma coords -> super
  if (extractLatLngFromUrl(finalUrl)) return { finalUrl, mapsUrl: finalUrl };

  // 3) jeśli odpowiedź jest HTML -> spróbuj wyciągnąć mapsUrl z treści
  const ctype = (res.headers.get("content-type") || "").toLowerCase();
  if (ctype.includes("text/html")) {
    const html = await res.text();
    const fromHtml = extractMapsUrlFromHtml(html);
    if (fromHtml) {
      // spróbuj jeszcze raz rozwinąć (bo to może być maps.app.goo.gl)
      if (extractLatLngFromUrl(fromHtml)) return { finalUrl, mapsUrl: fromHtml };

      // follow redirects on extracted
      const res2 = await fetchWithBrowserHeaders(fromHtml);
      const final2 = res2.url || fromHtml;

      if (extractLatLngFromUrl(final2)) return { finalUrl: final2, mapsUrl: final2 };

      // czasem coords siedzą w tym fromHtml mimo że res2.url nie ma
      if (extractLatLngFromUrl(fromHtml)) return { finalUrl: fromHtml, mapsUrl: fromHtml };

      return { finalUrl: final2, mapsUrl: final2 };
    }
  }

  // 4) fallback
  return { finalUrl, mapsUrl: finalUrl };
}

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
app.use(
  express.static(path.join(__dirname, "public"), {
    etag: false,
    maxAge: "0",
  })
);

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

  // coords: allow manual later, but prefer link
  let lat = Number(body.lat);
  let lng = Number(body.lng);

  let coords = null;
  let debug = {};

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    coords = { lat, lng };
  } else {
    if (!link) return { ok: false, status: 400, error: "Missing google maps link" };

    const { finalUrl, mapsUrl } = await resolveToMapsUrl(link);
    debug = { finalUrl, mapsUrl };

    coords = extractLatLngFromUrl(mapsUrl) || extractLatLngFromUrl(finalUrl) || extractLatLngFromUrl(link);

    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
      return {
        ok: false,
        status: 400,
        error:
          "Nie udało się wyciągnąć współrzędnych z linku. Spróbuj: Google Maps → Udostępnij → Skopiuj link (albo udostępnij pinezkę, nie samą stronę).",
        debug,
      };
    }
  }

  const payload = {
    records: [
      {
        fields: {
          [FIELD_NAME]: name,
          [FIELD_CAT]: category,
          [FIELD_SUB]: subcategory || "",
          [FIELD_NOTE]: note || "",
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

// Form fallback
app.post("/submit", async (req, res) => {
  try {
    const out = await handleSubmitCore(req.body);
    if (!out.ok) {
      const msg = encodeURIComponent(out.error || "Submit failed");
      return res.redirect(`/form?err=${msg}`);
    }
    return res.redirect("/form?ok=1");
  } catch (e) {
    const msg = encodeURIComponent(String(e.message || e));
    return res.redirect(`/form?err=${msg}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`road-map on :${PORT}`));
