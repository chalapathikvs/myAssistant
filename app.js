const APP_VERSION = "0.2.5";
const META_FILE = "meta.json";
const VAULT_FILE = "vault.json.enc";
const FILES_DIR = "files";
const FILE_MAGIC = "MYA1";
const DB_NAME = "myAssistantApp";
const DB_STORE = "handles";
const KDF_ITERATIONS = 600000;
const LOCK_TIMEOUT_MS = 30000;
const TRASH_DAYS = 10;

const VIEW_TITLES = {
  home: "Home",
  capture: "Capture",
  notifications: "Notifications",
  notes: "Notes",
  journal: "Journal",
  tasks: "Tasks / Purchases",
  yoga: "Yoga",
  files: "Files / Receipts",
  trash: "Trash",
  settings: "Settings"
};

const RECORD_TYPES = {
  quick_note: "Quick note",
  notification: "Notification",
  journal: "Journal",
  task: "Task",
  purchase: "Purchase",
  yoga_note: "Yoga note",
  file_record: "File record",
  receipt: "Receipt / warranty",
  research_topic: "Research topic",
  ai_response: "AI response"
};

const DEFAULT_TAGS = [
  "note",
  "notification",
  "win",
  "log",
  "mood",
  "revisit",
  "idea",
  "journal",
  "task",
  "purchase",
  "school",
  "yoga",
  "practice",
  "receipt",
  "warranty",
  "finance",
  "research",
  "important"
];

const state = {
  mode: null,
  view: "home",
  dirHandle: null,
  meta: null,
  vaultKey: null,
  currentPassword: null,
  data: null,
  filters: { search: "", tag: "", type: "" },
  lockTimer: null
};

const els = {
  appStatus: document.querySelector("#appStatus"),
  versionBadge: document.querySelector("#versionBadge"),
  supportPanel: document.querySelector("#supportPanel"),
  supportChecks: document.querySelector("#supportChecks"),
  welcomePanel: document.querySelector("#welcomePanel"),
  pinPanel: document.querySelector("#pinPanel"),
  pinTitle: document.querySelector("#pinTitle"),
  pinForm: document.querySelector("#pinForm"),
  pinInput: document.querySelector("#pinInput"),
  pinConfirmLabel: document.querySelector("#pinConfirmLabel"),
  pinConfirmInput: document.querySelector("#pinConfirmInput"),
  pinSubmitButton: document.querySelector("#pinSubmitButton"),
  workspacePanel: document.querySelector("#workspacePanel"),
  resumeVaultButton: document.querySelector("#resumeVaultButton"),
  createVaultButton: document.querySelector("#createVaultButton"),
  openVaultButton: document.querySelector("#openVaultButton"),
  lockButton: document.querySelector("#lockButton"),
  viewTitle: document.querySelector("#viewTitle"),
  vaultName: document.querySelector("#vaultName"),
  recordCount: document.querySelector("#recordCount"),
  fileCount: document.querySelector("#fileCount"),
  trashCount: document.querySelector("#trashCount"),
  tabs: document.querySelector("#tabs"),
  viewRoot: document.querySelector("#viewRoot"),
  toast: document.querySelector("#toast")
};

init();

async function init() {
  els.versionBadge.textContent = `v${APP_VERSION}`;

  // Wait a bit for Native injection if needed
  if (!isNative()) {
    await new Promise(r => setTimeout(r, 150));
  }

  if (isNative()) {
    const nb = document.querySelector("#nativeBadge");
    if (nb) nb.style.display = "inline-block";
  }

  renderSupportChecks();
  registerServiceWorker();
  checkForAppUpdate();
  bindEvents();
  initNativeBridge();

  const savedHandle = await getSavedHandle();
  if (savedHandle) {
    state.dirHandle = savedHandle;
    els.resumeVaultButton.classList.remove("hidden");
    if (state.dirHandle.isNative || await hasPermission(savedHandle, false)) {
      try {
        state.meta = await readJsonFile(state.dirHandle, META_FILE);
        showUnlock("unlock");
      } catch { await clearSavedHandle(); }
    }
  }
}

