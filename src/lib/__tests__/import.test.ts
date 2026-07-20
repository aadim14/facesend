import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importPhotos, MAX_PHOTOS } from "@/lib/import";
import { StorageFullError } from "@/lib/db";

const addPhoto = vi.hoisted(() => vi.fn());
const requestPersistence = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  addPhoto,
  requestPersistence,
}));

vi.mock("@/lib/images", () => ({
  makeThumbnail: vi.fn().mockResolvedValue({
    thumbBlob: new Blob(["t"]),
    width: 10,
    height: 10,
  }),
}));

const jpg = (name = "a.jpg") => new File([new Blob(["x"])], name, { type: "image/jpeg" });
/** Photos.app hands over HEIC with an empty MIME type. */
const typeless = (name: string) => new File([new Blob(["x"])], name, { type: "" });

beforeEach(() => {
  addPhoto.mockReset().mockResolvedValue(undefined);
  requestPersistence.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("importPhotos", () => {
  it("imports plain images", async () => {
    const out = await importPhotos([jpg("a.jpg"), jpg("b.jpg")]);
    expect(out.imported).toBe(2);
    expect(out.storageFull).toBe(false);
  });

  it("accepts HEIC that the OS handed over with no MIME type", async () => {
    // An extension check has to back up the MIME check, or iPhone photos are
    // rejected as "not images" before anything tries to read them.
    const out = await importPhotos([typeless("IMG_0042.HEIC")]);
    expect(out.imported).toBe(1);
  });

  it("skips genuine non-images and says so", async () => {
    const out = await importPhotos([jpg(), typeless("notes.txt")]);
    expect(out.imported).toBe(1);
    expect(out.notices.join(" ")).toMatch(/non-image/);
  });

  it("requests persistence before writing, not after", async () => {
    const order: string[] = [];
    requestPersistence.mockImplementation(async () => {
      order.push("persist");
      return true;
    });
    addPhoto.mockImplementation(async () => {
      order.push("write");
    });
    await importPhotos([jpg()]);
    expect(order).toEqual(["persist", "write"]);
  });

  it("does not touch storage when there is nothing importable", async () => {
    const out = await importPhotos([typeless("notes.txt")]);
    expect(out.imported).toBe(0);
    expect(requestPersistence).not.toHaveBeenCalled();
  });

  it("honours a budget so a second batch can't exceed the cap", async () => {
    const out = await importPhotos([jpg("a.jpg"), jpg("b.jpg"), jpg("c.jpg")], {
      budget: 2,
    });
    expect(out.imported).toBe(2);
    expect(out.notices.join(" ")).toMatch(new RegExp(`${MAX_PHOTOS} max`));
  });

  it("reports being at the limit rather than silently doing nothing", async () => {
    const out = await importPhotos([jpg()], { budget: 0 });
    expect(out.imported).toBe(0);
    expect(out.notices.join(" ")).toMatch(/limit/);
  });

  // Regression: a full disk surfaced as "couldn't be read", i.e. the host was
  // told their JPEGs were corrupt, and the loop ground through every remaining
  // photo failing identically.
  it("stops immediately when storage fills, and says storage — not 'unreadable'", async () => {
    addPhoto
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new StorageFullError());

    const out = await importPhotos([jpg("a.jpg"), jpg("b.jpg"), jpg("c.jpg")]);

    expect(out.imported).toBe(1);
    expect(out.storageFull).toBe(true);
    expect(addPhoto).toHaveBeenCalledTimes(2); // stopped, didn't try the third
    expect(out.notices.join(" ")).toMatch(/storage filled up/);
    expect(out.notices.join(" ")).not.toMatch(/couldn't be read/);
  });

  it("skips an unreadable photo but keeps going", async () => {
    addPhoto
      .mockRejectedValueOnce(new Error("decode failed"))
      .mockResolvedValue(undefined);
    const out = await importPhotos([jpg("bad.jpg"), jpg("ok.jpg")]);
    expect(out.imported).toBe(1);
    expect(out.storageFull).toBe(false);
    expect(out.notices.join(" ")).toMatch(/couldn't be read/);
  });

  it("reports progress across the batch", async () => {
    const seen: number[] = [];
    await importPhotos([jpg("a.jpg"), jpg("b.jpg")], {
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(2);
  });
});
