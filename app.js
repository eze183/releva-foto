const state = {
  photos: [], folders: [], activeFolderId: null, search: "",
  activePhoto: null, editorPhoto: null,
  tool: null, color: "#ec3013", annotations: [], selectedAnnotationId: null, drawing: false,
  cameraStream: null, facingMode: "environment", cameraZoom: 1, capturing: false,
  captureFolderId: null, burst: [],
  folderSelection: new Set(), folderSelectMode: false,
  photoSelection: new Set(), photoSelectMode: false, photoMoveMode: null,
  pendingParentId: null, actionsFolderId: null, afterFolderPick: null,
};
const $ = (selector) => document.querySelector(selector);
const views = ["galleryView", "folderView", "editorView", "detailView"];
const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
// Todo nombre de carpeta o de foto lo escribe el usuario y termina interpolado en
// HTML (y en atributos) — sin esto, una comilla o un & rompe la grilla entera.
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);

function showError(message) { alert(message); }
let toastTimer = null;
function toast(message, sticky) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => { node.hidden = true; }, 2200);
}

// --- IndexedDB: fotos como Blob (no base64) y lista de carpetas en "meta". ---
const DB_NAME = "releva-foto";
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}
async function idbTx(storeName, mode, run) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = run(store);
    tx.oncomplete = () => resolve(request instanceof IDBRequest ? request.result : request);
    tx.onerror = () => reject(tx.error);
  });
}
function idbGetAllPhotos() { return idbTx("photos", "readonly", (store) => store.getAll()); }
function idbPutPhoto(photo) { return idbTx("photos", "readwrite", (store) => store.put(photo)); }
function idbDeletePhoto(id) { return idbTx("photos", "readwrite", (store) => store.delete(id)); }
async function idbGetFolders() {
  const record = await idbTx("meta", "readonly", (store) => store.get("folders"));
  return record ? record.value : null;
}
function idbSetFolders(list) { return idbTx("meta", "readwrite", (store) => store.put({ key: "folders", value: list })); }
function saveFolders() { return idbSetFolders(state.folders).catch((error) => { console.error(error); showError("No se pudieron guardar los cambios de carpetas."); }); }

async function migrateFromLocalStorage() {
  const raw = localStorage.getItem("releva-fotos");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    for (const photo of data.photos || []) {
      const blob = await (await fetch(photo.image)).blob();
      await idbPutPhoto({ id: photo.id, name: photo.name, folder: photo.folder, note: photo.note, createdAt: photo.createdAt, blob });
    }
    const folderNames = data.folders && data.folders.length ? data.folders : ["General"];
    await idbSetFolders(folderNames.map((name) => ({ name, parent: null })));
    localStorage.removeItem("releva-fotos");
  } catch (error) {
    console.warn("No se pudo migrar el almacenamiento anterior:", error);
  }
}

// --- Migración a carpetas con id propio ---
// Antes la clave primaria de una carpeta era su nombre, así que "Vivienda 1" sólo
// podía existir una vez en toda la app y renombrar obligaba a reescribir cada foto.
// Ahora cada carpeta tiene un id estable y las fotos guardan `folderId`.
function newId() { return crypto.randomUUID ? crypto.randomUUID() : `f${Date.now()}${Math.random().toString(16).slice(2)}`; }
function migrateFolderShape(stored) {
  if (!stored || !stored.length) return { folders: [], nameToId: null, changed: false };
  if (stored[0] && stored[0].id) return { folders: stored, nameToId: null, changed: false };
  const legacy = typeof stored[0] === "string" ? stored.map((name) => ({ name, parent: null })) : stored;
  const nameToId = {};
  const folders = legacy.map((folder) => {
    const id = newId();
    nameToId[folder.name] = id;
    return { id, name: folder.name, parentId: null, _legacyParent: folder.parent };
  });
  folders.forEach((folder) => {
    folder.parentId = folder._legacyParent ? nameToId[folder._legacyParent] || null : null;
    delete folder._legacyParent;
  });
  return { folders, nameToId, changed: true };
}
async function migratePhotoFolders(nameToId) {
  for (const photo of state.photos) {
    if (photo.folderId) continue;
    photo.folderId = nameToId[photo.folder] || null;
    delete photo.folder;
    await idbPutPhoto(photo);
  }
}
// Red de seguridad: una foto que quedó apuntando a una carpeta inexistente (dato
// viejo, migración a medias) no puede volverse invisible. No hay carpeta por defecto,
// así que se crea una de rescate sólo si de verdad hace falta.
async function rescueOrphanPhotos() {
  const known = new Set(state.folders.map((folder) => folder.id));
  const orphans = state.photos.filter((photo) => !known.has(photo.folderId));
  if (!orphans.length) return;
  const folder = { id: newId(), name: "Fotos sueltas", parentId: null };
  state.folders.push(folder);
  await idbSetFolders(state.folders);
  for (const photo of orphans) { photo.folderId = folder.id; await idbPutPhoto(photo); }
}
// Las fotos viejas no tienen número de secuencia; se los asigno por orden de
// creación dentro de cada carpeta para que los nombres nuevos sigan contando bien.
async function backfillSequences() {
  const byFolder = new Map();
  for (const photo of state.photos) {
    if (!byFolder.has(photo.folderId)) byFolder.set(photo.folderId, []);
    byFolder.get(photo.folderId).push(photo);
  }
  for (const list of byFolder.values()) {
    list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    let next = 1;
    for (const photo of list) {
      if (typeof photo.seq === "number") { next = Math.max(next, photo.seq + 1); continue; }
      photo.seq = next++;
      await idbPutPhoto(photo);
    }
  }
}

const objectUrls = new Map();
function urlFor(photo) {
  if (!objectUrls.has(photo.id)) objectUrls.set(photo.id, URL.createObjectURL(photo.blob));
  return objectUrls.get(photo.id);
}
function releaseUrl(id) {
  if (objectUrls.has(id)) { URL.revokeObjectURL(objectUrls.get(id)); objectUrls.delete(id); }
}

async function loadAll() {
  try {
    await migrateFromLocalStorage();
    state.photos = await idbGetAllPhotos();
    const stored = await idbGetFolders();
    const { folders, nameToId, changed } = migrateFolderShape(stored);
    state.folders = folders;
    if (changed) await idbSetFolders(state.folders);
    if (nameToId) await migratePhotoFolders(nameToId);
    await rescueOrphanPhotos();
    await backfillSequences();
  } catch (error) {
    console.error(error);
    showError("No se pudo abrir el almacenamiento local. Los registros previos podrían no cargar.");
  }
}

function folderById(id) { return state.folders.find((folder) => folder.id === id) || null; }
function childFolders(parentId) { return state.folders.filter((folder) => folder.parentId === parentId); }
function descendantIds(id) { const direct = childFolders(id).map((folder) => folder.id); return direct.concat(direct.flatMap((childId) => descendantIds(childId))); }
function photosIn(folderId) { return state.photos.filter((photo) => photo.folderId === folderId); }
function countPhotosRecursive(id) { const ids = new Set([id, ...descendantIds(id)]); return state.photos.filter((photo) => ids.has(photo.folderId)).length; }
function folderPath(id) {
  const names = [];
  let current = folderById(id);
  const guard = new Set();
  while (current && !guard.has(current.id)) { guard.add(current.id); names.unshift(current.name); current = current.parentId ? folderById(current.parentId) : null; }
  return names;
}
function orderedFolders() {
  const result = [];
  function walk(parentId, depth) {
    childFolders(parentId).forEach((folder) => { result.push({ folder, depth }); walk(folder.id, depth + 1); });
  }
  walk(null, 0);
  return result;
}
function indent(depth) { return "　".repeat(depth); }
function nextSeqFor(folderId) { return photosIn(folderId).reduce((max, photo) => Math.max(max, photo.seq || 0), 0) + 1; }
function autoName(folder, seq) { return `${folder.name} - ${String(seq).padStart(3, "0")}`; }

