"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are blob object URLs */

interface Props {
  cropUrls: string[];
  photoCount: number;
  name: string;
  skipped: boolean;
  sent: boolean;
  sharing: boolean;
  mergeMode: boolean;
  selected: boolean;
  onChange: (value: string) => void;
  onPersist: () => void;
  onToggleSkip: () => void;
  onToggleSelect: () => void;
  onShare: () => void;
}

export default function PersonCard({
  cropUrls,
  photoCount,
  name,
  skipped,
  sent,
  sharing,
  mergeMode,
  selected,
  onChange,
  onPersist,
  onToggleSkip,
  onToggleSelect,
  onShare,
}: Props) {
  return (
    <div
      onClick={mergeMode ? onToggleSelect : undefined}
      className={`relative rounded-2xl border p-4 transition-all ${
        selected
          ? "border-accent ring-2 ring-accent/30"
          : "border-neutral-200"
      } ${skipped ? "opacity-50" : ""} ${
        mergeMode ? "cursor-pointer hover:border-accent/60" : ""
      }`}
    >
      {mergeMode && (
        <span
          className={`absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
            selected
              ? "border-accent bg-accent text-white"
              : "border-neutral-300 bg-white text-transparent"
          }`}
        >
          ✓
        </span>
      )}

      {!mergeMode && (
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
      )}

      <div className="flex items-center gap-2">
        {cropUrls.map((url, i) => (
          <img
            key={i}
            src={url}
            alt="face"
            className="h-14 w-14 rounded-full border border-neutral-100 object-cover"
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-400">
        in {photoCount} photo{photoCount === 1 ? "" : "s"}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <input
          type="text"
          value={name}
          placeholder="Name (optional)"
          disabled={skipped || mergeMode}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onPersist}
          className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none transition-colors focus:border-accent disabled:bg-neutral-50"
        />
        {!mergeMode && (
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
        )}
      </div>
    </div>
  );
}
