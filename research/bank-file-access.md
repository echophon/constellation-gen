# Reading and writing Banks on an SD card from the browser

Research for [issue #5](https://github.com/echophon/constellation-gen/issues/5). Researched 2026-10-03.

**Question.** What can a static site (TypeScript + Vite on GitHub Pages) do to read and write a folder of Bank directories (`000`..`999`, each holding Save Slot files `00.TXT`..`19.TXT`) on a removable FAT micro SD card, and what are the limits?

**How to read this document.** Each claim is tagged:

- **[V]** verified today against the cited primary source (spec, browser source code, vendor documentation, compat dataset).
- **[I]** inference: reasoning from verified facts, not directly stated by a source. Treat as a hypothesis.
- **[U]** unverified: from general knowledge, not checked against a primary source in this session.

Nothing here was tested on a real card or a real module. Section 9 lists what must be tested on hardware before the spec relies on it.

---

## 1. Short answer

- In **Chromium browsers** (Chrome, Edge, Opera on desktop; Chrome for Android 132+), the File System Access API lets the app open the card folder once, read every Bank, create `NNN/` folders and write `NN.TXT` files in place. This is the only route that writes to the card directly.
- **Firefox and Safari do not have the directory picker and both vendors have formally rejected it.** There the app can only *read* a folder the user picks or drops, and *export* a zip the user unpacks onto the card by hand.
- Writes are **atomic per file at best, never per Bank**, and on FAT even the per-file guarantee is weak. The app must keep its own working copy and treat the card as something it syncs to.
- The whole data set is tiny (at most 1000 x 20 x ~2 KB = ~40 MB), so quota is not a practical constraint in any browser. Eviction is the real risk, and only for unsaved work.

---

## 2. File System Access API on a directory handle

Two specs are involved. The WHATWG **File System Standard** defines handles, `createWritable`, and the origin private file system. The WICG **File System Access** draft adds the pickers, the permission methods and drag-and-drop handles for real user-visible folders.

### 2.1 Opening the card folder

- **[V]** `showDirectoryPicker({ id, mode, startIn })`; `mode` is `"read"` (default) or `"readwrite"`. Passing `mode: "readwrite"` asks for write access in the same prompt. `id` lets the browser remember the last directory per id. ([WICG spec](https://wicg.github.io/file-system-access/), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker))
- **[V]** Requires a secure context and transient user activation (must be called from a click). Without activation it throws `SecurityError`. If the user cancels, or the browser judges the folder "too sensitive or dangerous", it throws `AbortError`. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker))
- **[V]** GitHub Pages is HTTPS, so the secure-context requirement is met.
- **[V]** Chromium's blocklist logic rejects a picked path only when it *equals or is a parent of* a blocked path, or sits under a blocked path whose rule blocks children. The blocked set is OS and browser locations: home directory itself, Program Files, Windows, AppData, `/System/Volumes`, `/Applications`, `/Library`, `/dev`, `/proc`, `/sys`, `/etc`, `~/.ssh`, the browser profile, and so on. ([`chrome_file_system_access_permission_context.cc`](https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc), `ShouldBlockAccessToPath`, read from `main` on 2026-10-03)
- **[I]** A card's mount root (`/Volumes/NAME` on macOS, `E:\` on Windows, `/media/<user>/NAME` on Linux) is neither a blocked path nor a parent of one, so picking the **root of the card** should be allowed. The source has no rule about removable volumes or drive roots as such. By the same logic `C:\` and `/` are refused because they are parents of blocked paths. **Not tested.**

### 2.2 Creating `NNN/` folders and writing `NN.TXT`

- **[V]** `dir.getDirectoryHandle(name, { create: true })` and `dir.getFileHandle(name, { create: true })` create the entry when absent. Errors: `TypeError` for an invalid name, `TypeMismatchError` when a file is found where a directory was asked for (or the reverse), `NotFoundError` when absent and `create` is false, `NotAllowedError` without permission. ([WHATWG spec](https://fs.spec.whatwg.org/))
- **[V]** A valid name is "not an empty string, is not equal to '.' or '..', and does not contain '/' or any other character used as path separator on the underlying platform". `000` and `00.TXT` are valid. ([WHATWG spec](https://fs.spec.whatwg.org/))
- **[V]** `dir.removeEntry(name, { recursive: true })` deletes a folder and its contents. Without `recursive`, deleting a non-empty directory rejects. ([WHATWG spec](https://fs.spec.whatwg.org/))
- **[V]** Enumeration is by async iteration (`entries()`, `keys()`, `values()`). ([MDN compat data](https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemDirectoryHandle.json))
- **[V]** `FileSystemHandle.move()` (rename) exists in the compat data from Chrome 102, but Chrome's own documentation says move support for user-visible files is partial and directories are not supported. Do not design around renaming Bank folders; copy then delete instead. ([Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access))

### 2.3 Filename case

- **[V]** The File System spec says nothing about case sensitivity. Names are passed to the underlying platform. ([WHATWG spec](https://fs.spec.whatwg.org/))
- **[V]** FAT compares names case-insensitively. On creation, an upper-cased name goes in the short (8.3) entry and the original spelling goes in a long-filename (LFN) entry when LFN is enabled. ([FatFs documentation](http://elm-chan.org/fsw/ff/doc/filename.html), describing the on-disk format the common embedded FAT library uses)
- **[V]** Windows preserves long names on FAT and says "Do not assume case sensitivity". ([Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file))
- **[I]** Consequences for the app:
  - `getFileHandle("00.txt")` and `getFileHandle("00.TXT")` reach the same file on the card. A lowercase request for a file that does not exist yet would create an entry whose stored spelling is lowercase.
  - A name that is already upper-case 8.3 (`00.TXT`, `000`) fits the short entry exactly and needs no LFN entry. That is the form most likely to be read by any firmware FAT library, including one built without LFN support.
  - So: **always create with the exact upper-case name; when reading, match names case-insensitively; when overwriting, reuse the name as enumerated.**
- **[U]** Which FAT library the Constellation firmware uses, and whether it has LFN enabled, is unknown. This decides whether a lowercase or long name would be invisible to the module.

### 2.4 Atomicity of writes

What the spec promises:

- **[V]** `createWritable()` writes to a temporary file. "Any changes made through stream won't be reflected in the file entry ... until the stream has been closed." With `keepExistingData: false` (default) the temporary file starts empty. ([WHATWG spec](https://fs.spec.whatwg.org/))
- **[V]** On `close()` the browser runs "implementation-defined malware scans and safe browsing checks"; failure rejects with `AbortError`. The spec then notes "It is expected that this atomically updates the contents of the file on disk being written to." That is an expectation in a note, not a requirement. ([WHATWG spec](https://fs.spec.whatwg.org/))

What Chromium actually does (source read from `main`, 2026-10-03):

- **[V]** The swap file is a **sibling in the same directory**, named by appending `.crswap` to the target name (`00.TXT.crswap`), with `.1`, `.2` ... inserted when that name is taken, up to 100 attempts. On Android with content URIs the swap goes in the browser cache directory instead and is copied back. ([`file_system_access_file_handle_impl.cc`](https://source.chromium.org/chromium/chromium/src/+/main:content/browser/file_system_access/file_system_access_file_handle_impl.cc), `max_swap_files_ = 100` in the header)
- **[V]** On close, the swap is moved onto the target with `base::Move`, which is `rename(2)` on POSIX and `MoveFileEx(..., MOVEFILE_COPY_ALLOWED | MOVEFILE_REPLACE_EXISTING)` on Windows. ([`file_system_access_file_writer_impl.cc`](https://source.chromium.org/chromium/chromium/src/+/main:content/browser/file_system_access/file_system_access_file_writer_impl.cc), [`native_file_util.cc`](https://source.chromium.org/chromium/chromium/src/+/main:storage/browser/file_system/native_file_util.cc), [`file_util_posix.cc`](https://source.chromium.org/chromium/chromium/src/+/main:base/files/file_util_posix.cc), [`file_util_win.cc`](https://source.chromium.org/chromium/chromium/src/+/main:base/files/file_util_win.cc))
- **[V]** Before the move, a Safe Browsing "after write" check runs whenever the swap and target extensions differ, which is always the case here (`.crswap` vs `.TXT`). The file is SHA-256 hashed for it. After the move the file is passed to the OS quarantine service (macOS quarantine properties; Windows attachment services / zone identifier). ([`file_system_access_safe_move_helper.cc`](https://source.chromium.org/chromium/chromium/src/+/main:content/browser/file_system_access/file_system_access_safe_move_helper.cc), [`quarantine_mac.mm`](https://source.chromium.org/chromium/chromium/src/+/main:components/services/quarantine/quarantine_mac.mm))
- **[V]** If the writer is aborted, or destroyed without a successful close, the swap file is deleted (`should_purge_swap_file_on_destruction_` defaults to true and is cleared only after a successful move). ([`file_system_access_file_writer_impl.h`](https://source.chromium.org/chromium/chromium/src/+/main:content/browser/file_system_access/file_system_access_file_writer_impl.h))
- **[V]** `createWritable({ mode: "exclusive" })` (Chrome 121+) allows only one writer per file; the default `"siloed"` gives each writer its own swap file and the last close wins. ([Chrome blog](https://developer.chrome.com/blog/new-dev-trial-for-multiple-readers-and-writers), [MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable))

What follows for a FAT card:

- **[I]** The guarantee is "old contents or new contents" **for one file, as seen by the operating system while the card stays mounted**. FAT has no journal, so a rename-over-existing is several directory and allocation-table updates on the medium. Pulling the card or losing power mid-write can still leave a damaged directory entry. No browser API can make this safe.
- **[I]** There is **no multi-file transaction**. Writing a Bank is 20 independent file replacements. A failure part-way leaves a Bank that mixes old and new Save Slots.
- **[I]** A browser crash or a card pulled between `createWritable()` and `close()` can leave an orphan `NN.TXT.crswap` in the Bank folder. It needs a long-filename entry on FAT. How the module reacts to an unexpected file in a Bank folder is unknown.
- **[I]** On macOS, quarantine metadata is an extended attribute, and macOS stores extended attributes on FAT volumes as AppleDouble `._name` companion files. Writing through Chrome on a Mac may therefore add `._00.TXT` files next to each Save Slot. Separately, macOS itself adds `.Spotlight-V100`, `.fseventsd` and similar to FAT volumes. The reader must ignore every name that is not exactly a Bank folder or Save Slot file. **Not tested.**
- **[V]** The API has no flush-to-device, sync or eject call. The user must eject the card in the operating system before removing it.
- **[V]** Each close costs a hash, a Safe Browsing check and a rename. A Chromium bug tracks this being slow for many files ([issue 40899722](https://issues.chromium.org/issues/40899722)). **[I]** Writing one Bank (20 files) is fine; rewriting 1000 Banks (20,000 files) on a slow card would be painful. Write only changed Save Slots.

### 2.5 Permission prompts and persisting the handle

- **[V]** `handle.queryPermission({ mode })` returns `"granted"`, `"denied"` or `"prompt"` with no UI. `handle.requestPermission({ mode })` shows the prompt and needs transient user activation, from a Window (not a Worker). ([WICG spec](https://wicg.github.io/file-system-access/))
- **[V]** Handles are serializable and can be stored in IndexedDB. A handle read back from IndexedDB will usually report `"prompt"`. ([WICG spec](https://wicg.github.io/file-system-access/), [Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access))
- **[V]** By default, access lasts until all tabs for the origin are closed. Chromium's constant is 5 seconds after the last top-level tab for the origin closes or navigates away. ([Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access); `kPermissionRevocationTimeout = base::Seconds(5)` in the permission context source)
- **[V]** From Chrome 122, when the app retrieves a stored handle and calls `requestPermission()`, the user gets a three-way prompt: "Allow this time", "Allow on every visit", "Don't allow". "Allow on every visit" grants indefinite access until revoked in site settings. An installed web app gets persistent permission automatically. After the prompt is denied or dismissed more than three times it stops appearing and the plain prompt returns. ([Chrome blog, 2024-01-09](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api))
- **[V]** Persistent permissions are **not implemented on Android**: the eligibility function returns false there with a TODO. ([permission context source](https://source.chromium.org/chromium/chromium/src/+/main:chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc), `IsEligibleToUpgradePermissionRequestToRestorePrompt`)
- **[I]** Resulting session flow: first visit, one click opens the picker (one prompt covering read and write). Later visits, the app loads the stored handle, `queryPermission` says `"prompt"`, and the app shows a "Reconnect card" button whose click calls `requestPermission`. With "Allow on every visit" chosen, `queryPermission` returns `"granted"` straight away and no click is needed.
- **[I]** A stored handle points at a path, not at a physical card. If the card is absent, operations fail (expect `NotFoundError`). If a *different* card or drive is mounted at the same path or drive letter, the handle silently resolves to it. The app must check that what it opened looks like a Constellation card before writing. **Not tested.**
- **[V]** Storage and permission grants are per origin. **[I]** On GitHub Pages the origin is `https://echophon.github.io`, shared by every project site under that account. File permissions, IndexedDB and OPFS are shared with those other sites. Prefix database names, or use a custom domain to get a dedicated origin.

---

## 3. Browser support on 2026-10-03

From MDN browser-compat-data at commit `d26d7c5` (2026-10-02). ([Window.json](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json), [FileSystemHandle.json](https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemHandle.json), [FileSystemFileHandle.json](https://github.com/mdn/browser-compat-data/blob/main/api/FileSystemFileHandle.json), [DataTransferItem.json](https://github.com/mdn/browser-compat-data/blob/main/api/DataTransferItem.json), [HTMLInputElement.json](https://github.com/mdn/browser-compat-data/blob/main/api/HTMLInputElement.json), [StorageManager.json](https://github.com/mdn/browser-compat-data/blob/main/api/StorageManager.json))

| Capability | Chrome / Edge desktop | Chrome Android | Firefox desktop | Firefox Android | Safari macOS | Safari iOS |
|---|---|---|---|---|---|---|
| `showDirectoryPicker` | 86 | 132 | no | no | no | no |
| `queryPermission` / `requestPermission` | 86 | 109 | no | no | no | no |
| `DataTransferItem.getAsFileSystemHandle` | 86 | 132 | no | no | no | no |
| OPFS `navigator.storage.getDirectory` | 86 | 109 | 111 | 111 | 15.2 | 15.2 |
| `createWritable` (needed for OPFS on the main thread) | 86 | 109 | 111 | 111 | 26 | 26 |
| `createSyncAccessHandle` (workers only) | 102 | 109 | 111 | 111 | 15.2 | 15.2 |
| `<input webkitdirectory>` | 7 | 132 | 50 | 142 | 11.1 | 18.4 |
| `DataTransferItem.webkitGetAsEntry` | 13 | yes | 50 | 141 | 11.1 | yes |
| `navigator.storage.persist` | 55 | yes | 57 | yes | 15.2 | 15.2 |

All **[V]**. Notes:

- **[V]** `showDirectoryPicker` is still flagged experimental and "limited availability" on MDN (page last modified 2026-09-11).
- **[V]** Mozilla's standards position on File System Access is **negative** ([mozilla/standards-positions#154](https://github.com/mozilla/standards-positions/issues/154)). WebKit's is **oppose**, on security grounds, while noting it has shipped the origin private file system part ([WebKit/standards-positions#28](https://github.com/WebKit/standards-positions/issues/28)). **[I]** Do not plan for Firefox or Safari to gain direct card access.
- **[V]** Chrome's documentation says Brave needs a flag to enable the API. ([Chrome docs](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access))
- **[I]** Chrome for Android has the picker, but persistent permissions are missing, swap files are handled differently, and phones rarely have the card mounted. Treat Android as best effort.

---

## 4. Fallbacks where the picker is missing

None of these can write to the card. They split into "read a folder in" and "get files out".

### 4.1 Reading in: `<input type="file" webkitdirectory>`

- **[V]** Lets the user choose a directory; `input.files` then holds every file in the hierarchy. Each `File` has `webkitRelativePath`, **which starts with the chosen folder's own name** (`CARD/000/00.TXT`). Baseline "newly available" since August 2025; desktop support is old, mobile arrived in Chrome Android 132, Safari iOS 18.4, Firefox Android 142. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory))
- **[I]** Limits: a one-time read-only snapshot; no handle to keep; the user re-picks every session; every file under the folder is enumerated, including the hidden OS litter, so filter by path pattern. Strip the first path segment before matching.
- **[U]** Chromium shows an "upload N files to this site?" confirmation. The wording alarms users even though nothing leaves the machine; the UI should say so.

### 4.2 Reading in: drag and drop

- **[V]** `DataTransferItem.webkitGetAsEntry()` works in all three engines and returns a `FileSystemDirectoryEntry` for a dropped folder. It must be called inside the `drop` handler. It is non-standard in name and may become `getAsEntry()`. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry))
- **[V]** In Chromium `readEntries()` returns at most 100 entries per call; call it repeatedly until it returns an empty array. A card with more than 100 Banks hits this. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryReader/readEntries))
- **[U]** Entries obtained from a drop are read-only.
- **[V]** In Chromium only, `DataTransferItem.getAsFileSystemHandle()` returns a real `FileSystemDirectoryHandle` for a dropped folder. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFileSystemHandle)) **[I]** The app can then call `requestPermission({ mode: "readwrite" })` on it, making drag-and-drop an alternative to the picker in Chromium, not just a fallback.

### 4.3 Getting out: zip export (and zip import)

- **[I]** A page without the File System Access API can only hand the user single files (`<a download>` with a Blob URL). There is no way to save a folder tree, so a Bank or a whole card has to travel as one archive.
- **[V]** Current client-side zip libraries (npm registry, 2026-10-03): `fflate` 0.8.3 (MIT), `jszip` 3.10.2 (MIT or GPL-3.0), `client-zip` 2.5.1 (MIT), `@zip.js/zip.js` 2.23.0 (BSD-3-Clause). All maintained in 2026.
- **[U]** `fflate` reads and writes zips and is the smallest general-purpose choice; `client-zip` only writes; `jszip` is the older, larger standard; `zip.js` is the most featureful. At ~40 MB maximum and typically a few hundred KB, any of them is adequate and streaming is unnecessary.
- **[I]** Limits of zip export:
  - The user must unpack onto the card by hand. That step is outside the app's control and is where mistakes happen.
  - Operating systems differ on merging. Copying a folder over an existing one in macOS Finder replaces the whole folder by default; Windows merges. So an exported Bank folder should always contain all 20 Save Slots, and the instructions should say "replace".
  - Never put root-level card files (defaults, settings, autosave, calibration) in an export meant to be unpacked at the card root.
  - Unzip tools may add a wrapper folder or macOS metadata folders.
- **[I]** Zip import is the mirror image and is useful everywhere, including Chromium, for sharing Banks between people.

### 4.4 A ready-made wrapper

- **[V]** `browser-fs-access` (GoogleChromeLabs, Apache-2.0, 0.38.0, last published 2025-06) exists. **[U]** It wraps the picker with a `webkitdirectory` fallback behind one call. The two code paths here differ in more than the open call (one yields writable handles, the other a read-only snapshot), so a small hand-written adapter is likely clearer.

---

## 5. Where the working copy lives

### 5.1 Options

- **[V]** **IndexedDB**: available everywhere; can store structured records, Blobs and `FileSystemHandle` objects; transactional.
- **[V]** **OPFS**: a private per-origin file tree from `navigator.storage.getDirectory()`. No permission prompts, no Safe Browsing checks, invisible to the user, deleted when site data is cleared, counts against the same quota as IndexedDB. Baseline widely available since March 2023. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system))
- **[V]** On Safari before 26, OPFS files can only be written through `createSyncAccessHandle()` in a worker, because `createWritable()` arrived in Safari 26. (compat data, section 3)
- **[V]** `localStorage` is capped around 5 MiB per origin and is not suitable. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria))

### 5.2 Quotas

From [MDN, Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) (last modified 2026-01-05) and [WebKit, Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/). IndexedDB, OPFS and the Cache API share one per-origin quota. All **[V]**.

| Browser | Best-effort quota per origin | With persistence granted |
|---|---|---|
| Chromium | up to 60% of total disk | same |
| Firefox | the smaller of 10% of disk or 10 GiB (shared across the site's origins) | up to 50% of disk, max 8 TiB |
| Safari 17+ | about 60% of disk for browser apps; about 15% inside other apps' web views | same |

- **[V]** Chrome in Incognito gets roughly 5% of disk; private modes generally discard everything when the session ends. ([web.dev](https://web.dev/articles/storage-for-the-web))
- **[V]** Exceeding quota throws `QuotaExceededError`.
- **[I]** At ~40 MB worst case the app is far below every quota. Quota is not a design constraint.

### 5.3 Eviction and persistence

- **[V]** All browsers may evict best-effort origins, least recently used first, under storage pressure. Eviction removes **all** of an origin's data at once (IndexedDB and OPFS together). ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria))
- **[V]** Safari additionally deletes script-written storage for sites with no user interaction for 7 days of browser use, when cross-site tracking prevention is on (the default). Home Screen / Dock web apps are exempt. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria), [WebKit tracking prevention](https://webkit.org/tracking-prevention/))
- **[V]** `navigator.storage.persist()` asks for exemption from eviction. Firefox shows a prompt. Chromium and Safari decide silently by heuristics (Safari: for example whether the site is opened as a Home Screen web app). The promise resolves to `true` or `false`. ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist), [WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/))
- **[I]** In Safari a casual user who returns after more than a week can find the working copy gone. The working copy must never be the only place edits live; push the user to write to the card or export a zip.

### 5.4 Which one

- **[I]** **Use IndexedDB for the working copy.** Reasons: it is where the directory handle has to be stored anyway; a Bank save can be one transaction, which gives the per-Bank atomicity the card cannot; it works on the main thread in every browser including Safari before 26; the data is small structured text, so OPFS's byte-level performance buys nothing.
- **[I]** OPFS would only earn its place if the app wanted to reuse the same directory-handle code path against a private mirror of the card. That is a code-shape argument, and it brings the Safari pre-26 worker requirement with it.

---

## 6. Recommended approach

**[I]** throughout: this is a design recommendation built on the facts above.

1. **One storage interface, two implementations.** `CardAccess` with `listBanks`, `readBank`, `writeBank`, `deleteBank`. A *direct* implementation over `FileSystemDirectoryHandle`, and an *import/export* implementation over a file list in and a zip out. Choose by feature detection (`"showDirectoryPicker" in window`), never by user-agent string.
2. **Working copy in IndexedDB, always.** Open the card, read into the working copy, edit there, then write back explicitly. Call `navigator.storage.persist()` after the first meaningful edit. Keep the pre-write contents of each Bank as a backup record before overwriting it on the card.
3. **Direct mode (Chromium).**
   - `showDirectoryPicker({ mode: "readwrite", id: "constellation-card" })` from an "Open card" button. Also accept a dropped folder via `getAsFileSystemHandle()`.
   - Store the handle in IndexedDB. On return visits use `queryPermission`, then `requestPermission` behind a "Reconnect card" button.
   - Before any write, check the folder looks like a Constellation card (expected root files or at least one valid Bank). Refuse otherwise.
   - **Touch only names matching `^\d{3}$` (directories) and `^\d{2}\.TXT$` with 00-19 (files inside them).** Never create, modify or delete anything at the card root. Ignore everything else when reading, including dotfiles, `._*` and `*.crswap`.
   - Create names in exact upper case. Match case-insensitively when reading. Reuse the enumerated name when overwriting.
   - Write only changed Save Slots. For each: `createWritable()` (default `keepExistingData: false`), one `write()`, `close()`. Wrap in `try`/`finally` and call `abort()` on failure so the swap file is removed.
   - Write sequentially, not in parallel, to keep FAT updates simple and progress reportable.
   - After writing, read each file back and compare with what was intended. Report per-file results.
   - On opening a card, offer to clean up leftover `*.crswap` files inside Bank folders.
   - Finish with a clear instruction: **eject the card in the operating system before removing it.**
4. **Import/export mode (Firefox, Safari, anything else).**
   - Import: folder picker (`webkitdirectory`), folder drop (`webkitGetAsEntry`, looping `readEntries`), or a zip.
   - Export: a zip of complete Bank folders, with on-screen instructions for copying onto the card.
   - Say plainly that direct card writing needs a Chromium browser.
5. **Zip import/export in both modes**, as the way to share and back up Banks.

### Limits of this approach

- Direct card writing exists only in Chromium. Firefox and Safari users get a manual copy step, permanently.
- No Bank-level atomicity on the card. An interrupted write can leave a mixed Bank; the backup in the working copy is the recovery path.
- FAT can still be corrupted by removing the card without ejecting. The app cannot detect or prevent that.
- The app may leave or cause extra files in Bank folders (`.crswap` after a crash, `._*` on macOS). Harmlessness depends on firmware behaviour that has not been tested.
- A stored handle identifies a path, not a card. A wrong volume at the same path is caught only by the app's own sanity check.
- Permission must be re-granted with a click each session unless the user chooses "Allow on every visit" or installs the app; never persistent on Android.
- The working copy can be evicted (Safari's 7-day rule especially). It is a cache of work in progress, not an archive.
- On `echophon.github.io`, storage and file permissions are shared with other project sites on that origin.

---

## 7. Things considered and set aside

- **OPFS as the working copy**: no benefit at this data size, extra Safari constraint (section 5.4).
- **Renaming Bank folders with `move()`**: unreliable for user-visible directories (section 2.2).
- **A polyfill for the picker in Firefox**: a browser extension exists **[U]**, but requiring an extension defeats the point of a static site.
- **WebUSB / talking to the card reader directly**: out of scope for the ticket and would mean implementing FAT in the page.

---

## 8. Sources

Specs
- WHATWG File System Standard (last updated 2026-03-15): https://fs.spec.whatwg.org/
- WICG File System Access (draft community group report, 2025-10-10): https://wicg.github.io/file-system-access/

Vendor documentation
- Chrome: The File System Access API: https://developer.chrome.com/docs/capabilities/web-apis/file-system-access
- Chrome: Persistent permissions for the File System Access API (2024-01-09): https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api
- Chrome: API improvements for working with files (exclusive/siloed writers, 2023-10-09): https://developer.chrome.com/blog/new-dev-trial-for-multiple-readers-and-writers
- web.dev: Storage for the web: https://web.dev/articles/storage-for-the-web
- WebKit: Updates to Storage Policy (2023-08-10): https://webkit.org/blog/14403/updates-to-storage-policy/
- WebKit: Tracking Prevention: https://webkit.org/tracking-prevention/
- Microsoft: Naming Files, Paths, and Namespaces: https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file
- FatFs: Path Names: http://elm-chan.org/fsw/ff/doc/filename.html

MDN
- `showDirectoryPicker`: https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker
- `createWritable`: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable
- Origin private file system: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- Storage quotas and eviction criteria: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- `StorageManager.persist`: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- `webkitdirectory`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/webkitdirectory
- `webkitGetAsEntry`: https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry
- `getAsFileSystemHandle`: https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFileSystemHandle
- `readEntries`: https://developer.mozilla.org/en-US/docs/Web/API/FileSystemDirectoryReader/readEntries
- browser-compat-data (commit `d26d7c5`, 2026-10-02): https://github.com/mdn/browser-compat-data

Chromium source (`main`, read 2026-10-03)
- `chrome/browser/file_system_access/chrome_file_system_access_permission_context.cc`
- `content/browser/file_system_access/file_system_access_file_handle_impl.{cc,h}`
- `content/browser/file_system_access/file_system_access_file_writer_impl.{cc,h}`
- `content/browser/file_system_access/file_system_access_safe_move_helper.cc`
- `storage/browser/file_system/native_file_util.cc`
- `base/files/file_util_posix.cc`, `base/files/file_util_win.cc`
- `components/services/quarantine/quarantine_mac.mm`

Standards positions
- Mozilla (negative): https://github.com/mozilla/standards-positions/issues/154
- WebKit (oppose): https://github.com/WebKit/standards-positions/issues/28

---

## 9. Open questions that need a real card and module

1. Does Chrome allow picking the **root** of the mounted card on macOS, Windows and Linux? (Expected yes, section 2.1.)
2. After a Chrome write on macOS, are there `._NN.TXT` files in the Bank folder? Does the module ignore them?
3. Does the module tolerate a stray `NN.TXT.crswap` in a Bank folder?
4. Does the module read a Save Slot whose name was created in lower case, or with a long-filename entry? (The app should never create one; this sets how strict the reader of foreign cards must be.)
5. What does a stored handle do when the card is absent, and when a different volume is mounted at the same path?
6. How long does writing one Bank and ten Banks take on a typical card, given the per-file Safe Browsing check?
7. What do Finder and Explorer do when the exported zip's Bank folders are copied over existing ones?
