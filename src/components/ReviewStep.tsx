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
import { smartEjectSet } from "@/lib/face/cluster";
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
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [showNoFaces, setShowNoFaces] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
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

  function toggleSelect(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function confirmMerge() {
    if (selected.length < 2) return;
    const [target, ...rest] = selected;
    await mergeClusters(target, rest);
    setMergeMode(false);
    setSelected([]);
    await load();
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

  return (
    <div className="pb-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {people.length} {people.length === 1 ? "person" : "people"} found
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            Share each person their photos — straight to iMessage, WhatsApp,
            or AirDrop. Same person in two cards? Merge them.
          </p>
        </div>
        {people.length >= 2 && (
          <div className="flex gap-2">
            {mergeMode ? (
              <>
                <button
                  onClick={() => {
                    setMergeMode(false);
                    setSelected([]);
                  }}
                  className="rounded-full border border-neutral-200 px-4 py-1.5 text-sm hover:bg-neutral-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmMerge}
                  disabled={selected.length < 2}
                  className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Merge {selected.length >= 2 ? `(${selected.length})` : ""}
                </button>
              </>
            ) : (
              <button
                onClick={() => setMergeMode(true)}
                className="rounded-full border border-neutral-200 px-4 py-1.5 text-sm hover:bg-neutral-50"
              >
                Merge people
              </button>
            )}
          </div>
        )}
      </div>

      {mergeMode && (
        <p className="mb-4 rounded-xl bg-accent-soft px-4 py-2.5 text-sm text-accent">
          Select the cards that show the same person, then tap Merge.
        </p>
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
            mergeMode={mergeMode}
            selected={selected.includes(view.cluster.id)}
            onChange={(value) => updateName(view.cluster.id, value)}
            onPersist={() => persistCluster(view)}
            onToggleSkip={() => toggleSkip(view)}
            onToggleSelect={() => toggleSelect(view.cluster.id)}
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
