"use client";

import { useCallback, useEffect, useState } from "react";
import type { Step } from "@/types";
import { getStep, setStep as persistStep } from "@/lib/db";
import UploadStep from "@/components/UploadStep";
import ProcessingStep from "@/components/ProcessingStep";
import ReviewStep from "@/components/ReviewStep";

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: "upload", label: "Photos" },
  { key: "review", label: "People & sending" },
];

function stepIndex(step: Step): number {
  if (step === "upload" || step === "processing") return 0;
  return 1; // review (and legacy "done") — find, name, and send on one screen
}

/**
 * How long to wait for storage before telling the host something is wrong.
 * Generous: this is one small read, and a slow device on a cold IndexedDB
 * should never trip it.
 */
const STORAGE_TIMEOUT_MS = 8000;

export default function Home() {
  const [step, setStepState] = useState<Step | null>(null);
  const [storageStalled, setStorageStalled] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Catching rejections is not enough to keep this off "Loading…" forever:
    // an IndexedDB open can simply never settle. That happens when another
    // tab holds the database through a version upgrade, and it is not
    // hypothetical — it was hit during development and the app sat on
    // "Loading…" indefinitely, saying nothing, with no way forward.
    let settled = false;
    setStorageStalled(false);

    const timer = setTimeout(() => {
      if (!settled) setStorageStalled(true);
    }, STORAGE_TIMEOUT_MS);

    const finish = (next: Step) => {
      settled = true;
      clearTimeout(timer);
      setStorageStalled(false);
      setStepState(next);
    };

    // A late resolve still recovers the app — the stalled screen is a
    // explanation of a wait, not a terminal state.
    getStep()
      .then(finish)
      .catch(() => finish("upload"));

    return () => clearTimeout(timer);
  }, [attempt]);

  const go = useCallback(async (next: Step) => {
    setStepState(next);
    try {
      await persistStep(next);
    } catch {
      // resuming-on-reload is a nice-to-have; navigation must not depend on it
    }
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 pb-16">
      <header className="flex items-center justify-between py-8">
        <h1 className="text-lg font-semibold tracking-tight">
          Face<span className="text-accent">Send</span>
        </h1>
        {step !== null && (
          <nav className="flex items-center gap-4">
            {STEP_LABELS.map((s, i) => (
              <span
                key={s.key}
                className={`flex items-center gap-1.5 text-xs ${
                  i === stepIndex(step)
                    ? "font-medium text-accent"
                    : "text-neutral-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    i <= stepIndex(step) ? "bg-accent" : "bg-neutral-300"
                  }`}
                />
                {s.label}
              </span>
            ))}
          </nav>
        )}
      </header>

      {step === null && !storageStalled && (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
          Loading…
        </div>
      )}
      {step === null && storageStalled && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
          <p className="font-medium">This browser&apos;s storage isn&apos;t responding</p>
          <p className="max-w-sm text-sm text-neutral-500">
            Another FaceSend tab is usually holding it open. Close any other
            tabs with FaceSend and reload. Your photos are safe — nothing has
            been deleted.
          </p>
          <button
            onClick={() => setAttempt((a) => a + 1)}
            className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="text-sm text-neutral-400 underline underline-offset-4 hover:text-neutral-600"
          >
            Reload the page
          </button>
        </div>
      )}
      {step === "upload" && <UploadStep onComplete={() => go("processing")} />}
      {step === "processing" && (
        <ProcessingStep
          onComplete={() => go("review")}
          onEmpty={() => go("upload")}
        />
      )}
      {(step === "review" || step === "done") && (
        <ReviewStep onRetry={() => go("processing")} />
      )}
    </main>
  );
}
