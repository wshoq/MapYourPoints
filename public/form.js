const LS_META = "mapyourpoints_meta_v2";
const LS_SUBS = "mapyourpoints_subs_v5";     // cat -> [subs]
const LS_CATS = "mapyourpoints_cats_v1";     // [cats]
const LS_CAT_COLORS = "mapyourpoints_cat_colors_v1";
const LS_DRAFT = "mapyourpoints_form_draft_v5";

function uniq(arr) {
  return Array.from(new Set((arr || []).map(s => String(s).trim()).filter(Boolean)));
}
function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) ?? fallback) : fallback;
  } catch { return fallback; }
}
function saveJson(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
}
function saveDraft(getState) { saveJson(LS_DRAFT, getState()); }
function loadDraft() { return loadJson(LS_DRAFT, null); }
function clearDraft() { localStorage.removeItem(LS_DRAFT); }

function hashTo01(str) {
  const s = String(str || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 999;
}
function mixHex(a, b, t) {
  const toRgb = (hex) => {
    const m = String(hex).replace("#", "");
    const n = parseInt(m.length === 3 ? m.split("").map(x => x + x).join("") : m, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };
  const toHex = ({ r, g, b }) => {
    const to = (x) => x.toString(16).padStart(2, "0");
    return `#${to(r)}${to(g)}${to(b)}`;
  };
  const A = toRgb(a), B = toRgb(b);
  return toHex({
    r: Math.round(A.r + (B.r - A.r) * t),
    g: Math.round(A.g + (B.g - A.g) * t),
    b: Math.round(A.b + (B.b - A.b) * t),
  });
}
function randomNiceColor(seedStr) {
  const t = hashTo01(seedStr);
  const baseA = "#1565c0", baseB = "#6a1b9a", baseC = "#2e7d32";
  const base = t < 0.33 ? baseA : (t < 0.66 ? baseB : baseC);
  return mixHex(base, "#ffffff", 0.10 + (t * 0.12));
}

// elements
const f = document.getElementById("f");
const nameEl = document.getElementById("name");
const linkEl = document.getElementById("link");
const noteEl = document.getElementById("note");
const catEl = document.getElementById("category");
const subEl = document.getElementById("subcategory");
const submitBtn = document.getElementById("submitBtn");
const okEl = document.getElementById("ok");
const errEl = document.getElementById("err");

// manage categories
const manageCatBtn = document.getElementById("manageCatBtn");
const manageCatBox = document.getElementById("manageCatBox");
const newCat = document.getElementById("newCat");
const addCatBtn = document.getElementById("addCatBtn");
const catManage = document.getElementById("catManage");

// manage subs
const manageSubBtn = document.getElementById("manageSubBtn");
const manageSubBox = document.getElementById("manageSubBox");
const newSub = document.getElementById("newSub");
const addSubBtn = document.getElementById("addSubBtn");
const subManage = document.getElementById("subManage");

let categories = loadJson(LS_CATS, []);  // dynamic
let subStore = loadJson(LS_SUBS, {});   // cat -> subs
let catColors = loadJson(LS_CAT_COLORS, {});

// draft save on change
function getState() {
  return {
    name: nameEl.value || "",
    link: linkEl.value || "",
    note: noteEl.value || "",
    category: catEl.value || "",
    subcategory: subEl.value || "",
  };
}
[nameEl, linkEl, noteEl, catEl, subEl].forEach((el) => {
  el.addEventListener("input", () => saveDraft(getState));
  el.addEventListener("change", () => saveDraft(getState));
});

function showOk(msg) { okEl.style.display = "block"; okEl.textContent = msg; errEl.style.display = "none"; }
function showErr(msg) { errEl.style.display = "block"; errEl.textContent = msg; okEl.style.display = "none"; }

function renderCategories(keep = true) {
  const prev = keep ? catEl.value : "";
  catEl.innerHTML = "";
  for (const c of categories) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    catEl.appendChild(opt);
  }
  if (keep && prev && categories.includes(prev)) catEl.value = prev;
  if (!catEl.value && categories[0]) catEl.value = categories[0];
}

function renderSubSelect(keep = true) {
  const cat = catEl.value;
  const subs = uniq(subStore[cat] || []);
  const prev = keep ? subEl.value : "";

  subEl.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "<brak>";
  subEl.appendChild(none);

  for (const s of subs) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    subEl.appendChild(opt);
  }

  if (keep) {
    subEl.value = prev;
    if (subEl.value !== prev) subEl.value = "";
  } else {
    subEl.value = "";
  }
}

function renderCatManage() {
  catManage.innerHTML = "";
  if (!categories.length) {
    const empty = document.createElement("div");
    empty.className = "small muted";
    empty.textContent = "Brak kategorii — dodaj pierwszą powyżej.";
    catManage.appendChild(empty);
    return;
  }

  for (const c of categories) {
    const row = document.createElement("div");
    row.className = "subTagRow";

    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = "tagBtn";
    tag.textContent = c;
    tag.onclick = () => { catEl.value = c; catEl.dispatchEvent(new Event("change")); };

    const del = document.createElement("button");
    del.type = "button";
    del.className = "iconBtn";
    del.title = "Usuń";
    del.textContent = "✕";
    del.onclick = () => {
      categories = categories.filter(x => x !== c);
      saveJson(LS_CATS, categories);

      // też usuwamy subki tej kategorii z localStorage (opcjonalnie)
      delete subStore[c];
      saveJson(LS_SUBS, subStore);

      renderCategories(false);
      renderSubSelect(false);
      renderCatManage();
      renderSubManage();
      saveDraft(getState);
    };

    row.appendChild(tag);
    row.appendChild(del);
    catManage.appendChild(row);
  }
}

