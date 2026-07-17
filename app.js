const state = { photos: [], folders: ["General"], activeFolder: "all", filterOpen: false, pendingImage: null, annotatedImage: null, activePhoto: null, tool: "arrow", color: "#ec3013", history: [], drawing: false, start: null };
const $ = (selector) => document.querySelector(selector);
const views = ["galleryView", "captureView", "editorView", "detailView"];

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
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.action === (id === "galleryView" ? "gallery" : "capture")));
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
    .map((folder) => `<li><span>${folder}</span><button type="button" data-remove-folder="${folder}" aria-label="Borrar carpeta ${folder}">×</button></li>`)
    .join("") || `<li><span>No hay carpetas propias todavía.</span></li>`;
}
function renderFolderFilterPanel() {
  const options = [{ value: "all", label: "Todas las carpetas" }, ...state.folders.map((folder) => ({ value: folder, label: folder }))];
  $("#folderFilterPanel").innerHTML = options
    .map((opt) => `<button type="button" data-filter-folder="${opt.value}" class="${opt.value === state.activeFolder ? "active" : ""}">${opt.label}</button>`)
    .join("");
  $("#folderFilterLabel").textContent = state.activeFolder === "all" ? "Todas las carpetas" : state.activeFolder;
}
function setFilterOpen(open) {
  state.filterOpen = open;
  $("#folderFilterPanel").hidden = !open;
  $("#folderFilter").setAttribute("aria-expanded", String(open));
}
function renderGallery() {
  renderFolderFilterPanel();
  const grid = $("#photoGrid"); $("#photoCount").textContent = `${state.photos.length} ${state.photos.length === 1 ? "foto" : "fotos"}`;
  $("#emptyState").hidden = state.photos.length > 0;
  const filtered = state.activeFolder === "all" ? state.photos : state.photos.filter((photo) => photo.folder === state.activeFolder);
  grid.innerHTML = filtered.slice().reverse().map((photo) => `<button class="photo-card" data-id="${photo.id}"><img src="${urlFor(photo)}" alt="${photo.name}"><div><strong>${photo.name}</strong><span class="folder-pill">${photo.folder}</span></div></button>`).join("");
}
function resetCapture() { state.pendingImage = null; state.annotatedImage = null; $("#detailsForm").hidden = true; $("#sourceChooser").hidden = false; $("#detailsForm").reset(); }
function openCapture() { resetCapture(); renderFolders(); showView("captureView"); }
function handleImage(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { state.pendingImage = reader.result; $("#photoPreview").src = reader.result; $("#sourceChooser").hidden = true; $("#detailsForm").hidden = false; updateSuggestedName(); };
  reader.onerror = () => showError("No se pudo leer la imagen. Probá con otra foto.");
  reader.readAsDataURL(file);
}
function openDetail(id) {
  const photo = state.photos.find((item) => item.id === id); if (!photo) return;
  state.activePhoto = photo;
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
  if (action === "capture") openCapture();
  if (action === "gallery" || action === "back") { renderGallery(); showView("galleryView"); }
  if (action === "camera") $("#cameraInput").click();
  if (action === "library") $("#libraryInput").click();
  if (action === "back-to-details") showView("captureView");
  const card = event.target.closest(".photo-card"); if (card) openDetail(card.dataset.id);
  const tool = event.target.closest("[data-tool]"); if (tool) { state.tool = tool.dataset.tool; document.querySelectorAll(".tool[data-tool]").forEach((button) => button.classList.toggle("active", button === tool)); }
  const color = event.target.closest("[data-color]"); if (color) { state.color = color.dataset.color; document.querySelectorAll(".color").forEach((button) => button.classList.toggle("active", button === color)); }
  const removeFolder = event.target.closest("[data-remove-folder]");
  if (removeFolder) removeFolderByName(removeFolder.dataset.removeFolder);
  const filterToggle = event.target.closest("#folderFilter");
  if (filterToggle) { setFilterOpen(!state.filterOpen); return; }
  const filterOption = event.target.closest("[data-filter-folder]");
  if (filterOption) { state.activeFolder = filterOption.dataset.filterFolder; setFilterOpen(false); renderGallery(); return; }
  if (state.filterOpen && !event.target.closest(".filter-wrap")) setFilterOpen(false);
});
$("#newPhotoButton").onclick = openCapture; $("#cameraInput").onchange = (event) => handleImage(event.target.files[0]); $("#libraryInput").onchange = (event) => handleImage(event.target.files[0]);
$("#homeNumber").oninput = updateSuggestedName; $("#blockNumber").oninput = updateSuggestedName;
$("#annotateButton").onclick = startEditor; $("#saveMarksButton").onclick = () => { state.annotatedImage = canvas.toDataURL("image/jpeg", .9); $("#photoPreview").src = state.annotatedImage; showView("captureView"); };
$("#undoButton").onclick = () => { if (state.history.length > 1) { state.history.pop(); context.putImageData(state.history.at(-1), 0, 0); } };
$("#newFolderButton").onclick = () => { renderFolderManageList(); $("#folderDialog").showModal(); };
$("#confirmFolder").onclick = async (event) => {
  const name = $("#newFolderInput").value.trim();
  if (!name) { event.preventDefault(); return; }
  if (!state.folders.includes(name)) {
    state.folders.push(name);
    try { await idbSetFolders(state.folders); } catch (error) { console.error(error); showError("No se pudo guardar la carpeta nueva."); }
  }
  renderFolders(); $("#folderName").value = name; $("#newFolderInput").value = "";
};
async function removeFolderByName(name) {
  if (name === "General") return;
  if (!confirm(`¿Borrar la carpeta "${name}"? Las fotos que tenga pasarán a "General".`)) return;
  try {
    const affected = state.photos.filter((photo) => photo.folder === name);
    for (const photo of affected) { photo.folder = "General"; await idbPutPhoto(photo); }
    state.folders = state.folders.filter((folder) => folder !== name);
    await idbSetFolders(state.folders);
    renderFolders(); renderFolderManageList();
    if (state.activePhoto && state.activePhoto.folder === "General") $("#detailFolder").textContent = "General";
  } catch (error) {
    console.error(error);
    showError("No se pudo borrar la carpeta.");
  }
}
$("#detailsForm").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const dataUrl = state.annotatedImage || state.pendingImage;
    const blob = await (await fetch(dataUrl)).blob();
    const photo = { id: crypto.randomUUID(), blob, name: $("#photoName").value.trim(), folder: $("#folderName").value, note: $("#photoNote").value.trim(), createdAt: new Date().toISOString() };
    await idbPutPhoto(photo);
    state.photos.push(photo);
    renderGallery();
    showView("galleryView");
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
    $("#detailName").textContent = photo.name; $("#detailFolder").textContent = photo.folder; $("#detailNote").textContent = photo.note || "Sin observaciones.";
    $("#editForm").hidden = true; $("#detailReadView").hidden = false;
    renderGallery();
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
    renderGallery();
    showView("galleryView");
  } catch (error) {
    console.error(error);
    showError("No se pudo eliminar la foto.");
  }
};

(async function init() {
  await loadAll();
  renderFolders();
  renderGallery();
})();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
