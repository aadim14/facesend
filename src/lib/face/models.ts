/**
 * Load-once singleton for the face-api module and its three models.
 *
 * The library (and the bundled tfjs) touches `window` at module-eval time,
 * so it must only ever be imported dynamically from client code — never a
 * top-level static import.
 */

type FaceApi = typeof import("@vladmandic/face-api");

let loadPromise: Promise<FaceApi> | null = null;
let activeBackend: string | null = null;

/** Which tfjs backend ended up active ("webgl" = GPU, "cpu" = very slow fallback). */
export function getActiveBackend(): string | null {
  return activeBackend;
}

export function loadFaceApi(): Promise<FaceApi> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      // The fork's type defs don't surface these tf methods; call them when present.
      const tf = faceapi.tf as unknown as {
        setBackend?: (name: string) => Promise<boolean>;
        getBackend?: () => string;
        ready?: () => Promise<void>;
      };
      // Force the GPU backend — a silent CPU fallback is 10-50x slower.
      try {
        await tf.setBackend?.("webgl");
      } catch {
        // keep whatever backend tfjs picked
      }
      await tf.ready?.();
      activeBackend = tf.getBackend?.() ?? null;
      console.info(`[facesend] tfjs backend: ${activeBackend ?? "unknown"}`);
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
