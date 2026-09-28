import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type Artifact,
  type ArtifactKind,
  type Capture,
  type CaptureDocument,
  captureDocumentSchema,
  type Finding,
  type FindingDocument,
  findingDocumentSchema,
  type FindingState,
  findingStateSchema,
  type RunManifest,
  runManifestSchema,
} from "../domain/schema.js";

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export interface StorePaths {
  readonly root: string;
  readonly runsDir: string;
  readonly baselineDir: string;
  readonly baselineIndexPath: string;
  readonly findingStatePath: string;
}

export interface RunPaths {
  readonly runDir: string;
  readonly artifactsDir: string;
  readonly manifestPath: string;
  readonly findingsPath: string;
  readonly capturesPath: string;
  readonly reportPath: string;
}

export interface ArtifactInput {
  readonly captureId: string;
  readonly kind: ArtifactKind;
  readonly fileName: string;
  readonly mimeType: string;
  readonly data: Buffer;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface RunListing {
  readonly id: string;
  readonly createdAt: string;
  readonly status: string;
  readonly findingCount: number;
}

/** Persistence for runs, artifacts, baselines and cross-run finding state. */
export class RunStore {
  readonly paths: StorePaths;

  constructor(root: string) {
    const resolved = path.resolve(root);
    this.paths = {
      root: resolved,
      runsDir: path.join(resolved, "runs"),
      baselineDir: path.join(resolved, "baselines"),
      baselineIndexPath: path.join(resolved, "baselines", "index.json"),
      findingStatePath: path.join(resolved, "state", "findings.json"),
    };
  }

  /** Per-run path set. */
  run(id: string): RunPaths {
    if (!RUN_ID_PATTERN.test(id)) {
      throw new StorageError("Invalid run ID.");
    }
    const runDir = path.join(this.paths.runsDir, id);
    return {
      runDir,
      artifactsDir: path.join(runDir, "artifacts"),
      manifestPath: path.join(runDir, "manifest.json"),
      findingsPath: path.join(runDir, "findings.json"),
      capturesPath: path.join(runDir, "captures.json"),
      reportPath: path.join(runDir, "report.html"),
    };
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.paths.runsDir, { recursive: true });
    await mkdir(this.paths.baselineDir, { recursive: true });
    await mkdir(path.dirname(this.paths.findingStatePath), { recursive: true });
  }

  async ensureRun(id: string): Promise<RunPaths> {
    const paths = this.run(id);
    await mkdir(paths.artifactsDir, { recursive: true });
    return paths;
  }

  async writeManifest(manifest: RunManifest): Promise<void> {
    const paths = await this.ensureRun(manifest.id);
    await writeJsonAtomic(paths.manifestPath, manifest);
  }

  async readManifest(runId: string): Promise<RunManifest> {
    const raw = await readJson(path.join(this.run(runId).manifestPath));
    return runManifestSchema.parse(raw);
  }

  async writeFindings(runId: string, findings: readonly Finding[]): Promise<void> {
    const paths = await this.ensureRun(runId);
    const document: FindingDocument = { runId, findings: [...findings] };
    await writeJsonAtomic(paths.findingsPath, document);
  }

  async readFindings(runId: string): Promise<Finding[]> {
    const raw = await readJsonOptional(path.join(this.run(runId).findingsPath));
    if (raw === undefined) {
      return [];
    }
    return findingDocumentSchema.parse(raw).findings;
  }

  async writeCaptures(runId: string, captures: readonly Capture[]): Promise<void> {
    const paths = await this.ensureRun(runId);
    const document: CaptureDocument = { runId, captures: [...captures] };
    await writeJsonAtomic(paths.capturesPath, document);
  }

  async readCaptures(runId: string): Promise<Capture[]> {
    const raw = await readJsonOptional(path.join(this.run(runId).capturesPath));
    if (raw === undefined) {
      return [];
    }
    return captureDocumentSchema.parse(raw).captures;
  }

  async readCapture(runId: string, captureId: string): Promise<Capture | undefined> {
    const captures = await this.readCaptures(runId);
    return captures.find((capture) => capture.id === captureId);
  }

  /** Persist a binary artifact and return its manifest entry. */
  async writeArtifact(runId: string, input: ArtifactInput): Promise<Artifact> {
    const _paths = await this.ensureRun(runId);
    const relative = toPosix(path.join("artifacts", input.captureId, input.fileName));
    const absolute = this.resolveArtifactPath(runId, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, input.data);
    return {
      id: `${input.captureId}:${input.fileName}`,
      kind: input.kind,
      path: relative,
      mimeType: input.mimeType,
      bytes: input.data.byteLength,
      sha256: sha256(input.data),
      captureId: input.captureId,
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
    };
  }

