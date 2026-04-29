# myAssistant Vault

myAssistant is an Android-first, local-first encrypted PWA. The app code can be hosted on GitHub Pages, while user data lives in a user-selected local vault folder, such as a folder on an SD card.

## Current Intent

The app is now a usable foundation for a private assistant:

- create or reopen an encrypted vault in a user-selected directory
- unlock with a single strong password
- remember the previous vault handle when the browser allows it
- capture quick notes, journal entries, tasks, purchases, yoga notes, and research topics
- organize records with tags, pinned items, favorites, dates, and due/revisit dates
- store uploaded files, receipts, and warranty cards as encrypted binary files
- move records/files to Trash, restore them, and manually purge them after confirmation
- merge tags and add new tags
- store AI/search/OCR provider API keys inside the encrypted vault
- export a decrypted JSON copy after an explicit warning
- lock after 30 seconds of inactivity or when the app is hidden

Future AI and OCR features should send only user-selected context after a consent screen.

## App Structure

The PWA is static:

```text
index.html
styles.css
app.js
manifest.webmanifest
sw.js
version.json
icons/
```

The app UI is organized into views:

```text
Home
Capture
Notes
Journal
Tasks / Purchases
Yoga
Files / Receipts
Trash
Settings
```

Most features use the same record model. Views are filtered ways to work with encrypted records.

## Vault Layout

The selected vault folder uses this shape:

```text
AssistantVault/
  meta.json
  vault.json.enc
  files/
    <file-id>.bin.enc
```

`meta.json` is intentionally unencrypted and should not contain private user content. It identifies the folder as a myAssistant vault and stores cryptographic parameters such as salt and PBKDF2 iteration count.

`vault.json.enc` contains encrypted records, file metadata, tags, settings, trash state, and saved AI provider keys.

`files/` contains encrypted binary copies of uploaded files.

## Record Model

The app stores typed records like:

```js
{
  id,
  type,
  title,
  body,
  tagIds: [],
  linkedFileIds: [],
  pinned: false,
  favorite: false,
  createdAt,
  updatedAt,
  deletedAt: null,
  purgeAfter: null,
  data: {}
}
```

Current record types include:

```text
quick_note
journal
task
purchase
yoga_note
file_record
receipt
research_topic
ai_response
```

## Encryption Model

The password is not used directly to encrypt vault data.

```text
password + salt
  -> PBKDF2-SHA-256
  -> key-encryption key
  -> decrypts random vault key
  -> vault key encrypts JSON records and uploaded files
```

The vault currently uses:

- PBKDF2-SHA-256
- 600,000 iterations
- AES-GCM with 256-bit keys
- a fresh 96-bit IV for each encryption operation
- binary encrypted file storage for uploaded files, avoiding Base64 size overhead

Changing the password re-wraps the random vault key. Existing records and files do not need to be fully re-encrypted.

Uploaded files use a small binary container:

```text
4 bytes  magic: MYA1
4 bytes  big-endian header length
N bytes  JSON header with algorithm and IV
rest     AES-GCM ciphertext bytes
```

The older prototype Base64 JSON file format can still be read for compatibility.

## Trash And Deletion

Delete actions move items to Trash with a 10-day recovery window:

- normal views hide deleted records/files
- Trash can restore items
- Purge permanently removes records and encrypted files
- Purge always requires confirmation

Deleting files outside the app is possible, but it can leave stale metadata in the encrypted vault JSON.

## Recovery And Reinstall Flow

The vault folder is the source of truth. Browser storage is only a convenience.

If the PWA is uninstalled, browser data is cleared, or the saved directory handle is lost:

1. Open the app again.
2. If **Resume Previous Vault** appears, tap it and grant folder access.
3. If no previous vault is remembered, choose **Open Existing Vault**.
4. Select the same SD-card vault folder when asked.
5. Enter the password.
6. The encrypted vault data is restored.

If the password is forgotten, the encrypted vault cannot be recovered.

## AI And Search Direction

AI provider settings can be saved now, but the app does not yet call external AI/search/OCR APIs.

The planned rule is:

```text
Local vault stays local.
Only selected notes/files/excerpts are sent.
The user sees and confirms the outgoing context first.
AI responses are saved back as encrypted records.
```

Research outputs should be saved as normal encrypted records with source URLs, snippets, summaries, and run dates.

## Local Testing

Because service workers and several browser APIs require a secure origin, deploy through GitHub Pages for realistic Android testing.

For quick desktop testing, a localhost server is also treated as secure by browsers:

```powershell
python -m http.server 8080
```

Then open:

```text
http://localhost:8080/
```

## GitHub Pages

For a repository page, enable GitHub Pages for the repo and visit:

```text
https://<username>.github.io/<repo>/
```

The app uses relative paths so it can work from a repository subpath.

## Update Behavior

The service worker caches the app shell for offline loading. The app also checks `version.json` with a cache-busting request and shows a notice when the hosted version differs from the running app.

After changing app files, users may need to close and reopen the PWA, or refresh, before the new cached version takes over. A future version should add an explicit **Update now** button.

## Important Limits

- This app depends on the browser's File System Access API.
- Android browser behavior around SD cards and persisted permissions must be tested on the target device.
- Fingerprint or biometric unlock is not included. A future native wrapper could use biometrics as a convenience unlock, but the password remains the real vault recovery secret.
- Browser voice input, notifications, background checks, OCR, and AI calls are future phases.
