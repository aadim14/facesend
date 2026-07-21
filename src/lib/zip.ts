// ---- pure helpers (unit-tested) ----

/** Make a string safe for filenames across platforms. */
export function sanitizeFilename(name: string, fallback = "person"): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "-");
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Case- and unicode-insensitive key for filename collisions.
 *
 * NFC matters on macOS: the Photos app writes `café.jpg` decomposed (NFD)
 * while most other sources write it composed. They are different JS strings
 * but the same file on APFS, so without normalizing they'd both claim the
 * same zip entry.
 */
function collisionKey(name: string): string {
  return name.normalize("NFC").toLowerCase();
}

/**
 * Deduplicate filenames by appending -2, -3, ... before the extension.
 *
 * Every name we hand out is claimed, including the generated ones — a set of
 * originals like `a.jpg, a.jpg, a-2.jpg` would otherwise mint `a-2.jpg` for
 * the second `a.jpg` and then hand the real `a-2.jpg` the same entry name,
 * silently dropping one photo from the person's gallery on extraction.
 */
export function uniqueFilenames(names: string[]): string[] {
  const claimed = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const [stem, ext] =
      dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];

    let candidate = name;
    let n = 1;
    while (claimed.has(collisionKey(candidate))) {
      candidate = `${stem}-${++n}${ext}`;
    }
    claimed.add(collisionKey(candidate));
    return candidate;
  });
}

// ---- browser download ----

export interface ZipEntry {
  name: string;
  blob: Blob;
}

/**
 * Save a ready-made zip Blob to disk as `zipName` via an anchor download.
 *
 * Deliberately NOT using `showSaveFilePicker`: that API requires transient
 * user activation, which is gone by the time we've built and zipped the
 * gallery — it then throws AbortError, which is indistinguishable from a real
 * cancel and made "Send" silently do nothing. An anchor download needs no
 * activation and works in every browser, so delivery is reliable. Always
 * returns true (the download is initiated synchronously; there is no cancel).
 */
export function saveZipBlob(zipName: string, blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = zipName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

/**
 * Zip the given photos (store-only — JPEGs don't recompress) and save as
 * `<person>-photos.zip`. Returns false when the user cancelled the save dialog.
 */
export async function downloadAllAsZip(
  personName: string,
  entries: ZipEntry[]
): Promise<boolean> {
  const { downloadZip } = await import("client-zip");
  const names = uniqueFilenames(entries.map((e) => sanitizeFilename(e.name, "photo")));
  const files = entries.map((entry, i) => ({
    name: names[i],
    input: entry.blob,
  }));
  const blob = await downloadZip(files).blob();
  return saveZipBlob(`${sanitizeFilename(personName)}-photos.zip`, blob);
}
