import { slugify } from "../domain/ids.js";
import type { Artifact, Capture, DiffResult } from "../domain/schema.js";
import type { Logger } from "../logging.js";
import type { RunStore } from "../storage/run-store.js";
import { comparePngs } from "./image.js";

export type BaselineView = "full" | "viewport";

const SCREENSHOT_KIND: Record<BaselineView, Artifact["kind"]> = {
  full: "screenshot_full",
  viewport: "screenshot_viewport",
};

export interface BaselineComparison {
  readonly diff: DiffResult;
  readonly diffPng: Buffer | undefined;
  /** The approved baseline image, kept for expected/actual/diff review. */
  readonly expected: Buffer;
}

/** Stable baseline directory key for one route/scenario/viewport combination. */
export function baselineKey(input: {
  readonly route: string;
  readonly scenario: string;
  readonly viewport: string;
}): string {
  return [slugify(input.route), slugify(input.scenario), slugify(input.viewport)].join("__");
}

export function baselineImagePath(
  input: { readonly route: string; readonly scenario: string; readonly viewport: string },
  view: BaselineView,
): string {
  return `${baselineKey(input)}/${view}.png`;
}

export function baselineMetaPath(input: {
  readonly route: string;
  readonly scenario: string;
  readonly viewport: string;
}): string {
  return `${baselineKey(input)}/meta.json`;
}

export interface BaselineMeta {
  readonly version: 1;
  readonly approvedAt: string;
  readonly approvedFromRun: string;
  readonly views: Partial<
    Record<
      BaselineView,
      { readonly runId: string; readonly sha256: string; readonly approvedAt: string }
    >
  >;
}

export async function readBaselineMeta(
  store: RunStore,
  capture: Pick<Capture, "route" | "scenario" | "viewport">,
): Promise<BaselineMeta | undefined> {
  const metaPath = baselineMetaPath(capture);
  try {
    const raw = JSON.parse((await store.readBaseline(metaPath)).toString("utf8")) as BaselineMeta;
    return raw;
  } catch {
    return undefined;
  }
}

/**
 * Compare a capture against its approved baseline.
 *
 * Returns `undefined` when no baseline exists yet: the first capture only
 * records evidence, it never invents a regression.
 */
export async function compareAgainstBaseline(
  store: RunStore,
  runId: string,
  capture: Capture,
  options: { threshold: number; regionMinPixels: number },
): Promise<BaselineComparison | undefined> {
  const artifact = screenshotArtifact(capture);
  if (artifact === undefined) {
    return undefined;
  }
  const view: BaselineView = artifact.kind === "screenshot_full" ? "full" : "viewport";
  const relativePath = baselineImagePath(capture, view);
  if (!(await store.baselineExists(relativePath))) {
    return undefined;
  }

  const expected = await store.readBaseline(relativePath);
  const actual = await store.readArtifactFile(runId, artifact.path);
  const meta = await readBaselineMeta(store, capture);
  const comparison = comparePngs(actual, expected, options);
  const diff: DiffResult = {
    status: comparison.status,
    ratio: comparison.ratio,
    diffPixels: comparison.diffPixels,
    regions: comparison.regions.map((region) => ({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      pixels: region.pixels,
    })),
    ...(comparison.width > 0 ? { width: comparison.width } : {}),
    ...(comparison.height > 0 ? { height: comparison.height } : {}),
    ...(meta?.views[view]?.runId !== undefined ? { baselineRunId: meta.views[view].runId } : {}),
  };
  return { diff, diffPng: comparison.diffPng, expected };
}

function screenshotArtifact(capture: Capture): Artifact | undefined {
  return (
    capture.artifacts.find((artifact) => artifact.kind === "screenshot_full") ??
    capture.artifacts.find((artifact) => artifact.kind === "screenshot_viewport")
  );
}

export interface ApproveBaselineInput {
  readonly runId: string;
  readonly captureIds?: readonly string[] | undefined;
  readonly routes?: readonly string[] | undefined;
  readonly viewports?: readonly string[] | undefined;
  readonly scenarios?: readonly string[] | undefined;
}

export interface ApprovedBaseline {
  readonly captureId: string;
  readonly route: string;
  readonly scenario: string;
  readonly viewport: string;
  readonly view: BaselineView;
  readonly path: string;
  readonly sha256: string;
}

export interface ApproveBaselineResult {
  readonly approved: ApprovedBaseline[];
  readonly skipped: string[];
}

/**
 * Explicitly promote captured screenshots to baselines.
 *
 * Deliberately a separate operation: nothing in a capture run ever approves a
 * baseline automatically.
 */
export async function approveBaselines(
  store: RunStore,
  input: ApproveBaselineInput,
  logger: Logger,
): Promise<ApproveBaselineResult> {
  const captures = await store.readCaptures(input.runId);
  const selected = captures.filter((capture) => matches(capture, input));
  const approved: ApprovedBaseline[] = [];
  const skipped: string[] = [];

  for (const capture of selected) {
    const artifacts = capture.artifacts.filter(
      (artifact) =>
        artifact.kind === SCREENSHOT_KIND.full || artifact.kind === SCREENSHOT_KIND.viewport,
    );
    if (artifacts.length === 0) {
      skipped.push(`${capture.id}: no screenshot artifact`);
      continue;
    }
    const existing = await readBaselineMeta(store, capture);
    const views: Record<string, { runId: string; sha256: string; approvedAt: string }> = {
      ...(existing?.views as
        | Record<string, { runId: string; sha256: string; approvedAt: string }>
        | undefined),
    };
    const timestamp = new Date().toISOString();

    for (const artifact of artifacts) {
      const view: BaselineView = artifact.kind === "screenshot_full" ? "full" : "viewport";
      const data = await store.readArtifactFile(input.runId, artifact.path);
      const path = await store.writeBaseline(baselineImagePath(capture, view), data, {
        runId: input.runId,
        captureId: capture.id,
        view,
      });
      views[view] = { runId: input.runId, sha256: artifact.sha256, approvedAt: timestamp };
      approved.push({
        captureId: capture.id,
        route: capture.route,
        scenario: capture.scenario,
        viewport: capture.viewport,
        view,
        path,
        sha256: artifact.sha256,
      });
    }

    const meta: BaselineMeta = {
      version: 1,
      approvedAt: timestamp,
      approvedFromRun: input.runId,
      views,
    };
    await store.writeBaseline(
      baselineMetaPath(capture),
      Buffer.from(`${JSON.stringify(meta, null, 2)}\n`, "utf8"),
      { runId: input.runId, captureId: capture.id, kind: "meta" },
    );
    logger.info("baseline approved", { captureId: capture.id, views: Object.keys(views) });
  }

  return { approved, skipped };
}

function matches(capture: Capture, input: ApproveBaselineInput): boolean {
  if (capture.status !== "captured") {
    return false;
  }
  if (input.captureIds !== undefined && !input.captureIds.includes(capture.id)) {
    return false;
  }
  if (input.routes !== undefined && !input.routes.includes(capture.route)) {
    return false;
  }
  if (input.viewports !== undefined && !input.viewports.includes(capture.viewport)) {
    return false;
  }
  if (input.scenarios !== undefined && !input.scenarios.includes(capture.scenario)) {
    return false;
  }
  return true;
}