function showView(id) {
  views.forEach((view) => $("#" + view).classList.toggle("active", view === id));
  const navAction = id === "galleryView" || id === "folderView" ? "gallery" : null;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.action === navAction));
}
function formatDate(date) { return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date)); }

// Una nota que no se ve desde la grilla no sirve de nada: hay que poder barrer una
// carpeta de un vistazo y saber cuál foto tiene algo escrito.
const NOTE_ICON = `<svg class="note-flag" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`;
function folderCardHTML(folder) {
  const count = countPhotosRecursive(folder.id);
  const subCount = childFolders(folder.id).length;
  const selected = state.folderSelection.has(folder.id) ? " selected" : "";
  const meta = `${count} ${count === 1 ? "foto" : "fotos"}${subCount ? ` · ${subCount} ${subCount === 1 ? "subcarpeta" : "subcarpetas"}` : ""}`;
  const note = folder.note ? `<small class="card-note">${NOTE_ICON}${esc(folder.note)}</small>` : "";
  return `<div class="folder-card${selected}">
    <button type="button" class="folder-open" data-folder="${esc(folder.id)}">
      <div><strong>${esc(folder.name)}</strong><small>${meta}</small>${note}</div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
    <button type="button" class="folder-menu" data-folder-menu="${esc(folder.id)}" aria-label="Opciones de ${esc(folder.name)}">⋮</button>
  </div>`;
}
function photoCardHTML(photo, subtitle) {
  const selected = state.photoSelection.has(photo.id) ? " selected" : "";
  const flag = photo.note ? `<span class="photo-note-flag" aria-label="Con nota">${NOTE_ICON}</span>` : "";
  const caption = photo.note ? `<small class="card-note">${esc(photo.note)}</small>` : subtitle ? `<small>${esc(subtitle)}</small>` : "";
  return `<button class="photo-card${selected}" data-id="${esc(photo.id)}"><img src="${urlFor(photo)}" alt="${esc(photo.name)}" loading="lazy">${flag}<div><strong>${esc(photo.name)}</strong>${caption}</div></button>`;
}

function renderHome() {
  $("#photoCount").textContent = `${state.photos.length} ${state.photos.length === 1 ? "foto" : "fotos"}`;
  const query = state.search.trim().toLowerCase();
  $("#homeBrowse").hidden = !!query;
  $("#searchResults").hidden = !query;
  if (query) { renderSearchResults(query); return; }
  const roots = childFolders(null);
  $("#homeEmptyState").hidden = roots.length > 0;
  $("#folderGrid").innerHTML = roots.map(folderCardHTML).join("");
}
function renderSearchResults(query) {
  const folders = state.folders.filter((folder) => `${folder.name} ${folder.note || ""}`.toLowerCase().includes(query));
  const photos = state.photos.filter((photo) => `${photo.name} ${photo.note || ""}`.toLowerCase().includes(query)).slice().reverse();
  const parts = [];
  if (folders.length) parts.push(`<p class="results-label">Carpetas</p><div class="folder-grid">${folders.map(folderCardHTML).join("")}</div>`);
  if (photos.length) parts.push(`<p class="results-label">Fotos</p><div class="photo-grid">${photos.map((photo) => photoCardHTML(photo, folderPath(photo.folderId).join(" / "))).join("")}</div>`);
  $("#searchResults").innerHTML = parts.join("") || `<p class="results-empty">Nada coincide con "${esc(query)}".</p>`;
}

function showFolderView() {
  const folder = folderById(state.activeFolderId);
  if (!folder) { goHome(); return; }
  const subfolders = childFolders(folder.id);
  const photos = photosIn(folder.id).slice().reverse();
  const path = folderPath(folder.id).slice(0, -1);
  $("#folderViewPath").textContent = path.length ? path.join(" / ").toUpperCase() : "CARPETA";
  $("#folderViewTitle").textContent = folder.name;
  $("#folderNoteText").textContent = folder.note || "Agregar una nota a esta carpeta";
  $("#folderNoteCard").classList.toggle("empty", !folder.note);
  $("#subfolderGrid").innerHTML = subfolders.map(folderCardHTML).join("");
  $("#subfolderGrid").hidden = subfolders.length === 0;
  $("#photoGrid").innerHTML = photos.map((photo) => photoCardHTML(photo)).join("");
  $("#emptyState").hidden = photos.length > 0 || subfolders.length > 0;
  showView("folderView");
}
function goHome() { state.activeFolderId = null; renderHome(); showView("galleryView"); }
function refreshCurrentList() {
  if ($("#folderView").classList.contains("active")) showFolderView();
  else renderHome();
}
function backToFolderOrHome() { if (state.activeFolderId) showFolderView(); else goHome(); }
function goUpFromFolder() {
  const folder = folderById(state.activeFolderId);
  const parentId = folder ? folder.parentId : null;
  if (parentId) { state.activeFolderId = parentId; showFolderView(); } else goHome();
}

