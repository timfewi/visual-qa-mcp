import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";

import { comparePngs } from "../../src/compare/image.js";

type Rgba = [number, number, number, number];

function makePng(width: number, height: number, paint: (x: number, y: number) => Rgba): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [r, g, b, a] = paint(x, y);
      png.data[offset] = r;
      png.data[offset + 1] = g;
      png.data[offset + 2] = b;
      png.data[offset + 3] = a;
    }
  }
  return PNG.sync.write(png);
}

const white: Rgba = [255, 255, 255, 255];
const black: Rgba = [0, 0, 0, 255];

const options = { threshold: 0.1, regionMinPixels: 4, gridSize: 8 };

describe("pixel comparison", () => {
  test("reports an exact match without a diff image", () => {
    const image = makePng(64, 64, () => white);
    const result = comparePngs(
      image,
      makePng(64, 64, () => white),
      options,
    );
    expect(result.status).toBe("match");
    expect(result.ratio).toBe(0);
    expect(result.diffPixels).toBe(0);
    expect(result.diffPng).toBeUndefined();
    expect(result.regions).toEqual([]);
  });

  test("locates the changed area and reports a ratio", () => {
    const actual = makePng(64, 64, (x, y) =>
      x >= 16 && x < 32 && y >= 24 && y < 40 ? black : white,
    );
    const expected = makePng(64, 64, () => white);
    const result = comparePngs(actual, expected, options);
    expect(result.status).toBe("mismatch");
    expect(result.ratio).toBeGreaterThan(0);
    expect(result.diffPng).toBeInstanceOf(Buffer);
    const region = result.regions[0];
    expect(region).toBeDefined();
    expect(region?.x).toBeLessThanOrEqual(16);
    expect(region?.y).toBeLessThanOrEqual(24);
    expect((region?.x ?? 0) + (region?.width ?? 0)).toBeGreaterThanOrEqual(32);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThanOrEqual(40);
  });

  test("flags a dimension change as size mismatch even for identical content", () => {
    const result = comparePngs(
      makePng(64, 64, () => white),
      makePng(64, 80, () => white),
      options,
    );
    expect(result.status).toBe("size_mismatch");
    expect(result.width).toBe(64);
    expect(result.height).toBe(80);
    expect(result.diffPixels).toBeGreaterThan(0);
  });

  test("filters regions below the configured pixel threshold", () => {
    const actual = makePng(64, 64, (x, y) => (x === 1 && y === 1 ? black : white));
    const expected = makePng(64, 64, () => white);
    const strict = comparePngs(actual, expected, { ...options, regionMinPixels: 100 });
    expect(strict.diffPixels).toBeGreaterThan(0);
    expect(strict.regions).toEqual([]);
    const loose = comparePngs(actual, expected, { ...options, regionMinPixels: 1 });
    expect(loose.regions).toHaveLength(1);
  });

  test("merges nearby differences into a small number of regions", () => {
    const actual = makePng(128, 128, (x, y) =>
      (x >= 16 && x < 48 && y >= 16 && y < 48) || (x >= 80 && x < 112 && y >= 80 && y < 112)
        ? black
        : white,
    );
    const result = comparePngs(
      actual,
      makePng(128, 128, () => white),
      { ...options, regionMinPixels: 4 },
    );
    expect(result.regions.length).toBe(2);
  });
});
