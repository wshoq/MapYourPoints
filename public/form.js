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

const LS_KEY = "roadmap_subcategories_v1";

function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const json = raw ? JSON.parse(raw) : null;
    if (json && typeof json === "object") return json;
  } catch {}
  // init defaults
  const init = {};
  for (const c of CATEGORIES) init[c] = [...(DEFAULT_SUBS[c] || [])];
  return init;
}

function saveStore(store) {
  localStorage.setItem(LS_KEY, JSON.stringify(store));
}

function uniq(arr) {
  return Array.from(new Set(arr.map(s => String(s).trim()).filter(Boolean)));
}

const store = loadStore();

const catEl = document.getElementById("category");
const subEl = document.getElementById("subcategory");
const manageBtn = document.getElementById("manageBtn");
const manageBox = document.getElementById("manageBox");
const newSub = document.getElementById("newSub");
const addSubBtn = document.getElementById("addSubBtn");
const subList = document.getElementById("subList");

function renderCategories() {
  catEl.innerHTML = "";
  for (const c of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    catEl.appendChild(opt);
  }
}

function renderSubcategories() {
  const cat = catEl.value;
  const subs = uniq([...(store[cat] || [])]);

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
      store[cat] = (store[cat] || []).filter(x => x !== s);
      store[cat] = uniq(store[cat]);
      saveStore(store);
      renderSubcategories();
      renderManageList();
    };

    row.appendChild(name);
    row.appendChild(del);
    subList.appendChild(row);
  }
}

renderCategories();
renderSubcategories();

catEl.onchange = () => {
  renderSubcategories();
  renderManageList();
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
  saveStore(store);

  newSub.value = "";
  renderSubcategories();
  renderManageList();

  // auto-select newly added
  subEl.value = val;
};
