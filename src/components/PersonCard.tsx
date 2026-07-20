"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are blob object URLs */

import { useState } from "react";

interface FaceCrop {
  faceId: string;
  url: string;
}

interface Props {
  crops: FaceCrop[];
  /** Every face in the group, fetched on demand; null while collapsed. */
  expandedCrops: FaceCrop[] | null;
  /** Total faces in the group, which may exceed the preview. */
  faceCount: number;
  onToggleExpand: () => void;
  photoCount: number;
  name: string;
  skipped: boolean;
  /** Done for this session — delivered (shared) or downloaded. */
  done: boolean;
  working: boolean;
  /** Honest, device-aware button label supplied by the parent. */
  actionLabel: string;
  /** Sub-status under the button: a download note or an error. */
  statusNote?: string;
  statusTone?: "neutral" | "ok" | "error";
  canEject: boolean;
  onChange: (value: string) => void;
  onPersist: () => void;
  onToggleSkip: () => void;
  onShare: () => void;
  onEjectFace: (faceId: string) => void;
}

export default function PersonCard({
  crops,
  expandedCrops,
  faceCount,
  onToggleExpand,
  photoCount,
  name,
  skipped,
  done,
  working,
  actionLabel,
  statusNote,
  statusTone = "neutral",
  canEject,
  onChange,
  onPersist,
  onToggleSkip,
  onShare,
  onEjectFace,
}: Props) {
  const [confirmFaceId, setConfirmFaceId] = useState<string | null>(null);
  const chipsTappable = canEject && !skipped;
  // Expanding shows every face, not just the preview. Without it a wrongly
  // grouped face at position 5+ was simply uncorrectable: eject only works on
  // a face you can see, and only the first four were ever rendered.
  const shown = expandedCrops ?? crops;
  const hiddenCount = faceCount - crops.length;

  function tapChip(faceId: string) {
    if (!chipsTappable) return;
    setConfirmFaceId((current) => (current === faceId ? null : faceId));
  }

  const noteColor =
    statusTone === "error"
      ? "text-red-600"
      : statusTone === "ok"
        ? "text-green-600"
        : "text-neutral-400";

  return (
    <div
      className={`relative rounded-2xl border p-4 transition-all ${
        skipped
          ? "border-neutral-200 opacity-50"
          : done
            ? "border-green-200 bg-green-50/40"
            : "border-neutral-200"
      }`}
    >
      <button
        onClick={onToggleSkip}
        className={`absolute right-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
          skipped
            ? "bg-neutral-100 text-neutral-500"
            : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
        }`}
      >
        {skipped ? "Skipped" : "Skip"}
      </button>

      {/* pr-14 keeps the wrapped face chips clear of the absolutely
          positioned Skip button, which otherwise sits on top of them and
          swallows the tap. */}
      <div className="flex flex-wrap items-center gap-2 pr-14">
        {shown.map((crop) => (
          <button
            key={crop.faceId}
            type="button"
            onClick={() => tapChip(crop.faceId)}
            disabled={!chipsTappable}
            aria-label={
              chipsTappable ? "Remove this face from this person" : "Face"
            }
            className={`rounded-full transition-shadow ${
              confirmFaceId === crop.faceId
                ? "ring-2 ring-red-400 ring-offset-1"
                : chipsTappable
                  ? "hover:ring-2 hover:ring-neutral-300 hover:ring-offset-1"
                  : ""
            }`}
          >
            <img
              src={crop.url}
              alt=""
              className="h-14 w-14 rounded-full border border-neutral-100 object-cover"
            />
          </button>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expandedCrops != null}
            className="h-14 rounded-full border border-dashed border-neutral-300 px-3 text-xs font-medium text-neutral-500 transition-colors hover:border-accent hover:text-accent"
          >
            {expandedCrops ? "Show fewer" : `+${hiddenCount} more`}
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        in {photoCount} photo{photoCount === 1 ? "" : "s"}
        {chipsTappable && !confirmFaceId && (
          <span className="text-neutral-300"> · tap a face that doesn&apos;t belong</span>
        )}
      </p>

      {confirmFaceId && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-red-50 px-3 py-2">
          <span className="text-xs font-medium text-red-700">
            Not this person?
          </span>
          <span className="flex gap-2">
            <button
              onClick={() => {
                onEjectFace(confirmFaceId);
                setConfirmFaceId(null);
              }}
              className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700"
            >
              Remove
            </button>
            <button
              onClick={() => setConfirmFaceId(null)}
              className="rounded-full px-2 py-1 text-xs text-red-700 hover:bg-red-100"
            >
              Cancel
            </button>
          </span>
        </div>
      )}

      {skipped ? (
        <p className="mt-3 text-xs text-neutral-400">
          Skipped — won&apos;t get a gallery. Tap{" "}
          <span className="font-medium">Skipped</span> above to include them.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="text"
            value={name}
            placeholder="Add a name"
            onChange={(e) => onChange(e.target.value)}
            onBlur={onPersist}
            className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
          />
          <button
            onClick={onShare}
            disabled={working}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
              done
                ? "bg-green-50 text-green-700 hover:bg-green-100"
                : "bg-accent text-white hover:opacity-90"
            }`}
          >
            {working && (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
            )}
            {actionLabel}
          </button>
          {statusNote && <p className={`text-xs ${noteColor}`}>{statusNote}</p>}
        </div>
      )}
    </div>
  );
}
