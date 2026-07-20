import { describe, expect, it } from "vitest";
import { sanitizeFilename, uniqueFilenames } from "@/lib/zip";

describe("sanitizeFilename", () => {
  it("strips characters that break filenames", () => {
    expect(sanitizeFilename("Ana / O'Brien?")).toBe("Ana-O-Brien");
  });

  it("collapses whitespace into single hyphens", () => {
    expect(sanitizeFilename("  Jo   Smith  ")).toBe("Jo-Smith");
  });

  it("falls back when nothing survives", () => {
    expect(sanitizeFilename("???")).toBe("person");
    expect(sanitizeFilename("", "photo")).toBe("photo");
  });
});

describe("uniqueFilenames", () => {
  it("leaves unique names untouched", () => {
    expect(uniqueFilenames(["a.jpg", "b.jpg"])).toEqual(["a.jpg", "b.jpg"]);
  });

  it("dedupes by appending a counter before the extension", () => {
    expect(uniqueFilenames(["a.jpg", "a.jpg", "a.jpg", "b.jpg"])).toEqual([
      "a.jpg",
      "a-2.jpg",
      "a-3.jpg",
      "b.jpg",
    ]);
  });

  it("treats names case-insensitively", () => {
    expect(uniqueFilenames(["IMG.jpg", "img.jpg"])).toEqual([
      "IMG.jpg",
      "img-2.jpg",
    ]);
  });

  it("handles names without extensions", () => {
    expect(uniqueFilenames(["file", "file"])).toEqual(["file", "file-2"]);
  });

  // Regression: `seen` used to record only the original names, so the
  // generated `a-2.jpg` collided with a real `a-2.jpg` later in the list and
  // two entries shared one path — one photo vanished on extraction.
  it("does not collide with a real name matching a generated one", () => {
    expect(uniqueFilenames(["a.jpg", "a.jpg", "a-2.jpg"])).toEqual([
      "a.jpg",
      "a-2.jpg",
      "a-2-2.jpg",
    ]);
  });

  it("survives a camera export sitting next to its edit", () => {
    const out = uniqueFilenames([
      "IMG_1234.jpg",
      "IMG_1234.jpg",
      "IMG_1234-2.jpg",
    ]);
    expect(new Set(out).size).toBe(3);
  });

  it("treats NFC and NFD spellings of one name as a collision", () => {
    // "café.jpg" composed vs decomposed — one file on macOS.
    const out = uniqueFilenames(["café.jpg", "café.jpg"]);
    expect(out[0]).toBe("café.jpg");
    expect(out[1]).toBe("café-2.jpg");
  });

  it("never returns a duplicate for any input", () => {
    const messy = ["a.jpg", "a.jpg", "a-2.jpg", "a-2.jpg", "a-3.jpg", "a"];
    const out = uniqueFilenames(messy);
    expect(new Set(out.map((n) => n.toLowerCase())).size).toBe(messy.length);
  });
});
