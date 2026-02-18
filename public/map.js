const map = L.map("map").setView([52.2297, 21.0122], 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

// ===== Panel minimalize =====
const panel = document.getElementById("panel");
const toggleBtn = document.getElementById("panelToggle");
toggleBtn.onclick = () => {
  panel.classList.toggle("isMin");
};

// ===== Buttons =====
const myLocBtn = document.getElementById("myLocBtn");
myLocBtn.onclick = () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      setMyLocation(latitude, longitude, accuracy);
      map.setView([latitude, longitude], Math.max(map.getZoom(), 14));
    },
    () => {},
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 }
  );
};

// ===== My location marker =====
let myLocationMarker = null;
let myAccuracyCircle = null;
function setMyLocation(lat, lng, accuracy) {
  if (!myLocationMarker) {
    myLocationMarker = L.circleMarker([lat, lng], {
      radius: 7,
      weight: 2,
      color: "rgba(0,0,0,0.4)",
      fillColor: "#000",
      fillOpacity: 0.9,
    }).addTo(map);
    myLocationMarker.bindPopup(`Ty (dokładność ~${Math.round(accuracy)}m)`);
  } else {
    myLocationMarker.setLatLng([lat, lng]);
    myLocationMarker.setPopupContent(`Ty (dokładność ~${Math.round(accuracy)}m)`);
  }

  if (Number.isFinite(accuracy)) {
    if (!myAccuracyCircle) {
      myAccuracyCircle = L.circle([lat, lng], {
        radius: Math.max(accuracy, 10),
        weight: 1,
        color: "rgba(0,0,0,0.2)",
        fillColor: "rgba(0,0,0,0.06)",
        fillOpacity: 1,
      }).addTo(map);
    } else {
      myAccuracyCircle.setLatLng([lat, lng]);
      myAccuracyCircle.setRadius(Math.max(accuracy, 10));
    }
  }
}

// ===== Notes UI =====
const notesBox = document.getElementById("notesBox");
const notesTitle = document.getElementById("notesTitle");
const notesClose = document.getElementById("notesClose");
const notesInput = document.getElementById("notesInput");
const notesAdd = document.getElementById("notesAdd");
const notesList = document.getElementById("notesList");
const notesStatus = document.getElementById("notesStatus");

let activePointId = null;
let activePointName = "";

notesClose.onclick = () => {
  notesBox.style.display = "none";
  activePointId = null;
  notesInput.value = "";
  notesList.innerHTML = "";
  notesStatus.textContent = "";
};

async function fetchNotes(pointId) {
  const res = await fetch(`/api/points/${encodeURIComponent(pointId)}/notes`, { cache: "no-store" });
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || "Notes error");
  return data.notes || [];
}

