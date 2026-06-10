import type { FaceBox } from "@/types";

// ---- pure geometry (unit-tested) ----

export interface FittedSize {
  width: number;
  height: number;
  /** fitted / original. Never above 1 — we never upscale. */
  scale: number;
}

/** Fit dimensions within a max long edge, preserving aspect ratio, never upscaling. */
export function fitWithin(
  width: number,
  height: number,
  maxLongEdge: number
): FittedSize {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) {
    return { width, height, scale: 1 };
  }
  const scale = maxLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** Scale a box by a factor (e.g. map a detection from downscaled space back to the original). */
export function scaleBox(box: FaceBox, factor: number): FaceBox {
  return {
    x: box.x * factor,
    y: box.y * factor,
    w: box.w * factor,
    h: box.h * factor,
  };
}

/** Expand a box by a margin ratio on every side, clamped to the image, integer output. */
export function expandAndClampBox(
  box: FaceBox,
  marginRatio: number,
  imageWidth: number,
  imageHeight: number
): FaceBox {
  const mx = box.w * marginRatio;
  const my = box.h * marginRatio;
  const x = Math.max(0, Math.floor(box.x - mx));
  const y = Math.max(0, Math.floor(box.y - my));
  const right = Math.min(imageWidth, Math.ceil(box.x + box.w + mx));
  const bottom = Math.min(imageHeight, Math.ceil(box.y + box.h + my));
  return {
    x,
    y,
    w: Math.max(1, right - x),
    h: Math.max(1, bottom - y),
  };
}

// ---- browser-only helpers ----

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = "image/jpeg",
  quality = 0.85
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      type,
      quality
    );
  });
}

export interface ThumbnailResult {
  thumbBlob: Blob;
  width: number;
  height: number;
}

/**
 * Decode a photo, return its original dimensions plus a JPEG thumbnail.
 * Throws if the browser cannot decode the file (e.g. HEIC outside Safari).
 */
export async function makeThumbnail(
  blob: Blob,
  maxEdge = 480
): Promise<ThumbnailResult> {
  const bitmap = await createImageBitmap(blob);
  try {
    const fitted = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const canvas = document.createElement("canvas");
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.drawImage(bitmap, 0, 0, fitted.width, fitted.height);
    const thumbBlob = await canvasToBlob(canvas, "image/jpeg", 0.8);
    return { thumbBlob, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/** Draw a region of a bitmap to a canvas, output capped to a max long edge. */
export function cropToCanvas(
  bitmap: ImageBitmap,
  box: FaceBox,
  maxEdge = 320
): HTMLCanvasElement {
  const fitted = fitWithin(box.w, box.h, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(
    bitmap,
    box.x,
    box.y,
    box.w,
    box.h,
    0,
    0,
    fitted.width,
    fitted.height
  );
  return canvas;
}

/** Draw a region of a bitmap to a JPEG Blob, output capped to a max long edge. */
export async function cropToBlob(
  bitmap: ImageBitmap,
  box: FaceBox,
  maxEdge = 320
): Promise<Blob> {
  return canvasToBlob(cropToCanvas(bitmap, box, maxEdge), "image/jpeg", 0.85);
}
