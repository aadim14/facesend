import { describe, expect, it } from "vitest";
import {
  buildBundle,
  buildGalleryHtml,
  bundlePhotoNames,
} from "@/lib/bundle";
import type { PhotoRecord } from "@/types";

function makePhoto(id: string, name: string, bytes = "x"): PhotoRecord {
  return {
    id,
    name,
    blob: new Blob([bytes], { type: "image/jpeg" }),
    thumbBlob: new Blob(["t"], { type: "image/jpeg" }),
    width: 100,
    height: 80,
    faceCount: 1,
  };
}

describe("bundlePhotoNames", () => {
  it("sanitizes unsafe names and prefixes photos/", () => {
    const names = bundlePhotoNames([makePhoto("p1", "O'Brien?.jpg")]);
    expect(names[0].startsWith("photos/")).toBe(true);
    expect(names[0]).not.toMatch(/['?]/);
  });

  it("deduplicates identical source names", () => {
    const names = bundlePhotoNames([
      makePhoto("p1", "beach.jpg"),
      makePhoto("p2", "beach.jpg"),
    ]);
    expect(new Set(names).size).toBe(2);
  });
});

describe("buildGalleryHtml", () => {
  it("escapes the person name so markup can't break the page", () => {
    const html = buildGalleryHtml("<script>Ann", ["photos/a.jpg"]);
    expect(html).not.toContain("<script>Ann");
    expect(html).toContain("&lt;script&gt;Ann");
  });

  it("is fully offline — no external URLs or CDN references", () => {
    const html = buildGalleryHtml("Ann", ["photos/a.jpg", "photos/b.jpg"]);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html.toLowerCase()).not.toContain("cdn");
    // references photos by the relative path we pass in
    expect(html).toContain("photos/a.jpg");
  });

  it("shows the photo count with correct pluralization", () => {
    expect(buildGalleryHtml("Ann", ["photos/a.jpg"])).toContain("1 photo<");
    expect(buildGalleryHtml("Ann", ["photos/a.jpg", "photos/b.jpg"])).toContain(
      "2 photos"
    );
  });
});

describe("buildBundle (original size)", () => {
  it("yields index.html plus one file per photo (AE1)", async () => {
    const bundle = await buildBundle("Ana", [
      makePhoto("p1", "one.jpg"),
      makePhoto("p2", "two.jpg"),
    ]);
    const names = bundle.files.map((f) => f.name);
    expect(names).toContain("index.html");
    expect(names.filter((n) => n.startsWith("photos/"))).toHaveLength(2);
    expect(bundle.files).toHaveLength(3);
  });

  it("a single-photo person still produces a valid gallery", async () => {
    const bundle = await buildBundle("Ana", [makePhoto("p1", "solo.jpg")]);
    expect(bundle.files.some((f) => f.name === "index.html")).toBe(true);
    expect(bundle.files.filter((f) => f.name.startsWith("photos/"))).toHaveLength(
      1
    );
  });

  it("estBytes sums the file sizes", async () => {
    const bundle = await buildBundle("Ana", [
      makePhoto("p1", "one.jpg", "aaaa"),
    ]);
    const summed = bundle.files.reduce((s, f) => s + f.blob.size, 0);
    expect(bundle.estBytes).toBe(summed);
    expect(bundle.estBytes).toBeGreaterThan(0);
  });

  it("the index.html references every photo's in-zip path", async () => {
    const photos = [makePhoto("p1", "one.jpg"), makePhoto("p2", "two.jpg")];
    const bundle = await buildBundle("Ana", photos);
    const html = await bundle.files
      .find((f) => f.name === "index.html")!
      .blob.text();
    for (const path of bundlePhotoNames(photos)) {
      expect(html).toContain(path);
    }
  });
});
