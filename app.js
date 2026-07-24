const state = { photos: [], folders: ["General"], activeFolder: null, pendingImage: null, pendingBlob: null, annotatedImage: null, activePhoto: null, tool: "arrow", color: "#ec3013", history: [], drawing: false, start: null, cameraStream: null, facingMode: "environment" };
const $ = (selector) => document.querySelector(selector);
const views = ["galleryView", "folderView", "captureView", "editorView", "detailView"];

function showError(message) { alert(message); }

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

async function migrateFromLocalStorage() {
  const raw = localStorage.getItem("releva-fotos");
  if (!raw) return;
  try {
    const data = JSON.parse(raw);
    for (const photo of data.photos || []) {
      const blob = await (await fetch(photo.image)).blob();
      await idbPutPhoto({ id: photo.id, name: photo.name, folder: photo.folder, note: photo.note, createdAt: photo.createdAt, blob });
    }
    await idbSetFolders(data.folders && data.folders.length ? data.folders : ["General"]);
    localStorage.removeItem("releva-fotos");
  } catch (error) {
    console.warn("No se pudo migrar el almacenamiento anterior:", error);
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
    const folders = await idbGetFolders();
    state.folders = folders && folders.length ? folders : ["General"];
    if (!folders) await idbSetFolders(state.folders);
  } catch (error) {
    console.error(error);
    showError("No se pudo abrir el almacenamiento local. Los registros previos podrían no cargar.");
  }
}

function showView(id) {
  views.forEach((view) => $("#" + view).classList.toggle("active", view === id));
  const navAction = id === "galleryView" || id === "folderView" ? "gallery" : id === "captureView" ? "capture" : null;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.action === navAction));
}
function formatDate(date) { return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date)); }
function fileName() {
  const home = $("#homeNumber").value.trim(); const block = $("#blockNumber").value.trim();
  return `Foto vivienda n°${home || "—"}${block ? `, manzana ${block}` : ""}`;
}
function updateSuggestedName() { $("#photoName").value = fileName(); }
function renderFolders() {
  $("#folderName").innerHTML = state.folders.map((folder) => `<option>${folder}</option>`).join("");
  $("#editFolder").innerHTML = state.folders.map((folder) => `<option>${folder}</option>`).join("");
}
function renderFolderManageList() {
  $("#folderManageList").innerHTML = state.folders
    .filter((folder) => folder !== "General")
    .map((folder) => `<li><span>${folder}</span><div class="folder-manage-actions"><button type="button" data-rename-folder="${folder}" aria-label="Renombrar carpeta ${folder}">✎</button><button type="button" data-remove-folder="${folder}" aria-label="Borrar carpeta ${folder}">×</button></div></li>`)
    .join("") || `<li><span>No hay carpetas propias todavía.</span></li>`;
}
function renderFolderGrid() {
  $("#photoCount").textContent = `${state.photos.length} ${state.photos.length === 1 ? "foto" : "fotos"}`;
  $("#folderGrid").innerHTML = state.folders
    .map((folder) => {
      const count = state.photos.filter((photo) => photo.folder === folder).length;
      return `<button class="folder-card" data-folder="${folder}"><div><strong>${folder}</strong><small>${count} ${count === 1 ? "foto" : "fotos"}</small></div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>`;
    })
    .join("");
}
function showFolderView() {
  const folder = state.activeFolder;
  const photos = state.photos.filter((photo) => photo.folder === folder).slice().reverse();
  $("#folderViewTitle").textContent = folder;
  $("#emptyState").hidden = photos.length > 0;
  $("#photoGrid").innerHTML = photos.map((photo) => `<button class="photo-card" data-id="${photo.id}"><img src="${urlFor(photo)}" alt="${photo.name}"><div><strong>${photo.name}</strong></div></button>`).join("");
  showView("folderView");
}
function backToFolderOrHome() {
  if (state.activeFolder) { showFolderView(); } else { renderFolderGrid(); showView("galleryView"); }
}
function resetCapture() {
  if (state.pendingImage) URL.revokeObjectURL(state.pendingImage);
  state.pendingImage = null; state.pendingBlob = null; state.annotatedImage = null;
  $("#detailsForm").hidden = true; $("#sourceChooser").hidden = false; $("#detailsForm").reset();
}
function openCapture(preselectFolder) { resetCapture(); renderFolders(); if (preselectFolder) $("#folderName").value = preselectFolder; showView("captureView"); }
// Guarda la foto capturada como Blob (liviano) y usa un object URL para previsualizar.
function setPending(blob) {
  if (!blob) return;
  if (state.pendingImage) URL.revokeObjectURL(state.pendingImage);
  state.pendingBlob = blob;
  state.pendingImage = URL.createObjectURL(blob);
  state.annotatedImage = null;
  $("#photoPreview").src = state.pendingImage;
  $("#sourceChooser").hidden = true; $("#detailsForm").hidden = false;
  updateSuggestedName();
}
function handleImage(file) { if (file) setPending(file); }