function bindEvents() {
  els.resumeVaultButton.addEventListener("click", resumeSavedVaultFlow);
  els.createVaultButton.addEventListener("click", createVaultFlow);
  els.openVaultButton.addEventListener("click", openVaultFlow);
  els.pinForm.addEventListener("submit", submitPassword);
  els.lockButton.addEventListener("click", () => lockVault("Vault locked."));
  els.tabs.addEventListener("click", event => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    setView(button.dataset.view);
  });
  ["pointerdown", "keydown", "touchstart"].forEach(name => {
    document.addEventListener(name, resetLockTimer, { passive: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.vaultKey) lockVault("Vault locked while app was hidden.");
  });
}

function isNative() {
  return typeof window.NativeStorage !== "undefined" || typeof NativeStorage !== "undefined";
}

function getNative() {
  return window.NativeStorage || NativeStorage;
}

function initNativeBridge() {
  window.onNotificationReceived = async function(data) {
    if (!state.vaultKey || !state.data) return;
    const now = new Date().toISOString();
    const record = normalizeRecord({
      type: "notification",
      title: `${data.title || "No Title"} (${data.package})`,
      body: data.text || "",
      tagIds: tagNamesToIds(["notification", data.package.split(".").pop()]),
      createdAt: now, updatedAt: now,
      data: { package: data.package, intent: data.intent }
    });
    state.data.records.unshift(record);
    await saveVaultData();
    if (state.view === "notifications" || state.view === "home") renderView();
    toast(`Notification captured from ${data.package}`);
  };

  window.onNativeFolderPicked = async function(folderName) {
    if (!folderName) {
      toast("Folder selection cancelled.");
      return;
    }
    const nativeHandle = { isNative: true, name: folderName };
    state.dirHandle = nativeHandle;
    await saveHandle(nativeHandle);
    if (state.mode === "create") {
      showUnlock("create");
    } else {
      try {
        state.meta = await readJsonFile(nativeHandle, META_FILE);
        validateMeta(state.meta);
        showUnlock("unlock");
      } catch (e) { toast("Folder does not contain a valid vault."); }
    }
  };
}

function renderSupportChecks() {
  const checks = [
    ["File System Access", ("showDirectoryPicker" in window) || isNative()],
    ["Web Crypto", Boolean(window.crypto?.subtle)],
    ["Service Worker", "serviceWorker" in navigator],
    ["Secure Context", window.isSecureContext]
  ];
  els.supportChecks.innerHTML = checks.map(([label, ok]) => `
    <div class="check-row">
      <strong>${escapeHtml(label)}</strong>
      <span class="badge ${ok ? "ok" : "warn"}">${ok ? "Ready" : "Missing"}</span>
    </div>
  `).join("");
}

async function resumeSavedVaultFlow() {
  if (state.dirHandle?.isNative) { showUnlock("unlock"); return; }
  try {
    await ensurePermission(state.dirHandle, true);
    state.meta = await readJsonFile(state.dirHandle, META_FILE);
    validateMeta(state.meta);
    showUnlock("unlock");
  } catch (error) { toast(cleanError(error)); }
}

async function createVaultFlow() {
  if (isNative()) {
    state.mode = "create";
    getNative().pickFolder();
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    if (await fileExists(dirHandle, META_FILE)) { toast("Existing vault found."); return; }
    state.mode = "create";
    state.dirHandle = dirHandle;
    showUnlock("create");
  } catch (error) { toast(cleanError(error)); }
}

async function openVaultFlow() {
  if (isNative()) {
    state.mode = "unlock";
    getNative().pickFolder();
    return;
  }
  try {
    const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const meta = await readJsonFile(dirHandle, META_FILE);
    validateMeta(meta);
    state.mode = "unlock";
    state.dirHandle = dirHandle;
    state.meta = meta;
    await saveHandle(dirHandle);
    showUnlock("unlock");
  } catch (error) { toast(cleanError(error)); }
}

