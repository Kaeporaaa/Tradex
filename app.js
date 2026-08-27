"use strict";

/* ---------- Constantes ---------- */

const DANCE_LABELS = {
  "valse": "Valse",
  "valse-5-temps": "Valse à 5 temps",
  "mazurka": "Mazurka",
  "scottish": "Scottish",
  "bourree-2-temps": "Bourrée à 2 temps",
  "bourree-3-temps": "Bourrée à 3 temps",
  "polka": "Polka",
  "an-dro": "An dro",
  "hanter-dro": "Hanter dro",
  "rond": "Rond",
  "plinn": "Plinn",
  "gavotte": "Gavotte",
  "laride": "Laridé",
  "marche": "Marche",
  "chapelloise": "Chapelloise",
  "cercle": "Cercle circassien",
  "sept-temps": "7 temps",
  "hora": "Hora",
  "reel": "Reel",
  "jig": "Jig (gigue)",
  "slip-jig": "Slip jig",
  "slide": "Slide",
  "barndance": "Barndance",
  "hornpipe": "Hornpipe",
  "air": "Air (lent)",
  "autre": "Autre",
};

const CATEGORIE_LABELS = {
  "irish": "Irish",
  "morvan": "Morvan",
  "auvergne": "Auvergne",
  "pays-de-l-est": "Pays de l'Est",
  "breton": "Breton",
  "ecosse": "Écosse",
  "angleterre": "Angleterre",
  "autre": "Autre",
};

const NOTE_LABELS = {
  "do": "Do", "do-diese": "Do♯", "re": "Ré", "re-diese": "Ré♯",
  "mi": "Mi", "fa": "Fa", "fa-diese": "Fa♯", "sol": "Sol",
  "sol-diese": "Sol♯", "la": "La", "la-diese": "La♯", "si": "Si",
};

const MODE_LABELS = { "majeur": "Majeur", "mineur": "Mineur" };

const NIVEAU_LABELS = {
  "a-apprendre": "À apprendre",
  "a-bosser": "À bosser",
  "en-cours": "En cours",
  "maitrise": "Maîtrisé",
};

const LS_OVERRIDES = "accordeon-overrides";
const LS_LOCAL_IDS = "accordeon-local-ids";
const LS_DELETED_IDS = "accordeon-deleted-ids";
const LS_MUSICIENS_ADDED = "accordeon-musiciens-added";
const LS_MUSICIENS_DELETED = "accordeon-musiciens-deleted";

/* ---------- État global ---------- */

let baseTracks = [];        // tel que chargé depuis data/tracks.json (morceaux)
let baseMusiciens = [];     // tel que chargé depuis data/tracks.json (musiciens)
let tracks = [];            // liste fusionnée (base + overrides + locaux - supprimés), prête à afficher
let musiciens = [];         // roster fusionné (base + ajouts locaux - suppressions locales)
let selectedId = null;
let missingAudioIds = new Set();

let audioCtx = null;
let currentBuffer = null;
let currentSourceNode = null;
let isPlaying = false;
let playStartContextTime = 0;
let playStartOffset = 0;
let pausedOffset = 0;
let rafId = null;
let peaksCache = null; // Float32Array de pics min/max pour le morceau chargé
let dragState = null;  // { startX, startTime, moved, lastX } pendant un drag/tap sur la waveform

/* ---------- Petits utilitaires localStorage ---------- */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("Impossible d'écrire dans localStorage", e);
  }
}

function getOverrides() { return readJSON(LS_OVERRIDES, {}); }
function setOverride(id, patch) {
  const overrides = getOverrides();
  overrides[id] = Object.assign({}, overrides[id] || {}, patch);
  writeJSON(LS_OVERRIDES, overrides);
}
function deleteOverride(id) {
  const overrides = getOverrides();
  delete overrides[id];
  writeJSON(LS_OVERRIDES, overrides);
}

function getLocalIds() { return readJSON(LS_LOCAL_IDS, []); }
function addLocalId(id) {
  const ids = getLocalIds();
  if (!ids.includes(id)) { ids.push(id); writeJSON(LS_LOCAL_IDS, ids); }
}
function removeLocalId(id) {
  writeJSON(LS_LOCAL_IDS, getLocalIds().filter(x => x !== id));
}

function getDeletedIds() { return readJSON(LS_DELETED_IDS, []); }
function addDeletedId(id) {
  const ids = getDeletedIds();
  if (!ids.includes(id)) { ids.push(id); writeJSON(LS_DELETED_IDS, ids); }
}

/* ---------- Roster de musiciens ---------- */

function getMusiciensAdded() { return readJSON(LS_MUSICIENS_ADDED, []); }
function getMusiciensDeleted() { return readJSON(LS_MUSICIENS_DELETED, []); }

