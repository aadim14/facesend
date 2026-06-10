/**
 * Load-once singleton for the face-api module and its three models.
 *
 * The library (and the bundled tfjs) touches `window` at module-eval time,
 * so it must only ever be imported dynamically from client code — never a
 * top-level static import.
 */

type FaceApi = typeof import("@vladmandic/face-api");

let loadPromise: Promise<FaceApi> | null = null;

export function loadFaceApi(): Promise<FaceApi> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      // The fork's type defs don't surface tf.ready(); call it when present.
      const tf = faceapi.tf as unknown as { ready?: () => Promise<void> };
      await tf.ready?.();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      return faceapi;
    })().catch((error) => {
      loadPromise = null; // allow retry after a transient failure
      throw error;
    });
  }
  return loadPromise;
}
