"use client";

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
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [backend, setBackend] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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

      let found = (await getAllFaces()).length;
      setFacesFound(found);

      const durations: number[] = [];
      for (let i = 0; i < pending.length; i++) {
        const photo = pending[i];
        const startedAt = performance.now();
        try {
          const detected = await detectFacesInPhoto(photo.blob);
          await addFaces(
            detected.map((d) => ({
              id: newId(),
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
      for (const group of grouped) {
        const record: ClusterRecord = {
          id: newId(),
          name: "",
          contact: {},
          skipped: false,
          sent: false,
        };
        records.push(record);
        for (const faceId of group.faceIds) assignments.set(faceId, record.id);
      }
      await replaceClusters(records, assignments);
      onComplete();
    })().catch((e) => {
      setError(
        e instanceof Error ? e.message : "Something went wrong while processing."
      );
    });
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
  );
}
