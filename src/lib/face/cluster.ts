/**
 * Pure clustering over 128-d face descriptors.
 *
 * Greedy centroid assignment, then a polish pass that merges clusters whose
 * centroids ended up within the threshold and re-assigns every face to its
 * nearest final centroid. Deterministic for a given input order.
 *
 * 0.50 is deliberately stricter than the canonical 0.6 same-person threshold:
 * the UI can merge clusters but cannot split them, so under-merging is the
 * recoverable failure mode.
 */

export const CLUSTER_THRESHOLD = 0.5;

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
