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
});