function renderNotes(notes) {
  notesList.innerHTML = "";
  if (!notes.length) {
    const el = document.createElement("div");
    el.className = "small muted";
    el.textContent = "Brak notatek.";
    notesList.appendChild(el);
    return;
  }

  notes.forEach((txt, idx) => {
    const row = document.createElement("div");
    row.className = "noteRow";

    const pre = document.createElement("div");
    pre.className = "noteText";
    pre.textContent = txt;

    const del = document.createElement("button");
    del.className = "iconBtn";
    del.title = "Usuń notatkę";
    del.textContent = "🗑";
    del.onclick = async () => {
      try {
        notesStatus.textContent = "Usuwam…";
        const res = await fetch(`/api/points/${encodeURIComponent(activePointId)}/notes/${idx}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!data?.ok) throw new Error(data?.error || "Delete failed");
        renderNotes(data.notes || []);
        notesStatus.textContent = "✅ Usunięto";
        setTimeout(() => (notesStatus.textContent = ""), 900);
      } catch (e) {
        notesStatus.textContent = `⚠️ ${e.message}`;
      }
    };

    row.appendChild(pre);
    row.appendChild(del);
    notesList.appendChild(row);
  });
}

async function openNotes(pointId, pointName) {
  activePointId = pointId;
  activePointName = pointName;

  notesTitle.textContent = `Notatki · ${pointName}`;
  notesBox.style.display = "block";
  panel.classList.remove("isMin"); // rozwiń panel gdy wchodzimy w notatki

  try {
    notesStatus.textContent = "Ładuję…";
    const notes = await fetchNotes(pointId);
    renderNotes(notes);
    notesStatus.textContent = "";
  } catch (e) {
    notesStatus.textContent = `⚠️ ${e.message}`;
  }
}

notesAdd.onclick = async () => {
  const text = String(notesInput.value || "").trim();
  if (!activePointId) return;
  if (!text) return;

  try {
    notesStatus.textContent = "Zapisuję…";
    const res = await fetch(`/api/points/${encodeURIComponent(activePointId)}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || "Add failed");
    notesInput.value = "";
    renderNotes(data.notes || []);
    notesStatus.textContent = "✅ Dodano";
    setTimeout(() => (notesStatus.textContent = ""), 900);
  } catch (e) {
    notesStatus.textContent = `⚠️ ${e.message}`;
  }
};

// ===== Map markers + filters =====
const BASE_COLORS = {
  "Stacja benzynowa": "#2e7d32",
  "Warsztat": "#ef6c00",
  "Parking": "#1565c0",
  "Ważne Miejsce": "#6a1b9a",
  "Agencja celna / weterynarz": "#8d6e63",
};

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function hashTo01(str) {
  const s = String(str || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
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
  const a = hexToRgb(c1), b = hexToRgb(c2);
  return rgbToHex({ r: Math.round(a.r + (b.r - a.r) * t), g: Math.round(a.g + (b.g - a.g) * t), b: Math.round(a.b + (b.b - a.b) * t) });
}
function colorFor(category, subcategory) {
  const base = BASE_COLORS[category] || "#333";
  const sub = String(subcategory || "").trim();
  if (!sub) return base;
  const t = hashTo01(`${category}::${sub}`);
  return t < 0.5 ? mix(base, "#fff", 0.18 + t * 0.22) : mix(base, "#000", 0.12 + (t - 0.5) * 0.22);
}

const layers = new Map();   // key -> layerGroup
const enabled = new Map();  // key -> bool
const markers = new Map();  // key -> markers

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

  // label (tylko przy zoom>=12 i małym zagęszczeniu)
  m.bindTooltip(esc(p.name), {
    permanent: true,
    direction: "top",
    offset: [0, -8],
    opacity: 0.95,
    className: "markerLabel",
  });

  const dest = encodeURIComponent(`${p.lat},${p.lng}`);
  const gmapsNav = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;

  const popup = `
    <div class="popupTitle">${esc(p.name)}</div>
    <div class="popupMeta">
      <div><strong>${esc(cat)}</strong>${sub ? ` · <span>${esc(sub)}</span>` : ""}</div>
      ${note ? `<div class="popupNote">${esc(note)}</div>` : ""}
    </div>
    <div class="popupActions">
      <a class="btn" href="${gmapsNav}" target="_blank" rel="noopener">Nawiguj</a>
      <button class="btn" data-notes="1">Notatki</button>
    </div>
  `;

  m.bindPopup(popup);
  m.on("popupopen", (e) => {
    const root = e.popup.getElement();
    const btnNotes = root?.querySelector("button[data-notes]");
    if (btnNotes) {
      btnNotes.onclick = () => openNotes(p.id, p.name);
    }
  });

  m.addTo(layers.get(key));
  markers.get(key).push(m);
  if (!enabled.get(key)) map.removeLayer(layers.get(key));
}

function renderFilters() {
  const el = document.getElementById("filters");
  el.innerHTML = "";

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
        updateLabelsVisibility();
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

function visibleMarkerCountInView() {
  const b = map.getBounds();
  let n = 0;
  for (const [k, isOn] of enabled.entries()) {
    if (!isOn) continue;
    for (const m of (markers.get(k) || [])) {
      if (b.contains(m.getLatLng())) n++;
    }
  }
  return n;
}

function updateLabelsVisibility() {
  const zoom = map.getZoom();
  const inView = visibleMarkerCountInView();
  const show = (zoom >= 12) && (inView <= 80);

  for (const [k, isOn] of enabled.entries()) {
    const arr = markers.get(k) || [];
    for (const m of arr) {
      const tt = m.getTooltip();
      const el = tt?.getElement?.();
      if (!el) continue;
      el.style.display = (show && isOn) ? "block" : "none";
    }
  }
}

map.on("zoomend moveend", updateLabelsVisibility);

async function refresh() {
  try {
    const res = await fetch("/api/points?max=5000", { cache: "no-store" });
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || "Bad response");

    clearAll();
    for (const p of data.points) addPoint(p);

    renderFilters();
    updateLabelsVisibility();
  } catch (e) {
    // celowo bez spamowania UI — panel ma być mały
    console.warn(e);
  }
}

refresh();
setInterval(refresh, 15000);
