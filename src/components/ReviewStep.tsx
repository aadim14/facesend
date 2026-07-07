"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are blob object URLs */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAllFaces,
  getAllPhotos,
  getClusters,
  getFacesForCluster,
  getPhotosForCluster,
  putCluster,
  resetAll,
  retryFailedPhotos,
  splitCluster,
} from "@/lib/db";
import { smartEjectSet } from "@/lib/face/cluster";
import { newId } from "@/lib/id";
import { sharePersonGallery } from "@/lib/share";
import PersonCard from "@/components/PersonCard";
import type { ClusterRecord, PhotoRecord } from "@/types";

interface DeliveryStatus {
  note: string;
  tone: "neutral" | "error";
}

interface PersonView {
  cluster: ClusterRecord;
  crops: { faceId: string; url: string }[];
  faceCount: number;
  photoCount: number;
}

interface Props {
  onSent: () => void;
  onRetry: () => void;
}

export default function ReviewStep({ onSent, onRetry }: Props) {
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
  const [statuses, setStatuses] = useState<Record<string, DeliveryStatus>>({});
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
      deliveredAt: null,
    });
    await load();
  }

  function setStatus(id: string, status: DeliveryStatus | null) {
    setStatuses((prev) => {
      const next = { ...prev };
      if (status) next[id] = status;
      else delete next[id];
      return next;
    });
  }

  async function share(view: PersonView) {
    if (sharingId) return;
    const id = view.cluster.id;
    setSharingId(id);
    try {
      const name = (names[id] ?? "").trim();
      const photos = await getPhotosForCluster(id);
      const result = await sharePersonGallery(name, photos);
      // deliveredAt is set only on a confirmed share — cancel/fail/download don't.
      if (result === "shared") {
        setStatus(id, null);
        await persistCluster(view, {
          deliveredAt: Date.now(),
          deliveryError: undefined,
        });
      } else if (result === "downloaded-zip") {
        setStatus(id, {
          note: "Gallery downloaded — send it to them yourself.",
          tone: "neutral",
        });
      } else if (result === "failed") {
        setStatus(id, { note: "Couldn't send — try again.", tone: "error" });
      }
    } finally {
      setSharingId(null);
    }
  }

  async function retryFailed() {
    if (retrying) return;
    setRetrying(true);
    const reset = await retryFailedPhotos();
    if (reset > 0) onRetry();
    else setRetrying(false);
  }

  async function startOver() {
    if (!window.confirm("Delete all photos and people from this browser?")) return;
    await resetAll();
    window.location.reload();
  }

  const failedBanner = failedCount > 0 && (
    <div className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <span>
        {failedCount} photo{failedCount === 1 ? "" : "s"} couldn&apos;t be
        processed.
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
        {failedCount > 0 ? (
          <>
            <p className="font-medium">
              {failedCount} photo{failedCount === 1 ? "" : "s"} couldn&apos;t be
              processed
            </p>
            <p className="max-w-sm text-sm text-neutral-500">
              Something went wrong reading{" "}
              {failedCount === 1 ? "it" : "them"}. Try again, or start over with
              different photos.
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
              FaceSend groups photos by the people in them, and it couldn&apos;t
              spot any faces here.
            </p>
          </>
        )}
        <button
          onClick={startOver}
          className="text-sm text-neutral-400 underline underline-offset-4 hover:text-neutral-600"
        >
          Start over
        </button>
      </div>
    );
  }

  const active = people.filter((p) => !p.cluster.skipped);
  const sharedCount = active.filter((p) => p.cluster.deliveredAt != null).length;

  return (
    <div className="pb-28">
      {failedBanner}
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

      <div className="grid gap-4 sm:grid-cols-2">
        {people.map((view) => (
          <PersonCard
            key={view.cluster.id}
            crops={view.crops}
            photoCount={view.photoCount}
            name={names[view.cluster.id] ?? ""}
            skipped={view.cluster.skipped}
            delivered={view.cluster.deliveredAt != null}
            statusNote={statuses[view.cluster.id]?.note}
            statusTone={statuses[view.cluster.id]?.tone}
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
              : `${sharedCount} of ${active.length} ${active.length === 1 ? "person" : "people"} sent`}
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
