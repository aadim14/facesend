import { describe, expect, it } from "vitest";
import {
  CLUSTER_THRESHOLD,
  clusterDescriptors,
  euclideanDistance,
  IncrementalClusterer,
  smartEjectSet,
  suggestMerges,
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

describe("smartEjectSet", () => {
  // Person A sits near 0.2, person B (the wrong merge) near 0.8.
  const personA = (id: string, jitter = 0) => ({
    faceId: id,
    descriptor: vec(0.2 + jitter),
  });
  const personB = (id: string, jitter = 0) => ({
    faceId: id,
    descriptor: vec(0.8 + jitter),
  });

  it("returns empty for an unknown seed face", () => {
    expect(smartEjectSet([personA("a1")], "nope")).toEqual([]);
  });

  it("returns just the seed for a single-face cluster", () => {
    expect(smartEjectSet([personA("a1")], "a1")).toEqual(["a1"]);
  });

  it("ejects only the outlier from a 3-same + 1-different cluster", () => {
    const faces = [personA("a1"), personA("a2", 0.001), personA("a3", -0.001), personB("b1")];
    expect(smartEjectSet(faces, "b1").sort()).toEqual(["b1"]);
  });

  it("pulls a second photo of the wrong person out with the tapped one", () => {
    const faces = [
      personA("a1"),
      personA("a2", 0.002),
      personB("b1"),
      personB("b2", 0.003),
    ];
    expect(smartEjectSet(faces, "b1").sort()).toEqual(["b1", "b2"]);
  });

  it("never ejects the entire cluster", () => {
    const faces = [personB("b1"), personB("b2", 0.001), personB("b3", 0.002)];
    const ejected = smartEjectSet(faces, "b1");
    expect(ejected.length).toBeLessThan(faces.length);
    expect(ejected).toContain("b1");
  });

  it("does not drag along faces of the people staying behind", () => {
    const faces = [
      personA("a1"),
      personA("a2", 0.001),
      personA("a3", 0.002),
      personA("a4", -0.002),
      personB("b1"),
    ];
    const ejected = smartEjectSet(faces, "b1");
    expect(ejected).toEqual(["b1"]);
  });
});

describe("suggestMerges", () => {
  // euclidean distance between vec(a) and vec(b) over 128 dims = |a-b| * sqrt(128) ≈ |a-b| * 11.31
  const STEP = 1 / Math.sqrt(128); // component delta that yields distance 1.0... scaled below

  function group(id: string, value: number, count = 2) {
    return {
      clusterId: id,
      descriptors: Array.from({ length: count }, () => vec(value)),
    };
  }

  it("suggests pairs inside the uncertainty band", () => {
    // distance 0.5: component delta = 0.5/sqrt(128)
    const result = suggestMerges([group("a", 0.2), group("b", 0.2 + 0.5 * STEP)]);
    expect(result).toHaveLength(1);
    expect([result[0].a, result[0].b].sort()).toEqual(["a", "b"]);
    expect(result[0].distance).toBeCloseTo(0.5, 5);
  });

  it("ignores pairs below the auto-merge threshold and beyond the same-person bound", () => {
    const close = suggestMerges([group("a", 0.2), group("b", 0.2 + 0.3 * STEP)]);
    const far = suggestMerges([group("a", 0.2), group("b", 0.2 + 0.7 * STEP)]);
    expect(close).toHaveLength(0);
    expect(far).toHaveLength(0);
  });

  it("orders multiple suggestions nearest first", () => {
    const result = suggestMerges([
      group("a", 0.2),
      group("b", 0.2 + 0.58 * STEP),
      group("c", 0.2 - 0.5 * STEP),
    ]);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].distance).toBeLessThanOrEqual(result[1].distance);
    expect([result[0].a, result[0].b].sort()).toEqual(["a", "c"]);
  });

  it("skips clusters with no descriptors", () => {
    const result = suggestMerges([
      group("a", 0.2),
      { clusterId: "empty", descriptors: [] },
    ]);
    expect(result).toHaveLength(0);
  });
});

describe("IncrementalClusterer", () => {
  it("groups streamed faces like pass-1 greedy assignment", () => {
    const c = new IncrementalClusterer();
    c.add({ faceId: "a1", descriptor: vec(0.2) });
    c.add({ faceId: "a2", descriptor: vec(0.201) });
    c.add({ faceId: "b1", descriptor: vec(0.8) });
    const snap = c.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0].faceIds).toEqual(["a1", "a2"]);
    expect(snap[1].faceIds).toEqual(["b1"]);
  });

  it("keeps cluster order and anchors stable as faces stream in", () => {
    const c = new IncrementalClusterer();
    c.add({ faceId: "a1", descriptor: vec(0.2) });
    c.add({ faceId: "b1", descriptor: vec(0.8) });
    c.add({ faceId: "a2", descriptor: vec(0.199) });
    c.add({ faceId: "b2", descriptor: vec(0.801) });
    const snap = c.snapshot();
    expect(snap.map((s) => s.faceIds[0])).toEqual(["a1", "b1"]);
  });

  it("snapshots are copies — later adds don't mutate them", () => {
    const c = new IncrementalClusterer();
    c.add({ faceId: "a1", descriptor: vec(0.2) });
    const before = c.snapshot();
    c.add({ faceId: "a2", descriptor: vec(0.2) });
    expect(before[0].faceIds).toEqual(["a1"]);
  });
});
