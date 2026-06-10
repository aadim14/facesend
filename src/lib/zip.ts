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

/** Deduplicate filenames by appending -2, -3, ... before the extension. */
export function uniqueFilenames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count === 0) return name;
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return `${name}-${count + 1}`;
    return `${name.slice(0, dot)}-${count + 1}${name.slice(dot)}`;
  });
}

// ---- browser download ----

export interface ZipEntry {
  name: string;
  blob: Blob;
}

interface SaveFilePickerWindow extends Window {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<{
    createWritable: () => Promise<{
      write: (chunk: unknown) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

/**
 * Zip the given photos (store-only — JPEGs don't recompress) and save as
 * `<person>-photos.zip`. Streams to disk where the File System Access API
 * exists; falls back to a Blob download elsewhere.
 * Returns false when the user cancelled the save dialog.
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
  const zipName = `${sanitizeFilename(personName)}-photos.zip`;

  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: zipName,
        types: [
          { description: "ZIP archive", accept: { "application/zip": [".zip"] } },
        ],
      });
      const writable = await handle.createWritable();
      const response = downloadZip(files);
      await response.body?.pipeTo(
        new WritableStream({
          write: (chunk) => writable.write(chunk),
          close: () => writable.close(),
        })
      );
      return true;
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return false; // user cancelled
      // fall through to the Blob path on any other picker failure
    }
  }

  const blob = await downloadZip(files).blob();
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
