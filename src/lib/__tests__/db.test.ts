import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addFaces,
  addPhoto,
  getAllFaces,
  getCluster,
  getClusters,
  getFacesForCluster,
  getPhoto,
  getPhotosForCluster,
  getStep,
  mergeClusters,
  putCluster,
  replaceClusters,
  resetAll,
  setStep,
  splitCluster,
} from "@/lib/db";
import type { ClusterRecord, FaceRecord, PhotoRecord } from "@/types";

function makePhoto(id: string, name = `${id}.jpg`): PhotoRecord {
  return {
    id,
    name,
    blob: new Blob(["abc"], { type: "image/jpeg" }),
    thumbBlob: new Blob(["t"], { type: "image/jpeg" }),
    width: 100,
    height: 80,
    faceCount: -1,
  };
}

function makeFace(
  id: string,
  photoId: string,
  clusterId: string | null = null
): FaceRecord {
  return {
    id,
    photoId,
    clusterId,
    descriptor: new Float32Array(128).fill(0.5),
    box: { x: 0, y: 0, w: 10, h: 10 },
    cropBlob: new Blob(["c"], { type: "image/jpeg" }),
  };
}

function makeCluster(id: string): ClusterRecord {
  return { id, name: "", contact: {}, skipped: false, sent: false };
}

beforeEach(async () => {
  await resetAll();
});

describe("photos", () => {
  it("round-trips a photo with its blobs intact", async () => {
    await addPhoto(makePhoto("p1", "beach.jpg"));
    const photo = await getPhoto("p1");
    expect(photo?.name).toBe("beach.jpg");
    expect(photo?.faceCount).toBe(-1);
    expect(photo?.blob.size).toBe(3);
    expect(photo?.thumbBlob.size).toBe(1);
  });
});

describe("meta / step", () => {
  it("defaults to the upload step on a fresh database", async () => {
    expect(await getStep()).toBe("upload");
  });

  it("persists the step", async () => {
    await setStep("review");
    expect(await getStep()).toBe("review");
  });
});

describe("clusters and faces", () => {
  it("replaceClusters writes clusters and face assignments", async () => {
    await addPhoto(makePhoto("p1"));
    await addFaces([makeFace("f1", "p1"), makeFace("f2", "p1")]);
    const cluster = makeCluster("c1");
    await replaceClusters(
      [cluster],
      new Map([
        ["f1", "c1"],
        ["f2", "c1"],
      ])
    );
    expect(await getClusters()).toHaveLength(1);
    const faces = await getFacesForCluster("c1");
    expect(faces.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
  });

  it("getPhotosForCluster returns a photo once even with two matched faces", async () => {
    await addPhoto(makePhoto("p1"));
    await addFaces([makeFace("f1", "p1", "c1"), makeFace("f2", "p1", "c1")]);
    await putCluster(makeCluster("c1"));
    const photos = await getPhotosForCluster("c1");
    expect(photos).toHaveLength(1);
    expect(photos[0].id).toBe("p1");
  });

  it("mergeClusters re-points faces and deletes the source cluster", async () => {
    await addPhoto(makePhoto("p1"));
    await addPhoto(makePhoto("p2"));
    await addFaces([makeFace("f1", "p1", "a"), makeFace("f2", "p2", "b")]);
    await putCluster(makeCluster("a"));
    await putCluster(makeCluster("b"));

    await mergeClusters("a", ["b"]);

    expect(await getCluster("b")).toBeUndefined();
    const merged = await getFacesForCluster("a");
    expect(merged.map((f) => f.id).sort()).toEqual(["f1", "f2"]);
    const photos = await getPhotosForCluster("a");
    expect(photos.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });
});

describe("resetAll", () => {
  it("empties every store", async () => {
    await addPhoto(makePhoto("p1"));
    await addFaces([makeFace("f1", "p1", "c1")]);
    await putCluster(makeCluster("c1"));
    await setStep("done");

    await resetAll();

    expect(await getPhoto("p1")).toBeUndefined();
    expect(await getAllFaces()).toHaveLength(0);
    expect(await getClusters()).toHaveLength(0);
    expect(await getStep()).toBe("upload");
  });
});

describe("splitCluster", () => {
  it("moves the given faces into the new cluster and keeps the rest", async () => {
    await addPhoto(makePhoto("p1"));
    await addPhoto(makePhoto("p2"));
    await addFaces([
      makeFace("f1", "p1", "c1"),
      makeFace("f2", "p1", "c1"),
      makeFace("f3", "p2", "c1"),
    ]);
    await putCluster(makeCluster("c1"));

    await splitCluster("c1", ["f3"], makeCluster("c2"));

    expect((await getFacesForCluster("c1")).map((f) => f.id).sort()).toEqual(["f1", "f2"]);
    expect((await getFacesForCluster("c2")).map((f) => f.id)).toEqual(["f3"]);
    expect(await getCluster("c2")).toBeDefined();
  });

  it("ignores faces that belong to a different cluster", async () => {
    await addPhoto(makePhoto("p1"));
    await addFaces([makeFace("f1", "p1", "c1"), makeFace("fX", "p1", "other")]);
    await putCluster(makeCluster("c1"));
    await putCluster(makeCluster("other"));

    await splitCluster("c1", ["fX"], makeCluster("c2"));

    expect((await getFacesForCluster("other")).map((f) => f.id)).toEqual(["fX"]);
    expect(await getFacesForCluster("c2")).toHaveLength(0);
  });
});
