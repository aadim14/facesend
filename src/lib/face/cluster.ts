/**
 * Pure clustering over 128-d face descriptors.
 *
 * Greedy centroid assignment, then a polish pass that merges clusters whose
 * centroids ended up within the threshold and re-assigns every face to its
 * nearest final centroid. Deterministic for a given input order.
 *
 * 0.45 is deliberately stricter than the canonical 0.6 same-person threshold:
 * the UI can merge clusters but cannot split them, so under-merging is the
 * recoverable failure mode. Dim, blurry event photos compress the distance
 * between different people, which is also why descriptors are computed from
 * high-res chips (see detect.ts) rather than the downscaled frame.
 */

export const CLUSTER_THRESHOLD = 0.45;

export interface ClusterableFace {
  faceId: string;
  descriptor: Float32Array | number[];
}

export interface DescriptorCluster {
  faceIds: string[];
  centroid: Float32Array;
}

export function euclideanDistance(
  a: ArrayLike<number>,
  b: ArrayLike<number>
): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function meanDescriptor(
  descriptors: ArrayLike<number>[]
): Float32Array {
  const out = new Float32Array(descriptors[0].length);
  for (const d of descriptors) {
    for (let i = 0; i < out.length; i++) out[i] += d[i];
  }
  for (let i = 0; i < out.length; i++) out[i] /= descriptors.length;
  return out;
}

/**
 * Faces to pull out of a cluster when the host taps one face as "not this
 * person". The tapped face always ejects; any other face that sits closer
 * to the tapped face than to the centroid of the faces staying behind
 * ejects with it (the wrong person often appears in several photos).
 * At least one face always stays — ejecting an entire cluster is a no-op
 * the caller should treat as "tapped face only".
 */
export function smartEjectSet(
  faces: ClusterableFace[],
  seedFaceId: string
): string[] {
  const seed = faces.find((f) => f.faceId === seedFaceId);
  if (!seed) return [];
  if (faces.length < 2) return [seedFaceId];

  const eject = new Set([seedFaceId]);
  // Nearest-to-seed first, so a second photo of the wrong person joins the
  // eject set before borderline faces are judged against a shrunken "rest".
  const candidates = faces
    .filter((f) => f.faceId !== seedFaceId)
    .sort(
      (a, b) =>
        euclideanDistance(a.descriptor, seed.descriptor) -
        euclideanDistance(b.descriptor, seed.descriptor)
    );

  for (const candidate of candidates) {
    if (eject.size >= faces.length - 1) break; // someone must stay
    const staying = faces.filter(
      (f) => !eject.has(f.faceId) && f.faceId !== candidate.faceId
    );
    const stayCentroid = meanDescriptor(staying.map((f) => f.descriptor));
    const toSeed = euclideanDistance(candidate.descriptor, seed.descriptor);
    const toStay = euclideanDistance(candidate.descriptor, stayCentroid);
    if (toSeed < toStay) eject.add(candidate.faceId);
  }
  return [...eject];
}

/**
 * Upper bound for "might be the same person" merge suggestions: the
 * canonical face-recognition same-person threshold. Cluster pairs whose
 * centroids land between CLUSTER_THRESHOLD (our deliberately strict
 * auto-merge cutoff) and this value are exactly the under-merges the
 * strict threshold knowingly produces.
 */
export const SUGGEST_THRESHOLD = 0.6;

export interface MergeSuggestion {
  a: string;
  b: string;
  distance: number;
}

export interface ClusterGroup {
  clusterId: string;
  descriptors: ArrayLike<number>[];
}

/**
 * Cluster pairs whose centroid distance falls in the uncertainty band
 * [min, max) — candidates for a one-tap "Same person?" review, nearest
 * pairs first.
 */
export function suggestMerges(
  groups: ClusterGroup[],
  min = CLUSTER_THRESHOLD,
  max = SUGGEST_THRESHOLD
): MergeSuggestion[] {
  const centroids = groups
    .filter((g) => g.descriptors.length > 0)
    .map((g) => ({ id: g.clusterId, centroid: meanDescriptor(g.descriptors) }));
  const out: MergeSuggestion[] = [];
  for (let i = 0; i < centroids.length; i++) {
    for (let j = i + 1; j < centroids.length; j++) {
      const d = euclideanDistance(centroids[i].centroid, centroids[j].centroid);
      if (d >= min && d < max) {
        out.push({ a: centroids[i].id, b: centroids[j].id, distance: d });
      }
    }
  }
  return out.sort((x, y) => x.distance - y.distance);
}

