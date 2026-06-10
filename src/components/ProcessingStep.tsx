"use client";

/* eslint-disable @next/next/no-img-element -- face crops are blob object URLs */

import { useEffect, useRef, useState } from "react";
import {
  addFaces,
  getAllFaces,
  getAllPhotos,
  replaceClusters,
  setPhotoFaceCount,
} from "@/lib/db";
import { newId } from "@/lib/id";
import { getActiveBackend, loadFaceApi } from "@/lib/face/models";
import { detectFacesInPhoto } from "@/lib/face/detect";
import { clusterDescriptors, IncrementalClusterer } from "@/lib/face/cluster";
import type { ClusterRecord } from "@/types";

type Phase = "models" | "detecting" | "clustering";

interface Props {
  onComplete: () => void;
  onEmpty: () => void;
}

interface LiveCard {
  /** First face of the provisional cluster — stable across snapshots. */
  anchor: string;
  cropUrls: string[];
  count: number;
}

const PHASE_LABEL: Record<Phase, string> = {
  models: "Loading face recognition…",
  detecting: "Detecting faces",
  clustering: "Grouping people…",
};

export default function ProcessingStep({ onComplete, onEmpty }: Props) {
  const started = useRef(false);
  const [phase, setPhase] = useState<Phase>("models");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [facesFound, setFacesFound] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [cards, setCards] = useState<LiveCard[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  // The async loop closes over stale state; names live in a ref it can read.
  const namesRef = useRef<Record<string, string>>({});
  const cropUrlsRef = useRef<Map<string, string>>(new Map());

  function setName(anchor: string, value: string) {
    namesRef.current = { ...namesRef.current, [anchor]: value };
    setNames(namesRef.current);
  }

  useEffect(() => {
    // The started ref (not an effect-cleanup cancel flag) guards re-entry:
    // React StrictMode in dev runs effect → cleanup → effect on mount, and a
    // cleanup-based cancel would kill the one allowed run right after the
    // models load. The component only unmounts when this run advances the
    // step, so letting the run finish is always correct.
    if (started.current) return;
    started.current = true;

    (async () => {
      const photos = await getAllPhotos();
      if (photos.length === 0) {
        onEmpty();
        return;
      }

      setPhase("models");
      await loadFaceApi();
      setBackend(getActiveBackend());

      // Only photos not processed yet — a reload mid-run resumes where it left off.
      const pending = photos.filter((p) => p.faceCount === -1);
      const alreadyDone = photos.length - pending.length;
      setPhase("detecting");
      setProgress({ done: alreadyDone, total: photos.length });

      const existing = await getAllFaces();
      let found = existing.length;
      setFacesFound(found);

      // Provisional grouping for the live labeling cards. Seed with faces
      // already in the DB so a mid-run reload still shows groups.
      const clusterer = new IncrementalClusterer();
      for (const face of existing) {
        clusterer.add({ faceId: face.id, descriptor: face.descriptor });
        if (!cropUrlsRef.current.has(face.id)) {
          cropUrlsRef.current.set(face.id, URL.createObjectURL(face.cropBlob));
        }
      }
      const appearanceOrder = new Map<string, number>();

      function refreshCards() {
        const snapshot = clusterer
          .snapshot()
          .filter((c) => c.faceIds.length >= 2);
        for (const c of snapshot) {
          if (!appearanceOrder.has(c.faceIds[0])) {
            appearanceOrder.set(c.faceIds[0], appearanceOrder.size);
          }
        }
        // Append-only ordering so cards never reshuffle under the host's fingers.
        const next = snapshot
          .map((c) => ({
            anchor: c.faceIds[0],
            count: c.faceIds.length,
            cropUrls: c.faceIds
              .slice(0, 4)
              .map((id) => cropUrlsRef.current.get(id))
              .filter((u): u is string => !!u),
          }))
          .sort(
            (a, b) =>
              appearanceOrder.get(a.anchor)! - appearanceOrder.get(b.anchor)!
          );
        setCards(next);
      }
      refreshCards();

      const durations: number[] = [];
      for (let i = 0; i < pending.length; i++) {
        const photo = pending[i];
        const startedAt = performance.now();
        try {
          const detected = await detectFacesInPhoto(photo.blob);
          const records = detected.map((d) => ({
            id: newId(),
            photoId: photo.id,
            clusterId: null,
            descriptor: d.descriptor,
            box: d.box,
            cropBlob: d.cropBlob,
          }));
          await addFaces(records);
          await setPhotoFaceCount(photo.id, detected.length);
          for (const record of records) {
            clusterer.add({ faceId: record.id, descriptor: record.descriptor });
            cropUrlsRef.current.set(
              record.id,
              URL.createObjectURL(record.cropBlob)
            );
          }
          refreshCards();
          found += detected.length;
          setFacesFound(found);
        } catch {
          // One unreadable/failed photo must not kill the batch.
          await setPhotoFaceCount(photo.id, 0);
        }
        setProgress({ done: alreadyDone + i + 1, total: photos.length });
        // The first photo includes one-time GPU shader warm-up — exclude it
        // from the estimate when we have better samples.
        durations.push(performance.now() - startedAt);
        const samples = durations.length > 1 ? durations.slice(1) : durations;
        const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
        setEtaSeconds(Math.ceil((avg * (pending.length - i - 1)) / 1000));
      }

      setPhase("clustering");
      const faces = await getAllFaces();
      const grouped = clusterDescriptors(
        faces.map((f) => ({ faceId: f.id, descriptor: f.descriptor }))
      );
      const records: ClusterRecord[] = [];
      const assignments = new Map<string, string>();
      const recordById = new Map<string, ClusterRecord>();
      for (const group of grouped) {
        const record: ClusterRecord = {
          id: newId(),
          name: "",
          contact: {},
          skipped: false,
          sent: false,
        };
        records.push(record);
        recordById.set(record.id, record);
        for (const faceId of group.faceIds) assignments.set(faceId, record.id);
      }
      // Carry names typed during processing into the final clusters: each
      // name follows its anchor face into whichever cluster it ended up in.
      for (const [anchor, value] of Object.entries(namesRef.current)) {
        const name = value.trim();
        if (!name) continue;
        const clusterId = assignments.get(anchor);
        if (!clusterId) continue;
        const record = recordById.get(clusterId);
        if (record && !record.name) record.name = name;
      }
      await replaceClusters(records, assignments);
      onComplete();
    })().catch((e) => {
      setError(
        e instanceof Error ? e.message : "Something went wrong while processing."
      );
    });
  }, [onComplete, onEmpty, attempt]);

  useEffect(() => {
    const cropUrls = cropUrlsRef;
    return () => {
      cropUrls.current.forEach((u) => URL.revokeObjectURL(u));
      cropUrls.current.clear();
    };
  }, []);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
        <p className="text-sm font-medium text-red-600">
          Couldn&apos;t finish processing
        </p>
        <p className="max-w-sm text-sm text-neutral-500">{error}</p>
        <button
          onClick={() => {
            setError(null);
            started.current = false;
            setAttempt((a) => a + 1);
          }}
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Try again
        </button>
      </div>
    );
  }

  const pct =
    progress.total === 0
      ? 0
      : Math.round((progress.done / progress.total) * 100);

  return (
    <div className="flex flex-1 flex-col gap-6 py-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-sm font-medium">
          {PHASE_LABEL[phase]}
          {phase === "detecting" && (
            <span className="text-neutral-400">
              {" "}
              {progress.done} / {progress.total}
            </span>
          )}
        </p>
        <div className="h-1.5 w-64 overflow-hidden rounded-full bg-neutral-100">
          <div
            className={`h-full rounded-full bg-accent transition-all ${
              phase !== "detecting" ? "animate-pulse" : ""
            }`}
            style={{ width: phase === "detecting" ? `${pct}%` : "100%" }}
          />
        </div>
        {phase === "detecting" && (
          <p className="text-xs text-neutral-400">
            {facesFound} face{facesFound === 1 ? "" : "s"} found so far
            {etaSeconds !== null && etaSeconds > 0 && (
              <>
                {" · about "}
                {etaSeconds >= 90
                  ? `${Math.ceil(etaSeconds / 60)} min`
                  : `${etaSeconds}s`}{" "}
                left
              </>
            )}
          </p>
        )}
        {backend === "cpu" && (
          <p className="max-w-sm text-xs text-amber-600">
            No GPU acceleration available in this browser, so recognition runs
            much slower. Chrome or Edge with hardware acceleration enabled is
            dramatically faster.
          </p>
        )}
      </div>

      {cards.length > 0 && phase === "detecting" && (
        <div>
          <p className="mb-3 text-sm text-neutral-500">
            People found so far — start naming them while the rest process.
            You can fix groups and share on the next screen.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {cards.map((card) => (
              <div
                key={card.anchor}
                className="rounded-2xl border border-neutral-200 p-3"
              >
                <div className="flex items-center gap-2">
                  {card.cropUrls.map((url, i) => (
                    <img
                      key={i}
                      src={url}
                      alt="face"
                      className="h-10 w-10 rounded-full border border-neutral-100 object-cover"
                    />
                  ))}
                  <span className="ml-1 text-xs text-neutral-400">
                    ×{card.count}
                  </span>
                </div>
                <input
                  type="text"
                  value={names[card.anchor] ?? ""}
                  placeholder="Name (optional)"
                  onChange={(e) => setName(card.anchor, e.target.value)}
                  className="mt-2 w-full rounded-xl border border-neutral-200 px-3 py-1.5 text-sm outline-none transition-colors focus:border-accent"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
