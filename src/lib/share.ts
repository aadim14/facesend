import type { PhotoRecord } from "@/types";
import { buildBundle, type BundleSize } from "@/lib/bundle";
import { sanitizeFilename, saveZipBlob, uniqueFilenames } from "@/lib/zip";

/**
 * Outcome of a delivery attempt.
 * - `shared`         — the OS share sheet confirmed; this is the only outcome that counts as delivered.
 * - `cancelled`      — the host dismissed the share sheet or save dialog; no-op.
 * - `failed`         — the share threw; surface the error, do not silently pretend success.
 * - `downloaded-zip` — no file-share support (desktop), so the gallery zip downloaded instead; the host still has to send it.
 */
export type ShareResult = "shared" | "cancelled" | "failed" | "downloaded-zip";

/** iMessage/AirDrop degrade past a couple dozen loose attachments. */
const MAX_LOOSE_FILES = 20;

function canShareFiles(files: File[]): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files })
  );
}

/**
 * Whether this browser can hand files to the native share sheet at all.
 * On desktop this is essentially Safari-only — Chrome/Brave/Arc on macOS
 * report false and fall back to a zip download.
 */
export function fileShareSupported(): boolean {
  return canShareFiles([new File(["x"], "probe.txt", { type: "text/plain" })]);
}

/** "shared" | "cancelled" | "failed" — null-free discriminated share attempt. */
async function tryShareFiles(files: File[], title: string): Promise<ShareResult> {
  try {
    await navigator.share({ files, title });
    return "shared";
  } catch (error) {
    if ((error as DOMException)?.name === "AbortError") return "cancelled";
    return "failed";
  }
}

/** Zip a person's gallery bundle into one `.zip` File. */
async function bundleZipFile(
  personName: string,
  photos: PhotoRecord[],
  size: BundleSize
): Promise<File> {
  const bundle = await buildBundle(personName, photos, { size });
  const { downloadZip } = await import("client-zip");
  const blob = await downloadZip(
    bundle.files.map((f) => ({ name: f.name, input: f.blob }))
  ).blob();
  return new File(
    [blob],
    `${sanitizeFilename(personName || "photos")}-gallery.zip`,
    { type: "application/zip" }
  );
}

/**
 * Deliver one person's photos as a self-contained gallery. The gallery is
 * always a single `.zip` shared through the OS share sheet (never loose
 * files — Web Share flattens a file array, which would break the gallery's
 * relative photo paths and type-route the images away on iOS). Where the
 * browser can't share files (desktop), the same zip downloads instead.
 *
 * Must be called from a user gesture — navigator.share needs transient
 * activation, and only works in secure contexts (https / localhost).
 */
export async function sharePersonGallery(
  personName: string,
  photos: PhotoRecord[],
  opts: { size?: BundleSize } = {}
): Promise<ShareResult> {
  const name = personName.trim();
  const title = name ? `Photos of ${name}` : "Your photos";
  const zipFile = await bundleZipFile(name, photos, opts.size ?? "original");

  if (canShareFiles([zipFile])) {
    return tryShareFiles([zipFile], title);
  }
  // Desktop / no file-share: download the same gallery zip. Not "delivered" —
  // the host still has to send it, and the UI says so.
  const saved = await saveZipBlob(zipFile.name, zipFile);
  return saved ? "downloaded-zip" : "cancelled";
}

/**
 * Separate "save photos to camera roll" action: shares the loose image files
 * (no gallery) for recipients who just want the pictures in their roll. Large
 * sets fall back to the gallery zip. Returns "downloaded-zip" only when the
 * browser can't share files at all.
 */
export async function sharePhotosToCameraRoll(
  personName: string,
  photos: PhotoRecord[]
): Promise<ShareResult> {
  const name = personName.trim();
  const title = name ? `Photos of ${name}` : "Your photos";

  if (photos.length <= MAX_LOOSE_FILES) {
    const names = uniqueFilenames(
      photos.map((p) => sanitizeFilename(p.name, "photo"))
    );
    const files = photos.map(
      (p, i) =>
        new File([p.blob], names[i], { type: p.blob.type || "image/jpeg" })
    );
    if (canShareFiles(files)) return tryShareFiles(files, title);
  }
  // Too many loose files, or no loose-file support: fall back to the gallery zip.
  return sharePersonGallery(name, photos);
}
