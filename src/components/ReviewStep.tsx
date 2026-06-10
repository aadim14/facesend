"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are blob object URLs */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAllFaces,
  getAllPhotos,
  getClusters,
  getFacesForCluster,
  getPhotosForCluster,
  mergeClusters,
  putCluster,
  resetAll,
  splitCluster,
} from "@/lib/db";
import {
  smartEjectSet,
  suggestMerges,
  type MergeSuggestion,
} from "@/lib/face/cluster";
import { newId } from "@/lib/id";
import { sharePersonPhotos } from "@/lib/share";
import PersonCard from "@/components/PersonCard";
import type { ClusterRecord, PhotoRecord } from "@/types";

interface PersonView {
  cluster: ClusterRecord;
  crops: { faceId: string; url: string }[];
  faceCount: number;
  photoCount: number;
}

interface Props {
  onSent: () => void;
}

export default function ReviewStep({ onSent }: Props) {
  const [loading, setLoading] = useState(true);
  const [people, setPeople] = useState<PersonView[]>([]);
  const [noFacePhotos, setNoFacePhotos] = useState<
    { photo: PhotoRecord; url: string }[]
  >([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [showNoFaces, setShowNoFaces] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const dismissedRef = useRef<Set<string>>(new Set());
  const urlsRef = useRef<string[]>([]);

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

    const visibleIds = new Set(views.map((v) => v.cluster.id));
    setSuggestions(
      suggestMerges(
        [...byCluster.entries()]
          .filter(([clusterId]) => visibleIds.has(clusterId))
          .map(([clusterId, clusterFaces]) => ({
            clusterId,
            descriptors: clusterFaces.map((f) => f.descriptor),
          }))
      )
    );

    setPeople(views);
    setNoFacePhotos(noFaces);
    setNames((prev) => {
      const next: Record<string, string> = {};
      for (const view of views) {
        next[view.cluster.id] = prev[view.cluster.id] ?? view.cluster.name;
      }
      return next;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const urls = urlsRef;
    return () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    };
  }, [load]);

  function updateName(id: string, value: string) {
    setNames((prev) => ({ ...prev, [id]: value }));
  }

  async function persistCluster(view: PersonView, patch?: Partial<ClusterRecord>) {
    const updated: ClusterRecord = {
      ...view.cluster,
      name: (names[view.cluster.id] ?? view.cluster.name).trim(),
      ...patch,
    };
    await putCluster(updated);
    setPeople((prev) =>
      prev.map((p) =>
        p.cluster.id === view.cluster.id ? { ...p, cluster: updated } : p
      )
    );
    return updated;
  }

  async function toggleSkip(view: PersonView) {
    await persistCluster(view, { skipped: !view.cluster.skipped });
  }

  function pairKey(s: MergeSuggestion): string {
    return [s.a, s.b].sort().join("|");
  }

  async function acceptSuggestion(s: MergeSuggestion) {
    await mergeClusters(s.a, [s.b]);
    await load();
  }

  function dismissSuggestion(s: MergeSuggestion) {
    dismissedRef.current.add(pairKey(s));
    setSuggestions((prev) => prev.filter((x) => pairKey(x) !== pairKey(s)));
  }

  async function ejectFace(view: PersonView, faceId: string) {
    const faces = await getFacesForCluster(view.cluster.id);
    if (faces.length < 2) return; // nothing to split from
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
      sent: false,
    });
    await load();
  }

  async function share(view: PersonView) {
    if (sharingId) return;
    setSharingId(view.cluster.id);
    try {
      const name = (names[view.cluster.id] ?? "").trim();
      const photos = await getPhotosForCluster(view.cluster.id);
      const outcome = await sharePersonPhotos(name, photos);
      if (outcome !== "cancelled") {
        await persistCluster(view, { sent: true });
      }
    } finally {
      setSharingId(null);
    }
  }

  async function startOver() {
    if (!window.confirm("Delete all photos and people from this browser?")) return;
    await resetAll();
    window.location.reload();
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24 text-sm text-neutral-400">
        Loading people…
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
        <p className="font-medium">No faces found in these photos</p>
        <p className="max-w-sm text-sm text-neutral-500">
          FaceSend groups photos by the people in them, and it couldn&apos;t
          spot any faces here.
        </p>
        <button
          onClick={startOver}
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Start over
        </button>
      </div>
    );
  }

  const active = people.filter((p) => !p.cluster.skipped);
  const sharedCount = active.filter((p) => p.cluster.sent).length;

  const viewById = new Map(people.map((p) => [p.cluster.id, p]));
  const pendingSuggestions = suggestions.filter(
    (s) =>
      !dismissedRef.current.has(pairKey(s)) &&
      viewById.has(s.a) &&
      viewById.has(s.b)
  );
  const suggestion = pendingSuggestions[0];
  const suggestionViews = suggestion
    ? ([viewById.get(suggestion.a)!, viewById.get(suggestion.b)!] as const)
    : null;

  return (
    <div className="pb-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {people.length} {people.length === 1 ? "person" : "people"} found
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            Share each person their photos — straight to iMessage, WhatsApp,
            or AirDrop.
          </p>
        </div>
      </div>

      {suggestion && suggestionViews && (
        <div className="mb-5 rounded-2xl border border-accent/30 bg-accent-soft/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                Same person?
                {pendingSuggestions.length > 1 && (
                  <span className="ml-2 text-xs font-normal text-neutral-400">
                    {pendingSuggestions.length} suggestions
                  </span>
                )}
              </p>
              <div className="mt-2 flex items-center gap-3">
                {suggestionViews.map((view, i) => (
                  <div key={view.cluster.id} className="flex items-center gap-3">
                    {i === 1 && <span className="text-neutral-300">+</span>}
                    <span className="flex items-center gap-1.5">
                      {view.crops.slice(0, 2).map((crop) => (
                        <img
                          key={crop.faceId}
                          src={crop.url}
                          alt="face"
                          className="h-12 w-12 rounded-full border border-white object-cover"
                        />
                      ))}
                      <span className="ml-1 text-xs text-neutral-500">
                        {names[view.cluster.id]?.trim() ||
                          `${view.photoCount} photo${view.photoCount === 1 ? "" : "s"}`}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => acceptSuggestion(suggestion)}
                className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Merge
              </button>
              <button
                onClick={() => dismissSuggestion(suggestion)}
                className="rounded-full border border-neutral-200 bg-white px-4 py-1.5 text-sm hover:bg-neutral-50"
              >
                Not the same
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {people.map((view) => (
          <PersonCard
            key={view.cluster.id}
            crops={view.crops}
            photoCount={view.photoCount}
            name={names[view.cluster.id] ?? ""}
            skipped={view.cluster.skipped}
            sent={view.cluster.sent}
            sharing={sharingId === view.cluster.id}
            canEject={view.faceCount >= 2}
            onChange={(value) => updateName(view.cluster.id, value)}
            onPersist={() => persistCluster(view)}
            onToggleSkip={() => toggleSkip(view)}
            onShare={() => share(view)}
            onEjectFace={(faceId) => ejectFace(view, faceId)}
          />
        ))}
      </div>

      {noFacePhotos.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowNoFaces((s) => !s)}
            className="text-sm font-medium text-neutral-500 hover:text-neutral-700"
          >
            {showNoFaces ? "▾" : "▸"} No faces found ({noFacePhotos.length}{" "}
            photo{noFacePhotos.length === 1 ? "" : "s"})
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

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-100 bg-white/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <p className="text-xs text-neutral-400">
            {active.length === 0
              ? "Everyone is skipped — include at least one person"
              : `${sharedCount} of ${active.length} ${active.length === 1 ? "person" : "people"} shared`}
          </p>
          <button
            onClick={onSent}
            disabled={active.length === 0}
            className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Finish
          </button>
        </div>
      </div>
    </div>
  );
}