interface MutableCluster {
  faceIds: string[];
  centroid: Float32Array;
}

function nearestCluster(
  descriptor: ArrayLike<number>,
  clusters: MutableCluster[]
): { index: number; distance: number } {
  let index = -1;
  let distance = Infinity;
  for (let i = 0; i < clusters.length; i++) {
    const d = euclideanDistance(descriptor, clusters[i].centroid);
    if (d < distance) {
      distance = d;
      index = i;
    }
  }
  return { index, distance };
}

function addToCentroid(cluster: MutableCluster, descriptor: ArrayLike<number>) {
  const n = cluster.faceIds.length; // count BEFORE adding the new face id
  for (let i = 0; i < cluster.centroid.length; i++) {
    cluster.centroid[i] = (cluster.centroid[i] * n + descriptor[i]) / (n + 1);
  }
}

/**
 * Streaming version of pass 1 — greedy assignment with incremental
 * centroids — exposed so the UI can show provisional person groups while
 * photos are still processing. The final clusterDescriptors() run stays
 * the source of truth; snapshots are provisional. Cluster creation order
 * is stable and faceIds[0] never changes, so it works as a durable anchor
 * for carrying user input (names) across the final re-cluster.
 */
export class IncrementalClusterer {
  private clusters: MutableCluster[] = [];

  constructor(private readonly threshold = CLUSTER_THRESHOLD) {}

  add(face: ClusterableFace): void {
    const { index, distance } = nearestCluster(face.descriptor, this.clusters);
    if (index >= 0 && distance < this.threshold) {
      addToCentroid(this.clusters[index], face.descriptor);
      this.clusters[index].faceIds.push(face.faceId);
    } else {
      this.clusters.push({
        faceIds: [face.faceId],
        centroid: Float32Array.from(face.descriptor),
      });
    }
  }

  snapshot(): DescriptorCluster[] {
    return this.clusters.map((c) => ({
      faceIds: [...c.faceIds],
      centroid: c.centroid,
    }));
  }
}

export function clusterDescriptors(
  faces: ClusterableFace[],
  threshold = CLUSTER_THRESHOLD
): DescriptorCluster[] {
  const clusters: MutableCluster[] = [];

  // Pass 1: greedy assignment with incremental centroids.
  for (const face of faces) {
    const { index, distance } = nearestCluster(face.descriptor, clusters);
    if (index >= 0 && distance < threshold) {
      addToCentroid(clusters[index], face.descriptor);
      clusters[index].faceIds.push(face.faceId);
    } else {
      clusters.push({
        faceIds: [face.faceId],
        centroid: Float32Array.from(face.descriptor),
      });
    }
  }

  // Pass 2: merge clusters whose centroids sit within the threshold,
  // repeating until stable (a merge can pull two centroids together).
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = euclideanDistance(clusters[i].centroid, clusters[j].centroid);
        if (d < threshold) {
          const a = clusters[i];
          const b = clusters[j];
          const total = a.faceIds.length + b.faceIds.length;
          const centroid = new Float32Array(a.centroid.length);
          for (let k = 0; k < centroid.length; k++) {
            centroid[k] =
              (a.centroid[k] * a.faceIds.length +
                b.centroid[k] * b.faceIds.length) /
              total;
          }
          clusters[i] = { faceIds: [...a.faceIds, ...b.faceIds], centroid };
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  // Pass 3: re-assign each face to its nearest final centroid. Recovers
  // borderline faces that greedily landed in a cluster whose centroid drifted.
  if (clusters.length > 1) {
    const byId = new Map(faces.map((f) => [f.faceId, f.descriptor]));
    const reassigned: string[][] = clusters.map(() => []);
    for (const face of faces) {
      const { index } = nearestCluster(
        byId.get(face.faceId)!,
        clusters
      );
      reassigned[index].push(face.faceId);
    }
    for (let i = 0; i < clusters.length; i++) {
      clusters[i] = { ...clusters[i], faceIds: reassigned[i] };
    }
  }

  return clusters
    .filter((c) => c.faceIds.length > 0)
    .sort(
      (a, b) =>
        b.faceIds.length - a.faceIds.length ||
        a.faceIds[0].localeCompare(b.faceIds[0])
    )
    .map((c) => ({ faceIds: c.faceIds, centroid: c.centroid }));
}
