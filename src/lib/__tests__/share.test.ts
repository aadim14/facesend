import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverGallery, fileShareSupported } from "@/lib/share";

/**
 * share.ts decides, per device and per failure mode, whether a person's
 * gallery reaches them. It had no tests at all — every branch below is one
 * the host experiences directly.
 */

const saveZipBlob = vi.hoisted(() => vi.fn());
vi.mock("@/lib/zip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/zip")>()),
  saveZipBlob,
}));

function stubNavigator(over: Partial<Navigator>) {
  vi.stubGlobal("navigator", { ...over } as Navigator);
}

const zip = () =>
  new File([new Blob(["x"])], "ana-gallery.zip", { type: "application/zip" });

function abort(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

afterEach(() => {
  vi.unstubAllGlobals();
  saveZipBlob.mockClear();
});

describe("fileShareSupported", () => {
  it("is false when the browser has no canShare at all", () => {
    stubNavigator({});
    expect(fileShareSupported()).toBe(false);
  });

  it("probes with a zip, not a text file", () => {
    // Android Chrome gates canShare on a MIME allowlist, so probing with
    // text/plain would claim share support for a payload it will refuse.
    const canShare = vi.fn(
      (data?: ShareData) => data?.files?.[0]?.type === "application/zip"
    );
    stubNavigator({ canShare } as Partial<Navigator>);
    expect(fileShareSupported()).toBe(true);
    expect(canShare.mock.calls[0][0]?.files?.[0].type).toBe("application/zip");
  });

  it("is false when the browser refuses zips", () => {
    stubNavigator({ canShare: () => false } as Partial<Navigator>);
    expect(fileShareSupported()).toBe(false);
  });
});

describe("deliverGallery", () => {
  it("downloads when there is no share sheet (desktop Chrome)", async () => {
    stubNavigator({ canShare: () => false } as Partial<Navigator>);
    await expect(deliverGallery("Ana", zip())).resolves.toBe("downloaded-zip");
    expect(saveZipBlob).toHaveBeenCalledOnce();
  });

  it("reports a successful share and downloads nothing", async () => {
    stubNavigator({
      canShare: () => true,
      share: vi.fn().mockResolvedValue(undefined),
    } as Partial<Navigator>);
    await expect(deliverGallery("Ana", zip())).resolves.toBe("shared");
    expect(saveZipBlob).not.toHaveBeenCalled();
  });

  it("treats a dismissed share sheet as a cancellation, with no download", async () => {
    stubNavigator({
      canShare: () => true,
      share: vi.fn().mockRejectedValue(abort("Share canceled")),
    } as Partial<Navigator>);
    await expect(deliverGallery("Ana", zip())).resolves.toBe("cancelled");
    expect(saveZipBlob).not.toHaveBeenCalled();
  });

  // Regression: every AbortError used to count as a cancellation, so a real
  // share-service failure produced no share, no download and no error —
  // the host tapped Send and nothing whatsoever happened.
  it("falls back to a download for an AbortError that is not a dismissal", async () => {
    stubNavigator({
      canShare: () => true,
      share: vi.fn().mockRejectedValue(abort("Internal error")),
    } as Partial<Navigator>);
    await expect(deliverGallery("Ana", zip())).resolves.toBe("downloaded-zip");
    expect(saveZipBlob).toHaveBeenCalledOnce();
  });

  it("falls back to a download when the payload is rejected outright", async () => {
    stubNavigator({
      canShare: () => true,
      share: vi
        .fn()
        .mockRejectedValue(new DOMException("Permission denied", "NotAllowedError")),
    } as Partial<Navigator>);
    await expect(deliverGallery("Ana", zip())).resolves.toBe("downloaded-zip");
    expect(saveZipBlob).toHaveBeenCalledOnce();
  });

  it("never dead-ends: every non-cancel outcome leaves the host holding the file", async () => {
    for (const err of [
      new DOMException("boom", "DataError"),
      new TypeError("nope"),
      abort("something went wrong"),
    ]) {
      saveZipBlob.mockClear();
      stubNavigator({
        canShare: () => true,
        share: vi.fn().mockRejectedValue(err),
      } as Partial<Navigator>);
      const result = await deliverGallery("Ana", zip());
      expect(result).toBe("downloaded-zip");
      expect(saveZipBlob).toHaveBeenCalledOnce();
    }
  });
});