// --- Cámara dentro de la app (getUserMedia): evita el cambio de app que en Android
// hace que el sistema mate la página y se pierda la foto. Cae al input nativo si falla. ---
async function openCamera() {
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
function setupCameraZoom(stream) {
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities ? track.getCapabilities() : {};
  if (!caps.zoom) return;
  const minZ = caps.zoom.min, maxZ = caps.zoom.max;
  const video = $("#cameraStream");
  let lastDist = 0;
  video.addEventListener("touchstart", (e) => { if (e.touches.length === 2) lastDist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY); }, { passive: true });
  video.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2) return;
    const dist = Math.hypot(e.touches[1].clientX - e.touches[0].clientX, e.touches[1].clientY - e.touches[0].clientY);
    if (!lastDist) { lastDist = dist; return; }
    const scale = dist / lastDist;
    state.cameraZoom = Math.min(maxZ, Math.max(minZ, state.cameraZoom * scale));
    track.applyConstraints({ advanced: [{ zoom: state.cameraZoom }] });
    lastDist = dist;
  }, { passive: true });
}
function closeCamera() {
  if (state.cameraStream) { state.cameraStream.getTracks().forEach((track) => track.stop()); state.cameraStream = null; }
  $("#cameraStream").srcObject = null;
  $("#cameraOverlay").hidden = true;
}
function capturePhoto() {
  const video = $("#cameraStream");
  const w = video.videoWidth, h = video.videoHeight;
  if (!w || !h) { showError("La cámara todavía no está lista. Probá de nuevo."); return; }
  const shot = document.createElement("canvas");
  shot.width = w; shot.height = h;
  shot.getContext("2d").drawImage(video, 0, 0, w, h);
  shot.toBlob((blob) => {
    if (!blob) { showError("No se pudo capturar la foto. Probá de nuevo."); return; }
    setPending(blob);
    closeCamera();
  }, "image/jpeg", 0.92);
}
async function flipCamera() {
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  closeCamera();
  await openCamera();
}
function openDetail(id) {
  const photo = state.photos.find((item) => item.id === id); if (!photo) return;
  state.activePhoto = photo;
  state.activeFolder = photo.folder;
  $("#detailImage").src = urlFor(photo);
  $("#detailName").textContent = photo.name;
  $("#detailFolder").textContent = photo.folder;
  $("#detailNote").textContent = photo.note || "Sin observaciones.";
  $("#detailDate").textContent = formatDate(photo.createdAt);
  $("#editForm").hidden = true; $("#detailReadView").hidden = false;
  showView("detailView");
}
function openEdit() {
  const photo = state.activePhoto; if (!photo) return;
  renderFolders();
  $("#editName").value = photo.name; $("#editFolder").value = photo.folder; $("#editNote").value = photo.note || "";
  $("#detailReadView").hidden = true; $("#editForm").hidden = false;
}

