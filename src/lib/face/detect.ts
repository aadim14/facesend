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
/**
 * High-res chip size used to compute descriptors and store face crops.
 *
 * The recognition net resizes its input to 150×150 internally, and the crop
 * is displayed at 56 CSS px, so anything much above ~256 is pixels we draw,
 * encode and store without any of them reaching either consumer.
 */
const CHIP_MAX_EDGE = 256;
/**
 * Confidence floor for the second pass. Far below the first pass on purpose:
 * we already know this region is a face, and SSD MobileNet is trained on
 * faces with surrounding context, so it frequently fails to re-detect a
 * tightly cropped one at the normal threshold. This pass is only trying to
 * land landmarks for alignment, not decide whether there's a face.
 */
const CHIP_MIN_CONFIDENCE = 0.15;

export interface DetectedFace {
  descriptor: Float32Array;
  /** In original-image coordinates. */
  box: FaceBox;
  cropBlob: Blob;
}

/**
 * Two-stage pipeline per photo:
 * 1. Locate faces on a ≤640px frame — boxes only, no landmarks, no
 *    descriptors. Stage 1 previously computed landmarks and a descriptor for
 *    every face and stage 2 then overwrote essentially all of them, so a
 *    six-person group photo paid for seven detections where one was needed
 *    plus six descriptors that were thrown away.
 * 2. For each face above the size floor, cut a chip from the ORIGINAL bitmap
 *    and compute the descriptor there. Descriptors taken from the downscaled
 *    frame are weak for small faces — visually-similar strangers end up
 *    within merge distance of each other.
 *
 * Every descriptor now comes from a chip. Previously, when the chip pass
 * failed to re-detect the face, that one face silently kept its
 * low-resolution full-frame descriptor — so descriptors from two different
 * resolutions shared one embedding space and one 0.4 threshold, inflating
 * distances between images of the same person. Nothing counted how often that
 * happened, which made it invisible in practice.
 */
type FaceApi = Awaited<ReturnType<typeof loadFaceApi>>;

/**
 * Descriptor for one already-cropped face.
 *
 * Prefers a landmark-aligned pass, because alignment measurably tightens
 * same-person distances. But the chip *is* the face, so if detection can't
 * find one in it there is still a descriptor to compute — falling back to
 * computeFaceDescriptor keeps every face on the same footing rather than
 * silently leaving one on a lower-resolution embedding.
 */
async function describeChip(
  faceapi: FaceApi,
  chip: HTMLCanvasElement,
  chipOptions: InstanceType<FaceApi["SsdMobilenetv1Options"]>
): Promise<Float32Array | null> {
  try {
    const aligned = await faceapi
      .detectSingleFace(chip, chipOptions)
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (aligned) return aligned.descriptor;
  } catch {
    // fall through to the unaligned descriptor
  }
  try {
    const raw = await faceapi.computeFaceDescriptor(chip);
    return Array.isArray(raw) ? (raw[0] ?? null) : raw;
  } catch {
    return null;
  }
}

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
    // Boxes only — everything expensive happens per surviving face below.
    const detections = await faceapi.detectAllFaces(canvas, options);

    const chipOptions = new faceapi.SsdMobilenetv1Options({
      minConfidence: CHIP_MIN_CONFIDENCE,
    });

    const faces: DetectedFace[] = [];
    for (const detection of detections) {
      const { x, y, width, height } = detection.box;
      const originalBox = scaleBox({ x, y, w: width, h: height }, 1 / fitted.scale);
      // Checked before any chip work, so background strangers cost a box and
      // nothing else.
      if (Math.min(originalBox.w, originalBox.h) < MIN_FACE_PX) continue;

      const cropBox = expandAndClampBox(
        originalBox,
        CROP_MARGIN,
        bitmap.width,
        bitmap.height
      );
      const chip = cropToCanvas(bitmap, cropBox, CHIP_MAX_EDGE);

      const descriptor = await describeChip(faceapi, chip, chipOptions);
      // A non-finite component poisons every distance comparison downstream,
      // where it can only be papered over. Drop the face here instead.
      if (!descriptor || !descriptor.every(Number.isFinite)) continue;

      const cropBlob = await canvasToBlob(chip);
      faces.push({ descriptor, box: cropBox, cropBlob });
    }
    return faces;
  } finally {
    bitmap.close();
  }
}
