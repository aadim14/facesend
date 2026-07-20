export type Step = "upload" | "processing" | "review" | "done";

export interface PhotoRecord {
  id: string;
  name: string;
  blob: Blob;
  thumbBlob: Blob;
  width: number;
  height: number;
  /**
   * -2 = processing failed (decode/detection threw), -1 = not yet processed,
   * 0 = genuinely no faces found, >0 = faces found. -2 is distinct from 0 so a
   * failure surfaces as retryable rather than silently landing in "No faces".
   */
  faceCount: number;
}

/** Axis-aligned box in original-image pixel coordinates. */
export interface FaceBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceRecord {
  id: string;
  photoId: string;
  clusterId: string | null;
  descriptor: Float32Array;
  box: FaceBox;
  cropBlob: Blob;
}

export interface ContactInfo {
  email?: string;
  phone?: string;
}

export interface ClusterRecord {
  id: string;
  name: string;
  contact: ContactInfo;
  skipped: boolean;
  /**
   * Epoch ms of a *confirmed* delivery, or null if not delivered. Confirmed
   * means the OS share sheet resolved — a cancelled share or a zip that only
   * downloaded never sets this. Replaces the old optimistic `sent` boolean.
   */
  deliveredAt: number | null;
  /** Last delivery failure message, surfaced to the host; cleared on success. */
  deliveryError?: string;
}
