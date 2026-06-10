"use client";

/* eslint-disable @next/next/no-img-element -- avatars are blob object URLs */

import { useEffect, useRef, useState } from "react";
import {
  getAllFaces,
  getClusters,
  getPhotosForCluster,
  putCluster,
  resetAll,
} from "@/lib/db";
import { sharePersonPhotos } from "@/lib/share";
import type { ClusterRecord } from "@/types";

interface PersonRow {
  cluster: ClusterRecord;
  avatarUrl: string | null;
  photoCount: number;
}

interface Props {
  onReset: () => void;
}

export default function DoneStep({ onReset }: Props) {
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    (async () => {
      const [clusters, faces] = await Promise.all([getClusters(), getAllFaces()]);
      const result: PersonRow[] = clusters
        .filter((c) => !c.skipped)
        .map((cluster) => {
          const clusterFaces = faces.filter((f) => f.clusterId === cluster.id);
          const photoCount = new Set(clusterFaces.map((f) => f.photoId)).size;
          let avatarUrl: string | null = null;
          if (clusterFaces[0]) {
            avatarUrl = URL.createObjectURL(clusterFaces[0].cropBlob);
            urlsRef.current.push(avatarUrl);
          }
          return { cluster, avatarUrl, photoCount };
        })
        .filter((r) => r.photoCount > 0)
        .sort(
          (a, b) =>
            Number(a.cluster.sent) - Number(b.cluster.sent) ||
            a.cluster.name.localeCompare(b.cluster.name)
        );
      setRows(result);
      setLoading(false);
    })();

    const urls = urlsRef;
    return () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    };
  }, []);

  async function share(row: PersonRow) {
    if (sharingId) return;
    setSharingId(row.cluster.id);
    try {
      const photos = await getPhotosForCluster(row.cluster.id);
      const outcome = await sharePersonPhotos(row.cluster.name, photos);
      if (outcome !== "cancelled" && !row.cluster.sent) {
        const updated = { ...row.cluster, sent: true };
        await putCluster(updated);
        setRows((prev) =>
          prev.map((r) =>
            r.cluster.id === row.cluster.id ? { ...r, cluster: updated } : r
          )
        );
      }
    } finally {
      setSharingId(null);
    }
  }

  async function startOver() {
    if (
      !window.confirm(
        "Start over? This deletes all photos and people from this browser."
      )
    )
      return;
    await resetAll();
    onReset();
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-24 text-sm text-neutral-400">
        Loading…
      </div>
    );
  }

  const unsent = rows.filter((r) => !r.cluster.sent).length;

  return (
    <div className="py-4">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-xl">
          🎉
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">
          {unsent === 0 ? "Everyone has their photos" : "Almost there"}
        </h2>
        <p className="mt-2 text-sm text-neutral-500">
          {unsent === 0
            ? "Every person's photos went out. You can share anyone's set again below."
            : `${unsent} ${unsent === 1 ? "person hasn't" : "people haven't"} been shared yet — send theirs below.`}
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={row.cluster.id}
            className="flex items-center gap-3 rounded-2xl border border-neutral-200 p-3"
          >
            {row.avatarUrl ? (
              <img
                src={row.avatarUrl}
                alt={row.cluster.name || "person"}
                className="h-11 w-11 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="h-11 w-11 shrink-0 rounded-full bg-neutral-100" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {row.cluster.name || "Unnamed"}
              </p>
              <p className="truncate text-xs text-neutral-400">
                {row.photoCount} photo{row.photoCount === 1 ? "" : "s"}
                {row.cluster.sent && (
                  <span className="text-green-600"> · shared ✓</span>
                )}
              </p>
            </div>
            <button
              onClick={() => share(row)}
              disabled={sharingId === row.cluster.id}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                row.cluster.sent
                  ? "border border-neutral-200 hover:bg-neutral-50"
                  : "bg-accent text-white hover:opacity-90"
              }`}
            >
              {sharingId === row.cluster.id
                ? "Sharing…"
                : row.cluster.sent
                  ? "Share again"
                  : "Share"}
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-center text-xs text-neutral-400">
        Photos stay in this browser only. Clearing site data removes them.
      </p>

      <div className="mt-10 text-center">
        <button
          onClick={startOver}
          className="text-sm text-neutral-400 underline underline-offset-4 hover:text-neutral-600"
        >
          Start over with new photos
        </button>
      </div>
    </div>
  );
}
