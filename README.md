# myAssistant Vault

This is a bare PWA for testing the core storage model for an Android-first assistant app. The app code can be hosted on GitHub Pages, while user data lives in a user-selected local vault folder, such as a folder on an SD card.

## Current Intent

The first goal is to prove the durable local vault flow:

- create a vault in a user-selected directory
- open an existing vault after reinstall, browser cache clear, or lost app state
- protect the vault with a PIN or passphrase
- save text and numeric entries into encrypted JSON
- copy uploaded files into the same vault directory after encryption
- keep the app installable and cacheable as a PWA

This is not yet a full assistant. It is the foundation that future assistant features should write through.

## Architecture

The app is a static PWA:

```text
index.html
styles.css
app.js
manifest.webmanifest
sw.js
version.json
icons/
```

The app expects a vault folder with this shape:

```text
AssistantVault/
  meta.json
  vault.json.enc
  files/
    <file-id>.bin.enc
```

`meta.json` is intentionally unencrypted and should not contain private user content. It identifies the folder as a myAssistant vault and stores cryptographic parameters such as salt and PBKDF2 iteration count.

`vault.json.enc` contains encrypted structured data, currently notes and file metadata.

`files/` contains encrypted binary copies of user-selected files.

## Encryption Model

The PIN or passphrase is not used directly to encrypt vault data.

```text
PIN/passphrase + salt
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

This design makes future PIN changes easier because only the wrapped vault key needs to be re-encrypted.

Uploaded files use a small binary container:

```text
4 bytes  magic: MYA1
4 bytes  big-endian header length
N bytes  JSON header with algorithm and IV
rest     AES-GCM ciphertext bytes
```

The encrypted file is only slightly larger than the original file. The older prototype Base64 JSON file format can still be read for compatibility.

## Recovery And Reinstall Flow

The vault folder is the source of truth. Browser storage is only a convenience.

If the PWA is uninstalled, browser data is cleared, or the saved directory handle is lost:

1. Open the app again.
2. If **Resume Previous Vault** appears, tap it and grant folder access.
3. If no previous vault is remembered, choose **Open Existing Vault**.
4. Select the same SD-card vault folder when asked.
5. Enter the PIN or passphrase.
6. The encrypted vault data is restored.

On a normal reload or close/open cycle, the app stores the selected directory handle in IndexedDB. If the browser still trusts that handle, the app goes directly to the PIN screen. If the browser kept the handle but dropped permission, the app shows **Resume Previous Vault** so permission can be renewed with a user gesture.

If the PIN or passphrase is forgotten, the encrypted vault cannot be recovered.

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

After changing app files, users may need to close and reopen the PWA, or refresh, before the new cached version takes over. Future versions should replace the simple notice with an explicit update button.

## Important Limits

- This app depends on the browser's File System Access API.
- Android browser behavior around SD cards and persisted permissions must be tested on the target device.
- Fingerprint or biometric unlock is not included. A future native wrapper could use biometrics as a convenience unlock, but the PIN/passphrase should remain the real vault recovery secret.
- Encrypted downloaded files are decrypted only inside the app session. The current test app uses a browser download flow for decrypted file retrieval.
