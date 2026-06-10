import { describe, expect, it } from "vitest";
import { expandAndClampBox, fitWithin, scaleBox } from "@/lib/images";

describe("fitWithin", () => {
  it("downscales a landscape image preserving aspect ratio", () => {
    expect(fitWithin(4000, 3000, 800)).toEqual({
      width: 800,
      height: 600,
      scale: 0.2,
    });
  });

  it("downscales a portrait image on its long edge", () => {
    expect(fitWithin(3000, 4000, 800)).toEqual({
      width: 600,
      height: 800,
      scale: 0.2,
    });
  });

  it("never upscales a small image", () => {
    expect(fitWithin(640, 480, 800)).toEqual({
      width: 640,
      height: 480,
      scale: 1,
    });
  });

  it("never returns zero dimensions", () => {
    const fitted = fitWithin(10000, 1, 800);
    expect(fitted.width).toBeGreaterThanOrEqual(1);
    expect(fitted.height).toBeGreaterThanOrEqual(1);
  });
});

describe("scaleBox", () => {
  it("maps a detection from 800px space back to a 4000px original exactly", () => {
    const detected = { x: 80, y: 40, w: 160, h: 200 };
    const original = scaleBox(detected, 1 / 0.2);
    expect(original).toEqual({ x: 400, y: 200, w: 800, h: 1000 });
  });
});

describe("expandAndClampBox", () => {
  it("expands by the margin on every side in open space", () => {
    const box = expandAndClampBox({ x: 400, y: 400, w: 100, h: 100 }, 0.25, 1000, 1000);
    expect(box).toEqual({ x: 375, y: 375, w: 150, h: 150 });
  });

  it("clamps at the top-left corner", () => {
    const box = expandAndClampBox({ x: 0, y: 0, w: 100, h: 100 }, 0.25, 1000, 1000);
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.w).toBe(125);
    expect(box.h).toBe(125);
  });

  it("clamps at the bottom-right edge", () => {
    const box = expandAndClampBox({ x: 950, y: 950, w: 100, h: 100 }, 0.25, 1000, 1000);
    expect(box.x).toBe(925);
    expect(box.y).toBe(925);
    expect(box.x + box.w).toBeLessThanOrEqual(1000);
    expect(box.y + box.h).toBeLessThanOrEqual(1000);
  });

  it("always returns a box of at least 1x1 with integer coordinates", () => {
    const box = expandAndClampBox({ x: 999, y: 999, w: 1, h: 1 }, 0.25, 1000, 1000);
    expect(box.w).toBeGreaterThanOrEqual(1);
    expect(box.h).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(box.x)).toBe(true);
    expect(Number.isInteger(box.w)).toBe(true);
  });
});
