const APP_VERSION = "0.1.1";
const META_FILE = "meta.json";
const VAULT_FILE = "vault.json.enc";
const FILES_DIR = "files";
const FILE_MAGIC = "MYA1";
const DB_NAME = "myAssistantApp";
const DB_STORE = "handles";
const KDF_ITERATIONS = 600000;

const state = {
  mode: null,
  dirHandle: null,
  meta: null,
  vaultKey: null,
  data: null
};

const els = {
  appStatus: document.querySelector("#appStatus"),
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
  vaultName: document.querySelector("#vaultName"),
  recordCount: document.querySelector("#recordCount"),
  fileCount: document.querySelector("#fileCount"),
  updatedAt: document.querySelector("#updatedAt"),
  noteForm: document.querySelector("#noteForm"),
  noteText: document.querySelector("#noteText"),
  recordList: document.querySelector("#recordList"),
  fileForm: document.querySelector("#fileForm"),
  fileInput: document.querySelector("#fileInput"),
  fileList: document.querySelector("#fileList"),
  toast: document.querySelector("#toast")
};

init();

async function init() {
  renderSupportChecks();
  registerServiceWorker();
  checkForAppUpdate();
  bindEvents();

  const savedHandle = await getSavedHandle();
  if (savedHandle) {
    state.dirHandle = savedHandle;
    els.resumeVaultButton.classList.remove("hidden");

    if (!await hasPermission(savedHandle, false)) {
      toast("Previous vault remembered. Tap Resume Previous Vault to grant access.");
      return;
    }

    try {
      state.meta = await readJsonFile(savedHandle, META_FILE);
      showUnlock("unlock");
      toast("Remembered vault found. Enter PIN to unlock.");
    } catch {
      await clearSavedHandle();
    }
  }
}

function bindEvents() {
  els.resumeVaultButton.addEventListener("click", resumeSavedVaultFlow);
  els.createVaultButton.addEventListener("click", createVaultFlow);
  els.openVaultButton.addEventListener("click", openVaultFlow);
  els.pinForm.addEventListener("submit", submitPin);
  els.lockButton.addEventListener("click", lockVault);
  els.noteForm.addEventListener("submit", saveRecord);
  els.fileForm.addEventListener("submit", saveEncryptedFile);
}

async function resumeSavedVaultFlow() {
  if (!state.dirHandle) {
    toast("No previous vault is remembered on this device.");
    return;
  }

  try {
    await ensurePermission(state.dirHandle, true);
    state.meta = await readJsonFile(state.dirHandle, META_FILE);

    if (state.meta.app !== "myAssistant" || state.meta.kind !== "encrypted-vault") {
      toast("The remembered folder does not look like a myAssistant vault.");
      await clearSavedHandle();
      els.resumeVaultButton.classList.add("hidden");
      return;
    }

    showUnlock("unlock");
  } catch (error) {
    toast(cleanError(error, "Could not resume the remembered vault."));
  }
}