// --- Cámara dentro de la app (getUserMedia): evita el cambio de app que en Android
// hace que el sistema mate la página y se pierda la foto. Cae al input nativo si falla.
// Modo ráfaga: cada disparo guarda la foto directo y la cámara queda abierta. ---
async function openCameraFor(folderId) {
  const folder = folderById(folderId);
  if (!folder) { showError("Elegí una carpeta antes de sacar fotos."); return; }
  state.captureFolderId = folder.id;
  state.burst = [];
  renderBurst();
  $("#cameraFolderName").textContent = folder.name;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("#cameraInput").click(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: state.facingMode, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
    state.cameraStream = stream;
    state.cameraZoom = 1;
    $("#cameraStream").srcObject = stream;
    $("#cameraOverlay").hidden = false;
    setupCameraZoom(stream);
  } catch (error) {
    console.error(error);
    $("#cameraInput").click();
  }
}
function requestCapture() {
  if (state.activeFolderId) { openCameraFor(state.activeFolderId); return; }
  // Sin carpetas todavía no hay nada que elegir: se pide el nombre y se entra derecho
  // a la cámara, que es el flujo de un relevamiento nuevo.
  if (!state.folders.length) { state.afterFolderPick = (id) => openCameraFor(id); openFolderCreateDialog(null); return; }
  openFolderPickDialog((folderId) => openCameraFor(folderId));
}
// El listener se registra una sola vez (más abajo); acá sólo se actualiza qué
// track controlar. Si esto reatachara listeners en cada apertura de cámara, se
// acumularían y el zoom quedaría errático (bug real encontrado al probar
// "Cambiar cámara" dos veces seguidas).
const cameraZoomInfo = { track: null, hasHardwareZoom: false, minZ: 1, maxZ: 4 };
function setupCameraZoom(stream) {
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  cameraZoomInfo.track = track;
  cameraZoomInfo.hasHardwareZoom = !!caps.zoom;
  cameraZoomInfo.minZ = cameraZoomInfo.hasHardwareZoom ? caps.zoom.min : 1;
  cameraZoomInfo.maxZ = cameraZoomInfo.hasHardwareZoom ? caps.zoom.max : 4;
  $("#cameraStream").style.transform = "scale(1)";
}
(function initCameraZoomGestures() {
  const video = $("#cameraStream");
  let lastDist = 0;
  video.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { e.preventDefault(); lastDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY); } }, { passive: false });
  video.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2 || !cameraZoomInfo.track) return;
    e.preventDefault();
    const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
    if (!lastDist) { lastDist = dist; return; }
    const scale = dist / lastDist;
    state.cameraZoom = Math.min(cameraZoomInfo.maxZ, Math.max(cameraZoomInfo.minZ, state.cameraZoom * scale));
    if (cameraZoomInfo.hasHardwareZoom) cameraZoomInfo.track.applyConstraints({ advanced: [{ zoom: state.cameraZoom }] });
    else video.style.transform = `scale(${state.cameraZoom})`;
    lastDist = dist;
  }, { passive: false });
})();
function closeCamera() {
  if (state.cameraStream) { state.cameraStream.getTracks().forEach((track) => track.stop()); state.cameraStream = null; }
  $("#cameraStream").srcObject = null;
  $("#cameraStream").style.transform = "scale(1)";
  $("#cameraOverlay").hidden = true;
}
function finishCamera() {
  const folderId = state.captureFolderId;
  closeCamera();
  if (folderId) { state.activeFolderId = folderId; showFolderView(); }
  state.burst = [];
}
async function savePhotoBlob(blob, folderId) {
  const folder = folderById(folderId);
  if (!folder) throw new Error("La carpeta destino ya no existe.");
  const seq = nextSeqFor(folder.id);
  const photo = { id: newId(), blob, name: autoName(folder, seq), folderId: folder.id, note: "", createdAt: new Date().toISOString(), seq };
  await idbPutPhoto(photo);
  state.photos.push(photo);
  return photo;
}
function renderBurst() {
  const strip = $("#cameraStrip");
  $("#cameraCounter").textContent = String(state.burst.length);
  strip.hidden = state.burst.length === 0;
  strip.innerHTML = state.burst.slice(-6).reverse().map((photo) => `<img src="${urlFor(photo)}" alt="${esc(photo.name)}">`).join("");
}
function flashCamera() {
  const flash = $("#cameraFlash");
  flash.classList.remove("on");
  void flash.offsetWidth;
  flash.classList.add("on");
}
function capturePhoto() {
  if (state.capturing) return;
  const video = $("#cameraStream");
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) { showError("La cámara todavía no está lista. Probá de nuevo."); return; }
  // Cuando el sensor no expone zoom por hardware, el zoom es un transform CSS sobre
  // el <video>. Hay que recortar el frame igual, si no la foto sale sin acercar.
  const zoom = cameraZoomInfo.hasHardwareZoom ? 1 : Math.max(1, state.cameraZoom);
  const sw = w / zoom, sh = h / zoom, sx = (w - sw) / 2, sy = (h - sh) / 2;
  const shot = document.createElement("canvas");
  shot.width = Math.round(sw); shot.height = Math.round(sh);
  shot.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, shot.width, shot.height);
  state.capturing = true;
  flashCamera();
  shot.toBlob(async (blob) => {
    try {
      if (!blob) throw new Error("sin blob");
      const photo = await savePhotoBlob(blob, state.captureFolderId);
      state.burst.push(photo);
      renderBurst();
    } catch (error) {
      console.error(error);
      showError("No se pudo guardar la foto. Verificá el espacio disponible en el navegador.");
    } finally {
      state.capturing = false;
    }
  }, "image/jpeg", 0.92);
}
async function flipCamera() {
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  const folderId = state.captureFolderId;
  const burst = state.burst;
  closeCamera();
  await openCameraFor(folderId);
  state.burst = burst;
  renderBurst();
}
// Importar un lote de la galería: puede ser una foto o cincuenta, así que ordena por
// fecha de captura (para que la numeración quede cronológica), descarta lo que no sea
// imagen y muestra progreso — sin eso, elegir 40 fotos parece que no hace nada.
async function importFiles(files, targetId) {
  const folderId = targetId || state.activeFolderId;
  if (!folderById(folderId)) { showError("Entrá a una carpeta antes de importar fotos."); return; }
  const images = [...files]
    .filter((file) => (file.type || "").startsWith("image/"))
    .sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0) || a.name.localeCompare(b.name));
  const skipped = files.length - images.length;
  if (!images.length) { showError("No se seleccionó ninguna imagen."); return; }
  const button = $("#importButton");
  button.disabled = true;
  let saved = 0;
  try {
    for (const file of images) {
      toast(`Importando ${saved + 1} de ${images.length}...`, true);
      try { await savePhotoBlob(file, folderId); saved++; }
      catch (error) { console.error(error); }
      await new Promise((resolve) => setTimeout(resolve, 0)); // deja pintar el progreso
    }
  } finally {
    button.disabled = false;
  }
  refreshCurrentList();
  if (!saved) { showError("No se pudo importar ninguna foto. Verificá el espacio disponible en el navegador."); return; }
  const notes = [images.length - saved ? `${images.length - saved} fallaron` : "", skipped ? `${skipped} no eran imágenes` : ""].filter(Boolean);
  toast(`${saved} ${saved === 1 ? "foto agregada" : "fotos agregadas"}${notes.length ? ` · ${notes.join(", ")}` : ""}`);
}

function renderDetailNote(photo) {
  const node = $("#detailNote");
  node.textContent = photo.note || "Agregar una nota";
  node.classList.toggle("empty", !photo.note);
}
function openDetail(id) {
  const photo = state.photos.find((item) => item.id === id); if (!photo) return;
  state.activePhoto = photo;
  state.activeFolderId = photo.folderId;
  $("#detailImage").src = urlFor(photo);
  $("#detailName").textContent = photo.name;
  $("#detailFolder").textContent = folderPath(photo.folderId).join(" / ");
  renderDetailNote(photo);
  $("#detailDate").textContent = formatDate(photo.createdAt);
  $("#editForm").hidden = true; $("#detailReadView").hidden = false;
  resetPhotoZoom();
  showView("detailView");
}

// --- Zoom con pellizco sobre la foto en detalle: el navegador desactiva el
// pinch-zoom nativo de la página cuando la app corre instalada como PWA (modo
// standalone), así que hay que implementarlo a mano con transform CSS. ---
const photoZoom = { scale: 1, x: 0, y: 0 };
function applyPhotoZoom() { $("#detailImage").style.transform = `translate(${photoZoom.x}px, ${photoZoom.y}px) scale(${photoZoom.scale})`; }
function resetPhotoZoom() { photoZoom.scale = 1; photoZoom.x = 0; photoZoom.y = 0; applyPhotoZoom(); }
function clampPhotoZoom(wrapRect) {
  const minX = wrapRect.width - wrapRect.width * photoZoom.scale;
  const minY = wrapRect.height - wrapRect.height * photoZoom.scale;
  photoZoom.x = Math.min(0, Math.max(minX, photoZoom.x));
  photoZoom.y = Math.min(0, Math.max(minY, photoZoom.y));
}
(function setupPhotoZoom() {
  const wrap = $("#detailImageWrap");
  let pinchDist = 0, pinchStartScale = 1, pinchAnchor = null;
  let panStart = null, panOrigin = null;
  let lastTapTime = 0;
  wrap.addEventListener("touchstart", (e) => {
    const rect = wrap.getBoundingClientRect();
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      pinchStartScale = photoZoom.scale;
      pinchAnchor = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top };
      panStart = null;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTime < 300) {
        e.preventDefault();
        const tapX = e.touches[0].clientX - rect.left, tapY = e.touches[0].clientY - rect.top;
        if (photoZoom.scale > 1) { resetPhotoZoom(); }
        else {
          photoZoom.scale = 2.5;
          photoZoom.x = tapX - tapX * photoZoom.scale;
          photoZoom.y = tapY - tapY * photoZoom.scale;
          clampPhotoZoom(rect);
          applyPhotoZoom();
        }
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;
      if (photoZoom.scale > 1) { panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }; panOrigin = { x: photoZoom.x, y: photoZoom.y }; }
    }
  }, { passive: false });
  wrap.addEventListener("touchmove", (e) => {
    const rect = wrap.getBoundingClientRect();
    if (e.touches.length === 2 && pinchDist) {
      e.preventDefault();
      const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
      const newScale = Math.min(4, Math.max(1, pinchStartScale * (dist / pinchDist)));
      const localX = (pinchAnchor.x - photoZoom.x) / photoZoom.scale, localY = (pinchAnchor.y - photoZoom.y) / photoZoom.scale;
      photoZoom.scale = newScale;
      photoZoom.x = pinchAnchor.x - localX * newScale;
      photoZoom.y = pinchAnchor.y - localY * newScale;
      clampPhotoZoom(rect);
      applyPhotoZoom();
    } else if (e.touches.length === 1 && panStart) {
      e.preventDefault();
      photoZoom.x = panOrigin.x + (e.touches[0].clientX - panStart.x);
      photoZoom.y = panOrigin.y + (e.touches[0].clientY - panStart.y);
      clampPhotoZoom(rect);
      applyPhotoZoom();
    }
  }, { passive: false });
  wrap.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) pinchDist = 0;
    if (e.touches.length === 0) { panStart = null; if (photoZoom.scale <= 1) resetPhotoZoom(); }
  });
  wrap.addEventListener("touchcancel", () => { pinchDist = 0; panStart = null; });
})();

