import type { Browser } from "playwright";

import type { BoundingBox, Severity } from "../domain/schema.js";

export interface AnnotationMarker {
  readonly findingId: string;
  readonly number: number;
  readonly bbox: BoundingBox;
  readonly severity: Severity;
  readonly label: string;
}

export interface AnnotationOptions {
  readonly image: Buffer;
  readonly width: number;
  readonly height: number;
  readonly markers: readonly AnnotationMarker[];
  readonly title: string;
  /** Maximum annotated height; taller captures are clipped around the markers. */
  readonly maxHeight?: number;
  readonly padding?: number;
}

export interface AnnotationResult {
  readonly png: Buffer;
  readonly width: number;
  readonly height: number;
  readonly clipped: boolean;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#b00020",
  high: "#d84315",
  medium: "#b26a00",
  low: "#2e7d32",
  info: "#546e7a",
};

/**
 * Render an annotation overlay on top of a captured screenshot.
 *
 * Annotations are always produced after capture and never written into the
 * baseline image itself: the baseline stays the raw, comparable capture.
 */
export async function renderAnnotation(
  browser: Browser,
  options: AnnotationOptions,
): Promise<AnnotationResult> {
  const maxHeight = options.maxHeight ?? 8_000;
  const padding = options.padding ?? 48;
  const { width, height, markers } = options;

  const clip = computeClip(width, height, markers, maxHeight, padding);
  const html = buildAnnotationHtml(options, clip);
  const context = await browser.newContext({
    viewport: { width: clip.width, height: clip.height },
    deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const png = await page.screenshot({
      clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height },
      animations: "disabled",
      caret: "hide",
      scale: "css",
    });
    return {
      png,
      width: clip.width,
      height: clip.height,
      clipped: clip.clipped,
    };
  } finally {
    await context.close();
  }
}

interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
  clipped: boolean;
}

function computeClip(
  width: number,
  height: number,
  markers: readonly AnnotationMarker[],
  maxHeight: number,
  padding: number,
): Clip {
  if (height <= maxHeight) {
    return { x: 0, y: 0, width, height, clipped: false };
  }
  const boxes = markers.map((marker) => marker.bbox);
  if (boxes.length === 0) {
    return { x: 0, y: 0, width, height: maxHeight, clipped: true };
  }
  const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - padding);
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + padding;
  const clipHeight = Math.min(maxHeight, Math.max(120, bottom - top));
  return {
    x: 0,
    y: Math.min(top, Math.max(0, height - clipHeight)),
    width,
    height: Math.min(clipHeight, height),
    clipped: true,
  };
}

function buildAnnotationHtml(options: AnnotationOptions, _clip: Clip): string {
  const { width, height, markers, image } = options;
  const dataUrl = `data:image/png;base64,${image.toString("base64")}`;
  const shapes: string[] = [];

  for (const marker of markers) {
    const color = SEVERITY_COLOR[marker.severity];
    const box = marker.bbox;
    const left = clamp(box.x - 2, 0, width);
    const top = clamp(box.y - 2, 0, height);
    const right = clamp(box.x + box.width + 2, 0, width);
    const bottom = clamp(box.y + box.height + 2, 0, height);
    const badgeX = clamp(left - 14, 14, width - 14);
    const badgeY = clamp(top - 14, 14, height - 14);
    const centerX = clamp(box.x + box.width / 2, 0, width);
    const centerY = clamp(box.y + box.height / 2, 0, height);

    shapes.push(
      `<rect x="${left}" y="${top}" width="${Math.max(right - left, 1)}" height="${Math.max(bottom - top, 1)}" fill="none" stroke="${color}" stroke-width="2"/>`,
      `<line x1="${badgeX}" y1="${badgeY}" x2="${centerX}" y2="${centerY}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3"/>`,
      `<circle cx="${badgeX}" cy="${badgeY}" r="11" fill="${color}"/>`,
      `<text x="${badgeX}" y="${badgeY + 4}" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="12" font-weight="bold" fill="#ffffff">${marker.number}</text>`,
    );
  }

  const legend = markers
    .slice(0, 40)
    .map(
      (marker) =>
        `<li><span class="swatch" style="background:${SEVERITY_COLOR[marker.severity]}"></span><strong>${marker.number}</strong> ${escapeHtml(
          marker.label,
        )} <code>${escapeHtml(marker.findingId)}</code></li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(options.title)}</title>
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  #stage { position: relative; width: ${width}px; height: ${height}px; }
  #stage img { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; }
  #stage svg { position: absolute; left: 0; top: 0; }
  #legend { position: absolute; left: 12px; top: 12px; max-width: 520px; background: rgba(255,255,255,0.94); border: 1px solid #d0d7de; border-radius: 6px; padding: 8px 12px; font-family: DejaVu Sans, Arial, sans-serif; font-size: 12px; color: #1f2328; }
  #legend ul { margin: 4px 0 0; padding-left: 0; list-style: none; max-height: 220px; overflow: hidden; }
  #legend li { margin: 2px 0; }
  #legend code { color: #57606a; }
  .swatch { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 6px; }
</style>
</head>
<body>
<div id="stage">
  <img src="${dataUrl}" alt="capture">
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes.join("")}</svg>
  <div id="legend"><strong>${escapeHtml(options.title)}</strong><ul>${legend}</ul></div>
</div>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
