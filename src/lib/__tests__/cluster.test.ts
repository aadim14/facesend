import { describe, expect, it } from "vitest";
import {
  applyMergeLinks,
  CLUSTER_THRESHOLD,
  SUGGEST_THRESHOLD,
  clusterDescriptors,
  euclideanDistance,
  IncrementalClusterer,
  meanDescriptor,
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
    // Distances scale by sqrt(128) ≈ 11.31. f2 starts its own cluster
    // (0.045·11.31 ≈ 0.509 from f1, above 0.4), but after f3 pulls cluster 1's
    // centroid to 0.0105, the centroids sit ≈0.390 apart → merged.
    const result = clusterDescriptors([
      { faceId: "f1", descriptor: vec(0) },
      { faceId: "f2", descriptor: vec(0.045) },
      { faceId: "f3", descriptor: vec(0.021) },
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
    // Pinned exactly: the old range assertion passed for both 0.4 and 0.5,
    // so it silently tolerated the README drifting to a different number.
    expect(CLUSTER_THRESHOLD).toBe(0.4);
  });

  // Regression: pass 3 looked up each face's nearest centroid and pushed into
  // `reassigned[index]` without checking index >= 0. A NaN component makes
  // every distance comparison false, so index stayed -1 and the whole run
  // threw — after every photo had already been detected.
  it("survives a descriptor containing NaN instead of throwing", () => {
    const poisoned = vec(0.5);
    poisoned[7] = NaN;
    const faces = [
      { faceId: "a1", descriptor: vec(0) },
      { faceId: "a2", descriptor: vec(0.01) },
      { faceId: "b1", descriptor: vec(1) },
      { faceId: "bad", descriptor: poisoned },
    ];
    expect(() => clusterDescriptors(faces)).not.toThrow();
    // and the healthy faces still group correctly
    const groups = clusterDescriptors(faces).map((c) => [...c.faceIds].sort());
    expect(groups).toContainEqual(["a1", "a2"]);
  });

  it("never loses or duplicates a face", () => {
    const faces = [
      { faceId: "f1", descriptor: vec(0) },
      { faceId: "f2", descriptor: vec(0.02) },
      { faceId: "f3", descriptor: vec(0.5) },
      { faceId: "f4", descriptor: vec(1) },
      { faceId: "f5", descriptor: vec(1.01) },
    ];
    const out = clusterDescriptors(faces).flatMap((c) => c.faceIds);
    expect(out.slice().sort()).toEqual(["f1", "f2", "f3", "f4", "f5"]);
  });

  // The returned centroid used to be carried over from before pass 3, so it
  // described a different set of faces than the faceIds it shipped with.
  it("returns a centroid that matches the faces it ships with", () => {
    const faces = [
      { faceId: "f1", descriptor: vec(0) },
      { faceId: "f2", descriptor: vec(0.02) },
      { faceId: "f3", descriptor: vec(1) },
      { faceId: "f4", descriptor: vec(1.01) },
    ];
    const byId = new Map(faces.map((f) => [f.faceId, f.descriptor]));
    for (const cluster of clusterDescriptors(faces)) {
      const expected = meanDescriptor(
        cluster.faceIds.map((id) => byId.get(id)!)
      );
      expect(euclideanDistance(cluster.centroid, expected)).toBeLessThan(1e-6);
    }
  });
});

describe("applyMergeLinks", () => {
  const clusters = () => [
    { faceIds: ["a1", "a2"], centroid: vec(0) },
    { faceIds: ["b1"], centroid: vec(1) },
    { faceIds: ["c1", "c2"], centroid: vec(2) },
  ];

  it("is a no-op with no links", () => {
    expect(applyMergeLinks(clusters(), [])).toEqual(clusters());
  });

  it("ignores links naming faces that no longer exist", () => {
    // An ejected face, or one whose photo was deleted: a hint, not a
    // referential-integrity constraint.
    expect(applyMergeLinks(clusters(), [["a1", "ghost"]])).toEqual(clusters());
  });

  it("joins the two clusters a link spans", () => {
    const out = applyMergeLinks(clusters(), [["a1", "b1"]]);
    expect(out).toHaveLength(2);
    expect(out[0].faceIds.sort()).toEqual(["a1", "a2", "b1"]);
  });

  it("composes transitively", () => {
    // a~b and b~c means all three are one person, without an explicit a~c.
    const out = applyMergeLinks(clusters(), [
      ["a1", "b1"],
      ["b1", "c1"],
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].faceIds.sort()).toEqual(["a1", "a2", "b1", "c1", "c2"]);
  });

  it("gives the joined cluster a centroid describing all of its faces", () => {
    // Weighted mean of [0,0] (2 faces) and [1] (1 face) = 1/3.
    const out = applyMergeLinks(clusters(), [["a1", "b1"]]);
    expect(out[0].centroid[0]).toBeCloseTo(1 / 3, 6);
  });

  it("never loses a face", () => {
    const out = applyMergeLinks(clusters(), [["a1", "c2"]]);
    expect(out.flatMap((c) => c.faceIds).sort()).toEqual([
      "a1",
      "a2",
      "b1",
      "c1",
      "c2",
    ]);
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
    // distance 0.45: a near-miss just above the 0.4 auto-merge cutoff, which
    // is where a genuinely split person lands.
    const result = suggestMerges([group("a", 0.2), group("b", 0.2 + 0.45 * STEP)]);
    expect(result).toHaveLength(1);
    expect([result[0].a, result[0].b].sort()).toEqual(["a", "b"]);
    expect(result[0].distance).toBeCloseTo(0.45, 5);
  });

  it("ignores pairs below the auto-merge threshold and beyond the suggest bound", () => {
    const close = suggestMerges([group("a", 0.2), group("b", 0.2 + 0.3 * STEP)]);
    const far = suggestMerges([group("a", 0.2), group("b", 0.2 + 0.55 * STEP)]);
    expect(close).toHaveLength(0);
    expect(far).toHaveLength(0);
  });

  // Regression: the bound was 0.6, which in measurement swept in ~10% of all
  // different-person pairs and buried real splits in false prompts.
  it("does not prompt about a pair half a unit apart", () => {
    expect(SUGGEST_THRESHOLD).toBe(0.5);
    const result = suggestMerges([group("a", 0.2), group("b", 0.2 + 0.52 * STEP)]);
    expect(result).toHaveLength(0);
  });

  it("orders multiple suggestions nearest first", () => {
    const result = suggestMerges([
      group("a", 0.2),
      group("b", 0.2 + 0.48 * STEP),
      group("c", 0.2 - 0.42 * STEP),
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