function renderSupportChecks() {
  const checks = [
    ["File System Access", "showDirectoryPicker" in window],
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

async function createVaultFlow() {
  try {
    const dirHandle = await window.showDirectoryPicker({
      id: "myAssistantVault",
      mode: "readwrite"
    });
    await ensurePermission(dirHandle, true);

    if (await fileExists(dirHandle, META_FILE)) {
      toast("This folder already has a vault. Use Open Existing Vault.");
      return;
    }

    state.mode = "create";
    state.dirHandle = dirHandle;
    state.meta = null;
    showUnlock("create");
  } catch (error) {
    toast(cleanError(error));
  }
}

async function openVaultFlow() {
  try {
    const dirHandle = await window.showDirectoryPicker({
      id: "myAssistantVault",
      mode: "readwrite"
    });
    await ensurePermission(dirHandle, true);
    const meta = await readJsonFile(dirHandle, META_FILE);

    if (meta.app !== "myAssistant" || meta.kind !== "encrypted-vault") {
      toast("That folder does not look like a myAssistant vault.");
      return;
    }

    state.mode = "unlock";
    state.dirHandle = dirHandle;
    state.meta = meta;
    await saveHandle(dirHandle);
    showUnlock("unlock");
  } catch (error) {
    toast(cleanError(error));
  }
}

function showUnlock(mode) {
  state.mode = mode;
  els.welcomePanel.classList.add("hidden");
  els.workspacePanel.classList.add("hidden");
  els.pinPanel.classList.remove("hidden");
  els.pinTitle.textContent = mode === "create" ? "Create Vault PIN" : "Unlock Vault";
  els.pinSubmitButton.textContent = mode === "create" ? "Create Encrypted Vault" : "Unlock";
  els.pinConfirmLabel.classList.toggle("hidden", mode !== "create");
  els.pinConfirmInput.classList.toggle("hidden", mode !== "create");
  els.pinConfirmInput.required = mode === "create";
  els.pinInput.value = "";
  els.pinConfirmInput.value = "";
  els.pinInput.focus();
}

async function submitPin(event) {
  event.preventDefault();
  const pin = els.pinInput.value;

  if (pin.length < 6) {
    toast("Use at least 6 characters.");
    return;
  }

  if (state.mode === "create" && pin !== els.pinConfirmInput.value) {
    toast("PIN confirmation does not match.");
    return;
  }

  try {
    if (state.mode === "create") {
      await createVault(pin);
    } else {
      await unlockVault(pin);
    }
    els.pinInput.value = "";
    els.pinConfirmInput.value = "";
    renderWorkspace();
  } catch (error) {
    toast(cleanError(error, "Could not unlock vault. Check the PIN and folder."));
  }
}

async function createVault(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKey(pin, salt, KDF_ITERATIONS);
  const vaultKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const vaultKey = await importAesKey(vaultKeyBytes);
  const wrappedVaultKey = await encryptBytes(kek, vaultKeyBytes);

  const meta = {
    app: "myAssistant",
    kind: "encrypted-vault",
    vaultVersion: 1,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    crypto: {
      kdf: "PBKDF2",
      hash: "SHA-256",
      iterations: KDF_ITERATIONS,
      salt: bytesToBase64(salt),
      keyWrap: {
        algorithm: "AES-GCM",
        iv: wrappedVaultKey.iv,
        data: wrappedVaultKey.data
      },
      data: {
        algorithm: "AES-GCM"
      }
    }
  };

  const data = emptyVaultData();
  state.meta = meta;
  state.vaultKey = vaultKey;
  state.data = data;

  await state.dirHandle.getDirectoryHandle(FILES_DIR, { create: true });
  await writeJsonFile(state.dirHandle, META_FILE, meta);
  await saveVaultData();
  await saveHandle(state.dirHandle);
  toast("Encrypted vault created.");
}

async function unlockVault(pin) {
  if (!await ensurePermission(state.dirHandle, true)) {
    throw new Error("Read/write permission is needed to open this vault.");
  }

  const cryptoMeta = state.meta.crypto;
  const salt = base64ToBytes(cryptoMeta.salt);
  const kek = await deriveKey(pin, salt, cryptoMeta.iterations);
  const vaultKeyBytes = await decryptBytes(kek, cryptoMeta.keyWrap);
  const vaultKey = await importAesKey(vaultKeyBytes);
  const data = await readVaultData(state.dirHandle, vaultKey);

  state.vaultKey = vaultKey;
  state.data = data;
  await saveHandle(state.dirHandle);
  toast("Vault unlocked.");
}

async function saveRecord(event) {
  event.preventDefault();
  const text = els.noteText.value.trim();
  if (!text) {
    toast("Add some text first.");
    return;
  }

  state.data.records.unshift({
    id: crypto.randomUUID(),
    text,
    createdAt: new Date().toISOString()
  });
  state.data.updatedAt = new Date().toISOString();
  await saveVaultData();
  els.noteText.value = "";
  renderWorkspace();
  toast("Record encrypted and saved.");
}

async function saveEncryptedFile(event) {
  event.preventDefault();
  const file = els.fileInput.files[0];
  if (!file) {
    toast("Choose a file first.");
    return;
  }

  const fileId = crypto.randomUUID();
  const encryptedName = `${fileId}.bin.enc`;
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const encrypted = await encryptBytes(state.vaultKey, fileBytes);
  const encryptedFile = packEncryptedFile({
    algorithm: "AES-GCM",
    iv: encrypted.iv,
    ciphertext: base64ToBytes(encrypted.data)
  });

  const filesDir = await state.dirHandle.getDirectoryHandle(FILES_DIR, { create: true });
  await writeBinaryFile(filesDir, encryptedName, encryptedFile);

  state.data.files.unshift({
    id: fileId,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    encryptedName,
    encryptionFormat: "binary-v1",
    createdAt: new Date().toISOString()
  });
  state.data.updatedAt = new Date().toISOString();
  await saveVaultData();
  els.fileInput.value = "";
  renderWorkspace();
  toast("File encrypted into the vault.");
}

async function decryptFile(fileId) {
  const fileMeta = state.data.files.find(file => file.id === fileId);
  if (!fileMeta) return;

  try {
    const filesDir = await state.dirHandle.getDirectoryHandle(FILES_DIR);
    const envelope = await readEncryptedFile(filesDir, fileMeta.encryptedName);
    const bytes = await decryptBytes(state.vaultKey, envelope);
    const blob = new Blob([bytes], { type: fileMeta.type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileMeta.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    toast(cleanError(error, "Could not decrypt file."));
  }
}

async function saveVaultData() {
  const encrypted = await encryptJson(state.vaultKey, state.data);
  await writeTextFile(state.dirHandle, VAULT_FILE, JSON.stringify(encrypted));
}

async function readVaultData(dirHandle, vaultKey) {
  if (!await fileExists(dirHandle, VAULT_FILE)) {
    return emptyVaultData();
  }
  const encrypted = await readJsonFile(dirHandle, VAULT_FILE);
  return decryptJson(vaultKey, encrypted);
}

function emptyVaultData() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    records: [],
    files: []
  };
}

function renderWorkspace() {
  els.appStatus.textContent = "Unlocked";
  els.pinPanel.classList.add("hidden");
  els.welcomePanel.classList.add("hidden");
  els.workspacePanel.classList.remove("hidden");
  els.vaultName.textContent = state.dirHandle?.name || "Selected vault";
  els.recordCount.textContent = state.data.records.length;
  els.fileCount.textContent = state.data.files.length;
  els.updatedAt.textContent = formatDate(state.data.updatedAt);

  els.recordList.innerHTML = state.data.records.length
    ? state.data.records.map(record => `
        <article class="record-item">
          <div>${escapeHtml(record.text)}</div>
          <div class="item-meta">${formatDate(record.createdAt)}</div>
        </article>
      `).join("")
    : `<p class="hint">No records saved yet.</p>`;

  els.fileList.innerHTML = state.data.files.length
    ? state.data.files.map(file => `
        <article class="file-item">
          <strong>${escapeHtml(file.name)}</strong>
          <div class="item-meta">${formatBytes(file.size)} - ${formatDate(file.createdAt)}</div>
          <div class="file-actions">
            <button data-file-id="${file.id}" type="button">Decrypt Download</button>
          </div>
        </article>
      `).join("")
    : `<p class="hint">No files copied into the vault yet.</p>`;

  els.fileList.querySelectorAll("[data-file-id]").forEach(button => {
    button.addEventListener("click", () => decryptFile(button.dataset.fileId));
  });
}

function lockVault() {
  state.vaultKey = null;
  state.data = null;
  state.mode = "unlock";
  els.appStatus.textContent = "Locked";
  showUnlock("unlock");
}

async function deriveKey(pin, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function importAesKey(bytes) {
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(key, value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await encryptBytes(key, bytes);
  return {
    algorithm: "AES-GCM",
    iv: encrypted.iv,
    data: encrypted.data
  };
}

async function decryptJson(key, envelope) {
  const bytes = await decryptBytes(key, envelope);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return {
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted))
  };
}

async function decryptBytes(key, envelope) {
  const iv = base64ToBytes(envelope.iv);
  const data = base64ToBytes(envelope.data);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new Uint8Array(decrypted);
}

async function ensurePermission(handle, writable) {
  const options = { mode: writable ? "readwrite" : "read" };
  if (await handle.queryPermission(options) === "granted") return true;
  return await handle.requestPermission(options) === "granted";
}

async function hasPermission(handle, writable) {
  const options = { mode: writable ? "readwrite" : "read" };
  return await handle.queryPermission(options) === "granted";
}

async function fileExists(dirHandle, fileName) {
  try {
    await dirHandle.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(dirHandle, fileName) {
  const fileHandle = await dirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text());
}

async function writeJsonFile(dirHandle, fileName, value) {
  await writeTextFile(dirHandle, fileName, JSON.stringify(value, null, 2));
}

async function writeTextFile(dirHandle, fileName, text) {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

async function writeBinaryFile(dirHandle, fileName, bytes) {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(bytes);
  await writable.close();
}

async function readBinaryFile(dirHandle, fileName) {
  const fileHandle = await dirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function readEncryptedFile(dirHandle, fileName) {
  const bytes = await readBinaryFile(dirHandle, fileName);

  if (looksLikeBinaryEncryptedFile(bytes)) {
    return unpackEncryptedFile(bytes);
  }

  // Legacy prototype format: JSON with Base64 ciphertext.
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text);
}

function packEncryptedFile({ algorithm, iv, ciphertext }) {
  const headerBytes = new TextEncoder().encode(JSON.stringify({ algorithm, iv }));
  const magicBytes = new TextEncoder().encode(FILE_MAGIC);
  const output = new Uint8Array(8 + headerBytes.length + ciphertext.length);
  const view = new DataView(output.buffer);

  output.set(magicBytes, 0);
  view.setUint32(4, headerBytes.length, false);
  output.set(headerBytes, 8);
  output.set(ciphertext, 8 + headerBytes.length);
  return output;
}

function unpackEncryptedFile(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(4, false);
  const headerStart = 8;
  const headerEnd = headerStart + headerLength;
  const header = JSON.parse(new TextDecoder().decode(bytes.slice(headerStart, headerEnd)));
  const ciphertext = bytes.slice(headerEnd);

  return {
    algorithm: header.algorithm,
    iv: header.iv,
    data: bytesToBase64(ciphertext)
  };
}

function looksLikeBinaryEncryptedFile(bytes) {
  if (bytes.length < 8) return false;
  return new TextDecoder().decode(bytes.slice(0, 4)) === FILE_MAGIC;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(handle, "vaultDir");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getSavedHandle() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const request = tx.objectStore(DB_STORE).get("vaultDir");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function clearSavedHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete("vaultDir");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js");
      registration.update();
    } catch {
      // The app still works without offline shell caching.
    }
  });
}

async function checkForAppUpdate() {
  try {
    const response = await fetch(`./version.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const remote = await response.json();
    if (remote.version && remote.version !== APP_VERSION) {
      toast(`Version ${remote.version} is available. Close and reopen or refresh to update.`);
    }
  } catch {
    // Offline use is expected; update checks should never block the vault.
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function cleanError(error, fallback = "Something went wrong.") {
  if (error?.name === "AbortError") return "Selection cancelled.";
  if (error?.name === "NotAllowedError") return "Permission was not granted.";
  return error?.message || fallback;
}

let toastTimer = null;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 4200);
}