// --- Editor de marcado ---
// Todas las marcas (flecha, recuadro, texto y trazo libre) viven como objetos en
// state.annotations. Nada se hornea en píxeles hasta tocar "Listo", y la lista de
// marcas se guarda junto a la foto (photo.marks) sobre el original intacto
// (photo.originalBlob), así una foto se puede re-marcar sin perder calidad ni
// sin quedar atada a las marcas que ya tenía.
const canvas = $("#annotationCanvas"); const context = canvas.getContext("2d"); let editorImage = new Image();
const MAX_EDIT_SIDE = 2560;
function drawBase() { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(editorImage, 0, 0, canvas.width, canvas.height); }
function strokeWidth() { return Math.max(4, canvas.width / 180); }
function fontFor(a) { return `bold ${a.fontSize}px sans-serif`; }
function labelFor(type) { return type === "arrow" ? "flecha" : type === "box" ? "recuadro" : type === "draw" ? "trazo" : "texto"; }
function drawArrowShape(a) {
  context.strokeStyle = a.color; context.fillStyle = a.color; context.lineWidth = a.width || strokeWidth(); context.lineCap = "round";
  const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const size = Math.max(15, canvas.width / 32);
  context.beginPath();
  context.moveTo(a.x1, a.y1); context.lineTo(a.x2, a.y2);
  context.lineTo(a.x2 - size * Math.cos(angle - Math.PI / 6), a.y2 - size * Math.sin(angle - Math.PI / 6));
  context.moveTo(a.x2, a.y2);
  context.lineTo(a.x2 - size * Math.cos(angle + Math.PI / 6), a.y2 - size * Math.sin(angle + Math.PI / 6));
  context.stroke();
}
function drawBoxShape(a) { context.strokeStyle = a.color; context.lineWidth = a.width || strokeWidth(); context.strokeRect(a.x, a.y, a.w, a.h); }
function drawTextShape(a) { context.fillStyle = a.color; context.font = fontFor(a); context.fillText(a.text, a.x, a.y); }
function drawFreehandShape(a) {
  if (!a.points || a.points.length === 0) return;
  context.strokeStyle = a.color; context.lineWidth = a.width || strokeWidth(); context.lineCap = "round"; context.lineJoin = "round";
  context.beginPath();
  context.moveTo(a.points[0].x, a.points[0].y);
  for (let i = 1; i < a.points.length; i++) context.lineTo(a.points[i].x, a.points[i].y);
  if (a.points.length === 1) context.lineTo(a.points[0].x + 0.1, a.points[0].y);
  context.stroke();
}
function drawAnnotation(a) {
  if (a.type === "arrow") drawArrowShape(a);
  else if (a.type === "box") drawBoxShape(a);
  else if (a.type === "draw") drawFreehandShape(a);
  else drawTextShape(a);
}
function annotationHandles(a) {
  if (a.type === "arrow") return [{ key: "start", x: a.x1, y: a.y1 }, { key: "end", x: a.x2, y: a.y2 }];
  if (a.type === "box") return [{ key: "tl", x: a.x, y: a.y }, { key: "tr", x: a.x + a.w, y: a.y }, { key: "bl", x: a.x, y: a.y + a.h }, { key: "br", x: a.x + a.w, y: a.y + a.h }];
  if (a.type === "draw") return [];
  context.font = fontFor(a);
  return [{ key: "resize", x: a.x + context.measureText(a.text).width + 12, y: a.y }];
}
function drawHandles(a) {
  const r = Math.max(9, canvas.width / 90);
  annotationHandles(a).forEach((h) => {
    context.fillStyle = "#ffffff"; context.strokeStyle = a.color; context.lineWidth = 2;
    context.beginPath(); context.arc(h.x, h.y, r, 0, Math.PI * 2); context.fill(); context.stroke();
  });
}
function selectedAnnotation() { return state.annotations.find((a) => a.id === state.selectedAnnotationId); }
function fullRedraw() {
  drawBase();
  state.annotations.forEach(drawAnnotation);
  const selected = selectedAnnotation();
  if (selected) drawHandles(selected);
}
function cloneAnnotations(list) {
  return (list || []).map((a) => (a.points ? { ...a, points: a.points.map((p) => ({ x: p.x, y: p.y })) } : { ...a }));
}
function openEditorForPhoto(photo) {
  state.editorPhoto = photo;
  const source = photo.originalBlob || photo.blob;
  const url = URL.createObjectURL(source);
  editorImage = new Image();
  editorImage.onload = () => {
    URL.revokeObjectURL(url);
    const ratio = Math.min(MAX_EDIT_SIDE / editorImage.width, MAX_EDIT_SIDE / editorImage.height, 1);
    canvas.width = Math.round(editorImage.width * ratio);
    canvas.height = Math.round(editorImage.height * ratio);
    state.annotations = cloneAnnotations(photo.marks);
    state.selectedAnnotationId = null;
    deactivateTool();
    fullRedraw();
    showView("editorView");
  };
  editorImage.onerror = () => { URL.revokeObjectURL(url); showError("No se pudo abrir la foto para marcarla."); };
  editorImage.src = url;
}
function point(event) { const rect = canvas.getBoundingClientRect(); const touch = event.touches?.[0] || event; return { x: (touch.clientX - rect.left) * canvas.width / rect.width, y: (touch.clientY - rect.top) * canvas.height / rect.height }; }
function deactivateTool() {
  state.tool = null;
  document.querySelectorAll(".tool[data-tool]").forEach((button) => button.classList.remove("active"));
}
function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function annotationBoundsHit(a, p) {
  const pad = 14;
  if (a.type === "arrow") return distanceToSegment(p, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }) <= pad;
  if (a.type === "box") {
    const x0 = Math.min(a.x, a.x + a.w), x1 = Math.max(a.x, a.x + a.w), y0 = Math.min(a.y, a.y + a.h), y1 = Math.max(a.y, a.y + a.h);
    return p.x >= x0 - pad && p.x <= x1 + pad && p.y >= y0 - pad && p.y <= y1 + pad;
  }
  if (a.type === "draw") {
    const reach = pad + (a.width || 0) / 2;
    for (let i = 1; i < a.points.length; i++) if (distanceToSegment(p, a.points[i - 1], a.points[i]) <= reach) return true;
    return a.points.length === 1 && Math.hypot(p.x - a.points[0].x, p.y - a.points[0].y) <= reach;
  }
  context.font = fontFor(a);
  const width = context.measureText(a.text).width;
  return p.x >= a.x - pad && p.x <= a.x + width + pad && p.y >= a.y - a.fontSize - pad && p.y <= a.y + pad;
}
function findAnnotationAt(p) {
  for (let i = state.annotations.length - 1; i >= 0; i--) if (annotationBoundsHit(state.annotations[i], p)) return state.annotations[i];
  return null;
}
function findHandleAt(a, p) {
  const r = Math.max(14, canvas.width / 70);
  for (const h of annotationHandles(a)) if (Math.hypot(p.x - h.x, p.y - h.y) <= r) return h.key;
  return null;
}
function translateAnnotation(a, dx, dy) {
  if (a.type === "arrow") { a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; }
  else if (a.type === "draw") a.points.forEach((p) => { p.x += dx; p.y += dy; });
  else { a.x += dx; a.y += dy; }
}
function resizeAnnotation(a, handleKey, p) {
  if (a.type === "arrow") {
    if (handleKey === "start") { a.x1 = p.x; a.y1 = p.y; } else { a.x2 = p.x; a.y2 = p.y; }
  } else if (a.type === "box") {
    const opposite = {
      tl: { x: a.x + a.w, y: a.y + a.h }, tr: { x: a.x, y: a.y + a.h },
      bl: { x: a.x + a.w, y: a.y }, br: { x: a.x, y: a.y },
    }[handleKey];
    a.x = Math.min(opposite.x, p.x); a.y = Math.min(opposite.y, p.y);
    a.w = Math.abs(p.x - opposite.x); a.h = Math.abs(p.y - opposite.y);
  } else if (a.type === "text") {
    context.font = fontFor(a);
    const currentWidth = context.measureText(a.text).width || 1;
    const desiredWidth = Math.max(10, p.x - a.x);
    a.fontSize = Math.min(160, Math.max(12, a.fontSize * (desiredWidth / currentWidth)));
  }
}
function normalizeBox(a) {
  if (a.w < 0) { a.x += a.w; a.w = -a.w; }
  if (a.h < 0) { a.y += a.h; a.h = -a.h; }
}
let interaction = null;
canvas.addEventListener("pointerdown", (event) => {
  const p = point(event);
  const selected = selectedAnnotation();
  if (selected) {
    const handleKey = findHandleAt(selected, p);
    if (handleKey) { interaction = { mode: "resize", id: selected.id, handleKey }; return; }
  }
  const hit = findAnnotationAt(p);
  if (hit) {
    state.selectedAnnotationId = hit.id;
    interaction = { mode: "move", id: hit.id, start: p, moved: false, longPressTimer: null };
    interaction.longPressTimer = setTimeout(() => {
      if (!interaction || interaction.moved) return;
      interaction.longPressTimer = null;
      if (confirm(`¿Eliminar este ${labelFor(hit.type)}?`)) {
        state.annotations = state.annotations.filter((a) => a.id !== hit.id);
        if (state.selectedAnnotationId === hit.id) state.selectedAnnotationId = null;
        fullRedraw();
      }
      interaction = null;
    }, 550);
    fullRedraw();
    return;
  }
  if (state.selectedAnnotationId) { state.selectedAnnotationId = null; fullRedraw(); }
  if (state.tool === "text") {
    const label = prompt("Texto a agregar:");
    if (label) {
      const a = { id: newId(), type: "text", x: p.x, y: p.y, text: label, color: state.color, fontSize: Math.max(20, canvas.width / 23) };
      state.annotations.push(a);
      state.selectedAnnotationId = a.id;
      fullRedraw();
    }
    deactivateTool();
    return;
  }
  if (state.tool === "arrow" || state.tool === "box") {
    const a = state.tool === "arrow"
      ? { id: newId(), type: "arrow", x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: state.color, width: strokeWidth() }
      : { id: newId(), type: "box", x: p.x, y: p.y, w: 0, h: 0, color: state.color, width: strokeWidth() };
    state.annotations.push(a);
    interaction = { mode: "create", id: a.id };
    return;
  }
  if (state.tool === "draw") {
    const a = { id: newId(), type: "draw", points: [p], color: state.color, width: strokeWidth() };
    state.annotations.push(a);
    interaction = { mode: "create", id: a.id };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (!interaction) return;
  const p = point(event);
  if (interaction.mode === "create") {
    const a = state.annotations.find((x) => x.id === interaction.id);
    if (!a) return;
    if (a.type === "arrow") { a.x2 = p.x; a.y2 = p.y; }
    else if (a.type === "draw") a.points.push(p);
    else { a.w = p.x - a.x; a.h = p.y - a.y; }
    fullRedraw();
    return;
  }
  if (interaction.mode === "move") {
    const moved = Math.hypot(p.x - interaction.start.x, p.y - interaction.start.y);
    if (!interaction.moved && moved > 6) {
      if (interaction.longPressTimer) { clearTimeout(interaction.longPressTimer); interaction.longPressTimer = null; }
      interaction.moved = true;
    }
    if (interaction.moved) {
      const a = state.annotations.find((x) => x.id === interaction.id);
      if (a) { translateAnnotation(a, p.x - interaction.start.x, p.y - interaction.start.y); interaction.start = p; fullRedraw(); }
    }
    return;
  }
  if (interaction.mode === "resize") {
    const a = state.annotations.find((x) => x.id === interaction.id);
    if (a) { resizeAnnotation(a, interaction.handleKey, p); fullRedraw(); }
  }
});
canvas.addEventListener("pointerup", () => {
  if (!interaction) return;
  if (interaction.mode === "create") {
    const a = state.annotations.find((x) => x.id === interaction.id);
    if (a) {
      const tooSmall = a.type === "arrow" ? Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 6
        : a.type === "draw" ? a.points.length < 2
        : Math.abs(a.w) < 6 && Math.abs(a.h) < 6;
      if (tooSmall) state.annotations = state.annotations.filter((x) => x.id !== a.id);
      else if (a.type === "draw") state.selectedAnnotationId = null;
      else { if (a.type === "box") normalizeBox(a); state.selectedAnnotationId = a.id; }
    }
    deactivateTool();
    fullRedraw();
  }
  if (interaction.mode === "move" && interaction.longPressTimer) clearTimeout(interaction.longPressTimer);
  interaction = null;
});
canvas.addEventListener("pointercancel", () => {
  if (interaction) { if (interaction.longPressTimer) clearTimeout(interaction.longPressTimer); interaction = null; }
});
$("#undoButton").onclick = () => {
  if (!state.annotations.length) return;
  const removed = state.annotations.pop();
  if (state.selectedAnnotationId === removed.id) state.selectedAnnotationId = null;
  fullRedraw();
};
$("#saveMarksButton").onclick = () => {
  const photo = state.editorPhoto;
  if (!photo) { showView("detailView"); return; }
  state.selectedAnnotationId = null;
  fullRedraw();
  canvas.toBlob(async (blob) => {
    try {
      if (!blob) throw new Error("sin blob");
      if (!photo.originalBlob) photo.originalBlob = photo.blob;
      photo.blob = blob;
      photo.marks = cloneAnnotations(state.annotations);
      await idbPutPhoto(photo);
      releaseUrl(photo.id);
      openDetail(photo.id);
      toast("Marcas guardadas");
    } catch (error) {
      console.error(error);
      showError("No se pudieron guardar las marcas.");
    }
  }, "image/jpeg", 0.92);
};

// --- Navegación y acciones ---
document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "capture") requestCapture();
  if (action === "gallery") goHome();
  if (action === "back") backToFolderOrHome();
  if (action === "up") goUpFromFolder();
  if (action === "cancel-marks") { if (state.editorPhoto) openDetail(state.editorPhoto.id); else backToFolderOrHome(); }

  const folderMenu = event.target.closest("[data-folder-menu]");
  if (folderMenu) { openFolderActions(folderMenu.dataset.folderMenu); return; }
  const folderOpen = event.target.closest("[data-folder]");
  if (folderOpen) {
    if (longPressTriggered) { longPressTriggered = false; return; }
    const id = folderOpen.dataset.folder;
    if (state.folderSelectMode) { toggleFolderSelection(id); return; }
    state.activeFolderId = id; state.search = ""; $("#searchInput").value = ""; showFolderView(); return;
  }
  const card = event.target.closest(".photo-card");
  if (card) {
    if (longPressTriggered) { longPressTriggered = false; return; }
    if (state.photoSelectMode) { togglePhotoSelection(card.dataset.id); return; }
    openDetail(card.dataset.id); return;
  }
  const tool = event.target.closest("[data-tool]");
  if (tool) { state.tool = tool.dataset.tool; document.querySelectorAll(".tool[data-tool]").forEach((button) => button.classList.toggle("active", button === tool)); }
  const color = event.target.closest("[data-color]");
  if (color) { state.color = color.dataset.color; document.querySelectorAll(".color").forEach((button) => button.classList.toggle("active", button === color)); }
  const folderAction = event.target.closest("[data-folder-action]");
  if (folderAction) runFolderAction(folderAction.dataset.folderAction);
  const moveTarget = event.target.closest("[data-move-target]");
  if (moveTarget) moveSelectedFoldersTo(moveTarget.dataset.moveTarget || null);
  const photoTarget = event.target.closest("[data-photo-target]");
  if (photoTarget) applyPhotoTarget(photoTarget.dataset.photoTarget);
  const pickTarget = event.target.closest("[data-pick-folder]");
  if (pickTarget) resolveFolderPick(pickTarget.dataset.pickFolder);
  const quickNote = event.target.closest("[data-quick-note]");
  if (quickNote) { $("#editNote").value = quickNote.dataset.quickNote; renderQuickNotes(); }
});