async function writeJsonFile(dirHandle, fileName, value) {
  const content = JSON.stringify(value, null, 2);
  if (dirHandle.isNative) {
    if (!getNative().writeFile(fileName, content)) throw new Error("Native write failed");
    return;
  }
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

async function readJsonFile(dirHandle, fileName) {
  if (dirHandle.isNative) {
    const content = getNative().readFile(fileName);
    if (!content) throw new Error("File not found");
    return JSON.parse(content);
  }
  const fileHandle = await dirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

async function fileExists(dirHandle, fileName) {
  if (dirHandle.isNative) return getNative().fileExists(fileName);
  try { await dirHandle.getFileHandle(fileName); return true; } catch { return false; }
}

function validateMeta(meta) {
  if (meta.app !== "myAssistant" || meta.kind !== "encrypted-vault") {
    throw new Error("That folder does not look like a myAssistant vault.");
  }
}

function showUnlock(mode) {
  state.mode = mode;
  els.welcomePanel.classList.add("hidden");
  els.workspacePanel.classList.add("hidden");
  els.pinPanel.classList.remove("hidden");
  els.pinTitle.textContent = mode === "create" ? "Create Vault Password" : "Unlock Vault";
  els.pinSubmitButton.textContent = mode === "create" ? "Create Encrypted Vault" : "Unlock";
  els.pinConfirmLabel.classList.toggle("hidden", mode !== "create");
  els.pinConfirmInput.classList.toggle("hidden", mode !== "create");
  els.pinConfirmInput.required = mode === "create";
  els.pinInput.value = "";
  els.pinConfirmInput.value = "";
  els.pinInput.focus();
}

async function submitPassword(event) {
  event.preventDefault();
  const password = els.pinInput.value;
  if (password.length < 6) { toast("Use at least 6 characters."); return; }
  if (state.mode === "create" && password !== els.pinConfirmInput.value) { toast("Passwords don't match."); return; }
  try {
    if (state.mode === "create") await createVault(password);
    else await unlockVault(password);
    els.pinInput.value = "";
    renderApp();
  } catch (error) { toast(cleanError(error, "Could not unlock vault. Check password.")); }
}

async function createVault(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKey(password, salt, KDF_ITERATIONS);
  const vaultKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const vaultKey = await importAesKey(vaultKeyBytes);
  const wrappedVaultKey = await encryptBytes(kek, vaultKeyBytes);
  state.meta = {
    app: "myAssistant", kind: "encrypted-vault", vaultVersion: 2, appVersion: APP_VERSION, createdAt: new Date().toISOString(),
    crypto: { kdf: "PBKDF2", salt: bytesToBase64(salt), iterations: KDF_ITERATIONS, keyWrap: { algorithm: "AES-GCM", iv: wrappedVaultKey.iv, data: wrappedVaultKey.data } }
  };
  state.vaultKey = vaultKey;
  state.currentPassword = password;
  state.data = createEmptyVaultData();
  await writeJsonFile(state.dirHandle, META_FILE, state.meta);
  await saveVaultData();
  toast("Encrypted vault created.");
}

async function unlockVault(password) {
  const cryptoMeta = state.meta.crypto;
  const salt = base64ToBytes(cryptoMeta.salt);
  const kek = await deriveKey(password, salt, cryptoMeta.iterations);
  const vaultKeyBytes = await decryptBytes(kek, cryptoMeta.keyWrap);
  const vaultKey = await importAesKey(vaultKeyBytes);
  const data = await readVaultData(state.dirHandle, vaultKey);
  state.vaultKey = vaultKey;
  state.currentPassword = password;
  state.data = migrateVaultData(data);
  toast("Vault unlocked.");
}

function createEmptyVaultData() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2, createdAt: now, updatedAt: now,
    settings: { lockTimeoutMs: LOCK_TIMEOUT_MS, trashDays: TRASH_DAYS, aiConsentRequired: true },
    tags: DEFAULT_TAGS.map(name => ({ id: crypto.randomUUID(), name, createdAt: now })),
    records: [], files: [], secrets: { providers: [] }
  };
}