  async writeTextFile(runId: string, relativePath: string, contents: string): Promise<string> {
    const paths = await this.ensureRun(runId);
    const absolute = this.resolveArtifactPath(runId, relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, contents, "utf8");
    return toPosix(path.relative(paths.runDir, absolute));
  }

  /** Resolve a run-relative path, refusing directory escapes. */
  resolveArtifactPath(runId: string, relativePath: string): string {
    const runDir = this.run(runId).runDir;
    const absolute = path.resolve(runDir, relativePath);
    const prefix = `${path.resolve(runDir)}${path.sep}`;
    if (!absolute.startsWith(prefix)) {
      throw new StorageError(
        `Refusing to access a path outside the run directory: ${relativePath}`,
      );
    }
    return absolute;
  }

  async readArtifactFile(runId: string, relativePath: string): Promise<Buffer> {
    return readFile(this.resolveArtifactPath(runId, relativePath));
  }

  async listRuns(): Promise<RunListing[]> {
    let entries: string[];
    try {
      entries = await readdir(this.paths.runsDir);
    } catch {
      return [];
    }
    const listings: RunListing[] = [];
    for (const entry of entries) {
      if (!RUN_ID_PATTERN.test(entry)) {
        continue;
      }
      try {
        const raw = await readJson(path.join(this.paths.runsDir, entry, "manifest.json"));
        const manifest = runManifestSchema.parse(raw);
        if (manifest.id !== entry) {
          continue;
        }
        listings.push({
          id: manifest.id,
          createdAt: manifest.createdAt,
          status: manifest.status,
          findingCount: manifest.findingCount,
        });
      } catch {}
    }
    return listings.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  /** Remove the oldest runs beyond `keep`. Active runs are never removed. */
  async pruneRuns(keep: number): Promise<string[]> {
    const runs = await this.listRuns();
    const removable = runs.filter((run) => run.status !== "running").slice(Math.max(keep, 1));
    const removed: string[] = [];
    for (const run of removable) {
      await rm(this.run(run.id).runDir, { recursive: true, force: true });
      removed.push(run.id);
    }
    return removed;
  }

  async writeReport(runId: string, html: string): Promise<string> {
    const paths = await this.ensureRun(runId);
    await writeFile(paths.reportPath, html, "utf8");
    return toPosix(path.relative(paths.runDir, paths.reportPath));
  }

  // ----- baselines -------------------------------------------------------

  async writeBaseline(
    relativePath: string,
    data: Buffer,
    metadata: Record<string, unknown>,
  ): Promise<string> {
    const absolute = this.resolveBaselinePath(relativePath);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
    await this.updateBaselineIndex(relativePath, {
      sha256: sha256(data),
      bytes: data.byteLength,
      ...metadata,
    });
    return toPosix(relativePath);
  }

  async readBaseline(relativePath: string): Promise<Buffer> {
    return readFile(this.resolveBaselinePath(relativePath));
  }

  async baselineExists(relativePath: string): Promise<boolean> {
    try {
      await stat(this.resolveBaselinePath(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async readBaselineIndex(): Promise<Record<string, unknown>> {
    try {
      const raw = await readJson(this.paths.baselineIndexPath);
      return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  resolveBaselinePath(relativePath: string): string {
    const absolute = path.resolve(this.paths.baselineDir, relativePath);
    const prefix = `${path.resolve(this.paths.baselineDir)}${path.sep}`;
    if (!absolute.startsWith(prefix)) {
      throw new StorageError(
        `Refusing to access a path outside the baseline directory: ${relativePath}`,
      );
    }
    return absolute;
  }

  private async updateBaselineIndex(
    relativePath: string,
    entry: Record<string, unknown>,
  ): Promise<void> {
    const index = await this.readBaselineIndex();
    const entries = (index.entries as Record<string, unknown> | undefined) ?? {};
    entries[toPosix(relativePath)] = { approvedAt: new Date().toISOString(), ...entry };
    await mkdir(path.dirname(this.paths.baselineIndexPath), { recursive: true });
    await writeJsonAtomic(this.paths.baselineIndexPath, {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries,
    });
  }

  // ----- cross-run finding state ----------------------------------------

  async readFindingState(): Promise<FindingState> {
    try {
      const raw = await readJson(this.paths.findingStatePath);
      return findingStateSchema.parse(raw);
    } catch {
      return { version: 1, updatedAt: new Date().toISOString(), entries: [] };
    }
  }

  async writeFindingState(state: FindingState): Promise<void> {
    await mkdir(path.dirname(this.paths.findingStatePath), { recursive: true });
    await writeJsonAtomic(this.paths.findingStatePath, state);
  }
}

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function readJson(filePath: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new StorageError(
      `Cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new StorageError(
      `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Read a JSON document that may legitimately not exist yet. */
async function readJsonOptional(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw new StorageError(
      `Invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