function rebuildMusiciens() {
  const added = getMusiciensAdded();
  const deleted = getMusiciensDeleted();
  const set = new Set();
  baseMusiciens.forEach(m => { if (!deleted.includes(m)) set.add(m); });
  added.forEach(m => { if (!deleted.includes(m)) set.add(m); });
  musiciens = Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
}

function addMusicien(name) {
  name = (name || "").trim();
  if (!name) return;
  const deleted = getMusiciensDeleted();
  if (deleted.includes(name)) {
    writeJSON(LS_MUSICIENS_DELETED, deleted.filter(x => x !== name));
  }
  if (!musiciens.includes(name)) {
    const added = getMusiciensAdded();
    if (!added.includes(name)) { added.push(name); writeJSON(LS_MUSICIENS_ADDED, added); }
  }
  rebuildMusiciens();
}

function removeMusicien(name) {
  const added = getMusiciensAdded();
  if (added.includes(name)) {
    writeJSON(LS_MUSICIENS_ADDED, added.filter(x => x !== name));
  }
  if (baseMusiciens.includes(name)) {
    const deleted = getMusiciensDeleted();
    if (!deleted.includes(name)) { deleted.push(name); writeJSON(LS_MUSICIENS_DELETED, deleted); }
  }
  rebuildMusiciens();
  // Retire ce musicien des morceaux qui le référencent, pour ne pas garder de tag fantôme
  tracks.forEach(t => {
    if (t.joueAvec && t.joueAvec.includes(name)) {
      t.joueAvec = t.joueAvec.filter(x => x !== name);
      setOverride(t.id, { joueAvec: t.joueAvec });
    }
  });
}

/* ---------- IndexedDB (audio des morceaux ajoutés en local, pas encore déployés) ---------- */