function migrateVaultData(data) {
  const migrated = { ...createEmptyVaultData(), ...data };
  migrated.records = (data.records || []).map(normalizeRecord);
  return migrated;
}

function normalizeRecord(record) {
  const now = new Date().toISOString();
  return {
    id: record.id || crypto.randomUUID(),
    type: record.type || "quick_note",
    title: record.title || firstLine(record.body || "Untitled"),
    body: record.body || "",
    tagIds: record.tagIds || [],
    pinned: Boolean(record.pinned),
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
    data: record.data || {}
  };
}

function renderApp() {
  els.appStatus.textContent = "Unlocked";
  els.supportPanel.classList.add("hidden");
  els.pinPanel.classList.add("hidden");
  els.welcomePanel.classList.add("hidden");
  els.workspacePanel.classList.remove("hidden");
  resetLockTimer();
  renderView();
}

function setView(view) {
  state.view = view;
  renderView();
}

function renderView() {
  if (!state.data) return;
  const activeRecords = getActiveRecords();
  els.viewTitle.textContent = VIEW_TITLES[state.view] || "Home";
  els.vaultName.textContent = `${state.dirHandle?.name || "Vault"}`;
  els.recordCount.textContent = activeRecords.length;
  els.tabs.querySelectorAll("[data-view]").forEach(btn => btn.classList.toggle("active", btn.dataset.view === state.view));
  const renderers = {
    home: renderHome,
    capture: renderCapture,
    notifications: () => renderRecordBrowser("notifications", ["notification"], "Notifications"),
    notes: () => renderRecordBrowser("notes", ["quick_note"], "Notes"),
    journal: renderJournal, tasks: renderTasks, yoga: renderYoga, settings: renderSettings
  };
  els.viewRoot.innerHTML = renderers[state.view]?.() || renderHome();
  bindViewEvents();
}

function renderHome() {
  const recent = getActiveRecords().sort(sortUpdatedDesc).slice(0, 6);
  return `
    <section class="panel"><h2>Quick Capture</h2>${captureFormHtml("quick_note")}</section>
    <section class="panel"><h2>Recent</h2><div class="list">${recent.length ? recent.map(recordCardHtml).join("") : emptyHtml("No records yet.")}</div></section>
  `;
}

function renderCapture() { return `<section class="panel"><h2>Capture</h2>${captureFormHtml("quick_note", true)}</section>`; }
function renderJournal() { return renderRecordBrowser("journal", ["journal"], "Journal"); }
function renderTasks() { return renderRecordBrowser("tasks", ["task", "purchase"], "Tasks / Purchases"); }
function renderYoga() { return renderRecordBrowser("yoga", ["yoga_note"], "Yoga"); }
function renderRecordBrowser(view, types, title) {
  const records = getActiveRecords().filter(r => types.includes(r.type)).sort(sortUpdatedDesc);
  return `<section class="panel"><h2>${title}</h2><div class="list">${records.length ? records.map(recordCardHtml).join("") : emptyHtml("Nothing found.")}</div></section>`;
}

function captureFormHtml(defaultType) {
  return `
    <form class="capture-form" data-form="record">
      <input type="hidden" name="type" value="${defaultType}">
      <textarea name="body" rows="3" placeholder="Write something..."></textarea>
      <div class="toolbar"><button class="primary" type="submit">Save Record</button></div>
    </form>
  `;
}

function renderSettings() {
  return `
    <section class="panel">
      <h2>App</h2>
      <div class="toolbar">
        <button onclick="location.reload(true)">Force Reload (Fix Cache)</button>
        <button class="danger" data-action="lock">Lock Vault</button>
      </div>
    </section>
  `;
}

function recordCardHtml(record) {
  return `
    <article class="record-card">
      <div class="record-head"><strong>${escapeHtml(record.title)}</strong></div>
      <p class="record-body">${escapeHtml(record.body)}</p>
      <div class="tags">${record.tagIds.map(id => `<span class="tag">${escapeHtml(tagName(id))}</span>`).join("")}</div>
    </article>
  `;
}

