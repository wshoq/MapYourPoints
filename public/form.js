const CATEGORIES = [
  "Stacja benzynowa",
  "Warsztat",
  "Parking",
  "Ważne Miejsce",
  "Agencja celna / weterynarz",
];

const DEFAULT_SUBS = {
  "Stacja benzynowa": ["Zwykła", "Preferowana"],
  "Warsztat": [],
  "Parking": [],
  "Ważne Miejsce": [],
  "Agencja celna / weterynarz": [],
};

const LS_SUBS = "roadmap_subcategories_v1";
const LS_DRAFT = "roadmap_form_draft_v1";

function loadSubs() {
  try {
    const raw = localStorage.getItem(LS_SUBS);
    const json = raw ? JSON.parse(raw) : null;
    if (json && typeof json === "object") return json;
  } catch {}
  const init = {};
  for (const c of CATEGORIES) init[c] = [...(DEFAULT_SUBS[c] || [])];
  return init;
}

function saveSubs(store) {
  localStorage.setItem(LS_SUBS, JSON.stringify(store));
}

function uniq(arr) {
  return Array.from(new Set(arr.map(s => String(s).trim()).filter(Boolean)));
}

const store = loadSubs();

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

// manage UI
const manageBtn = document.getElementById("manageBtn");
const manageBox = document.getElementById("manageBox");
const newSub = document.getElementById("newSub");
const addSubBtn = document.getElementById("addSubBtn");
const subList = document.getElementById("subList");

// ---- Draft persistence ----
function saveDraft() {
  const draft = {
    name: nameEl.value || "",
    link: linkEl.value || "",
    note: noteEl.value || "",
    category: catEl.value || "",
    subcategory: subEl.value || "",
  };
  localStorage.setItem(LS_DRAFT, JSON.stringify(draft));
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(LS_DRAFT);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearDraft() {
  localStorage.removeItem(LS_DRAFT);
}

[nameEl, linkEl, noteEl, catEl, subEl].forEach((el) => {
  el.addEventListener("input", saveDraft);
  el.addEventListener("change", saveDraft);
});

// ---- Render helpers ----
function renderCategories() {
  catEl.innerHTML = "";
  for (const c of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    catEl.appendChild(opt);
  }
}

function renderSubcategories(keepSelected = true) {
  const cat = catEl.value;
  const subs = uniq([...(store[cat] || [])]);

  const prev = keepSelected ? (subEl.value || "") : "";

  subEl.innerHTML = "";
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "— (brak) —";
  subEl.appendChild(none);

  for (const s of subs) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    subEl.appendChild(opt);
  }

  // restore selection if possible
  if (keepSelected) {
    subEl.value = prev;
    if (subEl.value !== prev) subEl.value = ""; // fallback
  }
}

function renderManageList() {
  const cat = catEl.value;
  const subs = uniq([...(store[cat] || [])]);

  subList.innerHTML = "";
  if (!subs.length) {
    const empty = document.createElement("div");
    empty.className = "small muted";
    empty.textContent = "Brak podkategorii — dodaj pierwszą powyżej.";
    subList.appendChild(empty);
    return;
  }

  for (const s of subs) {
    const row = document.createElement("div");
    row.className = "subManageRow";

    const name = document.createElement("span");
    name.textContent = s;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn";
    del.textContent = "Usuń";
    del.onclick = () => {
      store[cat] = uniq((store[cat] || []).filter(x => x !== s));
      saveSubs(store);
      renderSubcategories(true);
      renderManageList();
      saveDraft();
    };

    row.appendChild(name);
    row.appendChild(del);
    subList.appendChild(row);
  }
}

// ---- Init ----
renderCategories();
catEl.value = CATEGORIES[0];
renderSubcategories(false);

// apply draft after initial render
const draft = loadDraft();
if (draft) {
  nameEl.value = draft.name || "";
  linkEl.value = draft.link || "";
  noteEl.value = draft.note || "";

  if (draft.category && CATEGORIES.includes(draft.category)) catEl.value = draft.category;
  renderSubcategories(false);

  subEl.value = draft.subcategory || "";
  if (subEl.value !== (draft.subcategory || "")) subEl.value = "";
}

// change category
catEl.onchange = () => {
  renderSubcategories(false);
  renderManageList();
  saveDraft();
};

manageBtn.onclick = () => {
  const open = manageBox.style.display !== "none";
  manageBox.style.display = open ? "none" : "block";
  if (!open) renderManageList();
};

addSubBtn.onclick = () => {
  const cat = catEl.value;
  const val = String(newSub.value || "").trim();
  if (!val) return;

  store[cat] = uniq([...(store[cat] || []), val]);
  saveSubs(store);

  newSub.value = "";
  renderSubcategories(true);
  renderManageList();

  subEl.value = val; // <- super ważne: ustawiamy aktywnie
  saveDraft();
};

// ---- AJAX submit (no refresh, no lost fields) ----
function showOk(msg) {
  okEl.style.display = "block";
  okEl.textContent = msg;
  errEl.style.display = "none";
}

function showErr(msg) {
  errEl.style.display = "block";
  errEl.textContent = msg;
  okEl.style.display = "none";
}

f.addEventListener("submit", async (e) => {
  e.preventDefault();

  // pewność: subcategory idzie jako string
  const payload = {
    name: String(nameEl.value || "").trim(),
    link: String(linkEl.value || "").trim(),
    category: String(catEl.value || "").trim(),
    subcategory: String(subEl.value || "").trim(),
    note: String(noteEl.value || "").trim(),
  };

  saveDraft();

  submitBtn.disabled = true;
  const prevText = submitBtn.textContent;
  submitBtn.textContent = "Wysyłam…";

  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      const dbg = data?.debug?.finalUrl ? ` (debug: ${data.debug.finalUrl})` : "";
      showErr((data?.error || "Błąd zapisu") + dbg);
      return;
    }

    showOk("✅ Zapisane! Punkt pojawi się na mapie za ~15 sekund.");
    clearDraft();

    // opcjonalnie: czyścimy tylko link + notatkę, zostawiamy kategorię
    linkEl.value = "";
    noteEl.value = "";
    saveDraft();
  } catch (err) {
    showErr(String(err?.message || err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = prevText;
  }
});
