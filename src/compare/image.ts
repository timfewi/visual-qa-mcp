import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface DiffRegionCandidate {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: number;
}

export interface ImageComparisonResult {
  readonly status: "match" | "mismatch" | "size_mismatch";
  readonly ratio: number;
  readonly diffPixels: number;
  readonly width: number;
  readonly height: number;
  readonly diffPng: Buffer | undefined;
  readonly regions: DiffRegionCandidate[];
}

export interface CompareOptions {
  readonly threshold: number;
  readonly regionMinPixels: number;
  /** Grid size used to cluster diff pixels into regions. */
  readonly gridSize?: number;
  readonly maxRegions?: number;
}

const DEFAULT_GRID = 16;
const DEFAULT_MAX_REGIONS = 40;

/**
 * Deterministic pixel diff of two PNG buffers.
 *
 * Mismatch regions are derived from the diff mask so the agent gets a bounded,
 * machine-readable list instead of a whole image to reason about.
 */
export function comparePngs(
  actual: Buffer,
  expected: Buffer,
  options: CompareOptions,
): ImageComparisonResult {
  const left = PNG.sync.read(actual);
  const right = PNG.sync.read(expected);
  const sizeMismatch = left.width !== right.width || left.height !== right.height;
  const width = Math.max(left.width, right.width);
  const height = Math.max(left.height, right.height);

  const leftData = sizeMismatch ? padImage(left, width, height) : left.data;
  const rightData = sizeMismatch ? padImage(right, width, height) : right.data;

  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(leftData, rightData, diff.data, width, height, {
    threshold: options.threshold,
    includeAA: false,
    alpha: 0.1,
    diffColor: [255, 0, 255],
    diffColorAlt: [0, 160, 255],
  });

  const totalPixels = width * height;
  const ratio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
  const regions = diffPixels === 0 ? [] : extractRegions(diff.data, width, height, options);

  const status: ImageComparisonResult["status"] =
    diffPixels === 0 ? "match" : sizeMismatch ? "size_mismatch" : "mismatch";

  return {
    status,
    ratio,
    diffPixels,
    width,
    height,
    diffPng: diffPixels === 0 ? undefined : PNG.sync.write(diff),
    regions,
  };
}

/**
 * Pixel data of a smaller image padded to the union size.
 *
 * Padding is filled with an opaque mid-grey, so a size change always shows up
 * as a large visible block in the diff instead of being cropped away. The
 * comparison status is forced to `size_mismatch` whenever the dimensions
 * differ, independently of the pixel count.
 */
function padImage(image: PNG, width: number, height: number): Buffer {
  const target = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    target[offset] = 128;
    target[offset + 1] = 128;
    target[offset + 2] = 128;
    target[offset + 3] = 255;
  }
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4;
      const destination = (y * width + x) * 4;
      target[destination] = image.data[source] ?? 0;
      target[destination + 1] = image.data[source + 1] ?? 0;
      target[destination + 2] = image.data[source + 2] ?? 0;
      target[destination + 3] = image.data[source + 3] ?? 0;
    }
  }
  return target;
}

/**
 * Cluster differing pixels into rectangles.
 *
 * A coarse occupancy grid is merged greedily into rectangles; this keeps the
 * region list small and stable while still pointing at the affected areas.
 */
function extractRegions(
  diffData: Buffer,
  width: number,
  height: number,
  options: CompareOptions,
): DiffRegionCandidate[] {
  const gridSize = options.gridSize ?? DEFAULT_GRID;
  const maxRegions = options.maxRegions ?? DEFAULT_MAX_REGIONS;
  const columns = Math.ceil(width / gridSize);
  const rows = Math.ceil(height / gridSize);
  const occupied = new Uint8Array(columns * rows);
  const cellPixels = new Uint32Array(columns * rows);

  for (let y = 0; y < height; y += 1) {
    const row = Math.floor(y / gridSize);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const isDiff =
        (diffData[offset] === 255 && diffData[offset + 1] === 0 && diffData[offset + 2] === 255) ||
        (diffData[offset] === 0 && diffData[offset + 1] === 160 && diffData[offset + 2] === 255);
      if (!isDiff) {
        continue;
      }
      const cell = row * columns + Math.floor(x / gridSize);
      occupied[cell] = 1;
      cellPixels[cell] = (cellPixels[cell] ?? 0) + 1;
    }
  }

  const visited = new Uint8Array(columns * rows);
  const regions: DiffRegionCandidate[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (occupied[index] !== 1 || visited[index] === 1) {
        continue;
      }
      let endColumn = column;
      while (
        endColumn + 1 < columns &&
        occupied[row * columns + endColumn + 1] === 1 &&
        visited[row * columns + endColumn + 1] === 0
      ) {
        endColumn += 1;
      }
      let endRow = row;
      let canGrow = true;
      while (canGrow && endRow + 1 < rows) {
        for (let candidate = column; candidate <= endColumn; candidate += 1) {
          const cell = (endRow + 1) * columns + candidate;
          if (occupied[cell] !== 1 || visited[cell] === 1) {
            canGrow = false;
            break;
          }
        }
        if (canGrow) {
          endRow += 1;
        }
      }

      let pixels = 0;
      for (let y = row; y <= endRow; y += 1) {
        for (let x = column; x <= endColumn; x += 1) {
          const cell = y * columns + x;
          visited[cell] = 1;
          pixels += cellPixels[cell] ?? 0;
        }
      }

      regions.push({
        x: column * gridSize,
        y: row * gridSize,
        width: Math.min((endColumn - column + 1) * gridSize, width - column * gridSize),
        height: Math.min((endRow - row + 1) * gridSize, height - row * gridSize),
        pixels,
      });
    }
  }

  return regions
    .filter((region) => region.pixels >= options.regionMinPixels)
    .sort((left, right) => right.pixels - left.pixels)
    .slice(0, maxRegions);
}
