"use client";

import { useEffect, useRef, useState } from "react";
import { addPhoto, requestPersistence } from "@/lib/db";
import { newId } from "@/lib/id";
import { makeThumbnail } from "@/lib/images";

const MAX_PHOTOS = 300;

interface Props {
  onComplete: () => void;
}

// Recursively walk a dropped directory entry, collecting every file inside.
// Dropping a folder gives you an empty `dataTransfer.files`, so we read the
// directory tree through the entries API instead.
function readEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([file]),
        () => resolve([])
      );
    });
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  return new Promise((resolve) => {
    const entries: FileSystemEntry[] = [];
    // readEntries returns at most ~100 items per call, so keep reading
    // until it hands back an empty batch.
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            Promise.all(entries.map(readEntry)).then((nested) =>
              resolve(nested.flat())
            );
          } else {
            entries.push(...batch);
            readBatch();
          }
        },
        () => resolve([])
      );
    };
    readBatch();
  });
}

async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items);
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => e != null);

  // Fall back to the flat file list if the entries API isn't available
  // (e.g. older browsers, or items dragged out of Photos.app).
  if (entries.length === 0) return Array.from(dataTransfer.files);

  const nested = await Promise.all(entries.map(readEntry));
  return nested.flat();
}

export default function UploadStep({ onComplete }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // Photos.app images aren't reachable through the file picker on most
  // macOS setups, but dragging a selection out of Photos works everywhere.
  const isMac =
    typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
  const [dragActive, setDragActive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [notice, setNotice] = useState<string | null>(null);

  // `webkitdirectory` is a non-standard attribute that React won't reliably
  // render from JSX, so set it directly on the DOM node to switch the picker
  // into folder-selection mode.
  useEffect(() => {
    const el = folderInputRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);

  async function handleFiles(fileList: FileList | File[]) {
    if (importing) return;
    const all = Array.from(fileList);
    const images = all.filter((f) => f.type.startsWith("image/"));
    const kept = images.slice(0, MAX_PHOTOS);

    const notices: string[] = [];
    if (all.length - images.length > 0) {
      notices.push(`${all.length - images.length} non-image file(s) skipped`);
    }
    if (images.length > MAX_PHOTOS) {
      notices.push(`keeping the first ${MAX_PHOTOS} of ${images.length} photos`);
    }

    if (kept.length === 0) {
      setNotice("Those files don't look like photos — try JPG or PNG images.");
      return;
    }

    setImporting(true);
    setProgress({ done: 0, total: kept.length });

    let imported = 0;
    let unreadable = 0;
    for (const file of kept) {
      try {
        const { thumbBlob, width, height } = await makeThumbnail(file);
        await addPhoto({
          id: newId(),
          name: file.name,
          blob: file,
          thumbBlob,
          width,
          height,
          faceCount: -1,
        });
        imported++;
      } catch (err) {
        console.warn(`[facesend] couldn't import ${file.name}:`, err);
        unreadable++;
      }
      setProgress({ done: imported + unreadable, total: kept.length });
    }

    if (unreadable > 0) {
      notices.push(`${unreadable} photo(s) couldn't be read and were skipped`);
    }

    if (imported === 0) {
      setImporting(false);
      setNotice(
        "None of those photos could be read in this browser. HEIC files work in Safari; try JPG or PNG elsewhere."
      );
      return;
    }

    await requestPersistence();
    if (notices.length > 0) setNotice(notices.join(" · "));
    onComplete();
  }

  if (importing) {
    const pct =
      progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-24 text-center">
        <p className="text-sm font-medium">
          Importing {progress.done} / {progress.total}
        </p>
        <div className="h-1.5 w-64 overflow-hidden rounded-full bg-neutral-100">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-neutral-400">
          Your photos never leave this device.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col justify-center py-12">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-semibold tracking-tight">
          Send event photos to the right people
        </h2>
        <p className="mt-3 text-neutral-500">
          Drop your photos, tag each face once, and get a private page per
          person. Everything happens in your browser.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          filesFromDrop(e.dataTransfer).then(handleFiles);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed px-6 py-20 transition-colors ${
          dragActive
            ? "border-accent bg-accent-soft"
            : "border-neutral-200 hover:border-accent/50"
        }`}
      >
        <svg
          className="h-10 w-10 text-accent"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
          />
        </svg>
        <p className="font-medium">Drag &amp; drop your event photos</p>
        <p className="text-sm text-neutral-400">
          or{" "}
          <span className="text-accent underline underline-offset-2">
            browse files
          </span>{" "}
          ·{" "}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              folderInputRef.current?.click();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                folderInputRef.current?.click();
              }
            }}
            className="text-accent underline underline-offset-2"
          >
            a whole folder
          </span>
        </p>
        <p className="mt-2 text-xs text-neutral-400">
          Up to {MAX_PHOTOS} photos · stays on this device
        </p>
        {isMac && (
          <p className="mt-1 rounded-full bg-neutral-50 px-3 py-1 text-xs text-neutral-500">
            Using the Photos app? Select your shots there and drag them
            straight in here.
          </p>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {/* Pulls every photo out of a chosen folder (and its subfolders).
            The `webkitdirectory` attribute is set imperatively above. */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {notice && (
        <p className="mt-4 text-center text-sm text-amber-600">{notice}</p>
      )}
    </div>
  );
}