let longPressTimer = null;
let longPressTriggered = false;
let longPressStartPos = null;
document.addEventListener("pointerdown", (e) => {
  const card = e.target.closest(".folder-open, .photo-card");
  if (!card) return;
  longPressTriggered = false;
  longPressStartPos = { x: e.clientX, y: e.clientY };
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    if (card.classList.contains("folder-open")) {
      toggleFolderSelection(card.dataset.folder);
    } else {
      togglePhotoSelection(card.dataset.id);
    }
  }, 550);
});
document.addEventListener("pointerup", () => clearTimeout(longPressTimer));
document.addEventListener("pointercancel", () => clearTimeout(longPressTimer));
document.addEventListener("pointermove", (e) => { if (longPressStartPos && Math.hypot(e.clientX - longPressStartPos.x, e.clientY - longPressStartPos.y) > 10) clearTimeout(longPressTimer); });

function toggleFolderSelection(id) {
  if (state.folderSelection.has(id)) state.folderSelection.delete(id); else state.folderSelection.add(id);
  if (state.folderSelection.size === 0) { exitFolderSelectMode(); return; }
  state.folderSelectMode = true;
  renderFolderSelectBar();
  refreshCurrentList();
}
function renderFolderSelectBar() {
  const n = state.folderSelection.size;
  $("#folderSelectBar").hidden = !state.folderSelectMode;
  $("#folderSelectCount").textContent = `${n} ${n === 1 ? "carpeta seleccionada" : "carpetas seleccionadas"}`;
}
function exitFolderSelectMode() {
  state.folderSelection.clear();
  state.folderSelectMode = false;
  renderFolderSelectBar();
  refreshCurrentList();
}
$("#folderSelectCancel").onclick = exitFolderSelectMode;
$("#folderSelectDelete").onclick = async () => {
  const ids = [...state.folderSelection];
  if (!ids.length) return;
  const label = ids.length > 1 ? `las ${ids.length} carpetas seleccionadas` : `la carpeta "${folderById(ids[0])?.name}"`;
  if (!confirm(`¿Eliminar ${label}?${deletionWarning(ids)}`)) return;
  for (const id of ids) await removeFolder(id);
  exitFolderSelectMode();
};
$("#folderSelectMove").onclick = () => openMoveFolderDialog([...state.folderSelection]);
function openMoveFolderDialog(ids) {
  const blocked = new Set(ids.flatMap((id) => [id, ...descendantIds(id)]));
  const targets = orderedFolders().filter(({ folder }) => !blocked.has(folder.id));
  $("#moveFolderList").innerHTML = `<li><button type="button" data-move-target="">— Nivel principal —</button></li>` +
    targets.map(({ folder, depth }) => `<li><button type="button" data-move-target="${esc(folder.id)}">${indent(depth)}${esc(folder.name)}</button></li>`).join("");
  $("#moveFolderDialog").showModal();
}
// Cancelar el diálogo tiene que dejar la selección como estaba: si vino del menú ⋮
// de una sola carpeta, la selección era temporal y no hay barra de selección visible.
$("#moveFolderDialog").addEventListener("close", () => { if (!state.folderSelectMode) state.folderSelection.clear(); });
async function moveSelectedFoldersTo(targetId) {
  for (const id of state.folderSelection) {
    const folder = folderById(id);
    if (folder) folder.parentId = targetId || null;
  }
  await saveFolders();
  $("#moveFolderDialog").close();
  exitFolderSelectMode();
  toast("Carpetas movidas");
}

