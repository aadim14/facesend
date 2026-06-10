export type Step = "upload" | "processing" | "review" | "done";

export interface PhotoRecord {
  id: string;
  name: string;
  blob: Blob;
  thumbBlob: Blob;
  width: number;
  height: number;
  /** -1 = not yet processed, 0 = no faces found (or undecodable), >0 = faces found */
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
  sent: boolean;
}