let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open("accordeon-db", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("blobs", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function storeBlob(id, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("blobs", "readwrite");
    tx.objectStore("blobs").put({ id, blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function getBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("blobs", "readonly");
    const req = tx.objectStore("blobs").get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = () => reject(req.error);
  });
}
async function deleteBlob(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("blobs", "readwrite");
    tx.objectStore("blobs").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------- Chargement / fusion des morceaux ---------- */

function slugify(str) {
  return str.toLowerCase()
    .normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "morceau";
}

function emptyTrack(overrides) {
  return Object.assign({
    id: "", titre: "", titreProvisoire: false, fichier: "", type: "valse", categorie: "",
    toniqueNote: "", toniqueMode: "", groupe: "Trad",
    source: "", niveau: "a-apprendre", notes: "",
    joueAvec: [],
    loopDebut: null, loopFin: null,
  }, overrides);
}

async function loadTracks() {
  try {
    const res = await fetch("data/tracks.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (Array.isArray(data)) {
      // Ancien format (tableau de morceaux uniquement, sans roster de musiciens).
      baseTracks = data;
      baseMusiciens = [];
    } else {
      baseTracks = Array.isArray(data.morceaux) ? data.morceaux : [];
      baseMusiciens = Array.isArray(data.musiciens) ? data.musiciens : [];
    }
  } catch (e) {
    baseTracks = [];
    baseMusiciens = [];
    showBanner(
      "Impossible de charger data/tracks.json (" + e.message + "). " +
      "Si tu as ouvert index.html directement depuis le disque, sers le dossier via un petit serveur local " +
      "(voir README.md) — les navigateurs bloquent souvent fetch() sur file://."
    );
  }
  rebuildMusiciens();
  rebuildMergedTracks();
}

function showBanner(msg) {
  let banner = document.getElementById("load-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "load-banner";
    banner.className = "load-banner";
    document.querySelector(".sidebar").prepend(banner);
  }
  banner.textContent = msg;
}

function rebuildMergedTracks() {
  const overrides = getOverrides();
  const localIds = getLocalIds();
  const deletedIds = getDeletedIds();

  const fromBase = baseTracks
    .filter(t => !deletedIds.includes(t.id))
    .map(t => Object.assign({}, t, overrides[t.id] || {}, { __local: false }));

  const fromLocal = localIds
    .filter(id => !deletedIds.includes(id))
    .map(id => Object.assign(emptyTrack({ id }), overrides[id] || {}, { __local: true }));

  tracks = fromBase.concat(fromLocal);
  tracks.sort((a, b) => (a.titre || "").localeCompare(b.titre || "", "fr"));
}

/* ---------- Rendu : filtres + liste ---------- */

function populateTypeFilter() {
  const sel = document.getElementById("filter-type");
  const used = new Set(tracks.map(t => t.type).filter(Boolean));
  sel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
  Array.from(used).sort((a, b) => (DANCE_LABELS[a] || a).localeCompare(DANCE_LABELS[b] || b, "fr"))
    .forEach(type => {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = DANCE_LABELS[type] || type;
      sel.appendChild(opt);
    });
}

function populateCategorieFilter() {
  const sel = document.getElementById("filter-categorie");
  const used = new Set(tracks.map(t => t.categorie).filter(Boolean));
  sel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
  Array.from(used).sort((a, b) => (CATEGORIE_LABELS[a] || a).localeCompare(CATEGORIE_LABELS[b] || b, "fr"))
    .forEach(cat => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = CATEGORIE_LABELS[cat] || cat;
      sel.appendChild(opt);
    });
}

function usedGroupes() {
  const set = new Set(["Trad"]);
  tracks.forEach(t => { if (t.groupe) set.add(t.groupe); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
}

function populateGroupeFilter() {
  const sel = document.getElementById("filter-groupe");
  const current = sel.value;
  sel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
  usedGroupes().forEach(g => {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = g;
    sel.appendChild(opt);
  });
  if (usedGroupes().includes(current)) sel.value = current;
}

function populateGroupeDatalist() {
  const list = document.getElementById("groupe-datalist");
  list.innerHTML = usedGroupes().map(g => '<option value="' + escapeHtml(g) + '"></option>').join("");
}

function populateMusicienFilter() {
  const sel = document.getElementById("filter-musicien");
  const current = sel.value;
  sel.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
  musiciens.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    sel.appendChild(opt);
  });
  if (musiciens.includes(current)) sel.value = current;
}

function refreshFilterOptions() {
  populateTypeFilter();
  populateCategorieFilter();
  populateMusicienFilter();
  populateGroupeFilter();
  populateGroupeDatalist();
}

function toniqueLabel(t) {
  if (!t.toniqueNote) return "";
  const note = NOTE_LABELS[t.toniqueNote] || t.toniqueNote;
  const mode = t.toniqueMode ? (MODE_LABELS[t.toniqueMode] || t.toniqueMode) : "";
  return mode ? note + " " + mode.toLowerCase() : note;
}

function currentFilters() {
  return {
    type: document.getElementById("filter-type").value,
    categorie: document.getElementById("filter-categorie").value,
    niveau: document.getElementById("filter-niveau").value,
    musicien: document.getElementById("filter-musicien").value,
    groupe: document.getElementById("filter-groupe").value,
    titreProvisoire: document.getElementById("filter-titre-provisoire").checked,
    q: document.getElementById("search-input").value.trim().toLocaleLowerCase("fr"),
  };
}

function filteredTracks() {
  const { type, categorie, niveau, musicien, groupe, titreProvisoire, q } = currentFilters();
  return tracks.filter(t => {
    if (type && t.type !== type) return false;
    if (categorie && t.categorie !== categorie) return false;
    if (niveau && t.niveau !== niveau) return false;
    if (musicien && !(t.joueAvec || []).includes(musicien)) return false;
    if (groupe && t.groupe !== groupe) return false;
    if (titreProvisoire && !t.titreProvisoire) return false;
    if (q) {
      const hay = [t.titre, t.source, t.notes, t.groupe, toniqueLabel(t), CATEGORIE_LABELS[t.categorie]]
        .filter(Boolean).join(" ").toLocaleLowerCase("fr");
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderList() {
  const list = document.getElementById("track-list");
  const items = filteredTracks();
  list.innerHTML = "";
  items.forEach(t => {
    const li = document.createElement("li");
    li.className = "track-item" + (t.id === selectedId ? " selected" : "");
    li.dataset.id = t.id;
    const missing = missingAudioIds.has(t.id);
    const tonique = toniqueLabel(t);
    li.innerHTML =
      '<span class="t-title">' + escapeHtml(t.titre || "(sans titre)") +
        (t.titreProvisoire ? ' <span class="provisoire-badge" title="Titre provisoire, à confirmer">?</span>' : "") +
      '</span>' +
      '<span class="t-meta">' + escapeHtml(DANCE_LABELS[t.type] || t.type || "") +
        (t.groupe ? " · " + escapeHtml(t.groupe) : "") +
        (t.categorie ? " · " + escapeHtml(CATEGORIE_LABELS[t.categorie] || t.categorie) : "") +
        (tonique ? " · " + escapeHtml(tonique) : "") +
        " · " + escapeHtml(NIVEAU_LABELS[t.niveau] || "") +
        (t.__local ? " · local, non déployé" : "") +
        (missing ? ' <span class="missing">· fichier introuvable</span>' : "") +
      "</span>";
    li.addEventListener("click", () => selectTrack(t.id));
    list.appendChild(li);
  });
  document.getElementById("track-count").textContent =
    items.length + " morceau" + (items.length > 1 ? "x" : "") +
    (tracks.length !== items.length ? " (sur " + tracks.length + ")" : "");
}

function renderMusiciensList() {
  const ul = document.getElementById("musiciens-list");
  ul.innerHTML = "";
  musiciens.forEach(m => {
    const li = document.createElement("li");
    li.className = "musicien-item";
    li.innerHTML = '<span>' + escapeHtml(m) + '</span><button type="button" class="musicien-remove" data-name="' +
      escapeHtml(m) + '" title="Retirer ce musicien">×</button>';
    ul.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ---------- Sélection d'un morceau ---------- */

async function selectTrack(id) {
  stopPlayback();
  selectedId = id;
  renderList();

  const t = tracks.find(x => x.id === id);
  if (!t) return;

  document.getElementById("empty-state").classList.add("hidden");
  document.getElementById("player-content").classList.remove("hidden");
  showPlayerView();

  // Nouveau morceau : on repart en vue "lecteur", section Edit repliée.
  document.getElementById("edit-section").open = false;

  fillEditForm(t);
  updateJsonSnippet(t);

  document.getElementById("waveform-status").textContent = "Chargement…";
  document.getElementById("time-current").textContent = "0:00";
  document.getElementById("time-total").textContent = "0:00";
  peaksCache = null;
  currentBuffer = null;
  pausedOffset = 0;

  try {
    let arrayBuffer;
    if (t.__local) {
      const blob = await getBlob(t.id);
      if (!blob) throw new Error("audio local introuvable (a-t-il été effacé au rechargement de la page ?)");
      arrayBuffer = await blob.arrayBuffer();
    } else {
      const res = await fetch(t.fichier, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      arrayBuffer = await res.arrayBuffer();
    }
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    currentBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    missingAudioIds.delete(t.id);
    document.getElementById("waveform-status").textContent = "";
    document.getElementById("time-total").textContent = formatTime(currentBuffer.duration);
    computePeaks();
    drawWaveform();
  } catch (e) {
    missingAudioIds.add(t.id);
    document.getElementById("waveform-status").textContent =
      "Fichier audio introuvable (" + t.fichier + "). " + e.message;
    renderList();
  }
}

/* ---------- Bascule vue "liste" / vue "lecteur" (même comportement à toute taille d'écran) ---------- */

function showPlayerView() {
  document.body.classList.add("view-player");
}
function showListView() {
  document.body.classList.remove("view-player");
}

/* ---------- Formulaire d'édition ---------- */

function fillEditForm(t) {
  document.getElementById("edit-titre").value = t.titre || "";
  document.getElementById("edit-titre-provisoire").checked = !!t.titreProvisoire;
  document.getElementById("edit-type").value = t.type || "valse";
  document.getElementById("edit-categorie").value = t.categorie || "";
  document.getElementById("edit-tonique-note").value = t.toniqueNote || "";
  document.getElementById("edit-tonique-mode").value = t.toniqueMode || "";
  document.getElementById("edit-niveau").value = t.niveau || "a-apprendre";
  document.getElementById("edit-groupe").value = t.groupe || "";
  document.getElementById("edit-source").value = t.source || "";
  document.getElementById("edit-notes").value = t.notes || "";
  document.getElementById("edit-fichier").value = t.fichier || "";
  document.getElementById("loop-start").value = t.loopDebut != null ? t.loopDebut : "";
  document.getElementById("loop-end").value = t.loopFin != null ? t.loopFin : "";
  document.getElementById("json-snippet-wrap").classList.toggle("hidden", !t.__local);
  renderJoueAvecCheckboxes(t);
}

function renderJoueAvecCheckboxes(t) {
  const container = document.getElementById("edit-joueavec");
  if (musiciens.length === 0) {
    container.innerHTML = '<span class="joueavec-empty">Ajoute des musiciens dans la colonne de gauche pour pouvoir les cocher ici.</span>';
    return;
  }
  const joueAvec = t.joueAvec || [];
  container.innerHTML = musiciens.map(m => {
    const checked = joueAvec.includes(m) ? " checked" : "";
    return '<label class="joueavec-chip"><input type="checkbox" value="' + escapeHtml(m) + '"' + checked + '> ' +
      escapeHtml(m) + '</label>';
  }).join("");
}

function currentTrack() {
  return tracks.find(t => t.id === selectedId);
}

function onFieldEdit(field, value) {
  const t = currentTrack();
  if (!t) return;
  t[field] = value;
  setOverride(t.id, { [field]: value });
  // La ligne de méta-infos affichée dans la liste (type, catégorie, tonalité, niveau,
  // titre...) doit rester à jour immédiatement, sans attendre une re-sélection.
  renderList();
  if (field === "type" || field === "categorie" || field === "groupe") refreshFilterOptions();
  updateJsonSnippet(t);
  if (field === "loopDebut" || field === "loopFin") drawWaveform();
}

function onJoueAvecChange(track) {
  const container = document.getElementById("edit-joueavec");
  const checked = Array.from(container.querySelectorAll("input[type=checkbox]:checked")).map(cb => cb.value);
  track.joueAvec = checked;
  setOverride(track.id, { joueAvec: checked });
  updateJsonSnippet(track);
  renderList();
}

function updateJsonSnippet(t) {
  if (!t.__local) return;
  const clean = {
    id: t.id, titre: t.titre, titreProvisoire: !!t.titreProvisoire, fichier: t.fichier,
    type: t.type, categorie: t.categorie,
    toniqueNote: t.toniqueNote, toniqueMode: t.toniqueMode, groupe: t.groupe,
    source: t.source, niveau: t.niveau, notes: t.notes, joueAvec: t.joueAvec || [],
    loopDebut: t.loopDebut, loopFin: t.loopFin,
  };
  document.getElementById("json-snippet").value = JSON.stringify(clean, null, 2) + ",";
}

/* ---------- Waveform ---------- */

function computePeaks() {
  const data = currentBuffer.getChannelData(0);
  const buckets = 1000;
  const step = Math.floor(data.length / buckets) || 1;
  const peaks = new Float32Array(buckets * 2);
  for (let i = 0; i < buckets; i++) {
    let min = 1, max = -1;
    const start = i * step;
    const end = Math.min(start + step, data.length);
    for (let j = start; j < end; j++) {
      const v = data[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    peaks[i * 2] = min;
    peaks[i * 2 + 1] = max;
  }
  peaksCache = peaks;
}

function drawWaveform() {
  const canvas = document.getElementById("waveform");
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.parentElement.clientWidth;
  const cssHeight = 120;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue("--accent").trim() || "#d98e3b";
  const dim = styles.getPropertyValue("--border").trim() || "#444";

  const t = currentTrack();
  const duration = currentBuffer ? currentBuffer.duration : 0;

  // zone de boucle
  if (t && duration > 0) {
    const start = t.loopDebut != null ? t.loopDebut : 0;
    const end = t.loopFin != null ? t.loopFin : duration;
    ctx.fillStyle = accent + "33";
    ctx.fillRect((start / duration) * cssWidth, 0, ((end - start) / duration) * cssWidth, cssHeight);
  }

  if (peaksCache) {
    const mid = cssHeight / 2;
    ctx.fillStyle = dim;
    const buckets = peaksCache.length / 2;
    for (let i = 0; i < buckets; i++) {
      const x = (i / buckets) * cssWidth;
      const min = peaksCache[i * 2], max = peaksCache[i * 2 + 1];
      const y1 = mid - max * mid * 0.9;
      const y2 = mid - min * mid * 0.9;
      ctx.fillRect(x, y1, Math.max(1, cssWidth / buckets), Math.max(1, y2 - y1));
    }
  } else {
    return; // status message affiché par ailleurs
  }

  // curseur de lecture
  if (duration > 0) {
    const pos = computeCurrentPosition();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    const x = (pos / duration) * cssWidth;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cssHeight);
    ctx.stroke();
  }
}

function xToTime(clientX) {
  const canvas = document.getElementById("waveform");
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * (currentBuffer ? currentBuffer.duration : 0);
}

function isEditOpen() {
  const d = document.getElementById("edit-section");
  return !!(d && d.open);
}

function waveformDragStart(x) {
  if (!currentBuffer) return;
  dragState = { startX: x, startTime: xToTime(x), moved: false, lastX: x };
}

function waveformDragMove(x) {
  if (!dragState || !currentBuffer) return;
  if (Math.abs(x - dragState.startX) > 4) dragState.moved = true;
  dragState.lastX = x;
  if (!isEditOpen()) return; // en vue lecteur : pas de redéfinition de boucle en glissant
  if (dragState.moved) {
    const t = currentTrack();
    const a = dragState.startTime, b = xToTime(x);
    t.loopDebut = Math.round(Math.min(a, b) * 100) / 100;
    t.loopFin = Math.round(Math.max(a, b) * 100) / 100;
    document.getElementById("loop-start").value = t.loopDebut;
    document.getElementById("loop-end").value = t.loopFin;
    document.getElementById("loop-checkbox").checked = true;
    drawWaveform();
  }
}

function waveformDragEnd() {
  if (!dragState || !currentBuffer) { dragState = null; return; }
  if (isEditOpen()) {
    if (!dragState.moved) {
      seekTo(dragState.startTime);
    } else {
      const t = currentTrack();
      setOverride(t.id, { loopDebut: t.loopDebut, loopFin: t.loopFin });
      updateJsonSnippet(t);
    }
  } else {
    // Vue lecteur : un tap (ou un glisser relâché) lance la lecture depuis ce point.
    seekAndPlay(xToTime(dragState.lastX));
  }
  dragState = null;
}

function setupWaveformInteraction() {
  const canvas = document.getElementById("waveform");

  canvas.addEventListener("mousedown", (e) => waveformDragStart(e.clientX));
  window.addEventListener("mousemove", (e) => waveformDragMove(e.clientX));
  window.addEventListener("mouseup", () => waveformDragEnd());

  canvas.addEventListener("touchstart", (e) => {
    if (!currentBuffer) return;
    e.preventDefault();
    waveformDragStart(e.touches[0].clientX);
  }, { passive: false });
  canvas.addEventListener("touchmove", (e) => {
    if (!dragState) return;
    e.preventDefault();
    waveformDragMove(e.touches[0].clientX);
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    e.preventDefault();
    waveformDragEnd();
  }, { passive: false });
}

/* ---------- Lecture / boucle (Web Audio API) ---------- */

function effectiveLoopRange(t) {
  const duration = currentBuffer.duration;
  const start = (t.loopDebut != null && t.loopDebut >= 0 && t.loopDebut < duration) ? t.loopDebut : 0;
  let end = (t.loopFin != null && t.loopFin > start && t.loopFin <= duration) ? t.loopFin : duration;
  return { start, end };
}

function computeCurrentPosition() {
  if (!currentBuffer) return 0;
  if (!isPlaying) return pausedOffset;
  const elapsed = audioCtx.currentTime - playStartContextTime;
  const looping = document.getElementById("loop-checkbox").checked;
  const t = currentTrack();
  if (!looping) {
    return Math.min(playStartOffset + elapsed, currentBuffer.duration);
  }
  const { start, end } = effectiveLoopRange(t);
  const span = end - start;
  const firstPass = end - playStartOffset;
  if (elapsed <= firstPass) return playStartOffset + elapsed;
  const remaining = (elapsed - firstPass) % span;
  return start + remaining;
}

function startPlayback(offset) {
  if (!currentBuffer) return;
  const t = currentTrack();
  const node = audioCtx.createBufferSource();
  node.buffer = currentBuffer;
  const looping = document.getElementById("loop-checkbox").checked;
  if (looping) {
    const { start, end } = effectiveLoopRange(t);
    node.loop = true;
    node.loopStart = start;
    node.loopEnd = end;
  }
  node.connect(audioCtx.destination);
  // Important : on ignore onended si ce node n'est plus le node "courant" au moment
  // où l'évènement arrive (cas d'un stop() suivi d'un redémarrage immédiat, par ex.
  // pause/seek/changement des points de boucle) — sinon un onended "en retard" d'un
  // node qu'on vient nous-même d'arrêter écrase à tort l'état du node tout juste lancé.
  node.onended = () => {
    if (currentSourceNode !== node) return;
    isPlaying = false;
    pausedOffset = 0;
    updatePlayButton();
    cancelAnimationFrame(rafId);
    document.getElementById("time-current").textContent = formatTime(0);
    drawWaveform();
  };
  const startOffset = Math.min(offset, currentBuffer.duration - 0.001);
  node.start(0, Math.max(0, startOffset));
  currentSourceNode = node;
  playStartContextTime = audioCtx.currentTime;
  playStartOffset = Math.max(0, startOffset);
  isPlaying = true;
  updatePlayButton();
  tick();
}

function stopCurrentNode() {
  const node = currentSourceNode;
  currentSourceNode = null; // fait immédiatement que son onended sera ignoré
  if (node) { try { node.stop(); } catch (e) { /* déjà arrêté */ } }
}

function stopPlayback() {
  if (isPlaying) pausedOffset = computeCurrentPosition();
  stopCurrentNode();
  isPlaying = false;
  cancelAnimationFrame(rafId);
  updatePlayButton();
}

function togglePlay() {
  if (!currentBuffer) return;
  if (isPlaying) {
    pausedOffset = computeCurrentPosition();
    stopCurrentNode();
    isPlaying = false;
    cancelAnimationFrame(rafId);
    updatePlayButton();
    drawWaveform();
  } else {
    if (audioCtx.state === "suspended") audioCtx.resume();
    startPlayback(pausedOffset >= currentBuffer.duration - 0.02 ? 0 : pausedOffset);
  }
}

function seekTo(time) {
  if (!currentBuffer) return;
  pausedOffset = Math.max(0, Math.min(time, currentBuffer.duration));
  if (isPlaying) {
    stopCurrentNode();
    startPlayback(pausedOffset);
  } else {
    drawWaveform();
    document.getElementById("time-current").textContent = formatTime(pausedOffset);
  }
}

// Comme seekTo, mais démarre toujours la lecture (utilisé par un tap sur la forme d'onde
// en vue "lecteur", où il n'y a pas de bouton dédié — taper doit lire depuis cet endroit).
function seekAndPlay(time) {
  if (!currentBuffer) return;
  pausedOffset = Math.max(0, Math.min(time, currentBuffer.duration));
  if (audioCtx.state === "suspended") audioCtx.resume();
  stopCurrentNode();
  startPlayback(pausedOffset);
}

function restartIfPlaying() {
  if (isPlaying) {
    const pos = computeCurrentPosition();
    stopCurrentNode();
    startPlayback(pos);
  } else {
    drawWaveform();
  }
}

function updatePlayButton() {
  document.getElementById("play-btn").textContent = isPlaying ? "⏸ Pause" : "▶ Lecture";
}

function tick() {
  if (!isPlaying) return;
  const pos = computeCurrentPosition();
  document.getElementById("time-current").textContent = formatTime(pos);
  drawWaveform();
  rafId = requestAnimationFrame(tick);
}

function formatTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m + ":" + String(sec).padStart(2, "0");
}

/* ---------- Ajout / suppression de morceaux ---------- */

async function handleFilesAdded(fileList) {
  const files = Array.from(fileList);
  let lastId = null;
  for (const file of files) {
    const base = file.name.replace(/\.[^.]+$/, "");
    let id = slugify(base) + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const titre = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    const track = emptyTrack({
      id,
      titre: titre.charAt(0).toUpperCase() + titre.slice(1),
      fichier: "audio/" + file.name,
    });
    await storeBlob(id, file);
    addLocalId(id);
    setOverride(id, track);
    lastId = id;
  }
  rebuildMergedTracks();
  refreshFilterOptions();
  renderList();
  if (lastId) selectTrack(lastId);
}

async function deleteCurrentTrack() {
  const t = currentTrack();
  if (!t) return;
  if (!confirm('Supprimer "' + (t.titre || "ce morceau") + '" du répertoire local ?\n(Le fichier audio original sur ton disque n\'est pas touché.)')) return;
  stopPlayback();
  if (t.__local) {
    removeLocalId(t.id);
    await deleteBlob(t.id);
  } else {
    addDeletedId(t.id);
  }
  deleteOverride(t.id);
  selectedId = null;
  currentBuffer = null;
  rebuildMergedTracks();
  refreshFilterOptions();
  renderList();
  document.getElementById("player-content").classList.add("hidden");
  document.getElementById("empty-state").classList.remove("hidden");
  showListView();
}

/* ---------- Export tracks.json ---------- */

function exportTracksJson() {
  const morceaux = tracks.map(t => ({
    id: t.id, titre: t.titre, titreProvisoire: !!t.titreProvisoire, fichier: t.fichier,
    type: t.type, categorie: t.categorie,
    toniqueNote: t.toniqueNote, toniqueMode: t.toniqueMode, groupe: t.groupe,
    source: t.source, niveau: t.niveau, notes: t.notes, joueAvec: t.joueAvec || [],
    loopDebut: t.loopDebut, loopFin: t.loopFin,
  }));
  const data = { musiciens: musiciens, morceaux: morceaux };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "tracks.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  const localCount = tracks.filter(t => t.__local).length;
  if (localCount > 0) {
    alert(
      "tracks.json téléchargé.\n\n" +
      "Rappel : " + localCount + " morceau(x) ajouté(s) en local ont leur audio uniquement dans ce navigateur. " +
      "Copie aussi les fichiers correspondants dans le dossier audio/ de ton dépôt avant de déployer."
    );
  }
}

/* ---------- Câblage des évènements ---------- */

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

function init() {
  setupWaveformInteraction();

  document.getElementById("search-input").addEventListener("input", debounce(renderList, 150));
  document.getElementById("filter-type").addEventListener("change", renderList);
  document.getElementById("filter-categorie").addEventListener("change", renderList);
  document.getElementById("filter-niveau").addEventListener("change", renderList);
  document.getElementById("filter-musicien").addEventListener("change", renderList);
  document.getElementById("filter-titre-provisoire").addEventListener("change", renderList);
  document.getElementById("filter-groupe").addEventListener("change", renderList);

  const musicienInput = document.getElementById("musicien-input");
  function addMusicienFromInput() {
    if (!musicienInput.value.trim()) return;
    addMusicien(musicienInput.value);
    musicienInput.value = "";
    renderMusiciensList();
    populateMusicienFilter();
    const t = currentTrack();
    if (t) renderJoueAvecCheckboxes(t);
  }
  document.getElementById("musicien-add-btn").addEventListener("click", addMusicienFromInput);
  musicienInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addMusicienFromInput(); } });
  document.getElementById("musiciens-list").addEventListener("click", e => {
    const btn = e.target.closest(".musicien-remove");
    if (!btn) return;
    removeMusicien(btn.dataset.name);
    renderMusiciensList();
    populateMusicienFilter();
    renderList();
    const t = currentTrack();
    if (t) renderJoueAvecCheckboxes(t);
  });
  document.getElementById("edit-joueavec").addEventListener("change", () => {
    const t = currentTrack();
    if (t) onJoueAvecChange(t);
  });

  document.getElementById("add-track-btn").addEventListener("click", () => {
    document.getElementById("file-input").click();
  });
  document.getElementById("file-input").addEventListener("change", (e) => {
    if (e.target.files.length) handleFilesAdded(e.target.files);
    e.target.value = "";
  });
  document.getElementById("export-btn").addEventListener("click", exportTracksJson);
  document.getElementById("delete-track-btn").addEventListener("click", deleteCurrentTrack);

  document.getElementById("play-btn").addEventListener("click", togglePlay);
  document.getElementById("loop-checkbox").addEventListener("change", restartIfPlaying);

  document.getElementById("back-to-list-btn").addEventListener("click", () => {
    stopPlayback();
    showListView();
  });
  document.getElementById("toggle-musiciens-btn").addEventListener("click", () => {
    document.getElementById("musiciens-panel").classList.toggle("hidden");
  });
  // La vue lecteur en deux volets ("Edit" ouvert sur grand écran) redimensionne la
  // forme d'onde : on la redessine au moment où la section s'ouvre/se ferme.
  document.getElementById("edit-section").addEventListener("toggle", () => {
    if (currentBuffer) requestAnimationFrame(drawWaveform);
  });

  document.getElementById("edit-titre").addEventListener("input", debounce(e => onFieldEdit("titre", e.target.value), 250));
  document.getElementById("edit-titre-provisoire").addEventListener("change", e => onFieldEdit("titreProvisoire", e.target.checked));
  document.getElementById("edit-type").addEventListener("change", e => onFieldEdit("type", e.target.value));
  document.getElementById("edit-categorie").addEventListener("change", e => onFieldEdit("categorie", e.target.value));
  document.getElementById("edit-tonique-note").addEventListener("change", e => onFieldEdit("toniqueNote", e.target.value));
  document.getElementById("edit-tonique-mode").addEventListener("change", e => onFieldEdit("toniqueMode", e.target.value));
  document.getElementById("edit-niveau").addEventListener("change", e => onFieldEdit("niveau", e.target.value));
  document.getElementById("edit-groupe").addEventListener("input", debounce(e => onFieldEdit("groupe", e.target.value), 250));
  document.getElementById("edit-source").addEventListener("input", debounce(e => onFieldEdit("source", e.target.value), 250));
  document.getElementById("edit-notes").addEventListener("input", debounce(e => onFieldEdit("notes", e.target.value), 250));
  document.getElementById("edit-fichier").addEventListener("input", debounce(e => onFieldEdit("fichier", e.target.value), 250));

  document.getElementById("loop-start").addEventListener("change", e => {
    const v = e.target.value === "" ? null : parseFloat(e.target.value);
    onFieldEdit("loopDebut", v);
    restartIfPlaying();
  });
  document.getElementById("loop-end").addEventListener("change", e => {
    const v = e.target.value === "" ? null : parseFloat(e.target.value);
    onFieldEdit("loopFin", v);
    restartIfPlaying();
  });
  document.getElementById("set-loop-start").addEventListener("click", () => {
    const v = Math.round(computeCurrentPosition() * 100) / 100;
    document.getElementById("loop-start").value = v;
    onFieldEdit("loopDebut", v);
    restartIfPlaying();
  });
  document.getElementById("set-loop-end").addEventListener("click", () => {
    const v = Math.round(computeCurrentPosition() * 100) / 100;
    document.getElementById("loop-end").value = v;
    onFieldEdit("loopFin", v);
    restartIfPlaying();
  });
  document.getElementById("clear-loop").addEventListener("click", () => {
    document.getElementById("loop-start").value = "";
    document.getElementById("loop-end").value = "";
    onFieldEdit("loopDebut", null);
    onFieldEdit("loopFin", null);
    restartIfPlaying();
  });

  window.addEventListener("resize", debounce(() => { if (currentBuffer) drawWaveform(); }, 150));

  loadTracks().then(() => {
    refreshFilterOptions();
    renderMusiciensList();
    renderList();
  });
}

document.addEventListener("DOMContentLoaded", init);