function togglePhotoSelection(id) {
  if (state.photoSelection.has(id)) state.photoSelection.delete(id); else state.photoSelection.add(id);
  if (state.photoSelection.size === 0) { exitPhotoSelectMode(); return; }
  state.photoSelectMode = true;
  renderPhotoSelectBar();
  refreshCurrentList();
}
function renderPhotoSelectBar() {
  const n = state.photoSelection.size;
  $("#photoSelectBar").hidden = !state.photoSelectMode;
  $("#photoSelectCount").textContent = `${n} ${n === 1 ? "foto seleccionada" : "fotos seleccionadas"}`;
}
function exitPhotoSelectMode() {
  state.photoSelection.clear();
  state.photoSelectMode = false;
  renderPhotoSelectBar();
  refreshCurrentList();
}
$("#photoSelectCancel").onclick = exitPhotoSelectMode;
$("#photoSelectDelete").onclick = async () => {
  const ids = [...state.photoSelection];
  if (!ids.length) return;
  const label = ids.length > 1 ? `las ${ids.length} fotos seleccionadas` : "esta foto";
  if (!confirm(`¿Eliminar ${label}?`)) return;
  try {
    for (const id of ids) { await idbDeletePhoto(id); releaseUrl(id); }
    state.photos = state.photos.filter((photo) => !ids.includes(photo.id));
    exitPhotoSelectMode();
  } catch (error) {
    console.error(error);
    showError("No se pudieron eliminar las fotos.");
  }
};
function openPhotoTargetDialog(mode) {
  state.photoMoveMode = mode;
  $("#photoTargetTitle").textContent = mode === "copy" ? "Copiar a" : "Mover a";
  $("#photoTargetList").innerHTML = orderedFolders()
    .map(({ folder, depth }) => `<li><button type="button" data-photo-target="${esc(folder.id)}">${indent(depth)}${esc(folder.name)}</button></li>`)
    .join("");
  $("#photoTargetDialog").showModal();
}
$("#photoSelectMove").onclick = () => openPhotoTargetDialog("move");
$("#photoSelectCopy").onclick = () => openPhotoTargetDialog("copy");
async function applyPhotoTarget(targetId) {
  const ids = [...state.photoSelection];
  const target = folderById(targetId);
  if (!target) return;
  try {
    for (const id of ids) {
      const photo = state.photos.find((item) => item.id === id);
      if (!photo) continue;
      if (state.photoMoveMode === "copy") {
        const copy = { ...photo, id: newId(), folderId: target.id, seq: nextSeqFor(target.id) };
        copy.name = autoName(target, copy.seq);
        await idbPutPhoto(copy);
        state.photos.push(copy);
      } else {
        photo.folderId = target.id;
        photo.seq = nextSeqFor(target.id);
        await idbPutPhoto(photo);
      }
    }
    toast(state.photoMoveMode === "copy" ? "Fotos copiadas" : "Fotos movidas");
  } catch (error) {
    console.error(error);
    showError("No se pudo completar la operación.");
  }
  $("#photoTargetDialog").close();
  exitPhotoSelectMode();
}

