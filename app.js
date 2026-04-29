const APP_VERSION = "0.2.1";
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
  filters: {
    search: "",
    tag: "",
    type: ""
  },
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
      toast("Remembered vault found. Enter password to unlock.");
    } catch {
      await clearSavedHandle();
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

async function resumeSavedVaultFlow() {
  if (!state.dirHandle) {
    toast("No previous vault is remembered on this device.");
    return;
  }

  try {
    await ensurePermission(state.dirHandle, true);
    state.meta = await readJsonFile(state.dirHandle, META_FILE);
    validateMeta(state.meta);
    showUnlock("unlock");
  } catch (error) {
    toast(cleanError(error, "Could not resume the remembered vault."));
  }
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
    validateMeta(meta);

    state.mode = "unlock";
    state.dirHandle = dirHandle;
    state.meta = meta;
    await saveHandle(dirHandle);
    showUnlock("unlock");
  } catch (error) {
    toast(cleanError(error));
  }
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

  if (password.length < 6) {
    toast("Use at least 6 characters.");
    return;
  }

  if (state.mode === "create" && password !== els.pinConfirmInput.value) {
    toast("Password confirmation does not match.");
    return;
  }

  try {
    if (state.mode === "create") {
      await createVault(password);
    } else {
      await unlockVault(password);
    }
    els.pinInput.value = "";
    els.pinConfirmInput.value = "";
    renderApp();
  } catch (error) {
    toast(cleanError(error, "Could not unlock vault. Check the password and folder."));
  }
}

async function createVault(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKey(password, salt, KDF_ITERATIONS);
  const vaultKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const vaultKey = await importAesKey(vaultKeyBytes);
  const wrappedVaultKey = await encryptBytes(kek, vaultKeyBytes);

  const meta = {
    app: "myAssistant",
    kind: "encrypted-vault",
    vaultVersion: 2,
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

  state.meta = meta;
  state.vaultKey = vaultKey;
  state.currentPassword = password;
  state.data = createEmptyVaultData();

  await state.dirHandle.getDirectoryHandle(FILES_DIR, { create: true });
  await writeJsonFile(state.dirHandle, META_FILE, meta);
  await saveVaultData();
  await saveHandle(state.dirHandle);
  toast("Encrypted vault created.");
}

async function unlockVault(password) {
  if (!await ensurePermission(state.dirHandle, true)) {
    throw new Error("Read/write permission is needed to open this vault.");
  }

  const cryptoMeta = state.meta.crypto;
  const salt = base64ToBytes(cryptoMeta.salt);
  const kek = await deriveKey(password, salt, cryptoMeta.iterations);
  const vaultKeyBytes = await decryptBytes(kek, cryptoMeta.keyWrap);
  const vaultKey = await importAesKey(vaultKeyBytes);
  const data = await readVaultData(state.dirHandle, vaultKey);

  state.vaultKey = vaultKey;
  state.currentPassword = password;
  state.data = migrateVaultData(data);
  await saveVaultData();
  await saveHandle(state.dirHandle);
  toast("Vault unlocked.");
}

function createEmptyVaultData() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    createdAt: now,
    updatedAt: now,
    settings: {
      lockTimeoutMs: LOCK_TIMEOUT_MS,
      trashDays: TRASH_DAYS,
      aiConsentRequired: true
    },
    tags: DEFAULT_TAGS.map(name => ({
      id: crypto.randomUUID(),
      name,
      createdAt: now
    })),
    records: [],
    files: [],
    secrets: {
      providers: []
    }
  };
}

