"use client";

/* eslint-disable @next/next/no-img-element -- photos are blob object URLs */

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { getCluster, getPhotosForCluster } from "@/lib/db";
import { downloadAllAsZip } from "@/lib/zip";
import type { ClusterRecord, PhotoRecord } from "@/types";

type Status = "loading" | "notfound" | "ready";

export default function SharePage() {
  const params = useParams<{ personId: string }>();
  const [status, setStatus] = useState<Status>("loading");
  const [cluster, setCluster] = useState<ClusterRecord | null>(null);
  const [photos, setPhotos] = useState<{ photo: PhotoRecord; thumbUrl: string }[]>(
    []
  );
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(
    null
  );
  const [downloading, setDownloading] = useState(false);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    const personId = String(params.personId ?? "");
    (async () => {
      const found = personId ? await getCluster(personId) : undefined;
      if (!found) {
        setStatus("notfound");
        return;
      }
      const personPhotos = await getPhotosForCluster(personId);
      if (personPhotos.length === 0) {
        setStatus("notfound");
        return;
      }
      const withUrls = personPhotos.map((photo) => {
        const thumbUrl = URL.createObjectURL(photo.thumbBlob);
        urlsRef.current.push(thumbUrl);
        return { photo, thumbUrl };
      });
      setCluster(found);
      setPhotos(withUrls);
      setStatus("ready");
    })();

    const urls = urlsRef;
    return () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    };
  }, [params.personId]);

  function openLightbox(photo: PhotoRecord) {
    const url = URL.createObjectURL(photo.blob);
    setLightbox({ url, name: photo.name });
  }

  function closeLightbox() {
    if (lightbox) URL.revokeObjectURL(lightbox.url);
    setLightbox(null);
  }

  async function handleDownloadAll() {
    if (!cluster || downloading) return;
    setDownloading(true);
    try {
      await downloadAllAsZip(
        cluster.name || "photos",
        photos.map(({ photo }) => ({ name: photo.name, blob: photo.blob }))
      );
    } finally {
      setDownloading(false);
    }
  }

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-neutral-400">
        Loading…
      </main>
    );
  }

  if (status === "notfound") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-lg font-semibold">
          This link isn&apos;t available here
        </h1>
        <p className="max-w-sm text-sm text-neutral-500">
          FaceSend keeps photos in the browser where they were uploaded. Open
          this link on the device that created it, or ask the sender to
          download and share the photos directly.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-4 py-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-accent">
            FaceSend
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {cluster?.name ? `${cluster.name}'s photos` : "Your photos"}
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            {photos.length} photo{photos.length === 1 ? "" : "s"} from the event
          </p>
        </div>
        <button
          onClick={handleDownloadAll}
          disabled={downloading}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {downloading ? "Zipping…" : `Download all (${photos.length})`}
        </button>
      </header>

      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        {photos.map(({ photo, thumbUrl }) => (
          <button
            key={photo.id}
            onClick={() => openLightbox(photo)}
            className="aspect-square overflow-hidden rounded-lg bg-neutral-100"
          >
            <img
              src={thumbUrl}
              alt={photo.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform hover:scale-105"
            />
          </button>
        ))}
      </div>

      {lightbox && (
        <div
          onClick={closeLightbox}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-4"
        >
          <img
            src={lightbox.url}
            alt={lightbox.name}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </main>
  );
}
