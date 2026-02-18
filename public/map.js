const REFRESH_MS = 15000;

const map = L.map("map").setView([52.2297, 21.0122], 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap",
}).addTo(map);

// Panel
const panel = document.getElementById("panel");
document.getElementById("panelToggle").onclick = () => panel.classList.toggle("isMin");

// Moja lokalizacja
let myMarker = null;
let myCircle = null;
function setMyLocation(lat, lng, accuracy) {
  if (!myMarker) {
    myMarker = L.circleMarker([lat, lng], {
      radius: 7, weight: 2,
      color: "rgba(0,0,0,0.4)", fillColor: "#000", fillOpacity: 0.9,
    }).addTo(map);
  } else myMarker.setLatLng([lat, lng]);

  if (Number.isFinite(accuracy)) {
    if (!myCircle) {
      myCircle = L.circle([lat, lng], {
        radius: Math.max(accuracy, 10),
        weight: 1, color: "rgba(0,0,0,0.2)",
        fillColor: "rgba(0,0,0,0.06)", fillOpacity: 1,
      }).addTo(map);
    } else {
      myCircle.setLatLng([lat, lng]);
      myCircle.setRadius(Math.max(accuracy, 10));
    }
  }
}
document.getElementById("myLocBtn").onclick = () => {
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

// Notes panel UI
const notesBox = document.getElementById("notesBox");
const notesTitle = document.getElementById("notesTitle");
const notesClose = document.getElementById("notesClose");
const notesInput = document.getElementById("notesInput");
const notesAdd = document.getElementById("notesAdd");
const notesList = document.getElementById("notesList");
const notesStatus = document.getElementById("notesStatus");

let activePointId = null;
let activePointName = null;

notesClose.onclick = () => {
  notesBox.style.display = "none";
  activePointId = null;
  activePointName = null;
  notesInput.value = "";
  notesList.innerHTML = "";
  notesStatus.textContent = "";
};

async function apiGetNotes(id) {
  const res = await fetch(`/api/points/${encodeURIComponent(id)}/notes`, { cache: "no-store" });
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || "Notes error");
  return data.notes || [];
}
async function apiAddNote(id, text) {
  const res = await fetch(`/api/points/${encodeURIComponent(id)}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || "Add failed");
  return data.notes || [];
}
async function apiDeleteNote(id, idx) {
  const res = await fetch(`/api/points/${encodeURIComponent(id)}/notes/${idx}`, { method: "DELETE" });
  const data = await res.json();
  if (!data?.ok) throw new Error(data?.error || "Delete failed");
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

    const t = document.createElement("div");
    t.className = "noteText";
    t.textContent = txt;

    const del = document.createElement("button");
    del.className = "iconBtn";
    del.title = "Usuń";
    del.textContent = "🗑";
    del.onclick = async () => {
      try {
        notesStatus.textContent = "Usuwam…";
        const updated = await apiDeleteNote(activePointId, idx);
        renderNotes(updated);
        notesStatus.textContent = "";
      } catch (e) {
        notesStatus.textContent = `⚠️ ${e.message}`;
      }
    };

    row.appendChild(t);
    row.appendChild(del);
    notesList.appendChild(row);
  });
}

async function openNotesPanel(id, name) {
  activePointId = id;
  activePointName = name;
  notesTitle.textContent = `Notatki · ${name}`;
  notesBox.style.display = "block";
  panel.classList.remove("isMin");

  try {
    notesStatus.textContent = "Ładuję…";
    const notes = await apiGetNotes(id);
    renderNotes(notes);
    notesStatus.textContent = "";
  } catch (e) {
    notesStatus.textContent = `⚠️ ${e.message}`;
  }
}

notesAdd.onclick = async () => {
  const text = String(notesInput.value || "").trim();
  if (!activePointId || !text) return;
  try {
    notesStatus.textContent = "Zapisuję…";
    const updated = await apiAddNote(activePointId, text);
    notesInput.value = "";
    renderNotes(updated);
    notesStatus.textContent = "";
  } catch (e) {
    notesStatus.textContent = `⚠️ ${e.message}`;
  }
};

// Colors
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

// Layers / filters
const layers = new Map();   // key -> layerGroup
const enabled = new Map();  // key -> bool
const markers = new Map();  // key -> marker[]
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
    radius: 7, weight: 2,
    color: "rgba(0,0,0,0.35)",
    fillColor: col, fillOpacity: 0.92,
  });

  // label (większy zasięg)
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
      <button class="btn" data-addnote="1">Dodaj notatkę</button>
      <button class="btn" data-shownotes="1">Wyświetl notatki</button>
    </div>

    <div class="popupInlineNote" data-inline="1" style="display:none;">
      <textarea placeholder="Wpisz notatkę…"></textarea>
      <div class="row" style="gap:8px; margin-top:8px;">
        <button class="btn" data-save="1">Zapisz</button>
        <button class="btn" data-cancel="1">Anuluj</button>
        <div class="small muted" data-msg="1"></div>
      </div>
    </div>
  `;

  m.bindPopup(popup);

  m.on("popupopen", (e) => {
    const root = e.popup.getElement();
    if (!root) return;

    const btnAdd = root.querySelector("button[data-addnote]");
    const btnShow = root.querySelector("button[data-shownotes]");
    const box = root.querySelector("div[data-inline]");
    const ta = box?.querySelector("textarea");
    const btnSave = box?.querySelector("button[data-save]");
    const btnCancel = box?.querySelector("button[data-cancel]");
    const msg = box?.querySelector("div[data-msg]");

    if (btnAdd && box) {
      btnAdd.onclick = () => {
        box.style.display = "block";
        if (ta) ta.focus();
      };
    }

    if (btnCancel && box) {
      btnCancel.onclick = () => {
        box.style.display = "none";
        if (ta) ta.value = "";
        if (msg) msg.textContent = "";
      };
    }

    if (btnSave && ta && msg) {
      btnSave.onclick = async () => {
        const text = String(ta.value || "").trim();
        if (!text) return;
        msg.textContent = "Zapisuję…";
        try {
          await apiAddNote(p.id, text);
          ta.value = "";
          box.style.display = "none";
          msg.textContent = "";
        } catch (err) {
          msg.textContent = `⚠️ ${err.message}`;
        }
      };
    }

    if (btnShow) {
      btnShow.onclick = () => openNotesPanel(p.id, p.name);
    }
  });

  m.addTo(layers.get(key));
  markers.get(key).push(m);

  if (!enabled.get(key)) map.removeLayer(layers.get(key));
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
      name.textContent = sub ? sub : "(brak)";

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

  // wcześniej + większy limit
  const show = (zoom >= 10) && (inView <= 160);

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
    console.warn(e);
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
