"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are blob object URLs */

interface Side {
  name: string;
  photoCount: number;
  crops: { faceId: string; url: string }[];
}

interface Props {
  a: Side;
  b: Side;
  remaining: number;
  working: boolean;
  onMerge: () => void;
  onDismiss: () => void;
}

function label(side: Side): string {
  const who = side.name.trim() || "Unnamed";
  return `${who} · ${side.photoCount} photo${side.photoCount === 1 ? "" : "s"}`;
}

function Faces({ side }: { side: Side }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-center gap-1">
        {side.crops.slice(0, 3).map((crop) => (
          <img
            key={crop.faceId}
            src={crop.url}
            alt=""
            className="h-12 w-12 rounded-full border border-white object-cover shadow-sm"
          />
        ))}
      </div>
      <span className="max-w-[9rem] truncate text-[11px] text-neutral-500">
        {label(side)}
      </span>
    </div>
  );
}

/**
 * One "are these the same person?" question.
 *
 * Clustering runs at a deliberately strict threshold, which means it splits
 * one person across two cards rather than risk blending two people. That
 * trade is only worth taking if undoing a split is trivial — this is the
 * undo. Pairs are surfaced nearest-first, and the host answers yes or no
 * rather than being asked to find the duplicates themselves.
 */
export default function MergePrompt({
  a,
  b,
  remaining,
  working,
  onMerge,
  onDismiss,
}: Props) {
  return (
    <section
      aria-label="Possible duplicate person"
      className="mb-6 rounded-2xl border border-accent/30 bg-accent-soft/40 p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">Same person?</h3>
        {remaining > 1 && (
          <span className="text-xs text-neutral-500">
            {remaining - 1} more to check
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        These two cards look like one person split in two. Merging keeps all
        their photos in one gallery.
      </p>

      <div className="mt-4 flex items-center justify-center gap-4">
        <Faces side={a} />
        <span aria-hidden className="text-lg text-neutral-300">
          +
        </span>
        <Faces side={b} />
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onMerge}
          disabled={working}
          className="flex-1 rounded-xl bg-accent py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {working ? "Merging…" : "Yes — same person"}
        </button>
        <button
          onClick={onDismiss}
          disabled={working}
          className="flex-1 rounded-xl border border-neutral-200 bg-white py-2 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-60"
        >
          No — different people
        </button>
      </div>
    </section>
  );
}
