import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from "idb";
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
const DB_VERSION = 2;

/**
 * Schema evolution. Exported so migrations are unit-testable against a
 * throwaway database. Each version bump lands as a gated block; a returning
 * host on v1 walks straight through to the current version.
 */
export async function upgradeFaceSendDB(
  db: IDBPDatabase<FaceSendDB>,
  oldVersion: number,
  _newVersion: number | null,
  tx: IDBPTransaction<FaceSendDB, ArrayLike<StoreNames<FaceSendDB>>, "versionchange">
): Promise<void> {
  if (oldVersion < 1) {
    db.createObjectStore("photos", { keyPath: "id" });
    const faces = db.createObjectStore("faces", { keyPath: "id" });
    faces.createIndex("by-photo", "photoId");
    faces.createIndex("by-cluster", "clusterId");
    db.createObjectStore("clusters", { keyPath: "id" });
    db.createObjectStore("meta");
  }
  if (oldVersion < 2) {
    // Replace the optimistic `sent` boolean with a confirmed-only
    // `deliveredAt`. Reset every cluster to null: the old flag couldn't
    // distinguish a real send from a zip that merely downloaded, so it's
    // not trustworthy to carry forward — hosts re-confirm delivery.
    const store = tx.objectStore("clusters");
    let cursor = await store.openCursor();
    while (cursor) {
      const migrated = { ...cursor.value, deliveredAt: null } as ClusterRecord & {
        sent?: boolean;
      };
      delete migrated.sent;
      cursor.update(migrated);
      cursor = await cursor.continue();
    }
  }
}

let dbPromise: Promise<IDBPDatabase<FaceSendDB>> | null = null;

/**
 * Open (or reuse) the database connection.
 *
 * The cached promise needs three escape hatches, because without them a
 * single bad moment poisons the whole session:
 *
 * - `.catch` clearing the cache: a rejected open — private browsing, storage
 *   blocked, a corrupt database — otherwise stayed cached as a rejected
 *   promise, so every later call failed for the rest of the session even once
 *   the cause had gone away. Retrying is cheap; being permanently dead is not.
 *
 * - `terminated`: the browser can force-close a connection (eviction, an
 *   IndexedDB backend crash). The cache would keep handing out that dead
 *   handle and every call would throw InvalidStateError forever.
 *
 * - `blocking`/`blocked`: on a future DB_VERSION bump, a second tab holding
 *   the old connection blocks the upgrade. openDB's promise then neither
 *   resolves nor rejects — and page.tsx only catches rejections, so the app
 *   would sit on "Loading…" indefinitely with nothing to report. `blocking`
 *   makes the old tab step aside instead.
 */
function getDB(): Promise<IDBPDatabase<FaceSendDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FaceSendDB>(DB_NAME, DB_VERSION, {
      upgrade: upgradeFaceSendDB,
      blocked() {
        console.warn(
          "[facesend] database upgrade is blocked by another open tab"
        );
      },
      blocking() {
        // Another tab wants to upgrade; release our handle so it can.
        dbPromise?.then((db) => db.close()).catch(() => {});
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

// ---- photos ----

/** One photo per transaction (large Blobs in a single giant transaction are flaky on iOS Safari). */
/**
 * Storage is full. Distinguished from a generic write failure because the two
 * need opposite responses: an unreadable photo means skip it and carry on, a
 * full disk means stop immediately — every remaining write will fail the same
 * way, and telling the host their JPEGs are corrupt is simply wrong.
 */
export class StorageFullError extends Error {
  constructor() {
    super("Storage is full");
    this.name = "StorageFullError";
  }
}

export async function addPhoto(photo: PhotoRecord): Promise<void> {
  const db = await getDB();
  try {
    await db.put("photos", photo);
  } catch (error) {
    if ((error as DOMException)?.name === "QuotaExceededError") {
      throw new StorageFullError();
    }
    throw error;
  }
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

/**
 * Reset photos that failed to process (faceCount -2) back to unprocessed (-1)
 * so a retry re-runs only them. Returns how many were reset.
 */
export async function retryFailedPhotos(): Promise<number> {
  const db = await getDB();
  const tx = db.transaction("photos", "readwrite");
  let reset = 0;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (cursor.value.faceCount === -2) {
      cursor.update({ ...cursor.value, faceCount: -1 });
      reset++;
    }
    cursor = await cursor.continue();
  }
  await tx.done;
  return reset;
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

// ---- merge ledger ----

const MERGE_LINKS_KEY = "mergeLinks";

/**
 * Pairs of face ids the host has confirmed belong to the same person.
 *
 * Clustering re-runs from scratch over every face whenever new photos arrive,
 * which silently undid every merge the host had already done. These are kept
 * as face ids rather than cluster ids because cluster ids are regenerated on
 * every run, whereas a face id is stable for the life of the photo.
 *
 * One link per merge is enough: they're applied as a union-find, so
 * same-person relationships compose transitively.
 */
export async function getMergeLinks(): Promise<[string, string][]> {
  return (await getMeta<[string, string][]>(MERGE_LINKS_KEY)) ?? [];
}

export async function addMergeLink(a: string, b: string): Promise<void> {
  if (!a || !b || a === b) return;
  const links = await getMergeLinks();
  const exists = links.some(
    ([x, y]) => (x === a && y === b) || (x === b && y === a)
  );
  if (exists) return;
  await setMeta(MERGE_LINKS_KEY, [...links, [a, b]]);
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
