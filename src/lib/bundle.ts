import type { PhotoRecord } from "@/types";
import { sanitizeFilename, uniqueFilenames } from "@/lib/zip";
import { canvasToBlob, fitWithin } from "@/lib/images";

/**
 * A person's deliverable is a self-contained portable gallery: their photos
 * plus an `index.html` that renders them offline on any device, with no
 * FaceSend install and no network. The whole thing is zipped into one file
 * and handed to the OS share sheet (see lib/share.ts) — it must be a single
 * zip, not loose files, because Web Share flattens a file array (relative
 * `photos/…` refs would break) and iOS type-routes loose files.
 */

export type BundleSize = "original" | "phone-sized";

/** Long edge for the phone-sized export — plenty for viewing, a fraction of the bytes. */
const PHONE_LONG_EDGE = 1600;

export interface BundleFile {
  /** Path inside the zip, e.g. "index.html" or "photos/ana.jpg". */
  name: string;
  blob: Blob;
}

export interface Bundle {
  files: BundleFile[];
  /** Rough total size of the zip's contents, for the size-vs-channel warning. */
  estBytes: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Map photos to unique, sanitized `photos/<name>.jpg` paths. Pure — the same
 * sanitation/dedup the zip download uses, so a person named `Ana / O'Brien?`
 * and duplicate source names both stay safe.
 */
export function bundlePhotoNames(photos: PhotoRecord[]): string[] {
  const base = uniqueFilenames(
    photos.map((p) => sanitizeFilename(p.name, "photo"))
  );
  return base.map((name) => `photos/${name}`);
}

/**
 * The offline gallery page: inlined CSS + a few lines of vanilla JS for a
 * responsive grid and a tap-to-open lightbox. No external URLs — it opens
 * from `file://` with the network off. `photoPaths` are relative to the page.
 */
export function buildGalleryHtml(
  personName: string,
  photoPaths: string[]
): string {
  const title = personName.trim() ? `Photos of ${personName.trim()}` : "Your photos";
  const heading = escapeHtml(title);
  const count = photoPaths.length;
  const tiles = photoPaths
    .map(
      (path) =>
        `<button class="tile" data-full="${escapeHtml(path)}"><img loading="lazy" src="${escapeHtml(path)}" alt=""></button>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #171717; }
  @media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #ededed; } }
  header { padding: 24px 16px 8px; text-align: center; }
  h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
  .count { margin: 4px 0 0; font-size: 13px; opacity: 0.55; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 6px; padding: 16px; max-width: 1100px; margin: 0 auto; }
  .tile { padding: 0; border: 0; background: none; cursor: pointer; aspect-ratio: 1; }
  .tile img { width: 100%; height: 100%; object-fit: cover; border-radius: 10px; display: block; }
  .lightbox { position: fixed; inset: 0; background: rgba(0,0,0,0.9); display: none; align-items: center; justify-content: center; padding: 16px; }
  .lightbox.open { display: flex; }
  .lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; }
  footer { padding: 24px 16px 40px; text-align: center; font-size: 12px; opacity: 0.4; }
</style>
</head>
<body>
<header>
  <h1>${heading}</h1>
  <p class="count">${count} photo${count === 1 ? "" : "s"}</p>
</header>
<main class="grid">${tiles}</main>
<div class="lightbox" id="lb"><img alt=""></div>
<footer>Made with FaceSend · your photos, on your device</footer>
<script>
  (function () {
    var lb = document.getElementById("lb");
    var img = lb.querySelector("img");
    document.querySelectorAll(".tile").forEach(function (t) {
      t.addEventListener("click", function () {
        img.src = t.getAttribute("data-full");
        lb.classList.add("open");
      });
    });
    lb.addEventListener("click", function () {
      lb.classList.remove("open");
      img.removeAttribute("src");
    });
  })();
</script>
</body>
</html>`;
}

/**
 * Downscale a photo to the phone-sized long edge. Browser-only (canvas).
 * Returns the original blob unchanged if it's already small enough or if
 * decoding fails — the bundle must never lose a photo to a resize error.
 */
async function phoneSized(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const fitted = fitWithin(bitmap.width, bitmap.height, PHONE_LONG_EDGE);
      if (fitted.scale === 1) return blob;
      const canvas = document.createElement("canvas");
      canvas.width = fitted.width;
      canvas.height = fitted.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return blob;
      ctx.drawImage(bitmap, 0, 0, fitted.width, fitted.height);
      return await canvasToBlob(canvas, "image/jpeg", 0.82);
    } finally {
      bitmap.close();
    }
  } catch {
    return blob;
  }
}

/**
 * Assemble one person's portable gallery bundle. The `original` size path is
 * pure data assembly (unit-tested); `phone-sized` additionally re-encodes
 * each photo via canvas (browser-only, verified in the app).
 */
export async function buildBundle(
  personName: string,
  photos: PhotoRecord[],
  opts: { size?: BundleSize } = {}
): Promise<Bundle> {
  // An empty bundle is never something the host wants to hand someone: it
  // produces a zip whose gallery reads "0 photos", and the caller had no way
  // to tell that apart from a real delivery, so the card cheerfully showed
  // "Downloaded ✓". Fail loudly instead of shipping an empty box.
  if (photos.length === 0) {
    throw new Error("Cannot build a gallery with no photos");
  }

  const size = opts.size ?? "original";
  const names = bundlePhotoNames(photos);

  const photoBlobs =
    size === "phone-sized"
      ? await Promise.all(photos.map((p) => phoneSized(p.blob)))
      : photos.map((p) => p.blob);

  const html = buildGalleryHtml(personName, names);
  const htmlBlob = new Blob([html], { type: "text/html" });

  const files: BundleFile[] = [
    { name: "index.html", blob: htmlBlob },
    ...photos.map((_, i) => ({ name: names[i], blob: photoBlobs[i] })),
  ];
  const estBytes = files.reduce((sum, f) => sum + f.blob.size, 0);

  return { files, estBytes };
}
