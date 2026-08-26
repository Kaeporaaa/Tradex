"use strict";

/* ---------- Constantes ---------- */

const DANCE_LABELS = {
  "valse": "Valse",
  "mazurka": "Mazurka",
  "scottish": "Scottish",
  "bourree": "Bourrée",
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
  "autre": "Autre",
};

const NIVEAU_LABELS = {
  "a-apprendre": "À apprendre",
  "en-cours": "En cours",
  "maitrise": "Maîtrisé",
};

const LS_OVERRIDES = "accordeon-overrides";
const LS_LOCAL_IDS = "accordeon-local-ids";
const LS_DELETED_IDS = "accordeon-deleted-ids";

/* ---------- État global ---------- */

let baseTracks = [];        // tel que chargé depuis data/tracks.json
let tracks = [];            // liste fusionnée (base + overrides + locaux - supprimés), prête à afficher
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
let dragState = null;  // { startX, moved } pendant un drag sur la waveform

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
    id: "", titre: "", fichier: "", type: "valse", tonalite: "",
    source: "", niveau: "a-apprendre", notes: "",
    loopDebut: null, loopFin: null,
  }, overrides);
}

async function loadTracks() {
  const banner = document.getElementById("load-banner");
  try {
    const res = await fetch("data/tracks.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    baseTracks = await res.json();
  } catch (e) {
    baseTracks = [];
    showBanner(
      "Impossible de charger data/tracks.json (" + e.message + "). " +
      "Si tu as ouvert index.html directement depuis le disque, sers le dossier via un petit serveur local " +
      "(voir README.md) — les navigateurs bloquent souvent fetch() sur file://."
    );
  }
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

function currentFilters() {
  return {
    type: document.getElementById("filter-type").value,
    niveau: document.getElementById("filter-niveau").value,
    q: document.getElementById("search-input").value.trim().toLocaleLowerCase("fr"),
  };
}

function filteredTracks() {
  const { type, niveau, q } = currentFilters();
  return tracks.filter(t => {
    if (type && t.type !== type) return false;
    if (niveau && t.niveau !== niveau) return false;
    if (q) {
      const hay = [t.titre, t.source, t.notes, t.tonalite].filter(Boolean).join(" ").toLocaleLowerCase("fr");
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
    li.innerHTML =
      '<span class="t-title">' + escapeHtml(t.titre || "(sans titre)") + '</span>' +
      '<span class="t-meta">' + escapeHtml(DANCE_LABELS[t.type] || t.type || "") +
        (t.tonalite ? " · " + escapeHtml(t.tonalite) : "") +
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

/* ---------- Formulaire d'édition ---------- */

function fillEditForm(t) {
  document.getElementById("edit-titre").value = t.titre || "";
  document.getElementById("edit-type").value = t.type || "valse";
  document.getElementById("edit-tonalite").value = t.tonalite || "";
  document.getElementById("edit-niveau").value = t.niveau || "a-apprendre";
  document.getElementById("edit-source").value = t.source || "";
  document.getElementById("edit-notes").value = t.notes || "";
  document.getElementById("edit-fichier").value = t.fichier || "";
  document.getElementById("loop-start").value = t.loopDebut != null ? t.loopDebut : "";
  document.getElementById("loop-end").value = t.loopFin != null ? t.loopFin : "";
  document.getElementById("json-snippet-wrap").classList.toggle("hidden", !t.__local);
}

function currentTrack() {
  return tracks.find(t => t.id === selectedId);
}

function onFieldEdit(field, value) {
  const t = currentTrack();
  if (!t) return;
  t[field] = value;
  setOverride(t.id, { [field]: value });
  if (field === "titre") renderList();
  updateJsonSnippet(t);
  if (field === "loopDebut" || field === "loopFin") drawWaveform();
}

function updateJsonSnippet(t) {
  if (!t.__local) return;
  const clean = {
    id: t.id, titre: t.titre, fichier: t.fichier, type: t.type,
    tonalite: t.tonalite, source: t.source, niveau: t.niveau, notes: t.notes,
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

function setupWaveformInteraction() {
  const canvas = document.getElementById("waveform");
  canvas.addEventListener("mousedown", (e) => {
    if (!currentBuffer) return;
    dragState = { startX: e.clientX, startTime: xToTime(e.clientX), moved: false };
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragState || !currentBuffer) return;
    if (Math.abs(e.clientX - dragState.startX) > 4) dragState.moved = true;
    if (dragState.moved) {
      const t = currentTrack();
      const a = dragState.startTime, b = xToTime(e.clientX);
      t.loopDebut = Math.round(Math.min(a, b) * 100) / 100;
      t.loopFin = Math.round(Math.max(a, b) * 100) / 100;
      document.getElementById("loop-start").value = t.loopDebut;
      document.getElementById("loop-end").value = t.loopFin;
      document.getElementById("loop-checkbox").checked = true;
      drawWaveform();
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (!dragState || !currentBuffer) return;
    if (!dragState.moved) {
      seekTo(dragState.startTime);
    } else {
      const t = currentTrack();
      setOverride(t.id, { loopDebut: t.loopDebut, loopFin: t.loopFin });
      updateJsonSnippet(t);
    }
    dragState = null;
  });
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
  populateTypeFilter();
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
  populateTypeFilter();
  renderList();
  document.getElementById("player-content").classList.add("hidden");
  document.getElementById("empty-state").classList.remove("hidden");
}

/* ---------- Export tracks.json ---------- */

function exportTracksJson() {
  const clean = tracks.map(t => ({
    id: t.id, titre: t.titre, fichier: t.fichier, type: t.type,
    tonalite: t.tonalite, source: t.source, niveau: t.niveau, notes: t.notes,
    loopDebut: t.loopDebut, loopFin: t.loopFin,
  }));
  const blob = new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" });
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
  document.getElementById("filter-niveau").addEventListener("change", renderList);

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

  document.getElementById("edit-titre").addEventListener("input", debounce(e => onFieldEdit("titre", e.target.value), 250));
  document.getElementById("edit-type").addEventListener("change", e => onFieldEdit("type", e.target.value));
  document.getElementById("edit-tonalite").addEventListener("input", debounce(e => onFieldEdit("tonalite", e.target.value), 250));
  document.getElementById("edit-niveau").addEventListener("change", e => onFieldEdit("niveau", e.target.value));
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
    populateTypeFilter();
    renderList();
  });
}

document.addEventListener("DOMContentLoaded", init);
