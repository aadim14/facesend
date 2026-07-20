import type { PhotoRecord } from "@/types";
import { buildBundle, type BundleSize } from "@/lib/bundle";
import { sanitizeFilename, saveZipBlob } from "@/lib/zip";

/**
 * Outcome of a delivery attempt.
 * - `shared`         — handed to the OS share sheet and it resolved.
 * - `cancelled`      — the host dismissed the share sheet; no-op, nothing downloaded.
 * - `downloaded-zip` — no share sheet, or the share failed; the gallery zip downloaded instead.
 *
 * There is deliberately no `failed`: every path that isn't a user cancellation
 * ends with the host holding the file. See {@link deliverGallery}.
 */
export type ShareResult = "shared" | "cancelled" | "downloaded-zip";

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
 *
 * Probes with a zip, not a text file: Chrome on Android gates canShare on a
 * MIME/extension allowlist, so `text/plain` passing says nothing about the
 * `application/zip` we actually ship. Probing with the wrong type made the
 * button promise "Share their photos" on devices that would then refuse the
 * real payload.
 */
export function fileShareSupported(): boolean {
  return canShareFiles([
    new File([new Blob([])], "probe.zip", { type: "application/zip" }),
  ]);
}

/**
 * Whether a rejected navigator.share() was the host backing out.
 *
 * `AbortError` alone isn't enough: Chrome raises it both for a dismissed sheet
 * and for internal share-service failures, and treating every AbortError as a
 * cancellation turned real failures into silent no-ops — no share, no
 * download, no error. The message is the only thing that separates them, so
 * anything that doesn't clearly read as a dismissal is treated as a failure
 * and falls back to a download. Erring that way costs the host an unwanted
 * file; erring the other way loses the photos entirely.
 */
function isUserCancellation(error: unknown): boolean {
  const e = error as DOMException | undefined;
  return (
    e?.name === "AbortError" && /cancel|abort|dismiss/i.test(e.message ?? "")
  );
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
 *
 * A share that fails for any reason other than the user cancelling (lost
 * activation, file too large, target rejects it) falls back to a download —
 * the host always gets the gallery, never a dead "couldn't send".
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
      if (isUserCancellation(error)) return "cancelled";
      saveZipBlob(file.name, file); // fall back so delivery never dead-ends
      return "downloaded-zip";
    }
  }
  saveZipBlob(file.name, file);
  return "downloaded-zip";
}

/** Download a prepared gallery File directly (no share sheet, no activation needed). */
export function downloadGallery(file: File): void {
  saveZipBlob(file.name, file);
}
