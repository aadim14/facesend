import type { PhotoRecord } from "@/types";
import {
  downloadAllAsZip,
  sanitizeFilename,
  uniqueFilenames,
  type ZipEntry,
} from "@/lib/zip";

export type ShareOutcome = "shared" | "downloaded" | "cancelled";

/**
 * iMessage and most share targets degrade past a couple dozen attachments;
 * bigger sets go through the sheet as a single zip instead.
 */
const MAX_LOOSE_FILES = 20;

function photoFiles(photos: PhotoRecord[]): File[] {
  const names = uniqueFilenames(
    photos.map((p) => sanitizeFilename(p.name, "photo"))
  );
  return photos.map(
    (p, i) => new File([p.blob], names[i], { type: p.blob.type || "image/jpeg" })
  );
}

function canShareFiles(files: File[]): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files })
  );
}

/** null = share unavailable/failed in a way the caller should fall back from. */
async function tryShare(files: File[], title: string): Promise<ShareOutcome | null> {
  try {
    await navigator.share({ files, title });
    return "shared";
  } catch (error) {
    if ((error as DOMException)?.name === "AbortError") return "cancelled";
    return null;
  }
}

/**
 * Share one person's photos through the native share sheet (iMessage,
 * AirDrop, WhatsApp, …). Small sets go as image files, large sets as one
 * zip. Where no share sheet exists (desktop), saves a zip instead.
 *
 * Must be called from a user gesture — navigator.share requires transient
 * activation, and only works in secure contexts (https / localhost).
 */
export async function sharePersonPhotos(
  personName: string,
  photos: PhotoRecord[]
): Promise<ShareOutcome> {
  const name = personName.trim();
  const title = name ? `Photos of ${name}` : "Your photos";

  if (photos.length <= MAX_LOOSE_FILES) {
    const files = photoFiles(photos);
    if (canShareFiles(files)) {
      const outcome = await tryShare(files, title);
      if (outcome) return outcome;
    }
  } else {
    const { downloadZip } = await import("client-zip");
    const names = uniqueFilenames(
      photos.map((p) => sanitizeFilename(p.name, "photo"))
    );
    const blob = await downloadZip(
      photos.map((p, i) => ({ name: names[i], input: p.blob }))
    ).blob();
    const zipFile = new File(
      [blob],
      `${sanitizeFilename(name || "person")}-photos.zip`,
      { type: "application/zip" }
    );
    if (canShareFiles([zipFile])) {
      const outcome = await tryShare([zipFile], title);
      if (outcome) return outcome;
    }
  }

  const entries: ZipEntry[] = photos.map((p) => ({ name: p.name, blob: p.blob }));
  const saved = await downloadAllAsZip(name || "person", entries);
  return saved ? "downloaded" : "cancelled";
}