const canvas = $("#annotationCanvas"); const context = canvas.getContext("2d"); let editorImage = new Image();
function drawBase() { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(editorImage, 0, 0, canvas.width, canvas.height); }
function snapshot() { state.history.push(context.getImageData(0, 0, canvas.width, canvas.height)); }
function startEditor() { editorImage = new Image(); editorImage.onload = () => { const ratio = Math.min(1200 / editorImage.width, 900 / editorImage.height, 1); canvas.width = Math.round(editorImage.width * ratio); canvas.height = Math.round(editorImage.height * ratio); drawBase(); state.history = [context.getImageData(0, 0, canvas.width, canvas.height)]; showView("editorView"); }; editorImage.src = state.annotatedImage || state.pendingImage; }
function point(event) { const rect = canvas.getBoundingClientRect(); const touch = event.touches?.[0] || event; return { x: (touch.clientX - rect.left) * canvas.width / rect.width, y: (touch.clientY - rect.top) * canvas.height / rect.height }; }
function setupStroke() { context.strokeStyle = state.color; context.fillStyle = state.color; context.lineWidth = Math.max(4, canvas.width / 180); context.lineCap = "round"; context.font = `bold ${Math.max(20, canvas.width / 23)}px sans-serif`; }
function drawArrow(start, end) { setupStroke(); const angle = Math.atan2(end.y - start.y, end.x - start.x); const size = Math.max(15, canvas.width / 32); context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y); context.lineTo(end.x - size * Math.cos(angle - Math.PI / 6), end.y - size * Math.sin(angle - Math.PI / 6)); context.moveTo(end.x, end.y); context.lineTo(end.x - size * Math.cos(angle + Math.PI / 6), end.y - size * Math.sin(angle + Math.PI / 6)); context.stroke(); }
function drawShape(end) { context.putImageData(state.history.at(-1), 0, 0); if (state.tool === "arrow") drawArrow(state.start, end); if (state.tool === "box") { setupStroke(); context.strokeRect(state.start.x, state.start.y, end.x - state.start.x, end.y - state.start.y); } if (state.tool === "draw") { setupStroke(); context.beginPath(); context.moveTo(state.start.x, state.start.y); context.lineTo(end.x, end.y); context.stroke(); state.start = end; state.history[state.history.length - 1] = context.getImageData(0, 0, canvas.width, canvas.height); } }
canvas.addEventListener("pointerdown", (event) => { const p = point(event); if (state.tool === "text") { const label = prompt("Texto a agregar:"); if (label) { setupStroke(); context.fillText(label, p.x, p.y); snapshot(); } return; } state.drawing = true; state.start = p; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener("pointermove", (event) => { if (state.drawing) drawShape(point(event)); });
canvas.addEventListener("pointerup", () => { if (!state.drawing) return; state.drawing = false; snapshot(); });

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "capture") openCapture(state.activeFolder);
  if (action === "gallery") { state.activeFolder = null; renderFolderGrid(); showView("galleryView"); }
  if (action === "back") backToFolderOrHome();
  if (action === "camera") openCamera();
  if (action === "library") $("#libraryInput").click();
  if (action === "back-to-details") showView("captureView");
  const folderCard = event.target.closest("[data-folder]");
  if (folderCard) { if (longPressTriggered) { longPressTriggered = false; return; } state.activeFolder = folderCard.dataset.folder; showFolderView(); return; }
  const card = event.target.closest(".photo-card"); if (card) openDetail(card.dataset.id);
  const tool = event.target.closest("[data-tool]"); if (tool) { state.tool = tool.dataset.tool; document.querySelectorAll(".tool[data-tool]").forEach((button) => button.classList.toggle("active", button === tool)); }
  const color = event.target.closest("[data-color]"); if (color) { state.color = color.dataset.color; document.querySelectorAll(".color").forEach((button) => button.classList.toggle("active", button === color)); }
  const removeFolder = event.target.closest("[data-remove-folder]");
  if (removeFolder) removeFolderByName(removeFolder.dataset.removeFolder);
  const renameFolder = event.target.closest("[data-rename-folder]");
  if (renameFolder) renameFolderByName(renameFolder.dataset.renameFolder);
});
let longPressTimer = null;
let longPressTriggered = false;
let longPressStartPos = null;
$("#folderGrid").addEventListener("pointerdown", (e) => {
  const card = e.target.closest(".folder-card");
  if (!card) return;
  longPressTriggered = false;
  longPressStartPos = { x: e.clientX, y: e.clientY };
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    const folder = card.dataset.folder;
    if (folder === "General") return;
    removeFolderByName(folder);
  }, 600);
});
$("#folderGrid").addEventListener("pointerup", () => clearTimeout(longPressTimer));
$("#folderGrid").addEventListener("pointercancel", () => clearTimeout(longPressTimer));
$("#folderGrid").addEventListener("pointermove", (e) => { if (longPressStartPos && Math.hypot(e.clientX - longPressStartPos.x, e.clientY - longPressStartPos.y) > 10) clearTimeout(longPressTimer); });
$("#newPhotoButton").onclick = () => openCapture(state.activeFolder);
$("#cameraInput").onchange = (event) => { handleImage(event.target.files[0]); event.target.value = ""; };
$("#libraryInput").onchange = (event) => { handleImage(event.target.files[0]); event.target.value = ""; };
$("#cameraShutter").onclick = capturePhoto; $("#cameraCancel").onclick = closeCamera; $("#cameraFlip").onclick = flipCamera;
$("#homeNumber").oninput = updateSuggestedName; $("#blockNumber").oninput = updateSuggestedName;
$("#annotateButton").onclick = startEditor; $("#saveMarksButton").onclick = () => { state.annotatedImage = canvas.toDataURL("image/jpeg", .9); $("#photoPreview").src = state.annotatedImage; showView("captureView"); };
$("#undoButton").onclick = () => { if (state.history.length > 1) { state.history.pop(); context.putImageData(state.history.at(-1), 0, 0); } };
function openFolderManageDialog() { renderFolderManageList(); $("#folderDialog").showModal(); }
$("#newFolderButton").onclick = openFolderManageDialog;
$("#newFolderButtonHome").onclick = openFolderManageDialog;
$("#confirmFolder").onclick = async (event) => {
  const name = $("#newFolderInput").value.trim();
  if (!name) { event.preventDefault(); return; }
  if (!state.folders.includes(name)) {
    state.folders.push(name);
    try { await idbSetFolders(state.folders); } catch (error) { console.error(error); showError("No se pudo guardar la carpeta nueva."); }
  }
  renderFolders(); renderFolderGrid(); $("#folderName").value = name; $("#newFolderInput").value = "";
};
async function removeFolderByName(name) {
  if (name === "General") return;
  if (!confirm(`¿Borrar la carpeta "${name}"? Las fotos que tenga pasarán a "General".`)) return;
  try {
    const affected = state.photos.filter((photo) => photo.folder === name);
    for (const photo of affected) { photo.folder = "General"; await idbPutPhoto(photo); }
    state.folders = state.folders.filter((folder) => folder !== name);
    await idbSetFolders(state.folders);
    if (state.activeFolder === name) state.activeFolder = "General";
    renderFolders(); renderFolderManageList(); renderFolderGrid();
    if (state.activePhoto && state.activePhoto.folder === "General") $("#detailFolder").textContent = "General";
  } catch (error) {
    console.error(error);
    showError("No se pudo borrar la carpeta.");
  }
}
async function renameFolderByName(oldName) {
  if (oldName === "General") return;
  const newName = prompt("Nuevo nombre para la carpeta:", oldName);
  if (!newName || !newName.trim() || newName.trim() === oldName) return;
  const trimmed = newName.trim();
  if (state.folders.includes(trimmed)) { showError("Ya existe una carpeta con ese nombre."); return; }
  try {
    const affected = state.photos.filter((photo) => photo.folder === oldName);
    for (const photo of affected) { photo.folder = trimmed; await idbPutPhoto(photo); }
    state.folders = state.folders.map((folder) => folder === oldName ? trimmed : folder);
    await idbSetFolders(state.folders);
    if (state.activeFolder === oldName) state.activeFolder = trimmed;
    renderFolders(); renderFolderManageList(); renderFolderGrid();
  } catch (error) {
    console.error(error);
    showError("No se pudo renombrar la carpeta.");
  }
}
$("#detailsForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const blob = state.annotatedImage ? await (await fetch(state.annotatedImage)).blob() : state.pendingBlob;
    if (!blob) { showError("No hay ninguna foto para guardar. Volvé a tomarla."); return; }
    const photo = { id: crypto.randomUUID(), blob, name: $("#photoName").value.trim(), folder: $("#folderName").value, note: $("#photoNote").value.trim(), createdAt: new Date().toISOString() };
    await idbPutPhoto(photo);
    state.photos.push(photo);
    state.activeFolder = photo.folder;
    showFolderView();
  } catch (error) {
    console.error(error);
    showError("No se pudo guardar la foto. Verificá el espacio disponible en el navegador.");
  }
};
$("#editButton").onclick = openEdit;
$("#editForm").onsubmit = async (event) => {
  event.preventDefault();
  const photo = state.activePhoto; if (!photo) return;
  const updated = { ...photo, name: $("#editName").value.trim(), folder: $("#editFolder").value, note: $("#editNote").value.trim() };
  try {
    await idbPutPhoto(updated);
    Object.assign(photo, updated);
    state.activeFolder = photo.folder;
    $("#detailName").textContent = photo.name; $("#detailFolder").textContent = photo.folder; $("#detailNote").textContent = photo.note || "Sin observaciones.";
    $("#editForm").hidden = true; $("#detailReadView").hidden = false;
  } catch (error) {
    console.error(error);
    showError("No se pudieron guardar los cambios.");
  }
};
$("#deleteButton").onclick = async () => {
  if (!state.activePhoto || !confirm("¿Eliminar este registro?")) return;
  try {
    await idbDeletePhoto(state.activePhoto.id);
    releaseUrl(state.activePhoto.id);
    state.photos = state.photos.filter((item) => item.id !== state.activePhoto.id);
    showFolderView();
  } catch (error) {
    console.error(error);
    showError("No se pudo eliminar la foto.");
  }
};