function migrateVaultData(data) {
  const migrated = {
    ...createEmptyVaultData(),
    ...data
  };

  migrated.settings = {
    lockTimeoutMs: LOCK_TIMEOUT_MS,
    trashDays: TRASH_DAYS,
    aiConsentRequired: true,
    ...(data.settings || {})
  };
  migrated.tags = Array.isArray(data.tags) ? data.tags : [];
  migrated.records = Array.isArray(data.records) ? data.records : [];
  migrated.files = Array.isArray(data.files) ? data.files : [];
  migrated.secrets = data.secrets || { providers: [] };
  migrated.secrets.providers = Array.isArray(migrated.secrets.providers) ? migrated.secrets.providers : [];

  for (const tagName of DEFAULT_TAGS) ensureTag(tagName, migrated);

  migrated.records = migrated.records.map(record => {
    if (record.type) return normalizeRecord(record);
    return normalizeRecord({
      id: record.id,
      type: "quick_note",
      title: firstLine(record.text || "Untitled note"),
      body: record.text || "",
      createdAt: record.createdAt,
      updatedAt: record.createdAt,
      tagIds: tagNamesToIds(["note"], migrated),
      data: {}
    });
  });

  migrated.files = migrated.files.map(file => ({
    id: file.id || crypto.randomUUID(),
    name: file.name || "Encrypted file",
    type: file.type || "application/octet-stream",
    size: file.size || 0,
    encryptedName: file.encryptedName,
    encryptionFormat: file.encryptionFormat || "legacy-json",
    linkedRecordIds: file.linkedRecordIds || [],
    tagIds: file.tagIds || tagNamesToIds(["file"], migrated),
    createdAt: file.createdAt || new Date().toISOString(),
    updatedAt: file.updatedAt || file.createdAt || new Date().toISOString(),
    deletedAt: file.deletedAt || null,
    purgeAfter: file.purgeAfter || null
  }));

  migrated.schemaVersion = 2;
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
    linkedFileIds: record.linkedFileIds || [],
    pinned: Boolean(record.pinned),
    favorite: Boolean(record.favorite),
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || record.createdAt || now,
    deletedAt: record.deletedAt || null,
    purgeAfter: record.purgeAfter || null,
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
  const activeFiles = getActiveFiles();
  const trashCount = state.data.records.filter(isDeleted).length + state.data.files.filter(isDeleted).length;

  els.viewTitle.textContent = VIEW_TITLES[state.view] || "Home";
  els.vaultName.textContent = `${state.dirHandle?.name || "Selected vault"} - updated ${formatDate(state.data.updatedAt)}`;
  els.recordCount.textContent = activeRecords.length;
  els.fileCount.textContent = activeFiles.length;
  els.trashCount.textContent = trashCount;

  els.tabs.querySelectorAll("[data-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });

  const renderers = {
    home: renderHome,
    capture: renderCapture,
    notes: () => renderRecordBrowser("notes", ["quick_note"], "Notes"),
    journal: renderJournal,
    tasks: renderTasks,
    yoga: renderYoga,
    files: renderFiles,
    trash: renderTrash,
    settings: renderSettings
  };
  els.viewRoot.innerHTML = renderers[state.view]?.() || renderHome();
  bindViewEvents();
}

function renderHome() {
  const pinned = getActiveRecords().filter(record => record.pinned).slice(0, 5);
  const upcoming = getActiveRecords()
    .filter(record => ["task", "purchase"].includes(record.type) && record.data.dueAt && record.data.status !== "done")
    .sort((a, b) => String(a.data.dueAt).localeCompare(String(b.data.dueAt)))
    .slice(0, 5);
  const recent = getActiveRecords()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 6);

  return `
    <section class="panel">
      <h2>Quick Capture</h2>
      ${captureFormHtml("quick_note")}
    </section>
    <section class="panel">
      <h2>Pinned</h2>
      <div class="list">${pinned.length ? pinned.map(recordCardHtml).join("") : emptyHtml("No pinned records yet.")}</div>
    </section>
    <section class="panel">
      <h2>Upcoming</h2>
      <div class="list">${upcoming.length ? upcoming.map(recordCardHtml).join("") : emptyHtml("No upcoming tasks or purchases.")}</div>
    </section>
    <section class="panel">
      <h2>Recent</h2>
      <div class="list">${recent.length ? recent.map(recordCardHtml).join("") : emptyHtml("No records yet.")}</div>
    </section>
  `;
}

function renderCapture() {
  return `
    <section class="panel">
      <h2>Capture Anything</h2>
      ${captureFormHtml("quick_note", true)}
    </section>
  `;
}

function renderJournal() {
  return `
    <section class="panel">
      <h2>New Journal Entry</h2>
      ${captureFormHtml("journal")}
    </section>
    ${recordBrowserHtml(["journal"], "Journal Entries")}
  `;
}

function renderTasks() {
  return `
    <section class="panel">
      <h2>New Task Or Purchase</h2>
      ${captureFormHtml("task")}
    </section>
    ${recordBrowserHtml(["task", "purchase"], "Tasks And Purchases")}
  `;
}

