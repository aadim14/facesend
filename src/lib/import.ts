import { addPhoto, requestPersistence, StorageFullError } from "@/lib/db";
import { newId } from "@/lib/id";
import { makeThumbnail } from "@/lib/images";

/** Hard ceiling on photos held in one event. */
export const MAX_PHOTOS = 300;

export interface ImportProgress {
  done: number;
  total: number;
}

export interface ImportOutcome {
  imported: number;
  /** Human-readable notes about what was dropped and why. */
  notices: string[];
  /** Set when storage filled mid-import — the remaining photos were not attempted. */
  storageFull: boolean;
}

/**
 * Import image files into the photo store.
 *
 * Shared by the first-run upload screen and "add more photos" on the review
 * screen, so the two can't drift apart on limits, filtering or error handling.
 *
 * `budget` is how many more photos this event can hold, which is what makes
 * the second entry point safe: adding to an event already holding 280 photos
 * must not blow past the cap.
 */
export async function importPhotos(
  fileList: FileList | File[],
  opts: {
    budget?: number;
    onProgress?: (progress: ImportProgress) => void;
  } = {}
): Promise<ImportOutcome> {
  const budget = opts.budget ?? MAX_PHOTOS;
  const all = Array.from(fileList);

  // Photos.app and some Android pickers hand over HEIC/HEIF with an empty
  // `type`, so an extension check has to back up the MIME check or those
  // files are reported as "not photos" before anything even tries to read
  // them.
  const looksLikeImage = (f: File) =>
    f.type.startsWith("image/") ||
    /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|tiff?)$/i.test(f.name);

  const images = all.filter(looksLikeImage);
  const kept = images.slice(0, Math.max(0, budget));

  const notices: string[] = [];
  if (all.length - images.length > 0) {
    notices.push(`${all.length - images.length} non-image file(s) skipped`);
  }
  if (images.length > kept.length) {
    notices.push(
      kept.length === 0
        ? `already at the ${MAX_PHOTOS}-photo limit`
        : `keeping ${kept.length} of ${images.length} photos (${MAX_PHOTOS} max)`
    );
  }

  if (kept.length === 0) {
    return { imported: 0, notices, storageFull: false };
  }

  // Ask before writing, not after: a non-persistent origin is both evictable
  // and given a smaller effective quota, so requesting it once the photos are
  // already on disk is too late to help.
  await requestPersistence();

  opts.onProgress?.({ done: 0, total: kept.length });

  let imported = 0;
  let unreadable = 0;
  let storageFull = false;

  for (const file of kept) {
    try {
      const { thumbBlob, width, height } = await makeThumbnail(file);
      await addPhoto({
        id: newId(),
        name: file.name,
        blob: file,
        thumbBlob,
        width,
        height,
        faceCount: -1,
      });
      imported++;
    } catch (err) {
      if (err instanceof StorageFullError) {
        // Every remaining write fails the same way; stop rather than grind
        // through 200 more photos producing the same error.
        storageFull = true;
        break;
      }
      console.warn(`[facesend] couldn't import ${file.name}:`, err);
      unreadable++;
    }
    opts.onProgress?.({ done: imported + unreadable, total: kept.length });
  }

  if (unreadable > 0) {
    notices.push(`${unreadable} photo(s) couldn't be read and were skipped`);
  }
  if (storageFull) {
    notices.push(
      `storage filled up — imported ${imported} of ${kept.length}. Free up space or start over.`
    );
  }

  return { imported, notices, storageFull };
}
