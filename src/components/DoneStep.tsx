"use client";

/* eslint-disable @next/next/no-img-element -- avatars are blob object URLs */

import { useEffect, useRef, useState } from "react";
import { getAllFaces, getClusters, resetAll } from "@/lib/db";
import type { ClusterRecord } from "@/types";

interface PersonLink {
  cluster: ClusterRecord;
  avatarUrl: string | null;
  photoCount: number;
  url: string;
}

interface Props {
  onReset: () => void;
}

export default function DoneStep({ onReset }: Props) {
  const [links, setLinks] = useState<PersonLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    (async () => {
      const [clusters, faces] = await Promise.all([getClusters(), getAllFaces()]);
      const origin = window.location.origin;
      const result: PersonLink[] = clusters
        .filter((c) => c.sent && !c.skipped)
        .map((cluster) => {
          const clusterFaces = faces.filter((f) => f.clusterId === cluster.id);
          const photoCount = new Set(clusterFaces.map((f) => f.photoId)).size;
          let avatarUrl: string | null = null;
          if (clusterFaces[0]) {
            avatarUrl = URL.createObjectURL(clusterFaces[0].cropBlob);
            urlsRef.current.push(avatarUrl);
          }
          return {
            cluster,
            avatarUrl,
            photoCount,
            url: `${origin}/p/${cluster.id}`,
          };
        })
        .sort((a, b) => a.cluster.name.localeCompare(b.cluster.name));
      setLinks(result);
      setLoading(false);
    })();

    const urls = urlsRef;
    return () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
    };
  }, []);

  async function copy(link: PersonLink) {
    try {
      await navigator.clipboard.writeText(link.url);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = link.url;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopiedId(link.cluster.id);
    setTimeout(() => setCopiedId((id) => (id === link.cluster.id ? null : id)), 2000);
  }

  async function startOver() {
    if (
      !window.confirm(
        "Start over? This deletes all photos, people, and links from this browser."
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

  return (
    <div className="py-4">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-xl">
          🎉
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">
          Links are ready
        </h2>
        <p className="mt-2 text-sm text-neutral-500">
          Each person gets a page with just their photos. Copy a link and send
          it however you like.
        </p>
      </div>

      <ul className="flex flex-col gap-3">
        {links.map((link) => (
          <li
            key={link.cluster.id}
            className="flex items-center gap-3 rounded-2xl border border-neutral-200 p-3"
          >
            {link.avatarUrl ? (
              <img
                src={link.avatarUrl}
                alt={link.cluster.name}
                className="h-11 w-11 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span className="h-11 w-11 shrink-0 rounded-full bg-neutral-100" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{link.cluster.name}</p>
              <p className="truncate text-xs text-neutral-400">
                {link.photoCount} photo{link.photoCount === 1 ? "" : "s"} ·{" "}
                {link.cluster.contact.email ?? link.cluster.contact.phone}
              </p>
            </div>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-neutral-200 px-3.5 py-1.5 text-xs font-medium hover:bg-neutral-50"
            >
              Open
            </a>
            <button
              onClick={() => copy(link)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                copiedId === link.cluster.id
                  ? "bg-green-50 text-green-600"
                  : "bg-accent text-white hover:opacity-90"
              }`}
            >
              {copiedId === link.cluster.id ? "Copied ✓" : "Copy link"}
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-6 text-center text-xs text-neutral-400">
        Links open on this device&apos;s browser, where the photos are stored.
        Clearing site data removes them.
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
