import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "300kb" }));
app.use(express.urlencoded({ extended: true })); // form POST fallback

// === Airtable config (env) ===
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID;   // <- ustaw w env
const TABLE_ID = process.env.AIRTABLE_TABLE_ID; // <- ustaw w env

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

async function resolveFinalUrl(url) {
  const u = String(url || "").trim();
  if (!u) return u;
  const res = await fetch(u, { redirect: "follow" });
  return res.url || u;
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
        const category = String(f[FIELD_CAT] || "").trim();
        const subcategory = String(f[FIELD_SUB] || "").trim();
        const note = String(f[FIELD_NOTE] || "").trim();

        return {
          id: r.id,
          name: String(f[FIELD_NAME] || "").trim(),
          lat: Number(f[FIELD_LAT]),
          lng: Number(f[FIELD_LNG]),
          category,
          subcategory,
          note,
          createdTime: r.createdTime,
        };
      })
      .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.category);

    res.json({ ok: true, count: points.length, points, categories: CATEGORIES });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// --- submit core (dla /api/submit i /submit) ---
async function handleSubmitCore(body) {
  const name = String(body.name || "").trim();
  const link = String(body.link || "").trim();
  const category = String(body.category || "").trim();
  const subcategory = String(body.subcategory || "").trim();
  const note = String(body.note || "").trim();

  if (!name) return { ok: false, status: 400, error: "Missing name" };
  if (!isValidCategory(category)) return { ok: false, status: 400, error: "Invalid category" };

  // coords: prefer link (jak wcześniej), ale wspieramy też ręczne lat/lng jeśli kiedyś dodasz
  let lat = Number(body.lat);
  let lng = Number(body.lng);

  let coords = null;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    coords = { lat, lng };
  } else {
    if (!link) return { ok: false, status: 400, error: "Missing google maps link" };

    const finalUrl = await resolveFinalUrl(link);
    coords = extractLatLngFromUrl(finalUrl) || extractLatLngFromUrl(link);

    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
      return {
        ok: false,
        status: 400,
        error:
          "Could not extract lat/lng from the link. Use Google Maps → Share and paste a link that contains coordinates.",
        debugFinalUrl: finalUrl,
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
  return { ok: true, created, coords };
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

// Form fallback -> redirect
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