function bindViewEvents() {
  els.viewRoot.querySelectorAll("[data-form='record']").forEach(f => f.addEventListener("submit", saveRecordFromForm));
  els.viewRoot.querySelectorAll("[data-action='lock']").forEach(b => b.addEventListener("click", () => lockVault()));
}

async function saveRecordFromForm(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  const record = normalizeRecord({ type: data.type, title: firstLine(data.body), body: data.body });
  state.data.records.unshift(record);
  await saveAndRender("Saved.");
}

async function saveAndRender(msg) {
  state.data.updatedAt = new Date().toISOString();
  await saveVaultData();
  renderView();
  toast(msg);
}

async function saveVaultData() {
  const encrypted = await encryptJson(state.vaultKey, state.data);
  await writeTextFile(state.dirHandle, VAULT_FILE, JSON.stringify(encrypted));
}

async function readVaultData(dirHandle, vaultKey) {
  if (!await fileExists(dirHandle, VAULT_FILE)) return createEmptyVaultData();
  const encrypted = await readJsonFile(dirHandle, VAULT_FILE);
  return decryptJson(vaultKey, encrypted);
}

function getActiveRecords() { return state.data?.records || []; }
function firstLine(v) { return v.split("\n")[0].slice(0, 60) || "Untitled"; }
function tagName(id) { return state.data?.tags?.find(t => t.id === id)?.name || id; }
function sortUpdatedDesc(a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); }
function tagNamesToIds(names) { return names.map(n => {
    const existing = state.data.tags.find(t => t.name === n);
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    state.data.tags.push({ id, name: n, createdAt: new Date().toISOString() });
    return id;
}); }

function lockVault(msg = "Locked.") {
  state.vaultKey = null; state.data = null; state.currentPassword = null;
  els.appStatus.textContent = "Locked";
  els.workspacePanel.classList.add("hidden");
  showUnlock("unlock");
  toast(msg);
}

function resetLockTimer() {
  if (!state.vaultKey) return;
  clearTimeout(state.lockTimer);
  state.lockTimer = setTimeout(() => lockVault("Inactivity lock."), LOCK_TIMEOUT_MS);
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function importAesKey(bytes) { return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]); }

async function encryptJson(key, value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await encryptBytes(key, bytes);
  return { algorithm: "AES-GCM", iv: encrypted.iv, data: encrypted.data };
}

async function decryptJson(key, envelope) {
  const bytes = await decryptBytes(key, envelope);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) };
}

async function decryptBytes(key, envelope) {
  const iv = base64ToBytes(envelope.iv);
  const data = base64ToBytes(envelope.data);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new Uint8Array(decrypted);
}

async function ensurePermission(h, w) { return true; }
async function hasPermission(h, w) { return true; }

async function writeTextFile(dirHandle, fileName, text) {
  if (dirHandle.isNative) {
    if (!getNative().writeFile(fileName, text)) throw new Error("Native write failed");
    return;
  }
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function openDb() {
  return new Promise(res => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => res(req.result);
  });
}

async function saveHandle(h) {
  const db = await openDb();
  const tx = db.transaction(DB_STORE, "readwrite");
  tx.objectStore(DB_STORE).put(h, "vaultDir");
}

async function getSavedHandle() {
  try {
    const db = await openDb();
    return await new Promise(res => {
      const req = db.transaction(DB_STORE).objectStore(DB_STORE).get("vaultDir");
      req.onsuccess = () => res(req.result);
    });
  } catch { return null; }
}

async function clearSavedHandle() {
  const db = await openDb();
  db.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).delete("vaultDir");
}

function registerServiceWorker() { if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js"); }
function checkForAppUpdate() {}

function bytesToBase64(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function escapeHtml(v) { return String(v ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }
function emptyHtml(m) { return `<p class="empty">${escapeHtml(m)}</p>`; }
function cleanError(error, fallback = "Error") {
  if (error?.name === "AbortError") return "Selection cancelled.";
  return error?.message || fallback;
}

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove("hidden");
  setTimeout(() => els.toast.classList.add("hidden"), 3500);
}