function renderYoga() {
  return `
    <section class="panel">
      <h2>New Yoga Note</h2>
      ${captureFormHtml("yoga_note")}
    </section>
    ${recordBrowserHtml(["yoga_note"], "Yoga Notes")}
  `;
}

function renderRecordBrowser(_view, types, title) {
  return recordBrowserHtml(types, title);
}

function recordBrowserHtml(types, title) {
  const records = filterRecords(types);
  return `
    <section class="panel">
      <h2>${escapeHtml(title)}</h2>
      ${searchControlsHtml(types)}
      <div class="list">${records.length ? records.map(recordCardHtml).join("") : emptyHtml("Nothing found.")}</div>
    </section>
  `;
}

function captureFormHtml(defaultType, allowTypeSelect = false) {
  const typeOptions = Object.entries(RECORD_TYPES)
    .filter(([type]) => type !== "file_record" && type !== "ai_response")
    .map(([type, label]) => `<option value="${type}" ${type === defaultType ? "selected" : ""}>${label}</option>`)
    .join("");

  return `
    <form class="capture-form" data-form="record">
      <div class="form-grid">
        <div>
          <label>Type</label>
          <select name="type" ${allowTypeSelect ? "" : "disabled"}>${typeOptions}</select>
          ${allowTypeSelect ? "" : `<input type="hidden" name="type" value="${escapeHtml(defaultType)}">`}
        </div>
        <div>
          <label>Tags</label>
          <input name="tags" placeholder="note, mood, revisit">
        </div>
        <div class="wide">
          <label>Title</label>
          <input name="title" placeholder="Optional title">
        </div>
        <div class="wide">
          <label>Body</label>
          <textarea name="body" rows="5" placeholder="Write the entry..."></textarea>
        </div>
        <div>
          <label>Date</label>
          <input name="date" type="date" value="${today()}">
        </div>
        <div>
          <label>Due / revisit</label>
          <input name="dueAt" type="date">
        </div>
        <div>
          <label>Mood</label>
          <input name="mood" placeholder="calm, tired, happy">
        </div>
        <div>
          <label>Status</label>
          <select name="status">
            <option value="open">Open</option>
            <option value="planned">Planned</option>
            <option value="done">Done</option>
          </select>
        </div>
      </div>
      <div class="toolbar">
        <button class="primary" type="submit">Save Record</button>
      </div>
    </form>
  `;
}

function searchControlsHtml(types) {
  const tagOptions = state.data.tags
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(tag => `<option value="${tag.id}" ${state.filters.tag === tag.id ? "selected" : ""}>${escapeHtml(tag.name)}</option>`)
    .join("");
  const typeValue = types.join(",");

  return `
    <div class="searchbar" data-search-types="${escapeHtml(typeValue)}">
      <input data-filter="search" value="${escapeHtml(state.filters.search)}" placeholder="Search title, body, tags">
      <select data-filter="tag">
        <option value="">All tags</option>
        ${tagOptions}
      </select>
    </div>
  `;
}

function renderFiles() {
  const files = getActiveFiles().filter(file => matchesSearch(file.name, tagNames(file.tagIds).join(" ")));
  return `
    <section class="panel">
      <h2>Save File Or Receipt</h2>
      <form data-form="file">
        <div class="form-grid">
          <div class="wide">
            <label>File</label>
            <input name="file" type="file" required>
          </div>
          <div>
            <label>Kind</label>
            <select name="kind">
              <option value="file_record">File</option>
              <option value="receipt">Receipt / warranty</option>
            </select>
          </div>
          <div>
            <label>Tags</label>
            <input name="tags" placeholder="receipt, warranty, finance">
          </div>
          <div>
            <label>Purchase date</label>
            <input name="purchaseDate" type="date">
          </div>
          <div>
            <label>Warranty until</label>
            <input name="warrantyUntil" type="date">
          </div>
          <div class="wide">
            <label>Notes</label>
            <textarea name="body" rows="3" placeholder="Product, shop, amount, serial number..."></textarea>
          </div>
        </div>
        <div class="toolbar">
          <button class="primary" type="submit">Encrypt File Into Vault</button>
        </div>
      </form>
    </section>
    <section class="panel">
      <h2>Files</h2>
      <input data-filter="search" value="${escapeHtml(state.filters.search)}" placeholder="Search files or tags">
      <div class="list">${files.length ? files.map(fileCardHtml).join("") : emptyHtml("No files saved yet.")}</div>
    </section>
  `;
}