// --- Carpetas: crear, renombrar, mover, eliminar ---
// El padre de una carpeta nueva lo define desde dónde se la creó (home = nivel
// principal, dentro de una carpeta = subcarpeta de esa). No hay desplegable de
// jerarquía: el contexto ya tiene la respuesta.
function openFolderCreateDialog(parentId) {
  state.pendingParentId = parentId || null;
  const parent = parentId ? folderById(parentId) : null;
  $("#folderCreateTitle").textContent = parent ? "Nueva subcarpeta" : "Nueva carpeta";
  $("#folderCreateHint").textContent = parent ? `Se creará dentro de "${parent.name}".` : "Se creará en el nivel principal.";
  $("#newFolderInput").value = "";
  $("#folderCreateDialog").showModal();
  setTimeout(() => $("#newFolderInput").focus(), 50);
}
$("#newFolderButtonHome").onclick = () => openFolderCreateDialog(null);
$("#newFolderButtonFolder").onclick = () => openFolderCreateDialog(state.activeFolderId);
$("#confirmFolder").onclick = async () => {
  const name = $("#newFolderInput").value.trim();
  const parentId = state.pendingParentId;
  if (!name) { showError("Poné un nombre para la carpeta."); return; }
  if (childFolders(parentId).some((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
    showError("Ya hay una carpeta con ese nombre en este mismo lugar.");
    return;
  }
  const folder = { id: newId(), name, parentId: parentId || null };
  state.folders.push(folder);
  await saveFolders();
  $("#folderCreateDialog").close();
  if (state.afterFolderPick) { const callback = state.afterFolderPick; state.afterFolderPick = null; callback(folder.id); return; }
  state.activeFolderId = folder.id;
  showFolderView();
  toast(`Carpeta "${folder.name}" creada`);
};
$("#newFolderInput").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); $("#confirmFolder").click(); } });

function openFolderActions(id) {
  const folder = folderById(id);
  if (!folder) return;
  state.actionsFolderId = id;
  $("#folderActionsTitle").textContent = folder.name;
  $("#folderActionsDialog").showModal();
}
// Borrar una carpeta se lleva todo lo que tiene adentro, así que el aviso dice
// exactamente qué se pierde. Para conservar las fotos hay que moverlas antes.
function deletionWarning(ids) {
  const all = new Set(ids.flatMap((id) => [id, ...descendantIds(id)]));
  const photos = state.photos.filter((photo) => all.has(photo.folderId)).length;
  const subs = all.size - ids.length;
  const parts = [];
  if (subs) parts.push(`${subs} ${subs === 1 ? "subcarpeta" : "subcarpetas"}`);
  if (photos) parts.push(`${photos} ${photos === 1 ? "foto" : "fotos"}`);
  return parts.length ? ` Se borran también ${parts.join(" y ")}. No se puede deshacer.` : "";
}
function runFolderAction(action) {
  const id = state.actionsFolderId;
  const folder = folderById(id);
  $("#folderActionsDialog").close();
  if (!folder) return;
  if (action === "note") { openFolderNoteDialog(id); return; }
  if (action === "sub") { openFolderCreateDialog(id); return; }
  if (action === "rename") { renameFolder(id); return; }
  if (action === "move") { state.folderSelection = new Set([id]); state.folderSelectMode = false; openMoveFolderDialog([id]); return; }
  if (action === "delete" && confirm(`¿Eliminar la carpeta "${folder.name}"?${deletionWarning([id])}`)) removeFolder(id);
}
async function removeFolder(id) {
  const folder = folderById(id);
  if (!folder) return;
  const doomed = new Set([id, ...descendantIds(id)]);
  try {
    for (const photo of state.photos.filter((item) => doomed.has(item.folderId))) {
      await idbDeletePhoto(photo.id);
      releaseUrl(photo.id);
    }
    state.photos = state.photos.filter((photo) => !doomed.has(photo.folderId));
    state.folders = state.folders.filter((item) => !doomed.has(item.id));
    await saveFolders();
    if (doomed.has(state.activeFolderId)) state.activeFolderId = folderById(folder.parentId) ? folder.parentId : null;
    if (state.activeFolderId) showFolderView(); else goHome();
  } catch (error) {
    console.error(error);
    showError("No se pudo borrar la carpeta.");
  }
}
// La nota de carpeta es el contexto que no cabe en el nombre y que no pertenece a
// ninguna foto en particular: cuándo se hizo, quién estaba, qué quedó pendiente.
function openFolderNoteDialog(id) {
  const folder = folderById(id);
  if (!folder) return;
  state.actionsFolderId = id;
  $("#folderNoteTitle").textContent = `Nota de "${folder.name}"`;
  $("#folderNoteInput").value = folder.note || "";
  $("#folderNoteDialog").showModal();
  setTimeout(() => $("#folderNoteInput").focus(), 50);
}
$("#folderNoteCard").onclick = () => openFolderNoteDialog(state.activeFolderId);
$("#confirmFolderNote").onclick = async () => {
  const folder = folderById(state.actionsFolderId);
  if (!folder) return;
  const note = $("#folderNoteInput").value.trim();
  const had = !!folder.note;
  if (note) folder.note = note; else delete folder.note;
  await saveFolders();
  $("#folderNoteDialog").close();
  refreshCurrentList();
  toast(note ? "Nota guardada" : had ? "Nota borrada" : "Sin cambios");
};

async function renameFolder(id) {
  const folder = folderById(id);
  if (!folder) return;
  const input = prompt("Nuevo nombre para la carpeta:", folder.name);
  if (!input || !input.trim() || input.trim() === folder.name) return;
  const name = input.trim();
  if (childFolders(folder.parentId).some((item) => item.id !== id && item.name.toLowerCase() === name.toLowerCase())) {
    showError("Ya hay una carpeta con ese nombre en este mismo lugar.");
    return;
  }
  folder.name = name;
  await saveFolders();
  refreshCurrentList();
  toast("Carpeta renombrada");
}

function openFolderPickDialog(callback) {
  state.afterFolderPick = callback;
  $("#folderPickList").innerHTML = orderedFolders()
    .map(({ folder, depth }) => `<li><button type="button" data-pick-folder="${esc(folder.id)}">${indent(depth)}${esc(folder.name)}</button></li>`)
    .join("");
  $("#folderPickDialog").showModal();
}
function resolveFolderPick(id) {
  const callback = state.afterFolderPick;
  state.afterFolderPick = null;
  $("#folderPickDialog").close();
  if (callback) callback(id);
}
$("#folderPickNew").onclick = () => { $("#folderPickDialog").close(); openFolderCreateDialog(null); };

