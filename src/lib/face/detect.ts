import type { FaceBox } from "@/types";
import {
  canvasToBlob,
  cropToCanvas,
  expandAndClampBox,
  fitWithin,
  scaleBox,
} from "@/lib/images";
import { loadFaceApi } from "@/lib/face/models";

/** Long edge the photo is downscaled to for the detection pass. */
const DETECT_MAX_EDGE = 640;
const MIN_CONFIDENCE = 0.5;
const CROP_MARGIN = 0.25;
/**
 * Faces smaller than this (short side, original pixels) are dropped —
 * they're background strangers whose descriptors are too noisy to cluster
 * and are the main cause of wrong merges.
 */
const MIN_FACE_PX = 48;
/** High-res chip size used to recompute descriptors and store face crops. */
const CHIP_MAX_EDGE = 400;

export interface DetectedFace {
  descriptor: Float32Array;
  /** In original-image coordinates. */
  box: FaceBox;
  cropBlob: Blob;
}

/**
 * Two-stage pipeline per photo:
 * 1. Detect faces on a ≤640px frame (fast).
 * 2. For each face, cut a high-resolution chip from the ORIGINAL bitmap and
 *    recompute landmarks + descriptor on it. Descriptors taken from the
 *    downscaled frame are weak for small faces — visually-similar strangers
 *    end up within merge distance of each other. The chip pass restores the
 *    resolution the recognition net needs.
 */
export async function detectFacesInPhoto(blob: Blob): Promise<DetectedFace[]> {
  const faceapi = await loadFaceApi();
  const bitmap = await createImageBitmap(blob);
  try {
    const fitted = fitWithin(bitmap.width, bitmap.height, DETECT_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = fitted.width;
    canvas.height = fitted.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    ctx.drawImage(bitmap, 0, 0, fitted.width, fitted.height);

    const options = new faceapi.SsdMobilenetv1Options({
      minConfidence: MIN_CONFIDENCE,
    });
    const results = await faceapi
      .detectAllFaces(canvas, options)
      .withFaceLandmarks()
      .withFaceDescriptors();

    const faces: DetectedFace[] = [];
    for (const result of results) {
      const detectionBox = result.detection.box;
      const originalBox = scaleBox(
        {
          x: detectionBox.x,
          y: detectionBox.y,
          w: detectionBox.width,
          h: detectionBox.height,
        },
        1 / fitted.scale
      );
      if (Math.min(originalBox.w, originalBox.h) < MIN_FACE_PX) continue;

      const cropBox = expandAndClampBox(
        originalBox,
        CROP_MARGIN,
        bitmap.width,
        bitmap.height
      );
      const chip = cropToCanvas(bitmap, cropBox, CHIP_MAX_EDGE);

      let descriptor = result.descriptor;
      try {
        const refined = await faceapi
          .detectSingleFace(chip, options)
          .withFaceLandmarks()
          .withFaceDescriptor();
        if (refined) descriptor = refined.descriptor;
      } catch {
        // keep the full-frame descriptor if the chip pass fails
      }

      const cropBlob = await canvasToBlob(chip);
      faces.push({ descriptor, box: cropBox, cropBlob });
    }
    return faces;
  } finally {
    bitmap.close();
  }
}
