"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are blob object URLs */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAllFaces,
  getAllPhotos,
  getClusters,
  mergeClusters,
  putCluster,
  resetAll,
} from "@/lib/db";
import { parseContact, validateTag } from "@/lib/contacts";
import PersonCard from "@/components/PersonCard";
import type { ClusterRecord, PhotoRecord } from "@/types";

interface PersonView {
  cluster: ClusterRecord;
  cropUrls: string[];
  photoCount: number;
}

interface FormValue {
  name: string;
  contact: string;
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
  const [forms, setForms] = useState<Record<string, FormValue>>({});
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [showValidation, setShowValidation] = useState(false);
  const [showNoFaces, setShowNoFaces] = useState(false);
  const [sending, setSending] = useState(false);
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
        const cropUrls = clusterFaces.slice(0, 4).map((f) => {
          const url = URL.createObjectURL(f.cropBlob);
          urlsRef.current.push(url);
          return url;
        });
        return { cluster, cropUrls, photoCount };
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
    setForms((prev) => {
      const next: Record<string, FormValue> = {};
      for (const view of views) {
        next[view.cluster.id] = prev[view.cluster.id] ?? {
          name: view.cluster.name,
          contact:
            view.cluster.contact.email ?? view.cluster.contact.phone ?? "",
        };
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

  function updateForm(id: string, field: "name" | "contact", value: string) {
    setForms((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  }

  async function persistForm(view: PersonView) {
    const form = forms[view.cluster.id];
    if (!form) return;
    const updated: ClusterRecord = {
      ...view.cluster,
      name: form.name.trim(),
      contact: parseContact(form.contact) ?? {},
    };
    await putCluster(updated);
    setPeople((prev) =>
      prev.map((p) =>
        p.cluster.id === view.cluster.id ? { ...p, cluster: updated } : p
      )
    );
  }

  async function toggleSkip(view: PersonView) {
    const updated = { ...view.cluster, skipped: !view.cluster.skipped };
    await putCluster(updated);
    setPeople((prev) =>
      prev.map((p) =>
        p.cluster.id === view.cluster.id ? { ...p, cluster: updated } : p
      )
    );
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

  function errorFor(view: PersonView): string | null {
    if (!showValidation) return null;
    const form = forms[view.cluster.id];
    const result = validateTag(form?.name ?? "", form?.contact ?? "");
    return result.ok ? null : result.error ?? null;
  }

  async function handleSend() {
    setShowValidation(true);
    const active = people.filter((p) => !p.cluster.skipped);
    if (active.length === 0) return;
    const allValid = active.every((p) => {
      const form = forms[p.cluster.id];
      return validateTag(form?.name ?? "", form?.contact ?? "").ok;
    });
    if (!allValid) return;

    setSending(true);
    for (const view of active) {
      const form = forms[view.cluster.id];
      await putCluster({
        ...view.cluster,
        name: form.name.trim(),
        contact: parseContact(form.contact)!,
        sent: true,
      });
    }
    onSent();
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

  const activeCount = people.filter((p) => !p.cluster.skipped).length;
  const invalidCount = showValidation
    ? people.filter((p) => !p.cluster.skipped && errorFor(p) !== null).length
    : 0;

  return (
    <div className="pb-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {people.length} {people.length === 1 ? "person" : "people"} found
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            Tag each person once. Same person in two cards? Merge them.
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
            cropUrls={view.cropUrls}
            photoCount={view.photoCount}
            name={forms[view.cluster.id]?.name ?? ""}
            contact={forms[view.cluster.id]?.contact ?? ""}
            error={errorFor(view)}
            skipped={view.cluster.skipped}
            mergeMode={mergeMode}
            selected={selected.includes(view.cluster.id)}
            onChange={(field, value) => updateForm(view.cluster.id, field, value)}
            onPersist={() => persistForm(view)}
            onToggleSkip={() => toggleSkip(view)}
            onToggleSelect={() => toggleSelect(view.cluster.id)}
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
            {invalidCount > 0
              ? `${invalidCount} ${invalidCount === 1 ? "person needs" : "people need"} a name and contact`
              : activeCount === 0
                ? "Everyone is skipped — include at least one person"
                : `${activeCount} ${activeCount === 1 ? "person" : "people"} will get a link`}
          </p>
          <button
            onClick={handleSend}
            disabled={sending || activeCount === 0}
            className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {sending ? "Preparing…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
