"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are blob object URLs */

import { useState } from "react";

interface FaceCrop {
  faceId: string;
  url: string;
}

interface Props {
  crops: FaceCrop[];
  photoCount: number;
  name: string;
  skipped: boolean;
  sent: boolean;
  sharing: boolean;
  canEject: boolean;
  onChange: (value: string) => void;
  onPersist: () => void;
  onToggleSkip: () => void;
  onShare: () => void;
  onEjectFace: (faceId: string) => void;
}

export default function PersonCard({
  crops,
  photoCount,
  name,
  skipped,
  sent,
  sharing,
  canEject,
  onChange,
  onPersist,
  onToggleSkip,
  onShare,
  onEjectFace,
}: Props) {
  const [confirmFaceId, setConfirmFaceId] = useState<string | null>(null);
  const chipsTappable = canEject && !skipped;

  function tapChip(faceId: string) {
    if (!chipsTappable) return;
    setConfirmFaceId((current) => (current === faceId ? null : faceId));
  }

  return (
    <div
      className={`relative rounded-2xl border border-neutral-200 p-4 transition-all ${
        skipped ? "opacity-50" : ""
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

      <div className="flex items-center gap-2">
        {crops.map((crop) => (
          <button
            key={crop.faceId}
            type="button"
            onClick={() => tapChip(crop.faceId)}
            disabled={!chipsTappable}
            className={`rounded-full transition-shadow ${
              confirmFaceId === crop.faceId
                ? "ring-2 ring-red-400 ring-offset-1"
                : chipsTappable
                  ? "hover:ring-2 hover:ring-neutral-300 hover:ring-offset-1"
                  : ""
            }`}
            title={chipsTappable ? "Not this person? Tap to remove" : undefined}
          >
            <img
              src={crop.url}
              alt="face"
              className="h-14 w-14 rounded-full border border-neutral-100 object-cover"
            />
          </button>
        ))}
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

      <div className="mt-3 flex flex-col gap-2">
        <input
          type="text"
          value={name}
          placeholder="Name (optional)"
          disabled={skipped}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onPersist}
          className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none transition-colors focus:border-accent disabled:bg-neutral-50"
        />
        <button
          onClick={onShare}
          disabled={skipped || sharing}
          className={`w-full rounded-xl py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
            sent
              ? "bg-green-50 text-green-700 hover:bg-green-100"
              : "bg-accent text-white hover:opacity-90"
          }`}
        >
          {sharing ? "Sharing…" : sent ? "Shared ✓ · Share again" : "Share photos"}
        </button>
      </div>
    </div>
  );
}
