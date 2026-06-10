"use client";

import { useEffect, useRef, useState } from "react";
import {
  addFaces,
  getAllFaces,
  getAllPhotos,
  replaceClusters,
  setPhotoFaceCount,
} from "@/lib/db";
import { loadFaceApi } from "@/lib/face/models";
import { detectFacesInPhoto } from "@/lib/face/detect";
import { clusterDescriptors } from "@/lib/face/cluster";
import type { ClusterRecord } from "@/types";

type Phase = "models" | "detecting" | "clustering";

interface Props {
  onComplete: () => void;
  onEmpty: () => void;
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
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let cancelled = false;

    (async () => {
      const photos = await getAllPhotos();
      if (photos.length === 0) {
        onEmpty();
        return;
      }

      setPhase("models");
      await loadFaceApi();
      if (cancelled) return;

      // Only photos not processed yet — a reload mid-run resumes where it left off.
      const pending = photos.filter((p) => p.faceCount === -1);
      const alreadyDone = photos.length - pending.length;
      setPhase("detecting");
      setProgress({ done: alreadyDone, total: photos.length });

      let found = (await getAllFaces()).length;
      setFacesFound(found);

      for (let i = 0; i < pending.length; i++) {
        if (cancelled) return;
        const photo = pending[i];
        try {
          const detected = await detectFacesInPhoto(photo.blob);
          await addFaces(
            detected.map((d) => ({
              id: crypto.randomUUID(),
              photoId: photo.id,
              clusterId: null,
              descriptor: d.descriptor,
              box: d.box,
              cropBlob: d.cropBlob,
            }))
          );
          await setPhotoFaceCount(photo.id, detected.length);
          found += detected.length;
          setFacesFound(found);
        } catch {
          // One unreadable/failed photo must not kill the batch.
          await setPhotoFaceCount(photo.id, 0);
        }
        setProgress({ done: alreadyDone + i + 1, total: photos.length });
      }

      setPhase("clustering");
      const faces = await getAllFaces();
      const grouped = clusterDescriptors(
        faces.map((f) => ({ faceId: f.id, descriptor: f.descriptor }))
      );
      const records: ClusterRecord[] = [];
      const assignments = new Map<string, string>();
      for (const group of grouped) {
        const record: ClusterRecord = {
          id: crypto.randomUUID(),
          name: "",
          contact: {},
          skipped: false,
          sent: false,
        };
        records.push(record);
        for (const faceId of group.faceIds) assignments.set(faceId, record.id);
      }
      await replaceClusters(records, assignments);
      if (!cancelled) onComplete();
    })().catch((e) => {
      if (!cancelled) {
        setError(
          e instanceof Error ? e.message : "Something went wrong while processing."
        );
      }
    });

    return () => {
      cancelled = true;
    };
  }, [onComplete, onEmpty, attempt]);

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
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-24 text-center">
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
          {facesFound} face{facesFound === 1 ? "" : "s"} found so far · this can
          take a few minutes for large batches
        </p>
      )}
    </div>
  );
}
