import type { FaceBox } from "@/types";
import {
  cropToBlob,
  expandAndClampBox,
  fitWithin,
  scaleBox,
} from "@/lib/images";
import { loadFaceApi } from "@/lib/face/models";

/** Long edge the photo is downscaled to before inference. */
const DETECT_MAX_EDGE = 640;
const MIN_CONFIDENCE = 0.4;
const CROP_MARGIN = 0.25;

export interface DetectedFace {
  descriptor: Float32Array;
  /** In original-image coordinates. */
  box: FaceBox;
  cropBlob: Blob;
}

/**
 * Run detection → landmarks → descriptors for one photo.
 * Returns one entry per face; boxes and crops are in original resolution.
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

    const results = await faceapi
      .detectAllFaces(
        canvas,
        new faceapi.SsdMobilenetv1Options({ minConfidence: MIN_CONFIDENCE })
      )
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
      const cropBox = expandAndClampBox(
        originalBox,
        CROP_MARGIN,
        bitmap.width,
        bitmap.height
      );
      const cropBlob = await cropToBlob(bitmap, cropBox);
      faces.push({
        descriptor: result.descriptor,
        box: cropBox,
        cropBlob,
      });
    }
    return faces;
  } finally {
    bitmap.close();
  }
}
