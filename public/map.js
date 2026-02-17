const REFRESH_MS = 15000;
document.getElementById("refresh").textContent = String(REFRESH_MS / 1000);

const map = L.map("map").setView([52.2297, 21.0122], 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

// ===== UI panel toggle (mobile-friendly) =====
const panel = document.getElementById("panel");
const toggleBtn = document.getElementById("panelToggle");
const closeBtn = document.getElementById("panelClose");

function setPanel(open) {
  panel.classList.toggle("isOpen", !!open);
}
toggleBtn.onclick = () => setPanel(!panel.classList.contains("isOpen"));
closeBtn.onclick = () => setPanel(false);

// close on map click (mobile convenience)
map.on("click", () => {
  if (window.innerWidth <= 900) setPanel(false);
});

// ===== Categories -> base colors =====
const BASE_COLORS = {
  "Stacja benzynowa": "#2e7d32",
  "Warsztat": "#ef6c00",
  "Parking": "#1565c0",
  "Ważne Miejsce": "#6a1b9a",
  "Agencja celna / weterynarz": "#8d6e63",
};

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function hashTo01(str) {
  // deterministic 0..1
  const s = String(str || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 0..1
  return ((h >>> 0) % 1000) / 999;
}

function hexToRgb(hex) {
  const m = String(hex).replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map(x => x + x).join("") : m, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  const to = (x) => x.toString(16).padStart(2, "0");
  return `#${to(Math.max(0, Math.min(255, r)))}${to(Math.max(0, Math.min(255, g)))}${to(Math.max(0, Math.min(255, b)))}`;
}

function mix(c1, c2, t) {
  const a = hexToRgb(c1);
  const b = hexToRgb(c2);
  return rgbToHex({
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  });
}

function colorFor(category, subcategory) {
  const base = BASE_COLORS[category] || "#333333";
  const sub = String(subcategory || "").trim();
  if (!sub) return base;

  // “odcień” w obrębie kategorii
  const t = hashTo01(`${category}::${sub}`);
  // mieszamy z bielą i czernią w zależności od t (żeby były różne odcienie)
  if (t < 0.5) return mix(base, "#ffffff", 0.18 + t * 0.22); // jaśniej
  return mix(base, "#000000", 0.12 + (t - 0.5) * 0.22); // ciemniej
}

// ===== Data structures =====
const layers = new Map(); // key = "Category||Subcategory" -> layerGroup
const enabled = new Map(); // key -> bool
const markers = new Map(); // key -> [marker]
let didInitialFit = false;
let userInteracted = false;

map.on("dragstart zoomstart", () => { userInteracted = true; });

function keyOf(p) {
  const cat = String(p.category || "").trim();
  const sub = String(p.subcategory || "").trim();
  return `${cat}||${sub}`;
}

function ensureLayer(key) {
  if (!layers.has(key)) {
    const g = L.layerGroup().addTo(map);
    layers.set(key, g);
    enabled.set(key, true);
    markers.set(key, []);
  }
}

function clearAll() {
  for (const [k, g] of layers.entries()) {
    g.clearLayers();
    markers.set(k, []);
  }
}

function addPoint(p) {
  const cat = String(p.category || "").trim();
  const sub = String(p.subcategory || "").trim();
  const note = String(p.note || "").trim();
  const key = keyOf(p);

  ensureLayer(key);

  const col = colorFor(cat, sub);

  const m = L.circleMarker([p.lat, p.lng], {
    radius: 7,
    weight: 2,
    color: "rgba(0,0,0,0.35)",
    fillColor: col,
    fillOpacity: 0.92,
  });

  const dest = encodeURIComponent(`${p.lat},${p.lng}`);
  const gmapsNav = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;

  const popup = `
    <div class="popupTitle">${esc(p.name)}</div>
    <div class="popupMeta">
      <div><strong>${esc(cat)}</strong>${sub ? ` · <span>${esc(sub)}</span>` : ""}</div>
      ${note ? `<div class="popupNote">${esc(note)}</div>` : ""}
      ${p.createdTime ? `<div class="popupTime muted">${esc(p.createdTime)}</div>` : ""}
    </div>
    <div class="popupActions">
      <a class="btn" href="${gmapsNav}" target="_blank" rel="noopener">Nawiguj</a>
      <button class="btn" data-copy="${esc(gmapsNav)}">Kopiuj link</button>
    </div>
  `;

  m.bindPopup(popup);
  m.on("popupopen", (e) => {
    const root = e.popup.getElement();
    if (!root) return;
    const btn = root.querySelector("button[data-copy]");
    if (!btn) return;
    btn.onclick = async () => {
      const url = btn.getAttribute("data-copy") || "";
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = "Skopiowano ✓";
        setTimeout(() => (btn.textContent = "Kopiuj link"), 1200);
      } catch {
        // fallback
        prompt("Skopiuj:", url);
      }
    };
  });

  m.addTo(layers.get(key));
  markers.get(key).push(m);

  if (!enabled.get(key)) map.removeLayer(layers.get(key));
}

function fitToVisible() {
  const bounds = L.latLngBounds([]);
  let any = false;

  for (const [k, isOn] of enabled.entries()) {
    if (!isOn) continue;
    const arr = markers.get(k) || [];
    for (const m of arr) {
      bounds.extend(m.getLatLng());
      any = true;
    }
  }

  if (any) map.fitBounds(bounds.pad(0.18));
}

function renderFilters() {
  const el = document.getElementById("filters");
  el.innerHTML = "";

  // build: category -> subcategory[] (including empty "")
  const byCat = new Map();
  for (const k of layers.keys()) {
    const [cat, sub] = k.split("||");
    if (!byCat.has(cat)) byCat.set(cat, new Set());
    byCat.get(cat).add(sub || "");
  }

  const cats = Array.from(byCat.keys()).sort((a, b) => a.localeCompare(b, "pl"));

  for (const cat of cats) {
    const subs = Array.from(byCat.get(cat)).sort((a, b) => a.localeCompare(b, "pl"));

    const details = document.createElement("details");
    details.open = true;

    const summary = document.createElement("summary");
    summary.innerHTML = `
      <span class="swatch" style="background:${colorFor(cat, "")}"></span>
      <span>${esc(cat)}</span>
      <span class="muted" style="margin-left:auto;">${countForCategory(cat)}</span>
    `;
    details.appendChild(summary);

    const list = document.createElement("div");
    list.className = "subList";

    for (const sub of subs) {
      const k = `${cat}||${sub}`;
      const isOn = !!enabled.get(k);

      const row = document.createElement("label");
      row.className = "subRow";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = isOn;
      cb.onchange = () => {
        enabled.set(k, cb.checked);
        const g = layers.get(k);
        if (cb.checked) g.addTo(map);
        else map.removeLayer(g);
      };

      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = colorFor(cat, sub);

      const name = document.createElement("span");
      name.textContent = sub ? sub : "(bez podkategorii)";

      const cnt = document.createElement("span");
      cnt.className = "muted";
      cnt.textContent = String((markers.get(k) || []).length);

      row.appendChild(cb);
      row.appendChild(sw);
      row.appendChild(name);
      row.appendChild(cnt);
      list.appendChild(row);
    }

    details.appendChild(list);
    el.appendChild(details);
  }
}

function countForCategory(cat) {
  let n = 0;
  for (const k of layers.keys()) {
    const [c] = k.split("||");
    if (c !== cat) continue;
    n += (markers.get(k) || []).length;
  }
  return n;
}

async function refresh() {
  const status = document.getElementById("status");
  const countEl = document.getElementById("count");

  try {
    const res = await fetch("/api/points?max=5000", { cache: "no-store" });
    const data = await res.json();
    if (!data || !data.ok) throw new Error(data?.error || "Bad response");

    clearAll();
    for (const p of data.points) addPoint(p);

    renderFilters();

    status.textContent = `✅ OK · ${new Date().toLocaleTimeString()}`;
    countEl.textContent = `Punkty: ${data.count}`;

    if (!didInitialFit && !userInteracted) {
      fitToVisible();
      didInitialFit = true;
    }
  } catch (e) {
    status.textContent = `⚠️ ${e.message}`;
  }
}

document.getElementById("fitBtn").onclick = () => fitToVisible();
document.getElementById("reloadBtn").onclick = () => refresh();

refresh();
setInterval(refresh, REFRESH_MS);
