import type { PhotoRecord } from "@/types";
import { buildBundle, type BundleSize } from "@/lib/bundle";
import { sanitizeFilename, saveZipBlob, uniqueFilenames } from "@/lib/zip";

/**
 * Outcome of a delivery attempt.
 * - `shared`         — the OS share sheet confirmed; the only outcome that counts as delivered.
 * - `cancelled`      — the host dismissed the share sheet; no-op.
 * - `failed`         — the share threw; surface the error, don't pretend success.
 * - `downloaded-zip` — no share sheet (desktop), so the gallery zip downloaded; the host still sends it.
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
 * Whether this browser can hand files to the native share sheet (mobile,
 * desktop Safari). Chrome/Brave/Arc on macOS report false and download instead.
 * Drives the honest per-device action label (Share vs Download).
 */
export function fileShareSupported(): boolean {
  return canShareFiles([new File(["x"], "probe.txt", { type: "text/plain" })]);
}

/**
 * Build one person's gallery as a single `.zip` File — the deliverable.
 * MUST be one zip: Web Share flattens a loose-file array (breaking the
 * gallery's relative photo paths) and iOS type-routes the images away.
 *
 * Call this AHEAD of the Send click and cache the result. The share sheet
 * needs transient user activation, which is consumed by this async build —
 * so the click handler must call {@link deliverGallery} with an already-built
 * File, never build inside the click.
 */
export async function prepareGalleryFile(
  personName: string,
  photos: PhotoRecord[],
  size: BundleSize = "original"
): Promise<File> {
  const name = personName.trim();
  const bundle = await buildBundle(name, photos, { size });
  const { downloadZip } = await import("client-zip");
  const blob = await downloadZip(
    bundle.files.map((f) => ({ name: f.name, input: f.blob }))
  ).blob();
  return new File([blob], `${sanitizeFilename(name || "photos")}-gallery.zip`, {
    type: "application/zip",
  });
}

/**
 * Deliver an already-prepared gallery File. Call this synchronously from the
 * Send click (no awaits before it) so the share sheet keeps its activation.
 * Mobile/Safari → native share sheet; desktop → reliable zip download.
 */
export async function deliverGallery(
  personName: string,
  file: File
): Promise<ShareResult> {
  const name = personName.trim();
  const title = name ? `Photos of ${name}` : "Your photos";
  if (canShareFiles([file])) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return "cancelled";
      return "failed";
    }
  }
  saveZipBlob(file.name, file);
  return "downloaded-zip";
}

/**
 * Convenience: prepare + deliver in one call. Prefer prepare-ahead +
 * {@link deliverGallery} on click where the mobile share sheet matters, since
 * the build here consumes activation. Fine for desktop (download needs none).
 */
export async function sharePersonGallery(
  personName: string,
  photos: PhotoRecord[],
  opts: { size?: BundleSize } = {}
): Promise<ShareResult> {
  const file = await prepareGalleryFile(personName, photos, opts.size ?? "original");
  return deliverGallery(personName, file);
}

/**
 * Separate "save photos to camera roll" action: shares the loose image files
 * (no gallery) so a recipient gets the pictures straight into their roll.
 * Large sets fall back to the gallery. Only meaningful where file-share works.
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
      (p, i) => new File([p.blob], names[i], { type: p.blob.type || "image/jpeg" })
    );
    if (canShareFiles(files)) {
      try {
        await navigator.share({ files, title });
        return "shared";
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError") return "cancelled";
        return "failed";
      }
    }
  }
  return sharePersonGallery(name, photos);
}
