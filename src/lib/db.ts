import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  ClusterRecord,
  FaceRecord,
  PhotoRecord,
  Step,
} from "@/types";

interface FaceSendDB extends DBSchema {
  photos: { key: string; value: PhotoRecord };
  faces: {
    key: string;
    value: FaceRecord;
    indexes: { "by-photo": string; "by-cluster": string };
  };
  clusters: { key: string; value: ClusterRecord };
  meta: { key: string; value: unknown };
}

const DB_NAME = "facesend";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<FaceSendDB>> | null = null;

function getDB(): Promise<IDBPDatabase<FaceSendDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FaceSendDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("photos", { keyPath: "id" });
        const faces = db.createObjectStore("faces", { keyPath: "id" });
        faces.createIndex("by-photo", "photoId");
        faces.createIndex("by-cluster", "clusterId");
        db.createObjectStore("clusters", { keyPath: "id" });
        db.createObjectStore("meta");
      },
    });
  }
  return dbPromise;
}

// ---- photos ----

/** One photo per transaction (large Blobs in a single giant transaction are flaky on iOS Safari). */
export async function addPhoto(photo: PhotoRecord): Promise<void> {
  const db = await getDB();
  await db.put("photos", photo);
}

export async function getPhoto(id: string): Promise<PhotoRecord | undefined> {
  const db = await getDB();
  return db.get("photos", id);
}

export async function getAllPhotos(): Promise<PhotoRecord[]> {
  const db = await getDB();
  const photos = await db.getAll("photos");
  return photos.sort((a, b) => a.name.localeCompare(b.name));
}

export async function setPhotoFaceCount(
  id: string,
  faceCount: number
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("photos", "readwrite");
  const photo = await tx.store.get(id);
  if (photo) {
    photo.faceCount = faceCount;
    await tx.store.put(photo);
  }
  await tx.done;
}

// ---- faces ----

/** All faces of one photo, written in one transaction. */
export async function addFaces(faces: FaceRecord[]): Promise<void> {
  if (faces.length === 0) return;
  const db = await getDB();
  const tx = db.transaction("faces", "readwrite");
  for (const face of faces) tx.store.put(face);
  await tx.done;
}

export async function getAllFaces(): Promise<FaceRecord[]> {
  const db = await getDB();
  return db.getAll("faces");
}

export async function getFacesForCluster(
  clusterId: string
): Promise<FaceRecord[]> {
  const db = await getDB();
  return db.getAllFromIndex("faces", "by-cluster", clusterId);
}

// ---- clusters ----

/**
 * Replace the full cluster set and face→cluster assignments in one transaction.
 * Used after the clustering pass.
 */
export async function replaceClusters(
  clusters: ClusterRecord[],
  assignments: Map<string, string>
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["clusters", "faces"], "readwrite");
  const clusterStore = tx.objectStore("clusters");
  const faceStore = tx.objectStore("faces");
  await clusterStore.clear();
  for (const cluster of clusters) clusterStore.put(cluster);
  let cursor = await faceStore.openCursor();
  while (cursor) {
    const face = cursor.value;
    const clusterId = assignments.get(face.id) ?? null;
    if (face.clusterId !== clusterId) {
      cursor.update({ ...face, clusterId });
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getClusters(): Promise<ClusterRecord[]> {
  const db = await getDB();
  return db.getAll("clusters");
}

export async function getCluster(
  id: string
): Promise<ClusterRecord | undefined> {
  const db = await getDB();
  return db.get("clusters", id);
}

export async function putCluster(cluster: ClusterRecord): Promise<void> {
  const db = await getDB();
  await db.put("clusters", cluster);
}

/**
 * Merge source clusters into the target: re-point all faces, delete the sources.
 * Single transaction so a crash can't leave faces pointing at deleted clusters.
 */
export async function mergeClusters(
  targetId: string,
  sourceIds: string[]
): Promise<void> {
  const sources = sourceIds.filter((id) => id !== targetId);
  if (sources.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(["clusters", "faces"], "readwrite");
  const faceIndex = tx.objectStore("faces").index("by-cluster");
  for (const sourceId of sources) {
    const faces = await faceIndex.getAll(sourceId);
    for (const face of faces) {
      tx.objectStore("faces").put({ ...face, clusterId: targetId });
    }
    tx.objectStore("clusters").delete(sourceId);
  }
  await tx.done;
}

/**
 * Split faces out of a cluster into a fresh one: create the new cluster,
 * re-point the given faces. Single transaction so a crash can't leave the
 * new cluster empty or faces pointing at a cluster that was never created.
 */
export async function splitCluster(
  sourceClusterId: string,
  faceIds: string[],
  newCluster: ClusterRecord
): Promise<void> {
  if (faceIds.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(["clusters", "faces"], "readwrite");
  tx.objectStore("clusters").put(newCluster);
  const faceStore = tx.objectStore("faces");
  for (const id of faceIds) {
    const face = await faceStore.get(id);
    if (face && face.clusterId === sourceClusterId) {
      faceStore.put({ ...face, clusterId: newCluster.id });
    }
  }
  await tx.done;
}

// ---- derived reads ----

/** Distinct photos containing a person, each photo once even with multiple matched faces. */
export async function getPhotosForCluster(
  clusterId: string
): Promise<PhotoRecord[]> {
  const faces = await getFacesForCluster(clusterId);
  const photoIds = [...new Set(faces.map((f) => f.photoId))];
  const db = await getDB();
  const photos: PhotoRecord[] = [];
  for (const id of photoIds) {
    const photo = await db.get("photos", id);
    if (photo) photos.push(photo);
  }
  return photos.sort((a, b) => a.name.localeCompare(b.name));
}

// ---- meta ----

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get("meta", key)) as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put("meta", value, key);
}

export async function getStep(): Promise<Step> {
  return (await getMeta<Step>("step")) ?? "upload";
}

export async function setStep(step: Step): Promise<void> {
  await setMeta("step", step);
}

// ---- lifecycle ----

export async function resetAll(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["photos", "faces", "clusters", "meta"], "readwrite");
  tx.objectStore("photos").clear();
  tx.objectStore("faces").clear();
  tx.objectStore("clusters").clear();
  tx.objectStore("meta").clear();
  await tx.done;
}

/** Best-effort request to exempt our storage from automatic eviction. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // non-fatal
  }
  return false;
}
