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

const LS_SUBS = "roadmap_subcategories_v2";
const LS_DRAFT = "roadmap_form_draft_v2";

function uniq(arr) {
  return Array.from(new Set((arr || []).map(s => String(s).trim()).filter(Boolean)));
}

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

function saveDraft(getState) {
  localStorage.setItem(LS_DRAFT, JSON.stringify(getState()));
}
function loadDraft() {
  try {
    const raw = localStorage.getItem(LS_DRAFT);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearDraft() {
  localStorage.removeItem(LS_DRAFT);
}

// elements
const f = document.getElementById("f");
const nameEl = document.getElementById("name");
const linkEl = document.getElementById("link");
const noteEl = document.getElementById("note");
const catEl = document.getElementById("category");
const subEl = document.getElementById("subcategory");
const datalistEl = document.getElementById("subListDatalist");
const submitBtn = document.getElementById("submitBtn");

const okEl = document.getElementById("ok");
const errEl = document.getElementById("err");

// manage UI
const manageBtn = document.getElementById("manageBtn");
const manageBox = document.getElementById("manageBox");
const newSub = document.getElementById("newSub");
const addSubBtn = document.getElementById("addSubBtn");
const subManage = document.getElementById("subManage");

const store = loadSubs();

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

function renderCategories() {
  catEl.innerHTML = "";
  for (const c of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    catEl.appendChild(opt);
  }
}

function renderDatalist() {
  const cat = catEl.value;
  const subs = uniq(store[cat] || []);
  datalistEl.innerHTML = "";
  for (const s of subs) {
    const opt = document.createElement("option");
    opt.value = s;
    datalistEl.appendChild(opt);
  }
}

function renderManageList() {
  const cat = catEl.value;
  const subs = uniq(store[cat] || []);

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
    tag.onclick = () => {
      subEl.value = s;
      saveDraft(getState);
    };

    const del = document.createElement("button");
    del.type = "button";
    del.className = "iconBtn";
    del.title = "Usuń";
    del.textContent = "✕";
    del.onclick = () => {
      store[cat] = uniq((store[cat] || []).filter(x => x !== s));
      saveSubs(store);
      renderDatalist();
      renderManageList();
      saveDraft(getState);
    };

    row.appendChild(tag);
    row.appendChild(del);
    subManage.appendChild(row);
  }
}

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

// init
renderCategories();
catEl.value = CATEGORIES[0];
renderDatalist();

const draft = loadDraft();
if (draft) {
  nameEl.value = draft.name || "";
  linkEl.value = draft.link || "";
  noteEl.value = draft.note || "";
  if (draft.category && CATEGORIES.includes(draft.category)) catEl.value = draft.category;
  renderDatalist();
  subEl.value = draft.subcategory || "";
}

catEl.onchange = () => {
  renderDatalist();
  renderManageList();
  saveDraft(getState);
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
  renderDatalist();
  renderManageList();

  // mega ważne: ustawiamy w input
  subEl.value = val;
  saveDraft(getState);
};

// submit (AJAX) — nic nie znika przy błędzie
f.addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    name: String(nameEl.value || "").trim(),
    link: String(linkEl.value || "").trim(),
    category: String(catEl.value || "").trim(),
    subcategory: String(subEl.value || "").trim(), // <- TERAZ ZAWSZE TEKST
    note: String(noteEl.value || "").trim(),
  };

  saveDraft(getState);

  submitBtn.disabled = true;
  const prev = submitBtn.textContent;
  submitBtn.textContent = "Wysyłam…";

  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok || !data?.ok) {
      showErr(data?.error || "Błąd zapisu");
      return;
    }

    showOk("✅ Zapisane! Punkt pojawi się na mapie za chwilę.");
    clearDraft();

    // czyścimy tylko po sukcesie:
    nameEl.value = "";
    linkEl.value = "";
    noteEl.value = "";
    subEl.value = "";
    manageBox.style.display = "none";
    saveDraft(getState);
  } catch (err) {
    showErr(String(err?.message || err));
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = prev;
  }
});
