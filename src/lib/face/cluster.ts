/**
 * Pure clustering over 128-d face descriptors.
 *
 * Greedy centroid assignment, then a polish pass that merges clusters whose
 * centroids ended up within the threshold and re-assigns every face to its
 * nearest final centroid. Deterministic for a given input order.
 *
 * 0.4 is deliberately stricter than the canonical 0.6 same-person threshold:
 * we'd rather split one person across two cards (host just shares twice, and
 * tap-to-eject can still peel a stray face out) than blend two different
 * people into one group, which looks broken. Dim, blurry event photos
 * compress the distance between different people, which is also why
 * descriptors are computed from high-res chips (see detect.ts) rather than
 * the downscaled frame.
 */

export const CLUSTER_THRESHOLD = 0.4;

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
 * Upper bound for "might be the same person" merge suggestions. Pairs whose
 * centroids land between CLUSTER_THRESHOLD (our strict auto-merge cutoff) and
 * this value are the under-merges that strictness knowingly produces.
 *
 * Was 0.6, the canonical same-person threshold — far too permissive as a
 * *prompt* threshold. Measured over 22 faces from 6 unrelated group photos,
 * where all 231 pairs are known different people:
 *
 *   band          false prompts
 *   [0.40, 0.60)  23
 *   [0.40, 0.50)   3
 *   [0.40, 0.45)   1
 *
 * The closest different-person pair sat at 0.444, and only 1% of them fell
 * below 0.494. At 0.6 the app asked "same person?" 23 times about 22 distinct
 * people — noise that trains the host to dismiss the prompt without reading
 * it, which costs more than the splits it was meant to catch.
 *
 * 0.5 keeps the near-misses (a true split that failed auto-merge sits just
 * above 0.4) and drops ~87% of the false prompts. Recall matters less than
 * precision here: a missed suggestion still leaves two cards the host can see
 * and merge, whereas a wrong suggestion actively wastes their attention.
 */
export const SUGGEST_THRESHOLD = 0.5;

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

/**
 * Fold host-confirmed same-person links into a clustering result.
 *
 * Clustering re-runs over every face whenever photos are added, so without
 * this a merge the host explicitly confirmed is silently undone by the next
 * run. Links are applied as a union-find over the produced clusters: any two
 * clusters holding linked faces become one, transitively.
 *
 * Links naming faces that no longer exist (ejected, or their photo deleted)
 * are ignored rather than treated as an error — the ledger is a set of hints
 * about people, not a referential-integrity constraint.
 */
export function applyMergeLinks(
  clusters: DescriptorCluster[],
  links: [string, string][]
): DescriptorCluster[] {
  if (links.length === 0 || clusters.length < 2) return clusters;

  const clusterOfFace = new Map<string, number>();
  clusters.forEach((c, i) => c.faceIds.forEach((id) => clusterOfFace.set(id, i)));

  const parent = clusters.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };

  let joined = false;
  for (const [a, b] of links) {
    const ia = clusterOfFace.get(a);
    const ib = clusterOfFace.get(b);
    if (ia == null || ib == null || find(ia) === find(ib)) continue;
    union(ia, ib);
    joined = true;
  }
  if (!joined) return clusters;

  const merged = new Map<number, DescriptorCluster[]>();
  clusters.forEach((c, i) => {
    const root = find(i);
    merged.set(root, [...(merged.get(root) ?? []), c]);
  });

  return [...merged.values()]
    .map((members) => {
      const faceIds = members.flatMap((m) => m.faceIds);
      // Weighted mean of the member centroids — the mean of the union, without
      // needing the descriptors back. A centroid must describe the faces it
      // ships with; carrying one member's centroid over would be a lie.
      const centroid = new Float32Array(members[0].centroid.length);
      for (const m of members) {
        for (let i = 0; i < centroid.length; i++) {
          centroid[i] += m.centroid[i] * m.faceIds.length;
        }
      }
      for (let i = 0; i < centroid.length; i++) centroid[i] /= faceIds.length;
      return { faceIds, centroid };
    })
    .sort(
      (a, b) =>
        b.faceIds.length - a.faceIds.length ||
        a.faceIds[0].localeCompare(b.faceIds[0])
    );
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
  //
  // Two guards, with quite different track records:
  //
  //   - index < 0 fixes a *demonstrated* crash. It means every distance
  //     compared false, which is what happens when a descriptor contains NaN
  //     (a degenerate 1px crop, or a float16 WebGL readback). Pass 1 already
  //     guarded this; pass 3 did not, so `reassigned[-1].push(...)` threw and
  //     killed the run *after* every photo had been detected — the whole
  //     session's work lost to a generic "something went wrong".
  //
  //   - `distance < threshold` is defence in depth, not a fixed bug. Pass 3
  //     used to move every face to its globally nearest centroid regardless
  //     of distance, which reads as a way to blend two people into one group.
  //     A search over 20k randomised 128-d inputs found no case where it
  //     actually changed the partition — a face's own centroid is essentially
  //     always its nearest — so this is cheap insurance on an invariant the
  //     file header claims, not a repair. Don't cite it as a bug fix.
  if (clusters.length > 1) {
    const byId = new Map(faces.map((f) => [f.faceId, f.descriptor]));
    const home = new Map<string, number>();
    clusters.forEach((c, i) => c.faceIds.forEach((id) => home.set(id, i)));

    const reassigned: string[][] = clusters.map(() => []);
    for (const face of faces) {
      const descriptor = byId.get(face.faceId)!;
      const { index, distance } = nearestCluster(descriptor, clusters);
      const target =
        index >= 0 && distance < threshold
          ? index
          : (home.get(face.faceId) ?? -1);
      if (target >= 0) reassigned[target].push(face.faceId);
    }

    for (let i = 0; i < clusters.length; i++) {
      // Recompute the centroid: it has to describe the faces it ships with,
      // or the result isn't a fixed point and any future consumer that trusts
      // `centroid` reads a vector for a different set of faces.
      const descriptors = reassigned[i]
        .map((id) => byId.get(id))
        .filter((d): d is Float32Array | number[] => d != null);
      clusters[i] = {
        faceIds: reassigned[i],
        centroid: descriptors.length
          ? meanDescriptor(descriptors)
          : clusters[i].centroid,
      };
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