function renderTrash() {
  const records = state.data.records.filter(isDeleted).sort(sortUpdatedDesc);
  const files = state.data.files.filter(isDeleted).sort(sortUpdatedDesc);
  return `
    <section class="panel">
      <h2>Trash</h2>
      <p class="hint">Items are recoverable for ${state.data.settings.trashDays} days. Permanent purge always asks for confirmation.</p>
      <div class="list">
        ${records.map(recordCardHtml).join("")}
        ${files.map(fileCardHtml).join("")}
        ${records.length || files.length ? "" : emptyHtml("Trash is empty.")}
      </div>
    </section>
  `;
}

function renderSettings() {
  const tags = state.data.tags.slice().sort((a, b) => a.name.localeCompare(b.name));
  const providers = state.data.secrets.providers;
  return `
    <section class="panel">
      <h2>Security</h2>
      <form data-form="password">
        <label>Current password</label>
        <input name="currentPassword" type="password" autocomplete="current-password" required>
        <label>New password</label>
        <input name="newPassword" type="password" autocomplete="new-password" minlength="6" required>
        <label>Confirm new password</label>
        <input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required>
        <div class="toolbar">
          <button class="primary" type="submit">Change Password</button>
        </div>
      </form>
      <p class="hint">The vault locks after 30 seconds of inactivity or when the app is hidden.</p>
    </section>
    <section class="panel">
      <h2>AI Providers</h2>
      <form data-form="provider">
        <div class="form-grid">
          <div>
            <label>Name</label>
            <input name="name" placeholder="OpenAI, Gemini, Search API">
          </div>
          <div>
            <label>Type</label>
            <select name="type">
              <option value="ai">AI</option>
              <option value="search">Search</option>
              <option value="ocr">OCR</option>
            </select>
          </div>
          <div class="wide">
            <label>API key</label>
            <input name="apiKey" type="password" autocomplete="off" placeholder="Stored inside encrypted vault">
          </div>
          <div class="wide">
            <label>Endpoint / notes</label>
            <input name="endpoint" placeholder="Optional endpoint, model, or usage note">
          </div>
        </div>
        <button class="primary" type="submit">Save Provider</button>
      </form>
      <div class="list">
        ${providers.length ? providers.map(provider => `
          <article class="record-card">
            <div class="record-head">
              <h3 class="record-title">${escapeHtml(provider.name)}</h3>
              <span class="badge">${escapeHtml(provider.type)}</span>
            </div>
            <p class="meta">${escapeHtml(provider.endpoint || "No endpoint saved")} - key saved encrypted in vault</p>
            <div class="card-actions">
              <button class="danger small" data-delete-provider="${provider.id}" type="button">Delete</button>
            </div>
          </article>
        `).join("") : emptyHtml("No providers saved.")}
      </div>
    </section>
    <section class="panel">
      <h2>Tags</h2>
      <form data-form="tag">
        <label>New tag</label>
        <input name="name" placeholder="new tag">
        <button class="primary" type="submit">Add Tag</button>
      </form>
      <form data-form="mergeTags">
        <div class="form-grid">
          <div>
            <label>Merge from</label>
            <select name="from">${tags.map(tag => `<option value="${tag.id}">${escapeHtml(tag.name)}</option>`).join("")}</select>
          </div>
          <div>
            <label>Merge into</label>
            <select name="to">${tags.map(tag => `<option value="${tag.id}">${escapeHtml(tag.name)}</option>`).join("")}</select>
          </div>
        </div>
        <button type="submit">Merge Tags</button>
      </form>
      <div class="tags">${tags.map(tag => `<span class="tag">${escapeHtml(tag.name)}</span>`).join("")}</div>
    </section>
    <section class="panel">
      <h2>Export</h2>
      <p class="hint">Decrypted export creates readable JSON on this device. Treat it as sensitive.</p>
      <div class="toolbar">
        <button class="danger" data-action="export-decrypted" type="button">Export Decrypted JSON</button>
      </div>
    </section>
  `;
}