// --- Detalle de una foto ---
$("#markButton").onclick = () => { if (state.activePhoto) openEditorForPhoto(state.activePhoto); };
// Notas rápidas: en un relevamiento la misma observación se repite decenas de veces
// ("humedad en cielorraso"). En vez de pedirle al usuario que mantenga una lista de
// etiquetas, la app ofrece lo que él mismo ya escribió, ordenado por uso.
function frequentNotes(limit) {
  const counts = new Map();
  for (const photo of state.photos) {
    const note = (photo.note || "").trim();
    if (!note || note.length > 60) continue;
    counts.set(note, (counts.get(note) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([note]) => note);
}
function renderQuickNotes() {
  const current = $("#editNote").value.trim();
  const notes = frequentNotes(6).filter((note) => note !== current);
  $("#quickNotes").hidden = notes.length === 0;
  $("#quickNotes").innerHTML = notes.map((note) => `<button type="button" class="quick-note" data-quick-note="${esc(note)}">${esc(note)}</button>`).join("");
}
function openPhotoEdit(focusNote) {
  const photo = state.activePhoto; if (!photo) return;
  $("#editName").value = photo.name;
  $("#editNote").value = photo.note || "";
  renderQuickNotes();
  $("#detailReadView").hidden = true; $("#editForm").hidden = false;
  if (focusNote) setTimeout(() => $("#editNote").focus(), 50);
}
$("#editButton").onclick = () => openPhotoEdit(false);
$("#detailNote").onclick = () => openPhotoEdit(true);
$("#editCancel").onclick = () => { $("#editForm").hidden = true; $("#detailReadView").hidden = false; };
$("#editForm").onsubmit = async (event) => {
  event.preventDefault();
  const photo = state.activePhoto; if (!photo) return;
  try {
    photo.name = $("#editName").value.trim() || photo.name;
    photo.note = $("#editNote").value.trim();
    await idbPutPhoto(photo);
    $("#detailName").textContent = photo.name;
    renderDetailNote(photo);
    $("#editForm").hidden = true; $("#detailReadView").hidden = false;
    toast("Cambios guardados");
  } catch (error) {
    console.error(error);
    showError("No se pudieron guardar los cambios.");
  }
};
$("#deleteButton").onclick = async () => {
  if (!state.activePhoto || !confirm("¿Eliminar este registro?")) return;
  try {
    const id = state.activePhoto.id;
    await idbDeletePhoto(id);
    releaseUrl(id);
    state.photos = state.photos.filter((item) => item.id !== id);
    state.activePhoto = null;
    backToFolderOrHome();
  } catch (error) {
    console.error(error);
    showError("No se pudo eliminar la foto.");
  }
};

$("#cameraShutter").onclick = capturePhoto;
$("#cameraCancel").onclick = finishCamera;
$("#cameraDone").onclick = finishCamera;
$("#cameraFlip").onclick = flipCamera;
$("#importButton").onclick = () => $("#libraryInput").click();
// Fallback: si getUserMedia no está disponible se abre la cámara nativa, y ahí la
// carpeta destino es la que se eligió al pedir la cámara, no la que esté abierta.
$("#cameraInput").onchange = (event) => { const files = [...event.target.files]; event.target.value = ""; if (files.length) importFiles(files, state.captureFolderId); };
$("#libraryInput").onchange = (event) => { const files = [...event.target.files]; event.target.value = ""; if (files.length) importFiles(files); };
$("#searchInput").oninput = (event) => { state.search = event.target.value; renderHome(); };

// --- Exportar a .zip ---
let jszipPromise = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve();
  if (!jszipPromise) {
    jszipPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "vendor/jszip.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("No se pudo cargar la librería de exportación."));
      document.head.appendChild(script);
    });
  }
  return jszipPromise;
}
function sanitizeFileName(name) {
  const clean = (name || "").replace(/[\\/:*?"<>|]+/g, "-").trim();
  return clean || "sin-nombre";
}
function csvEscape(value) {
  const s = String(value ?? "");
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function extensionFor(blob) {
  if (blob.type === "image/png") return "png";
  if (blob.type === "image/webp") return "webp";
  return "jpg";
}
async function buildExportZip(photos) {
  await loadJSZip();
  const zip = new JSZip();
  const usedNames = new Map();
  const rows = [["Nombre", "Carpeta", "Nota de la foto", "Nota de la carpeta", "Fecha"]];
  for (const photo of photos) {
    const pathNames = folderPath(photo.folderId);
    const folderNote = folderById(photo.folderId)?.note || "";
    const dir = pathNames.map(sanitizeFileName).join("/") || "General";
    const used = usedNames.get(dir) || new Set();
    const base = sanitizeFileName(photo.name);
    const ext = extensionFor(photo.blob);
    let fileName = `${base}.${ext}`;
    let i = 2;
    while (used.has(fileName)) { fileName = `${base} (${i}).${ext}`; i++; }
    used.add(fileName); usedNames.set(dir, used);
    zip.file(`${dir}/${fileName}`, photo.blob);
    rows.push([photo.name, pathNames.join(" / "), photo.note || "", folderNote, formatDate(photo.createdAt)]);
  }
  const csv = rows.map((row) => row.map(csvEscape).join(";")).join("\r\n");
  zip.file("registro.csv", "﻿" + csv);
  // La nota de carpeta también va como archivo suelto dentro de su propia carpeta:
  // al abrir el zip queda a la vista sin tener que ir al CSV.
  const exported = new Set(photos.map((photo) => photo.folderId));
  for (const folderId of exported) {
    const folder = folderById(folderId);
    if (!folder || !folder.note) continue;
    const dir = folderPath(folderId).map(sanitizeFileName).join("/");
    zip.file(`${dir}/_nota.txt`, "﻿" + folder.note);
  }
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}
async function shareOrDownload(blob, fileName) {
  const file = new File([blob], fileName, { type: "application/zip" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: fileName }); return; }
    catch (error) { if (error && error.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function renderExportFolderList() {
  $("#exportFolderList").innerHTML = orderedFolders()
    .map(({ folder, depth }) => {
      const count = photosIn(folder.id).length;
      return `<li><label><input type="checkbox" value="${esc(folder.id)}" checked> ${indent(depth)}${esc(folder.name)} <small>${count} ${count === 1 ? "foto" : "fotos"}</small></label></li>`;
    })
    .join("");
}
$("#exportButton").onclick = () => {
  if (!state.photos.length) { showError("Todavía no hay fotos para exportar."); return; }
  renderExportFolderList();
  $("#exportDialog").showModal();
};
function setAllExportChecks(checked) { [...$("#exportFolderList").querySelectorAll("input[type=checkbox]")].forEach((box) => box.checked = checked); }
$("#exportSelectAll").onclick = () => setAllExportChecks(true);
$("#exportDeselectAll").onclick = () => setAllExportChecks(false);
$("#confirmExport").onclick = async () => {
  const checkboxes = [...$("#exportFolderList").querySelectorAll("input[type=checkbox]")];
  const selectedIds = checkboxes.filter((box) => box.checked).map((box) => box.value);
  if (!selectedIds.length) { showError("Seleccioná al menos una carpeta."); return; }
  const photos = state.photos.filter((photo) => selectedIds.includes(photo.folderId));
  if (!photos.length) { showError("No hay fotos para exportar en esa selección."); return; }
  $("#exportDialog").close();
  const button = $("#exportButton");
  button.disabled = true;
  try {
    const blob = await buildExportZip(photos);
    const stamp = new Date().toISOString().slice(0, 10);
    const scopeName = selectedIds.length === state.folders.length ? "todo" : selectedIds.length === 1 ? sanitizeFileName(folderById(selectedIds[0])?.name) : "seleccion";
    await shareOrDownload(blob, `releva-foto_${scopeName}_${stamp}.zip`);
  } catch (error) {
    console.error(error);
    showError("No se pudo generar la exportación.");
  } finally {
    button.disabled = false;
  }
};

(async function init() {
  await loadAll();
  renderHome();
})();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
