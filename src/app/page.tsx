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

export default function Home() {
  const [step, setStepState] = useState<Step | null>(null);

  useEffect(() => {
    // Never leave the app stuck on "Loading…" — if reading the saved step
    // fails (storage blocked/evicted), fall back to a fresh upload.
    getStep()
      .then(setStepState)
      .catch(() => setStepState("upload"));
  }, []);

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

      {step === null && (
        <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
          Loading…
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