function recordCardHtml(record) {
  const deleted = isDeleted(record);
  const restorable = canRestore(record);
  return `
    <article class="record-card">
      <div class="record-head">
        <div>
          <h3 class="record-title">${escapeHtml(record.title || "Untitled")}</h3>
          <p class="meta">${escapeHtml(RECORD_TYPES[record.type] || record.type)} - ${formatDate(record.updatedAt)}</p>
        </div>
        <div class="toolbar">
          ${record.pinned ? `<span class="badge ok">Pinned</span>` : ""}
          ${record.favorite ? `<span class="badge">Favorite</span>` : ""}
        </div>
      </div>
      ${record.body ? `<p class="record-body">${escapeHtml(record.body)}</p>` : ""}
      ${record.data?.dueAt ? `<p class="meta">Due: ${escapeHtml(record.data.dueAt)}</p>` : ""}
      ${record.data?.mood ? `<p class="meta">Mood: ${escapeHtml(record.data.mood)}</p>` : ""}
      ${record.linkedFileIds?.length ? `<p class="meta">Linked files: ${record.linkedFileIds.length}</p>` : ""}
      <div class="tags">${record.tagIds.map(tagId => `<span class="tag">${escapeHtml(tagName(tagId))}</span>`).join("")}</div>
      <div class="card-actions">
        ${deleted ? `
          ${restorable ? `<button class="small" data-restore-record="${record.id}" type="button">Restore</button>` : `<span class="badge warn">Recovery expired</span>`}
          <button class="danger small" data-purge-record="${record.id}" type="button">Purge</button>
        ` : `
          <button class="small" data-toggle-pin="${record.id}" type="button">${record.pinned ? "Unpin" : "Pin"}</button>
          <button class="small" data-toggle-favorite="${record.id}" type="button">${record.favorite ? "Unfavorite" : "Favorite"}</button>
          <button class="danger small" data-delete-record="${record.id}" type="button">Delete</button>
        `}
      </div>
    </article>
  `;
}

function fileCardHtml(file) {
  const deleted = isDeleted(file);
  const restorable = canRestore(file);
  return `
    <article class="record-card">
      <div class="record-head">
        <div>
          <h3 class="record-title">${escapeHtml(file.name)}</h3>
          <p class="meta">${formatBytes(file.size)} - ${formatDate(file.updatedAt || file.createdAt)}</p>
        </div>
        <span class="badge">${escapeHtml(file.type || "file")}</span>
      </div>
      <div class="tags">${file.tagIds.map(tagId => `<span class="tag">${escapeHtml(tagName(tagId))}</span>`).join("")}</div>
      <div class="card-actions">
        ${deleted ? `
          ${restorable ? `<button class="small" data-restore-file="${file.id}" type="button">Restore</button>` : `<span class="badge warn">Recovery expired</span>`}
          <button class="danger small" data-purge-file="${file.id}" type="button">Purge</button>
        ` : `
          <button class="small" data-decrypt-file="${file.id}" type="button">Decrypt Download</button>
          <button class="danger small" data-delete-file="${file.id}" type="button">Delete</button>
        `}
      </div>
    </article>
  `;
}

function bindViewEvents() {
  els.viewRoot.querySelectorAll("[data-form='record']").forEach(form => form.addEventListener("submit", saveRecordFromForm));
  els.viewRoot.querySelectorAll("[data-form='file']").forEach(form => form.addEventListener("submit", saveFileFromForm));
  els.viewRoot.querySelectorAll("[data-form='password']").forEach(form => form.addEventListener("submit", changePassword));
  els.viewRoot.querySelectorAll("[data-form='provider']").forEach(form => form.addEventListener("submit", saveProvider));
  els.viewRoot.querySelectorAll("[data-form='tag']").forEach(form => form.addEventListener("submit", saveTag));
  els.viewRoot.querySelectorAll("[data-form='mergeTags']").forEach(form => form.addEventListener("submit", mergeTags));

  els.viewRoot.querySelectorAll("[data-filter='search']").forEach(input => input.addEventListener("input", event => {
    state.filters.search = event.target.value;
    renderView();
  }));
  els.viewRoot.querySelectorAll("[data-filter='tag']").forEach(select => select.addEventListener("change", event => {
    state.filters.tag = event.target.value;
    renderView();
  }));

  bindButton("[data-toggle-pin]", button => toggleRecordFlag(button.dataset.togglePin, "pinned"));
  bindButton("[data-toggle-favorite]", button => toggleRecordFlag(button.dataset.toggleFavorite, "favorite"));
  bindButton("[data-delete-record]", button => trashRecord(button.dataset.deleteRecord));
  bindButton("[data-restore-record]", button => restoreRecord(button.dataset.restoreRecord));
  bindButton("[data-purge-record]", button => purgeRecord(button.dataset.purgeRecord));
  bindButton("[data-decrypt-file]", button => decryptFile(button.dataset.decryptFile));
  bindButton("[data-delete-file]", button => trashFile(button.dataset.deleteFile));
  bindButton("[data-restore-file]", button => restoreFile(button.dataset.restoreFile));
  bindButton("[data-purge-file]", button => purgeFile(button.dataset.purgeFile));
  bindButton("[data-delete-provider]", button => deleteProvider(button.dataset.deleteProvider));
  bindButton("[data-action='export-decrypted']", exportDecryptedVault);
}