function renderSubManage() {
  const cat = catEl.value;
  const subs = uniq(subStore[cat] || []);

  subManage.innerHTML = "";
  if (!subs.length) {
    const empty = document.createElement("div");
    empty.className = "small muted";
    empty.textContent = "Brak podkategorii — dodaj pierwszą powyżej.";
    subManage.appendChild(empty);
    return;
  }

  for (const s of subs) {
    const row = document.createElement("div");
    row.className = "subTagRow";

    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = "tagBtn";
    tag.textContent = s;
    tag.onclick = () => { subEl.value = s; saveDraft(getState); };

    const del = document.createElement("button");
    del.type = "button";
    del.className = "iconBtn";
    del.title = "Usuń";
    del.textContent = "✕";
    del.onclick = () => {
      subStore[cat] = uniq((subStore[cat] || []).filter(x => x !== s));
      saveJson(LS_SUBS, subStore);
      renderSubSelect(true);
      renderSubManage();
      saveDraft(getState);
    };

    row.appendChild(tag);
    row.appendChild(del);
    subManage.appendChild(row);
  }
}

// Load meta from server (Airtable)
async function loadMetaAndMerge() {
  try {
    const res = await fetch("/api/meta?max=5000", { cache: "no-store" });
    const data = await res.json();
    if (!data?.ok) return;

    const dbCats = uniq(data.categories || []);
    const dbSubs = data.subcategories || {};

    categories = uniq([...(categories || []), ...dbCats]).sort((a, b) => a.localeCompare(b, "pl"));
    for (const c of categories) {
      const a = subStore[c] || [];
      const b = dbSubs[c] || [];
      subStore[c] = uniq([...a, ...b]).sort((x, y) => x.localeCompare(y, "pl"));
      if (!catColors[c]) catColors[c] = randomNiceColor(c);
    }

    saveJson(LS_CATS, categories);
    saveJson(LS_SUBS, subStore);
    saveJson(LS_CAT_COLORS, catColors);
    saveJson(LS_META, data);
  } catch {}
}

// init
(async function init() {
  await loadMetaAndMerge();

  renderCategories(false);
  renderSubSelect(false);

  // restore draft
  const draft = loadDraft();
  if (draft) {
    nameEl.value = draft.name || "";
    linkEl.value = draft.link || "";
    noteEl.value = draft.note || "";
    if (draft.category && categories.includes(draft.category)) catEl.value = draft.category;
    renderSubSelect(false);
    subEl.value = draft.subcategory || "";
    if (subEl.value !== (draft.subcategory || "")) subEl.value = "";
  }

  catEl.onchange = () => {
    renderSubSelect(false);
    renderSubManage();
    saveDraft(getState);
  };

  // manage categories toggle
  manageCatBtn.onclick = () => {
    const open = manageCatBox.style.display !== "none";
    manageCatBox.style.display = open ? "none" : "block";
    if (!open) renderCatManage();
  };

  addCatBtn.onclick = () => {
    const val = String(newCat.value || "").trim();
    if (!val) return;

    categories = uniq([...(categories || []), val]).sort((a, b) => a.localeCompare(b, "pl"));
    if (!catColors[val]) catColors[val] = randomNiceColor(val);
    if (!subStore[val]) subStore[val] = [];

    saveJson(LS_CATS, categories);
    saveJson(LS_CAT_COLORS, catColors);
    saveJson(LS_SUBS, subStore);

    newCat.value = "";
    renderCategories(true);
    renderCatManage();

    catEl.value = val;
    catEl.dispatchEvent(new Event("change"));
  };

  // manage subs toggle
  manageSubBtn.onclick = () => {
    const open = manageSubBox.style.display !== "none";
    manageSubBox.style.display = open ? "none" : "block";
    if (!open) renderSubManage();
  };

  addSubBtn.onclick = () => {
    const cat = catEl.value;
    const val = String(newSub.value || "").trim();
    if (!val) return;

    subStore[cat] = uniq([...(subStore[cat] || []), val]).sort((a, b) => a.localeCompare(b, "pl"));
    saveJson(LS_SUBS, subStore);

    newSub.value = "";
    renderSubSelect(true);
    renderSubManage();

    subEl.value = val;
    saveDraft(getState);
  };

  // submit
  f.addEventListener("submit", async (e) => {
    e.preventDefault();

    const payload = {
      name: String(nameEl.value || "").trim(),
      link: String(linkEl.value || "").trim(),
      category: String(catEl.value || "").trim(),
      subcategory: String(subEl.value || "").trim(),
      note: String(noteEl.value || "").trim(),
    };

    saveDraft(getState);

    submitBtn.disabled = true;
    const prev = submitBtn.textContent;
    submitBtn.textContent = "Wysyłam…";

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok || !data?.ok) {
        showErr(data?.error || "Błąd zapisu");
        return;
      }

      showOk("✅ Zapisane!");
      clearDraft();

      nameEl.value = "";
      linkEl.value = "";
      noteEl.value = "";
      subEl.value = "";
      manageCatBox.style.display = "none";
      manageSubBox.style.display = "none";
      saveDraft(getState);
    } catch (err) {
      showErr(String(err?.message || err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = prev;
    }
  });

  // initial manage lists
  renderCatManage();
  renderSubManage();
})();