// --- Exportar a .zip (todo o la carpeta que esté filtrada) ---
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
  const rows = [["Nombre", "Carpeta", "Nota", "Fecha"]];
  for (const photo of photos) {
    const folderSafe = sanitizeFileName(photo.folder);
    const used = usedNames.get(folderSafe) || new Set();
    const base = sanitizeFileName(photo.name);
    const ext = extensionFor(photo.blob);
    let fileName = `${base}.${ext}`;
    let i = 2;
    while (used.has(fileName)) { fileName = `${base} (${i}).${ext}`; i++; }
    used.add(fileName); usedNames.set(folderSafe, used);
    zip.file(`${folderSafe}/${fileName}`, photo.blob);
    rows.push([photo.name, photo.folder, photo.note || "", formatDate(photo.createdAt)]);
  }
  const csv = rows.map((row) => row.map(csvEscape).join(";")).join("\r\n");
  zip.file("registro.csv", "﻿" + csv);
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
  $("#exportFolderList").innerHTML = state.folders
    .map((folder) => {
      const count = state.photos.filter((photo) => photo.folder === folder).length;
      return `<li><label><input type="checkbox" value="${folder}" checked> ${folder} <small>${count} ${count === 1 ? "foto" : "fotos"}</small></label></li>`;
    })
    .join("");
}
$("#exportButton").onclick = () => { renderExportFolderList(); $("#exportDialog").showModal(); };
function setAllExportChecks(checked) { [...$("#exportFolderList").querySelectorAll("input[type=checkbox]")].forEach((box) => box.checked = checked); }
$("#exportSelectAll").onclick = () => setAllExportChecks(true);
$("#exportDeselectAll").onclick = () => setAllExportChecks(false);
$("#confirmExport").onclick = async () => {
  const checkboxes = [...$("#exportFolderList").querySelectorAll("input[type=checkbox]")];
  const selectedFolders = checkboxes.filter((box) => box.checked).map((box) => box.value);
  if (!selectedFolders.length) { showError("Seleccioná al menos una carpeta."); return; }
  const photos = state.photos.filter((photo) => selectedFolders.includes(photo.folder));
  if (!photos.length) { showError("No hay fotos para exportar en esa selección."); return; }
  $("#exportDialog").close();
  const button = $("#exportButton");
  button.disabled = true;
  try {
    const blob = await buildExportZip(photos);
    const stamp = new Date().toISOString().slice(0, 10);
    const scopeName = selectedFolders.length === state.folders.length ? "todo" : selectedFolders.length === 1 ? sanitizeFileName(selectedFolders[0]) : "seleccion";
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
  renderFolders();
  renderFolderGrid();
})();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