function bindButton(selector, handler) {
  els.viewRoot.querySelectorAll(selector).forEach(button => button.addEventListener("click", () => handler(button)));
}

async function saveRecordFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const type = data.type || "quick_note";
  const tagNames = parseTags(data.tags);
  const now = new Date().toISOString();

  if (type === "journal") tagNames.push("journal");
  if (type === "task") tagNames.push("task");
  if (type === "purchase") tagNames.push("purchase");
  if (type === "yoga_note") tagNames.push("yoga");
  if (!tagNames.length) tagNames.push("note");

  const record = normalizeRecord({
    type,
    title: data.title?.trim() || firstLine(data.body || RECORD_TYPES[type] || "Untitled"),
    body: data.body?.trim() || "",
    tagIds: tagNamesToIds(tagNames),
    createdAt: now,
    updatedAt: now,
    data: {
      date: data.date || today(),
      dueAt: data.dueAt || null,
      mood: data.mood?.trim() || null,
      status: data.status || "open"
    }
  });

  state.data.records.unshift(record);
  await saveAndRender("Record saved.");
}

async function saveFileFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const file = formData.get("file");
  if (!file || !file.name) {
    toast("Choose a file first.");
    return;
  }

  const now = new Date().toISOString();
  const kind = formData.get("kind") || "file_record";
  const tagNames = parseTags(formData.get("tags"));
  tagNames.push(kind === "receipt" ? "receipt" : "file");

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

  const fileMeta = {
    id: fileId,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
    encryptedName,
    encryptionFormat: "binary-v1",
    linkedRecordIds: [],
    tagIds: tagNamesToIds(tagNames),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAfter: null
  };
  state.data.files.unshift(fileMeta);

  const record = normalizeRecord({
    type: kind,
    title: file.name,
    body: String(formData.get("body") || "").trim(),
    tagIds: fileMeta.tagIds,
    linkedFileIds: [fileId],
    createdAt: now,
    updatedAt: now,
    data: {
      purchaseDate: formData.get("purchaseDate") || null,
      warrantyUntil: formData.get("warrantyUntil") || null
    }
  });
  state.data.records.unshift(record);

  await saveAndRender("File encrypted into vault.");
}

async function toggleRecordFlag(recordId, flag) {
  const record = state.data.records.find(item => item.id === recordId);
  if (!record) return;
  record[flag] = !record[flag];
  record.updatedAt = new Date().toISOString();
  await saveAndRender("Record updated.");
}

async function trashRecord(recordId) {
  const record = state.data.records.find(item => item.id === recordId);
  if (!record) return;
  if (!window.confirm(`Delete "${record.title}"? You can restore it from Trash for ${state.data.settings.trashDays} days.`)) return;
  markDeleted(record);
  await saveAndRender("Record moved to Trash.");
}

async function restoreRecord(recordId) {
  const record = state.data.records.find(item => item.id === recordId);
  if (!record) return;
  record.deletedAt = null;
  record.purgeAfter = null;
  record.updatedAt = new Date().toISOString();
  await saveAndRender("Record restored.");
}

