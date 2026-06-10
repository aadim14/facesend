import { describe, expect, it } from "vitest";
import {
  CLUSTER_THRESHOLD,
  clusterDescriptors,
  euclideanDistance,
} from "@/lib/face/cluster";

/** 128-d vector with every component set to `value`. */
function vec(value: number): Float32Array {
  return new Float32Array(128).fill(value);
}

describe("euclideanDistance", () => {
  it("computes the classic 3-4-5 triangle", () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
  });

  it("is zero for identical vectors", () => {
    expect(euclideanDistance(vec(0.3), vec(0.3))).toBe(0);
  });
});

describe("clusterDescriptors", () => {
  it("returns no clusters for empty input", () => {
    expect(clusterDescriptors([])).toEqual([]);
  });

  it("returns one cluster for a single face", () => {
    const result = clusterDescriptors([{ faceId: "f1", descriptor: vec(0.5) }]);
    expect(result).toHaveLength(1);
    expect(result[0].faceIds).toEqual(["f1"]);
  });

  it("groups identical descriptors into one cluster", () => {
    const result = clusterDescriptors([
      { faceId: "f1", descriptor: vec(0.2) },
      { faceId: "f2", descriptor: vec(0.2) },
      { faceId: "f3", descriptor: vec(0.2) },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].faceIds).toHaveLength(3);
  });

  it("separates two groups well beyond the threshold", () => {
    // fill(0) vs fill(1): distance = sqrt(128) ≈ 11.3, far above 0.5
    const result = clusterDescriptors([
      { faceId: "a1", descriptor: vec(0) },
      { faceId: "a2", descriptor: vec(0.001) },
      { faceId: "b1", descriptor: vec(1) },
      { faceId: "b2", descriptor: vec(1.001) },
    ]);
    expect(result).toHaveLength(2);
    const groups = result.map((c) => [...c.faceIds].sort());
    expect(groups).toContainEqual(["a1", "a2"]);
    expect(groups).toContainEqual(["b1", "b2"]);
  });

  it("polish pass merges clusters whose centroids drift within the threshold", () => {
    // f2 starts its own cluster (0.565 from f1 > 0.5), but after f3 pulls
    // cluster 1's centroid to 0.0125, the centroids sit 0.42 apart → merged.
    const result = clusterDescriptors([
      { faceId: "f1", descriptor: vec(0) },
      { faceId: "f2", descriptor: vec(0.05) },
      { faceId: "f3", descriptor: vec(0.025) },
    ]);
    expect(result).toHaveLength(1);
    expect([...result[0].faceIds].sort()).toEqual(["f1", "f2", "f3"]);
  });

  it("is deterministic for the same input", () => {
    const faces = [
      { faceId: "f1", descriptor: vec(0) },
      { faceId: "f2", descriptor: vec(0.02) },
      { faceId: "f3", descriptor: vec(1) },
      { faceId: "f4", descriptor: vec(1.01) },
    ];
    const a = clusterDescriptors(faces).map((c) => c.faceIds);
    const b = clusterDescriptors(faces).map((c) => c.faceIds);
    expect(a).toEqual(b);
  });

  it("uses a stricter-than-canonical default threshold", () => {
    expect(CLUSTER_THRESHOLD).toBeLessThanOrEqual(0.55);
    expect(CLUSTER_THRESHOLD).toBeGreaterThanOrEqual(0.4);
  });
});
