"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are blob object URLs */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addMergeLink,
  getAllFaces,
  getAllPhotos,
  getClusters,
  getFacesForCluster,
  getPhotosForCluster,
  mergeClusters,
  putCluster,
  resetAll,
  retryFailedPhotos,
  splitCluster,
} from "@/lib/db";
import { smartEjectSet, suggestMerges } from "@/lib/face/cluster";
import type { MergeSuggestion } from "@/lib/face/cluster";
import { newId } from "@/lib/id";
import { importPhotos, MAX_PHOTOS } from "@/lib/import";
import {
  deliverGallery,
  downloadGallery,
  fileShareSupported,
  prepareGalleryFile,
} from "@/lib/share";
import PersonCard from "@/components/PersonCard";
import MergePrompt from "@/components/MergePrompt";
import type { ClusterRecord, PhotoRecord } from "@/types";

interface PersonView {
  cluster: ClusterRecord;
  crops: { faceId: string; url: string }[];
  faceCount: number;
  photoCount: number;
}

interface Props {
  onRetry: () => void;
}

export default function ReviewStep({ onRetry }: Props) {
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<PersonView[]>([]);
  const [failedCount, setFailedCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [noFacePhotos, setNoFacePhotos] = useState<
    { photo: PhotoRecord; url: string }[]
  >([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [showNoFaces, setShowNoFaces] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  // Ephemeral per-session delivery outcome for the desktop download path
  // (a confirmed mobile share is persisted on the cluster as deliveredAt).
  const [statuses, setStatuses] = useState<
    Record<string, "downloaded" | "error" | "missing">
  >({});
  const [canShare, setCanShare] = useState(false);
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const [merging, setMerging] = useState(false);
  // Pairs the host has said "different people" to. Session-scoped on purpose:
  // re-clustering after an eject can legitimately change the answer, and a
  // rejected pair reappearing once is cheaper than storing a permanent no.
  const [rejectedPairs, setRejectedPairs] = useState<Set<string>>(new Set());
  const [photoTotal, setPhotoTotal] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);
  // Pre-built gallery zips keyed by cluster id, so the Send tap can hand the
  // share sheet a ready File (preserving user activation on mobile). Warmed
  // lazily as the host names a person — never all at once (a 22-person event
  // would zip 22 galleries in the background and never finish in time).
  const galleryCache = useRef<Map<string, { name: string; file: File }>>(new Map());
  const warmTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const mounted = useRef(true);

  useEffect(() => {
    setCanShare(fileShareSupported());
  }, []);

  const warmGallery = useCallback(async (clusterId: string, name: string) => {
    try {
      const photos = await getPhotosForCluster(clusterId);
      if (photos.length === 0) return;
      const file = await prepareGalleryFile(name, photos);
      if (mounted.current) galleryCache.current.set(clusterId, { name, file });
    } catch {
      // best-effort warm-up; deliver() rebuilds on demand if the cache misses
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];

    const [clusters, faces, photos] = await Promise.all([
      getClusters(),
      getAllFaces(),
      getAllPhotos(),
    ]);

    const byCluster = new Map<string, typeof faces>();
    for (const face of faces) {
      if (!face.clusterId) continue;
      const list = byCluster.get(face.clusterId) ?? [];
      list.push(face);
      byCluster.set(face.clusterId, list);
    }

    const views: PersonView[] = clusters
      .map((cluster) => {
        const clusterFaces = byCluster.get(cluster.id) ?? [];
        const photoCount = new Set(clusterFaces.map((f) => f.photoId)).size;
        const crops = clusterFaces.slice(0, 4).map((f) => {
          const url = URL.createObjectURL(f.cropBlob);
          urlsRef.current.push(url);
          return { faceId: f.id, url };
        });
        return { cluster, crops, faceCount: clusterFaces.length, photoCount };
      })
      .filter((v) => v.photoCount > 0)
      .sort((a, b) => b.photoCount - a.photoCount);

    const noFaces = photos
      .filter((p) => p.faceCount === 0)
      .map((photo) => {
        const url = URL.createObjectURL(photo.thumbBlob);
        urlsRef.current.push(url);
        return { photo, url };
      });

    // Pairs sitting in the band between our strict auto-merge cutoff and the
    // canonical same-person threshold — i.e. exactly the splits the strict
    // threshold knowingly creates. Skipped people are excluded; the host has
    // already said they don't want a gallery for them.
    setSuggestions(
      suggestMerges(
        views
          .filter((v) => !v.cluster.skipped)
          .map((v) => ({
            clusterId: v.cluster.id,
            descriptors: (byCluster.get(v.cluster.id) ?? []).map(
              (f) => f.descriptor
            ),
          }))
      )
    );

    setPeople(views);
    setPhotoTotal(photos.length);
    setFailedCount(photos.filter((p) => p.faceCount === -2).length);
    setNoFacePhotos(noFaces);
    setNames((prev) => {
      const next: Record<string, string> = {};
      for (const view of views) {
        next[view.cluster.id] = prev[view.cluster.id] ?? view.cluster.name;
      }
      return next;
    });
    setLoading(false);
    galleryCache.current.clear();
    // Galleries are warmed lazily (as a person is named), not eagerly here.
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    const urls = urlsRef;
    const timers = warmTimers;
    return () => {
      mounted.current = false;
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
      timers.current.forEach((t) => clearTimeout(t));
      timers.current.clear();
    };
  }, [load]);

  function scheduleWarm(id: string, name: string) {
    const timers = warmTimers.current;
    const existing = timers.get(id);
    if (existing) clearTimeout(existing);
    // Debounce: warm the gallery ~0.6s after the host stops typing the name,
    // so by the time they tap Send the share sheet has a ready File.
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        warmGallery(id, name.trim());
      }, 600)
    );
  }

  function updateName(id: string, value: string) {
    setNames((prev) => ({ ...prev, [id]: value }));
    scheduleWarm(id, value);
  }

  async function persistCluster(view: PersonView, patch?: Partial<ClusterRecord>) {
    const name = (names[view.cluster.id] ?? view.cluster.name).trim();
    const updated: ClusterRecord = { ...view.cluster, name, ...patch };
    await putCluster(updated);
    setPeople((prev) =>
      prev.map((p) =>
        p.cluster.id === view.cluster.id ? { ...p, cluster: updated } : p
      )
    );
    // Name feeds the gallery header + filename — re-warm so the cached zip matches.
    const cached = galleryCache.current.get(view.cluster.id);
    if (!cached || cached.name !== name) warmGallery(view.cluster.id, name);
    return updated;
  }

  async function toggleSkip(view: PersonView) {
    await persistCluster(view, { skipped: !view.cluster.skipped });
  }

  function pairKey(a: string, b: string): string {
    return [a, b].sort().join("~");
  }

  /**
   * Merge two cards that are the same person.
   *
   * The survivor is whichever card the host has already invested in: a typed
   * name first, then the larger photo set. mergeClusters keeps the target's
   * record, so choosing wrong would silently discard a name they typed.
   */
  async function acceptMerge(a: PersonView, b: PersonView) {
    if (merging) return;
    setMerging(true);
    try {
      const nameOf = (v: PersonView) =>
        (names[v.cluster.id] ?? v.cluster.name).trim();
      const [target, source] =
        (nameOf(a) && !nameOf(b)) ||
        (!!nameOf(a) === !!nameOf(b) && a.photoCount >= b.photoCount)
          ? [a, b]
          : [b, a];

      // Persist the in-flight name first — mergeClusters writes the stored
      // record, which wouldn't include a name still sitting in local state.
      const name = nameOf(target);
      if (name !== target.cluster.name) await persistCluster(target);

      await mergeClusters(target.cluster.id, [source.cluster.id]);
      // Record the decision against face ids, which survive re-clustering —
      // otherwise the next run (adding photos, retrying a failure) silently
      // splits these two apart again and re-asks the same question.
      const anchorA = target.crops[0]?.faceId;
      const anchorB = source.crops[0]?.faceId;
      if (anchorA && anchorB) await addMergeLink(anchorA, anchorB);

      galleryCache.current.delete(target.cluster.id); // photo set changed
      galleryCache.current.delete(source.cluster.id);
      await load();
    } finally {
      if (mounted.current) setMerging(false);
    }
  }

  function rejectMerge(a: string, b: string) {
    setRejectedPairs((prev) => new Set(prev).add(pairKey(a, b)));
  }

  async function ejectFace(view: PersonView, faceId: string) {
    const faces = await getFacesForCluster(view.cluster.id);
    if (faces.length < 2) return;
    const ejectIds = smartEjectSet(
      faces.map((f) => ({ faceId: f.id, descriptor: f.descriptor })),
      faceId
    );
    if (ejectIds.length === 0) return;
    await splitCluster(view.cluster.id, ejectIds, {
      id: newId(),
      name: "",
      contact: {},
      skipped: false,
      deliveredAt: null,
    });
    galleryCache.current.delete(view.cluster.id); // photos changed — rebuild
    await load();
  }

  function setStatus(
    id: string,
    value: "downloaded" | "error" | "missing" | null
  ) {
    setStatuses((prev) => {
      const next = { ...prev };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
  }

  async function share(view: PersonView) {
    if (sharingId) return;
    const id = view.cluster.id;
    const name = (names[id] ?? "").trim();
    setSharingId(id);
    setStatus(id, null);
    try {
      const cached = galleryCache.current.get(id);
      if (cached && cached.name === name) {
        // Warm + correct name: deliver synchronously so the share sheet keeps
        // its user activation (the first await is navigator.share itself).
        const result = await deliverGallery(name, cached.file);
        if (result === "shared") {
          await persistCluster(view, {
            deliveredAt: Date.now(),
            deliveryError: undefined,
          });
        } else if (result === "downloaded-zip") {
          setStatus(id, "downloaded");
        }
        // "cancelled" → leave as-is
      } else {
        // Not warmed yet: building the zip now would burn the click's
        // activation, so download directly instead of failing the share sheet.
        const photos = await getPhotosForCluster(id);
        if (photos.length === 0) {
          // Faces still point at this cluster but their photos are gone —
          // evicted storage, or a half-finished reset. Say so rather than
          // handing over an empty zip and calling it delivered.
          setStatus(id, "missing");
          return;
        }
        const file = await prepareGalleryFile(name, photos);
        galleryCache.current.set(id, { name, file });
        downloadGallery(file);
        setStatus(id, "downloaded");
      }
    } catch {
      setStatus(id, "error");
    } finally {
      if (mounted.current) setSharingId(null);
    }
  }

  async function retryFailed() {
    if (retrying) return;
    setRetrying(true);
    const reset = await retryFailedPhotos();
    if (reset > 0) onRetry();
    else setRetrying(false);
  }

  /**
   * Add a second batch of photos to the event already in progress.
   *
   * Until now the only route out of this screen was startOver(), which
   * deletes everything — so a host who took more photos, or who imported
   * half the camera roll by mistake, had to re-run detection over the whole
   * set and re-type every name. New photos land as unprocessed and
   * ProcessingStep detects only those, then re-clusters; names and confirmed
   * merges survive that (see the merge ledger and name inheritance).
   */
  async function addMorePhotos(fileList: FileList | File[]) {
    if (adding) return;
    setAdding(true);
    try {
      const { imported, notices, storageFull } = await importPhotos(fileList, {
        budget: MAX_PHOTOS - photoTotal,
      });
      if (imported > 0) {
        onRetry(); // -> processing, which picks up only the unprocessed photos
        return;
      }
      setAddNotice(
        storageFull
          ? "There's no room left in this browser's storage."
          : notices.join(" · ") || "Those files don't look like photos."
      );
    } finally {
      if (mounted.current) setAdding(false);
    }
  }

  async function startOver() {
    if (!window.confirm("Delete all photos and people from this browser?")) return;
    await resetAll();
    window.location.reload();
  }

  function isDone(view: PersonView): boolean {
    return view.cluster.deliveredAt != null || statuses[view.cluster.id] === "downloaded";
  }

  function actionLabel(view: PersonView): string {
    if (sharingId === view.cluster.id) return canShare ? "Opening share…" : "Preparing…";
    // "Shared", not "Sent": handing a file to the OS share sheet is all this
    // app can observe. Whether the host actually completed the send in
    // Messages is not reported back to the page, so claiming "Sent" asserts
    // something we don't know.
    if (isDone(view)) return canShare ? "Shared ✓ · Share again" : "Downloaded ✓ · Again";
    return canShare ? "Share their photos" : "Download their gallery";
  }

  function noteFor(view: PersonView): { note?: string; tone: "ok" | "error" | "neutral" } {
    const id = view.cluster.id;
    if (statuses[id] === "error") return { note: "Couldn't send — try again.", tone: "error" };
    if (statuses[id] === "missing")
      return {
        note: "Their photos are missing from this browser — try reprocessing.",
        tone: "error",
      };
    if (statuses[id] === "downloaded")
      return { note: "Downloaded ✓ — now send it to them.", tone: "ok" };
    if (view.cluster.deliveredAt != null) return { tone: "ok" };
    return { tone: "neutral" };
  }

  const atPhotoLimit = photoTotal >= MAX_PHOTOS;

  /** Shared by the empty state and the footer — both need a way forward. */
  const addPhotosControl = (
    <>
      <button
        onClick={() => addInputRef.current?.click()}
        disabled={adding || atPhotoLimit}
        className="text-sm font-medium text-accent underline underline-offset-4 hover:opacity-80 disabled:opacity-40"
      >
        {adding
          ? "Adding…"
          : atPhotoLimit
            ? `At the ${MAX_PHOTOS}-photo limit`
            : "Add more photos"}
      </button>
      <input
        ref={addInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) addMorePhotos(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24 text-sm text-neutral-400">
        Loading people…
      </div>
    );
  }

  const failedBanner = failedCount > 0 && (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span>
        {failedCount} photo{failedCount === 1 ? "" : "s"} couldn&apos;t be processed.
      </span>
      <button
        onClick={retryFailed}
        disabled={retrying}
        className="shrink-0 rounded-full bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {retrying ? "Retrying…" : "Try again"}
      </button>
    </div>
  );

  if (people.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
        {failedCount > 0 ? (
          <>
            <p className="font-medium">
              {failedCount} photo{failedCount === 1 ? "" : "s"} couldn&apos;t be processed
            </p>
            <p className="max-w-sm text-sm text-neutral-500">
              Something went wrong reading {failedCount === 1 ? "it" : "them"}. Try
              again, or start over with different photos.
            </p>
            <button
              onClick={retryFailed}
              disabled={retrying}
              className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {retrying ? "Retrying…" : "Try again"}
            </button>
          </>
        ) : (
          <>
            <p className="font-medium">No faces found in these photos</p>
            <p className="max-w-sm text-sm text-neutral-500">
              FaceSend groups photos by the people in them, and it couldn&apos;t spot
              any faces in {photoTotal === 1 ? "this photo" : `these ${photoTotal} photos`}.
              Adding shots where faces are larger or better lit usually helps.
            </p>
          </>
        )}
        {/* This screen used to offer nothing but "Start over", which deletes
            every imported photo — a dead end for the one case where the host
            has the most to lose. */}
        {addPhotosControl}
        {addNotice && <p className="text-xs text-amber-600">{addNotice}</p>}
        <button
          onClick={startOver}
          className="text-sm text-neutral-400 underline underline-offset-4 hover:text-neutral-600"
        >
          Start over
        </button>
      </div>
    );
  }

  // Resolve suggestions against the current people list: a pair is live only
  // if both cards still exist, neither is skipped, and the host hasn't already
  // said they're different. One question at a time — a wall of "same person?"
  // prompts is worse than the duplicates it's trying to fix.
  const byId = new Map(people.map((p) => [p.cluster.id, p]));
  const pendingSuggestions = suggestions
    .filter((s) => !rejectedPairs.has(pairKey(s.a, s.b)))
    .map((s) => ({ a: byId.get(s.a), b: byId.get(s.b), distance: s.distance }))
    .filter(
      (s): s is { a: PersonView; b: PersonView; distance: number } =>
        s.a != null && s.b != null && !s.a.cluster.skipped && !s.b.cluster.skipped
    );
  const activeSuggestion = pendingSuggestions[0];

  const active = people.filter((p) => !p.cluster.skipped);
  const doneCount = active.filter((p) => isDone(p)).length;
  const allDone = active.length > 0 && doneCount === active.length;
  const pct = active.length ? Math.round((doneCount / active.length) * 100) : 0;

  return (
    <div className="pb-16">
      {failedBanner}

      <div className="mb-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          {people.length} {people.length === 1 ? "person" : "people"} found
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          {canShare
            ? "Send each person their photos — straight to Messages, WhatsApp, or AirDrop."
            : "Download each person's gallery, then send it to them. On a phone, FaceSend can share it straight to Messages or WhatsApp."}
        </p>
      </div>

      {/* progress */}
      <div className="mb-6">
        <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          <span className="font-medium text-neutral-700">{doneCount}</span> of{" "}
          {active.length} {canShare ? "sent" : "downloaded"}
        </p>
      </div>

      {allDone && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
            ✓
          </span>
          <div className="text-sm">
            <p className="font-medium text-green-800">
              {canShare ? "Everyone has their photos 🎉" : "All galleries ready 🎉"}
            </p>
            <p className="text-green-700">
              {canShare
                ? "You can send anyone's again below."
                : "Send each downloaded gallery to its person."}
            </p>
          </div>
        </div>
      )}

      {activeSuggestion && (
        <MergePrompt
          a={{
            name: names[activeSuggestion.a.cluster.id] ?? "",
            photoCount: activeSuggestion.a.photoCount,
            crops: activeSuggestion.a.crops,
          }}
          b={{
            name: names[activeSuggestion.b.cluster.id] ?? "",
            photoCount: activeSuggestion.b.photoCount,
            crops: activeSuggestion.b.crops,
          }}
          remaining={pendingSuggestions.length}
          working={merging}
          onMerge={() =>
            acceptMerge(activeSuggestion.a, activeSuggestion.b)
          }
          onDismiss={() =>
            rejectMerge(
              activeSuggestion.a.cluster.id,
              activeSuggestion.b.cluster.id
            )
          }
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {people.map((view) => {
          const note = noteFor(view);
          return (
            <PersonCard
              key={view.cluster.id}
              crops={view.crops}
              photoCount={view.photoCount}
              name={names[view.cluster.id] ?? ""}
              skipped={view.cluster.skipped}
              done={isDone(view)}
              working={sharingId === view.cluster.id}
              actionLabel={actionLabel(view)}
              statusNote={note.note}
              statusTone={note.tone}
              canEject={view.faceCount >= 2}
              onChange={(value) => updateName(view.cluster.id, value)}
              onPersist={() => persistCluster(view)}
              onToggleSkip={() => toggleSkip(view)}
              onShare={() => share(view)}
              onEjectFace={(faceId) => ejectFace(view, faceId)}
            />
          );
        })}
      </div>

      {noFacePhotos.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowNoFaces((s) => !s)}
            className="text-sm font-medium text-neutral-500 hover:text-neutral-700"
          >
            {showNoFaces ? "▾" : "▸"} No faces found ({noFacePhotos.length} photo
            {noFacePhotos.length === 1 ? "" : "s"})
          </button>
          {showNoFaces && (
            <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {noFacePhotos.map(({ photo, url }) => (
                <img
                  key={photo.id}
                  src={url}
                  alt={photo.name}
                  className="aspect-square w-full rounded-lg object-cover"
                />
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-neutral-400">
            These photos won&apos;t be sent to anyone.
          </p>
        </div>
      )}

      <div className="mt-12 flex flex-col items-center gap-3 text-center">
        {addPhotosControl}
        {addNotice && <p className="text-xs text-amber-600">{addNotice}</p>}
        <p className="text-xs text-neutral-400">
          {photoTotal} photo{photoTotal === 1 ? "" : "s"} in this event · names
          and merges are kept when you add more
        </p>
        <button
          onClick={startOver}
          className="mt-2 text-sm text-neutral-400 underline underline-offset-4 hover:text-neutral-600"
        >
          Start over with new photos
        </button>
      </div>
    </div>
  );
}