async function purgeRecord(recordId) {
  const record = state.data.records.find(item => item.id === recordId);
  if (!record) return;
  if (!window.confirm(`Permanently purge "${record.title}"? This cannot be undone.`)) return;
  state.data.records = state.data.records.filter(item => item.id !== recordId);
  await saveAndRender("Record purged.");
}

async function trashFile(fileId) {
  const file = state.data.files.find(item => item.id === fileId);
  if (!file) return;
  if (!window.confirm(`Delete "${file.name}"? The encrypted file remains recoverable from Trash for ${state.data.settings.trashDays} days.`)) return;
  markDeleted(file);
  state.data.records.filter(record => record.linkedFileIds.includes(fileId)).forEach(markDeleted);
  await saveAndRender("File moved to Trash.");
}

async function restoreFile(fileId) {
  const file = state.data.files.find(item => item.id === fileId);
  if (!file) return;
  file.deletedAt = null;
  file.purgeAfter = null;
  file.updatedAt = new Date().toISOString();
  state.data.records.filter(record => record.linkedFileIds.includes(fileId)).forEach(record => {
    record.deletedAt = null;
    record.purgeAfter = null;
    record.updatedAt = new Date().toISOString();
  });
  await saveAndRender("File restored.");
}

async function purgeFile(fileId) {
  const file = state.data.files.find(item => item.id === fileId);
  if (!file) return;
  if (!window.confirm(`Permanently purge "${file.name}" and remove its encrypted file? This cannot be undone.`)) return;
  await removeEncryptedFile(file);
  state.data.files = state.data.files.filter(item => item.id !== fileId);
  state.data.records = state.data.records.filter(record => !record.linkedFileIds.includes(fileId));
  await saveAndRender("File purged.");
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

async function saveProvider(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (!data.name || !data.apiKey) {
    toast("Provider name and API key are required.");
    return;
  }

  state.data.secrets.providers.push({
    id: crypto.randomUUID(),
    name: data.name.trim(),
    type: data.type,
    apiKey: data.apiKey,
    endpoint: data.endpoint.trim(),
    createdAt: new Date().toISOString()
  });
  await saveAndRender("Provider saved inside encrypted vault.");
}

async function deleteProvider(providerId) {
  const provider = state.data.secrets.providers.find(item => item.id === providerId);
  if (!provider) return;
  if (!window.confirm(`Delete provider "${provider.name}" and its saved API key?`)) return;
  state.data.secrets.providers = state.data.secrets.providers.filter(item => item.id !== providerId);
  await saveAndRender("Provider deleted.");
}

async function saveTag(event) {
  event.preventDefault();
  const name = new FormData(event.currentTarget).get("name");
  if (!String(name).trim()) return;
  ensureTag(name);
  await saveAndRender("Tag saved.");
}

async function mergeTags(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (!data.from || !data.to || data.from === data.to) {
    toast("Choose two different tags.");
    return;
  }

  const fromTag = state.data.tags.find(tag => tag.id === data.from);
  const toTag = state.data.tags.find(tag => tag.id === data.to);
  if (!fromTag || !toTag) return;
  if (!window.confirm(`Merge "${fromTag.name}" into "${toTag.name}"?`)) return;

  for (const record of state.data.records) record.tagIds = replaceTag(record.tagIds, data.from, data.to);
  for (const file of state.data.files) file.tagIds = replaceTag(file.tagIds, data.from, data.to);
  state.data.tags = state.data.tags.filter(tag => tag.id !== data.from);
  await saveAndRender("Tags merged.");
}

async function changePassword(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (data.currentPassword !== state.currentPassword) {
    toast("Current password does not match this unlocked session.");
    return;
  }
  if (data.newPassword.length < 6 || data.newPassword !== data.confirmPassword) {
    toast("New password confirmation does not match.");
    return;
  }
  if (!window.confirm("Change the vault password? The old password will no longer unlock this vault.")) return;

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKey(data.newPassword, salt, KDF_ITERATIONS);
  const vaultKeyBytes = await crypto.subtle.exportKey("raw", state.vaultKey);
  const wrappedVaultKey = await encryptBytes(kek, new Uint8Array(vaultKeyBytes));

  state.meta.crypto.salt = bytesToBase64(salt);
  state.meta.crypto.iterations = KDF_ITERATIONS;
  state.meta.crypto.keyWrap = {
    algorithm: "AES-GCM",
    iv: wrappedVaultKey.iv,
    data: wrappedVaultKey.data
  };
  state.meta.appVersion = APP_VERSION;
  state.currentPassword = data.newPassword;
  await writeJsonFile(state.dirHandle, META_FILE, state.meta);
  await saveAndRender("Password changed.");
}

async function exportDecryptedVault() {
  if (!window.confirm("Export a decrypted readable JSON copy of this vault? Anyone with that file can read its contents.")) return;
  const exportData = {
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    vault: state.data
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `myAssistant-decrypted-export-${today()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function saveAndRender(message) {
  state.data.updatedAt = new Date().toISOString();
  await saveVaultData();
  renderView();
  toast(message);
}

function markDeleted(item) {
  const now = new Date();
  item.deletedAt = now.toISOString();
  item.purgeAfter = addDays(now, state.data.settings.trashDays).toISOString();
  item.updatedAt = now.toISOString();
}

async function removeEncryptedFile(file) {
  try {
    const filesDir = await state.dirHandle.getDirectoryHandle(FILES_DIR);
    await filesDir.removeEntry(file.encryptedName);
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }
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

function getActiveRecords() {
  return state.data.records.filter(record => !isDeleted(record));
}

function getActiveFiles() {
  return state.data.files.filter(file => !isDeleted(file));
}

function filterRecords(types) {
  return getActiveRecords()
    .filter(record => types.includes(record.type))
    .filter(record => !state.filters.tag || record.tagIds.includes(state.filters.tag))
    .filter(record => matchesSearch(record.title, record.body, tagNames(record.tagIds).join(" ")))
    .sort(sortUpdatedDesc);
}

function matchesSearch(...values) {
  const query = state.filters.search.trim().toLowerCase();
  if (!query) return true;
  return values.some(value => String(value || "").toLowerCase().includes(query));
}

function isDeleted(item) {
  return Boolean(item.deletedAt);
}

function canRestore(item) {
  return !item.purgeAfter || Date.parse(item.purgeAfter) > Date.now();
}

function sortUpdatedDesc(a, b) {
  return String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt));
}

function parseTags(value) {
  return String(value || "")
    .split(",")
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean);
}

function ensureTag(name, target = state.data) {
  const clean = String(name || "").trim().toLowerCase();
  if (!clean) return null;
  const existing = target.tags.find(tag => tag.name.toLowerCase() === clean);
  if (existing) return existing.id;
  const tag = {
    id: crypto.randomUUID(),
    name: clean,
    createdAt: new Date().toISOString()
  };
  target.tags.push(tag);
  return tag.id;
}

function tagNamesToIds(names, target = state.data) {
  return [...new Set(names.map(name => ensureTag(name, target)).filter(Boolean))];
}

function tagName(tagId) {
  return state.data.tags.find(tag => tag.id === tagId)?.name || "unknown";
}

function tagNames(tagIds) {
  return tagIds.map(tagName);
}

function replaceTag(tagIds, fromId, toId) {
  return [...new Set(tagIds.map(tagId => tagId === fromId ? toId : tagId))];
}

function firstLine(value) {
  const line = String(value || "").trim().split(/\r?\n/)[0];
  return line.slice(0, 80) || "Untitled";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function emptyHtml(message) {
  return `<p class="empty">${escapeHtml(message)}</p>`;
}

function lockVault(message = "Vault locked.") {
  state.vaultKey = null;
  state.currentPassword = null;
  state.data = null;
  clearTimeout(state.lockTimer);
  els.appStatus.textContent = "Locked";
  els.supportPanel.classList.remove("hidden");
  showUnlock("unlock");
  toast(message);
}

function resetLockTimer() {
  if (!state.vaultKey) return;
  clearTimeout(state.lockTimer);
  state.lockTimer = setTimeout(() => lockVault("Vault locked after 30 seconds of inactivity."), state.data?.settings?.lockTimeoutMs || LOCK_TIMEOUT_MS);
}

async function deriveKey(password, salt, iterations) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]
  );
}

async function importAesKey(bytes) {
  return crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "AES-GCM" },
    true,
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
  if (looksLikeBinaryEncryptedFile(bytes)) return unpackEncryptedFile(bytes);
  return JSON.parse(new TextDecoder().decode(bytes));
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
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function escapeHtml(value) {
  return String(value ?? "")
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
