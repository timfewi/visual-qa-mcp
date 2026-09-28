import path from "node:path";

import {
  assertNavigationAllowed,
  type SecurityPolicy,
  sanitizeUrlForStorage,
} from "./security/url-guard.js";
import { compileRedaction, type CompiledRedaction } from "./security/redact.js";
import type { VisualQaConfig, Route, Scenario, Viewport } from "./config/schema.js";
import { loadConfig, summarizeConfig } from "./config/load.js";
import {
  categoryCounts,
  normalizeFindings,
  severityCounts,
  filterFindings,
  sortFindings,
} from "./domain/findings.js";
import { createCaptureId, createRunId } from "./domain/ids.js";
import { runRules } from "./domain/rules/index.js";
import type {
  Artifact,
  Capture,
  CaptureSummary,
  DiffResult,
  Finding,
  FindingState,
  RecheckStatus,
  RunManifest,
  Severity,
} from "./domain/schema.js";
import { classifyRecheck, type RecheckOutcome } from "./domain/status.js";
import type { Logger } from "./logging.js";
import { RunStore } from "./storage/run-store.js";
import { captureTarget, resolveRouteUrl, type CaptureEvidence } from "./capture/session.js";
import { closeBrowser, launchBrowser, type BrowserLaunchResult } from "./capture/browser.js";
import { approveBaselines, compareAgainstBaseline } from "./compare/baseline.js";
import { renderAnnotation, type AnnotationMarker } from "./annotate/annotate.js";
import { renderReport } from "./annotate/report.js";
import {
  buildStructuralFacts,
  normalizeVisionFindings,
  type VisionReviewAdapter,
} from "./review/adapter.js";
import { startPreview, type PreviewServer } from "./target/preview.js";

/** Local alias: the resolved configuration type is used heavily below. */
type Config = VisualQaConfig;

export interface ProgressReport {
  readonly step: number;
  readonly total: number;
  readonly message: string;
}

export interface ProgressHooks {
  report(report: ProgressReport): void | Promise<void>;
}

/** Test seam: replaces the real Chromium launch. */
export type BrowserLauncher = (config: Config, logger: Logger) => Promise<BrowserLaunchResult>;

export interface ServiceOptions {
  readonly configPath?: string | undefined;
  readonly cwd?: string | undefined;
  readonly logger: Logger;
  readonly visionAdapter?: VisionReviewAdapter | undefined;
  readonly browserLauncher?: BrowserLauncher | undefined;
}

export interface InspectInput {
  readonly routes?: readonly string[] | undefined;
  readonly viewports?: readonly string[] | undefined;
  readonly scenarios?: readonly string[] | undefined;
  readonly designBrief?: string | undefined;
  /**
   * Inspect exactly this URL as a single ad-hoc page instead of the configured
   * routes. The URL must satisfy the configured security policy.
   */
  readonly url?: string | undefined;
}

/** One route/scenario/viewport combination to capture. */
interface CaptureTarget {
  readonly route: Route;
  readonly scenario: Scenario;
  readonly viewport: Viewport;
}

export interface RunResult {
  readonly runId: string;
  readonly status: RunManifest["status"];
  readonly operation: RunManifest["operation"];
  readonly parentRunId?: string | undefined;
  readonly runDir: string;
  readonly reportPath: string;
  readonly target: string;
  readonly createdAt: string;
  readonly finishedAt?: string | undefined;
  readonly captures: CaptureSummary[];
  readonly findings: Finding[];
  readonly summary: {
    readonly captures: number;
    readonly findings: number;
    readonly bySeverity: Record<Severity, number>;
    readonly byCategory: Record<string, number>;
  };
  readonly artifacts: Artifact[];
  readonly warnings: string[];
}

export interface EvidenceQuery {
  readonly runId: string;
  readonly findingIds?: readonly string[] | undefined;
  readonly captureIds?: readonly string[] | undefined;
  readonly viewports?: readonly string[] | undefined;
  readonly routes?: readonly string[] | undefined;
  readonly includeImages?: boolean | undefined;
  readonly includeSemantics?: boolean | undefined;
  readonly includeAria?: boolean | undefined;
  readonly maxImages?: number | undefined;
}

export interface EvidenceImage {
  readonly path: string;
  readonly mimeType: string;
  readonly data: Buffer;
  readonly kind: Artifact["kind"];
  readonly captureId: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface EvidenceResult {
  readonly runId: string;
  readonly operation: RunManifest["operation"];
  readonly findings: Finding[];
  readonly captures: EvidenceCapture[];
  readonly images: EvidenceImage[];
  readonly resourceLinks: {
    readonly uri: string;
    readonly name: string;
    readonly mimeType: string;
  }[];
  readonly notes: string[];
}

export interface EvidenceCapture {
  readonly id: string;
  readonly route: string;
  readonly scenario: string;
  readonly viewport: string;
  readonly url: string;
  readonly status: Capture["status"];
  readonly error?: string | undefined;
  readonly stability: Capture["stability"];
  readonly redaction: Capture["redaction"];
  readonly runtime: Capture["runtime"];
  readonly axe?: Capture["axe"] | undefined;
  readonly diff?: DiffResult | undefined;
  readonly aria?: string | undefined;
  readonly semantics?: Capture["semantics"] | undefined;
  readonly artifacts: readonly Artifact[];
}

export interface RecheckInput {
  readonly runId: string;
  readonly findingIds: readonly string[];
  readonly designBrief?: string | undefined;
}

export interface RecheckEntry {
  readonly findingId: string;
  readonly previousStatus: RecheckStatus;
  readonly status: RecheckStatus;
  readonly note: string;
  readonly observation: string;
  readonly previousMetric: number | undefined;
  readonly currentMetric: number | undefined;
  readonly captureId: string;
}

/** A finding selected for recheck, resolved from a run or the finding state. */
interface SelectedFinding {
  readonly id: string;
  readonly route: string;
  readonly scenario: string;
  readonly viewport: string;
  readonly category: Finding["category"];
  readonly origin: Finding["origin"];
  readonly ruleId: string;
  readonly severity: Finding["severity"];
  readonly observation: string;
  readonly status: RecheckStatus;
  readonly history: readonly Finding["history"][number][];
  readonly runId: string;
  readonly metric?: Finding["metric"] | undefined;
}

export interface RecheckResult extends RunResult {
  readonly recheck: RecheckEntry[];
}

export interface AnnotateInput {
  readonly runId: string;
  readonly findingIds?: readonly string[] | undefined;
  readonly severities?: readonly Severity[] | undefined;
  readonly categories?: readonly string[] | undefined;
  readonly viewports?: readonly string[] | undefined;
}

export interface AnnotationOutput {
  readonly captureId: string;
  readonly route: string;
  readonly scenario: string;
  readonly viewport: string;
  readonly path: string;
  readonly findingIds: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly clipped: boolean;
}

export interface AnnotateResult {
  readonly runId: string;
  readonly annotations: AnnotationOutput[];
  readonly reportPath: string;
  readonly findings: number;
}

export interface ApproveInput {
  readonly runId: string;
  readonly captureIds?: readonly string[] | undefined;
  readonly routes?: readonly string[] | undefined;
  readonly viewports?: readonly string[] | undefined;
  readonly scenarios?: readonly string[] | undefined;
}

export interface ApproveResult {
  readonly runId: string;
  readonly approved: readonly {
    readonly captureId: string;
    readonly route: string;
    readonly scenario: string;
    readonly viewport: string;
    readonly view: string;
    readonly path: string;
  }[];
  readonly skipped: readonly string[];
}

/**
 * Transport-independent core of the visual QA loop.
 *
 * The MCP server and the CLI both drive exactly this service; nothing in this
 * module knows about MCP.
 */
export class VisualQaService {
  private readonly config: VisualQaConfig;
  private readonly configPath: string;
  private readonly store: RunStore;
  private readonly logger: Logger;
  private readonly visionAdapter: VisionReviewAdapter | undefined;
  private readonly browserLauncher: BrowserLauncher;
  private readonly redaction: CompiledRedaction;

  constructor(options: {
    readonly config: VisualQaConfig;
    readonly configPath: string;
    readonly store: RunStore;
    readonly logger: Logger;
    readonly redaction: CompiledRedaction;
    readonly visionAdapter?: VisionReviewAdapter | undefined;
    readonly browserLauncher?: BrowserLauncher | undefined;
  }) {
    this.config = options.config;
    this.configPath = options.configPath;
    this.store = options.store;
    this.logger = options.logger;
    this.redaction = options.redaction;
    this.visionAdapter = options.visionAdapter;
    this.browserLauncher = options.browserLauncher ?? launchBrowser;
  }

  static async create(options: ServiceOptions): Promise<VisualQaService> {
    const loaded = await loadConfig(options.configPath, options.cwd);
    const redaction = compileRedaction(loaded.config.redaction);
    return new VisualQaService({
      config: loaded.config,
      configPath: loaded.path,
      store: new RunStore(
        path.isAbsolute(loaded.config.storage.root)
          ? loaded.config.storage.root
          : path.resolve(path.dirname(loaded.path), loaded.config.storage.root),
      ),
      logger: options.logger,
      redaction,
      visionAdapter: options.visionAdapter,
      ...(options.browserLauncher !== undefined
        ? { browserLauncher: options.browserLauncher }
        : {}),
    });
  }

  get configuration(): VisualQaConfig {
    return this.config;
  }

  get storeInstance(): RunStore {
    return this.store;
  }

  private get policy(): SecurityPolicy {
    return this.config.security;
  }

  /** Inspect the configured routes, scenarios and viewports. */
  async inspect(input: InspectInput, hooks?: ProgressHooks): Promise<RunResult> {
    const targets = this.selectTargets(input);
    if (targets.length === 0) {
      throw new ServiceError(
        "No capture target matches the requested route/viewport/scenario filter.",
      );
    }
    return this.runCapture({
      operation: "inspect",
      targets,
      designBrief: input.designBrief,
      ...(hooks !== undefined ? { hooks } : {}),
    });
  }

  /** Recheck only the captures that produced the selected findings. */
  async recheck(input: RecheckInput, hooks?: ProgressHooks): Promise<RecheckResult> {
    if (input.findingIds.length === 0) {
      throw new ServiceError("visual_recheck requires at least one finding ID.");
    }
    const parentRunId = await this.resolveRunId(input.runId);
    const state = await this.store.readFindingState();
    const selected = await this.resolveSelectedFindings(parentRunId, input.findingIds, state);
    if (selected.length === 0) {
      throw new ServiceError(
        `None of the requested finding IDs are known in run ${parentRunId} or the recorded finding state: ${input.findingIds.join(", ")}`,
      );
    }

    const { targets, missing } = this.recheckTargets(selected);
    if (targets.length === 0) {
      throw new ServiceError(
        `The selected findings cannot be rechecked because their configuration is gone: ${missing.join(", ")}`,
      );
    }

    const run = await this.runCapture({
      operation: "recheck",
      targets,
      designBrief: input.designBrief,
      parentRunId,
      ...(hooks !== undefined ? { hooks } : {}),
    });

    const current = await this.store.readFindings(run.runId);
    const entries: RecheckEntry[] = [];
    const outcomes = new Map<string, RecheckOutcome>();
    const recheckedCaptures = await this.store.readCaptures(run.runId);
    for (const finding of selected) {
      const match = current.find((candidate) => candidate.id === finding.id);
      const captureId = createCaptureId({
        route: finding.route,
        scenario: finding.scenario,
        viewport: finding.viewport,
      });
      const capture = recheckedCaptures.find(
        (candidate) =>
          candidate.route === finding.route &&
          candidate.scenario === finding.scenario &&
          candidate.viewport === finding.viewport,
      );
      const outcome = classifyRecheck({
        present: match !== undefined,
        previousStatus: finding.status,
        previousMetric: finding.metric,
        currentMetric: match?.metric,
        captureFailed: capture === undefined || capture.status === "failed",
      });
      outcomes.set(finding.id, outcome);
      entries.push({
        findingId: finding.id,
        previousStatus: finding.status,
        status: outcome.status,
        note: outcome.note,
        observation: match?.observation ?? finding.observation,
        previousMetric: finding.metric?.value,
        currentMetric: match?.metric?.value,
        captureId,
      });
    }

    await this.applyRecheckOutcomes(run.runId, selected, outcomes, state);

    return { ...run, recheck: entries };
  }

  /**
   * Resolve findings that should be rechecked.
   *
   * Findings are taken from the referenced run when present, otherwise from the
   * recorded cross-run finding state. That keeps `visual_recheck` chainable:
   * a recheck run contains no findings for conditions that were fixed, yet those
   * IDs must still be recheckable to detect a reappearance.
   */
  private async resolveSelectedFindings(
    parentRunId: string,
    ids: readonly string[],
    state: FindingState,
  ): Promise<SelectedFinding[]> {
    const parentFindings = await this.store.readFindings(parentRunId);
    const byId = new Map(parentFindings.map((finding) => [finding.id, finding]));
    const stateById = new Map(state.entries.map((entry) => [entry.id, entry]));
    const selected: SelectedFinding[] = [];

    for (const id of ids) {
      const parent = byId.get(id);
      const entry = stateById.get(id);
      if (parent !== undefined) {
        selected.push({
          id,
          route: parent.route,
          scenario: parent.scenario,
          viewport: parent.viewport,
          category: parent.category,
          origin: parent.origin,
          ruleId: parent.ruleId,
          severity: parent.severity,
          observation: parent.observation,
          status: entry?.status ?? parent.status,
          history: entry?.history ?? parent.history,
          runId: parent.runId,
          ...(entry?.metric !== undefined
            ? { metric: entry.metric }
            : parent.metric !== undefined
              ? { metric: parent.metric }
              : {}),
        });
        continue;
      }
      if (entry !== undefined) {
        selected.push({
          id,
          route: entry.route,
          scenario: entry.scenario,
          viewport: entry.viewport,
          category: entry.category,
          origin: entry.origin,
          ruleId: entry.ruleId,
          severity: entry.severity,
          observation: entry.observation,
          status: entry.status,
          history: entry.history,
          runId: entry.lastRunId,
          ...(entry.metric !== undefined ? { metric: entry.metric } : {}),
        });
      }
    }

    return selected;
  }

  /** Retrieve structured evidence and optionally the referenced images. */
  async getEvidence(query: EvidenceQuery): Promise<EvidenceResult> {
    const runId = await this.resolveRunId(query.runId);
    const manifest = await this.store.readManifest(runId);
    const captures = await this.store.readCaptures(runId);
    const allFindings = await this.store.readFindings(runId);

    const findings = filterFindings(allFindings, {
      ids: query.findingIds,
      routes: query.routes,
      viewports: query.viewports,
    });

    const wantedCaptureIds = new Set<string>(query.captureIds ?? []);
    if (query.findingIds !== undefined) {
      for (const capture of captures) {
        const matchesFinding = findings.some(
          (finding) =>
            finding.route === capture.route &&
            finding.scenario === capture.scenario &&
            finding.viewport === capture.viewport,
        );
        if (matchesFinding) {
          wantedCaptureIds.add(capture.id);
        }
      }
    }
    const hasCaptureFilter =
      query.captureIds !== undefined ||
      query.viewports !== undefined ||
      query.routes !== undefined ||
      query.findingIds !== undefined;
    const selectedCaptures = hasCaptureFilter
      ? captures.filter(
          (capture) =>
            wantedCaptureIds.has(capture.id) ||
            query.viewports?.includes(capture.viewport) ||
            query.routes?.includes(capture.route),
        )
      : captures;

    const notes: string[] = [];
    const images: EvidenceImage[] = [];
    const resourceLinks: { uri: string; name: string; mimeType: string }[] = [];
    const maxImages = query.maxImages ?? 6;

    for (const capture of selectedCaptures) {
      for (const artifact of capture.artifacts) {
        const uri = `visual-qa://runs/${encodeURIComponent(runId)}/artifacts/${artifact.path}`;
        resourceLinks.push({
          uri,
          name: `${capture.id}/${artifact.kind}`,
          mimeType: artifact.mimeType,
        });
      }
    }

    if (query.includeImages === true) {
      const preferred: Artifact[] = [];
      for (const capture of selectedCaptures) {
        const viewportShot = capture.artifacts.find(
          (artifact) => artifact.kind === "screenshot_viewport",
        );
        const fullShot = capture.artifacts.find((artifact) => artifact.kind === "screenshot_full");
        const diff = capture.artifacts.find((artifact) => artifact.kind === "diff");
        if (viewportShot !== undefined) {
          preferred.push(viewportShot);
        }
        if (diff !== undefined) {
          preferred.push(diff);
        } else if (fullShot !== undefined && viewportShot === undefined) {
          preferred.push(fullShot);
        }
      }
      for (const artifact of preferred.slice(0, maxImages)) {
        images.push({
          path: artifact.path,
          mimeType: artifact.mimeType,
          data: await this.store.readArtifactFile(runId, artifact.path),
          kind: artifact.kind,
          captureId: artifact.captureId,
          ...(artifact.width !== undefined ? { width: artifact.width } : {}),
          ...(artifact.height !== undefined ? { height: artifact.height } : {}),
        });
      }
      if (preferred.length > maxImages) {
        notes.push(
          `Only ${maxImages} of ${preferred.length} candidate images are included; the rest are available as resource links.`,
        );
      }
    }

    const evidenceCaptures: EvidenceCapture[] = selectedCaptures.map((capture) => ({
      id: capture.id,
      route: capture.route,
      scenario: capture.scenario,
      viewport: capture.viewport,
      url: capture.url,
      status: capture.status,
      stability: capture.stability,
      redaction: capture.redaction,
      runtime: capture.runtime,
      artifacts: capture.artifacts,
      ...(capture.error !== undefined ? { error: capture.error } : {}),
      ...(capture.axe !== undefined ? { axe: capture.axe } : {}),
      ...(capture.diff !== undefined ? { diff: capture.diff } : {}),
      ...(query.includeAria === true && capture.aria !== undefined ? { aria: capture.aria } : {}),
      ...(query.includeSemantics === true && capture.semantics !== undefined
        ? { semantics: capture.semantics }
        : {}),
    }));

    notes.push(
      `Run ${runId} (${manifest.operation}) contains ${captures.length} capture(s) and ${allFindings.length} finding(s).`,
    );

    return {
      runId,
      operation: manifest.operation,
      findings,
      captures: evidenceCaptures,
      images,
      resourceLinks,
      notes,
    };
  }

  /** Produce annotated screenshots and the static review report. */
  async annotate(input: AnnotateInput): Promise<AnnotateResult> {
    const runId = await this.resolveRunId(input.runId);
    const findings = filterFindings(await this.store.readFindings(runId), {
      ids: input.findingIds,
      severities: input.severities,
      categories: input.categories,
      viewports: input.viewports,
    });
    if (findings.length === 0) {
      throw new ServiceError(`No finding in run ${runId} matches the annotation filter.`);
    }
    const captures = await this.store.readCaptures(runId);
    const groups = groupFindings(findings, captures);
    const annotations = new Map<string, string>();
    const outputs: AnnotationOutput[] = [];

    if (groups.length > 0) {
      const { browser } = await this.browserLauncher(this.config, this.logger);
      try {
        for (const group of groups) {
          const capture = group.capture;
          const source = await this.pickAnnotationSource(runId, capture);
          if (source === undefined) {
            this.logger.warn("no screenshot available for annotation", { captureId: capture.id });
            continue;
          }
          const markers: AnnotationMarker[] = group.findings.map((finding, index) => ({
            findingId: finding.id,
            number: index + 1,
            bbox: finding.bbox ?? {
              x: 0,
              y: 0,
              width: source.width,
              height: Math.min(source.height, 120),
            },
            severity: finding.severity,
            label: `${finding.severity} · ${finding.category} · ${finding.observation}`,
          }));
          const rendered = await renderAnnotation(browser, {
            image: source.data,
            width: source.width,
            height: source.height,
            markers,
            title: `${capture.viewport} · ${capture.route} · ${capture.scenario} (${runId})`,
          });
          const artifact = await this.store.writeArtifact(runId, {
            captureId: capture.id,
            kind: "annotation",
            fileName: "annotation.png",
            mimeType: "image/png",
            data: rendered.png,
            width: rendered.width,
            height: rendered.height,
          });
          annotations.set(capture.id, artifact.path);
          outputs.push({
            captureId: capture.id,
            route: capture.route,
            scenario: capture.scenario,
            viewport: capture.viewport,
            path: artifact.path,
            findingIds: group.findings.map((finding) => finding.id),
            width: rendered.width,
            height: rendered.height,
            clipped: rendered.clipped,
          });
        }
      } finally {
        await browser.close();
      }
    }

    const manifest = await this.store.readManifest(runId);
    const capturesWithAnnotations = await this.store.readCaptures(runId);
    for (const output of outputs) {
      const capture = capturesWithAnnotations.find(
        (candidate) => candidate.id === output.captureId,
      );
      if (capture !== undefined) {
        capture.artifacts = [
          ...capture.artifacts.filter((artifact) => artifact.kind !== "annotation"),
          {
            id: `${capture.id}:annotation.png`,
            kind: "annotation",
            path: output.path,
            mimeType: "image/png",
            bytes: 0,
            sha256: "",
            captureId: capture.id,
            width: output.width,
            height: output.height,
          },
        ];
      }
    }
    await this.store.writeCaptures(runId, capturesWithAnnotations);

    const reportPath = await this.store.writeReport(
      runId,
      renderReport({
        manifest,
        captures: capturesWithAnnotations,
        findings: await this.store.readFindings(runId),
        annotations,
      }),
    );

    return { runId, annotations: outputs, reportPath, findings: findings.length };
  }

  /** Explicitly approve captured screenshots as regression baselines. */
  async approveBaseline(input: ApproveInput): Promise<ApproveResult> {
    const runId = await this.resolveRunId(input.runId);
    const result = await approveBaselines(
      this.store,
      {
        runId,
        ...(input.captureIds !== undefined ? { captureIds: input.captureIds } : {}),
        ...(input.routes !== undefined ? { routes: input.routes } : {}),
        ...(input.viewports !== undefined ? { viewports: input.viewports } : {}),
        ...(input.scenarios !== undefined ? { scenarios: input.scenarios } : {}),
      },
      this.logger,
    );
    if (result.approved.length === 0) {
      throw new ServiceError(
        `No capture in run ${runId} matched the baseline approval filter${result.skipped.length > 0 ? ` (${result.skipped.join("; ")})` : ""}.`,
      );
    }
    return {
      runId,
      approved: result.approved.map((entry) => ({
        captureId: entry.captureId,
        route: entry.route,
        scenario: entry.scenario,
        viewport: entry.viewport,
        view: entry.view,
        path: entry.path,
      })),
      skipped: result.skipped,
    };
  }

  async listRuns(): Promise<
    { id: string; createdAt: string; status: string; findingCount: number }[]
  > {
    const runs = await this.store.listRuns();
    return runs.filter((run) => run.status !== "running");
  }

  private async resolveRunId(runId: string): Promise<string> {
    if (runId !== "latest") {
      return runId;
    }
    const runs = (await this.store.listRuns()).filter((run) => run.status !== "running");
    const latest = runs[0];
    if (latest === undefined) {
      throw new ServiceError("No completed run has been recorded yet.");
    }
    return latest.id;
  }

  private selectTargets(input: InspectInput): CaptureTarget[] {
    const viewports =
      input.viewports === undefined
        ? this.config.viewports
        : this.config.viewports.filter(
            (viewport) => input.viewports?.includes(viewport.name) === true,
          );

    if (input.url !== undefined) {
      const adHoc: Route = { path: input.url, scenarios: [] };
      return viewports.map((viewport) => ({
        route: adHoc,
        scenario: { name: "default", actions: [], settleMs: 0 },
        viewport,
      }));
    }

    const routes =
      input.routes === undefined
        ? this.config.routes
        : this.config.routes.filter((route) => input.routes?.includes(route.path) === true);

    const targets: CaptureTarget[] = [];
    for (const route of routes) {
      const scenarios =
        route.scenarios.length > 0
          ? input.scenarios === undefined
            ? route.scenarios
            : route.scenarios.filter(
                (scenario) => input.scenarios?.includes(scenario.name) === true,
              )
          : [{ name: "default", actions: [], settleMs: 0 }];
      for (const scenario of scenarios) {
        for (const viewport of viewports) {
          targets.push({ route, scenario, viewport });
        }
      }
    }
    return targets;
  }

  /**
   * Resolve recheck targets from the recorded findings.
   *
   * A configured route is used when it still exists so its scenario actions are
   * reproduced; otherwise the recorded route path is captured directly, which
   * keeps ad-hoc URL inspections recheckable. The viewport must still be
   * configured, because its dimensions cannot be reconstructed otherwise.
   */
  private recheckTargets(selected: readonly SelectedFinding[]): {
    targets: CaptureTarget[];
    missing: string[];
  } {
    const targets: CaptureTarget[] = [];
    const missing: string[] = [];

    for (const finding of selected) {
      const viewport = this.config.viewports.find(
        (candidate) => candidate.name === finding.viewport,
      );
      if (viewport === undefined) {
        missing.push(`viewport "${finding.viewport}"`);
        continue;
      }
      const configured = this.config.routes.find((route) => route.path === finding.route);
      const route: Route = configured ?? { path: finding.route, scenarios: [] };
      const scenario: Scenario = route.scenarios.find(
        (candidate) => candidate.name === finding.scenario,
      ) ?? { name: finding.scenario, actions: [], settleMs: 0 };
      const alreadySelected = targets.some(
        (target) =>
          target.route.path === route.path &&
          target.scenario.name === scenario.name &&
          target.viewport.name === viewport.name,
      );
      if (!alreadySelected) {
        targets.push({ route, scenario, viewport });
      }
    }

    return { targets, missing };
  }

  private async runCapture(options: {
    readonly operation: "inspect" | "recheck";
    readonly targets: readonly CaptureTarget[];
    readonly designBrief?: string | undefined;
    readonly parentRunId?: string | undefined;
    readonly hooks?: ProgressHooks | undefined;
  }): Promise<RunResult> {
    const { operation, targets, hooks, designBrief, parentRunId } = options;
    const runId = createRunId();
    const warnings: string[] = [];
    let preview: PreviewServer | undefined;
    const startedAt = new Date();

    const resolvedBase = await this.resolveBaseUrl(warnings);
    preview = resolvedBase.preview;
    const baseUrl = resolvedBase.baseUrl;

    // Only origins that are actually inspected stay reachable; request
    // interception aborts everything else.
    const allowedOrigins = new Set<string>();
    for (const target of targets) {
      try {
        const resolved = resolveRouteUrl(baseUrl, target.route.path);
        assertNavigationAllowed(resolved, this.policy);
        allowedOrigins.add(new URL(resolved).origin);
      } catch {}
    }
    if (this.config.security.blockRequestsToOtherOrigins) {
      warnings.push(
        `Requests outside ${allowedOrigins.size} allowed origin(s) are blocked by configuration.`,
      );
    }

    await this.store.ensureRoot();
    const manifest: RunManifest = {
      id: runId,
      createdAt: startedAt.toISOString(),
      status: "running",
      operation,
      configPath: this.configPath,
      configName: this.config.name,
      configSummary: summarizeConfig(this.config),
      targetBaseUrl: sanitizeUrlForStorage(baseUrl),
      routes: [...new Set(targets.map((target) => target.route.path))],
      viewports: [...new Set(targets.map((target) => target.viewport.name))],
      captures: [],
      findingCount: 0,
      findingsBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      findingsByCategory: {},
      errors: [...warnings],
      artifacts: [],
      ...(parentRunId !== undefined ? { parentRunId } : {}),
    };
    await this.store.writeManifest(manifest);

    let launchedBrowser: Awaited<ReturnType<BrowserLauncher>> | undefined;
    const getBrowser = async () => {
      if (launchedBrowser === undefined) {
        launchedBrowser = await this.browserLauncher(this.config, this.logger);
        this.logger.debug("capture run started", {
          runId,
          operation,
          browser: launchedBrowser.resolvedFrom,
        });
      }
      return launchedBrowser.browser;
    };
    const captures: Capture[] = [];
    const findings: Finding[] = [];
    let step = 0;

    try {
      for (const target of targets) {
        step += 1;
        await hooks?.report({
          step,
          total: targets.length,
          message: `Capturing ${target.route.path} · ${target.scenario.name} · ${target.viewport.name}`,
        });

        const evidence = await captureTarget(
          getBrowser,
          {
            runId,
            route: target.route,
            scenario: target.scenario,
            viewport: target.viewport,
            baseUrl,
            storageStatePath: this.resolveStorageState(target.scenario),
          },
          {
            config: this.config,
            redaction: this.redaction,
            policy: this.policy,
            allowedOrigins,
            logger: this.logger,
          },
        );

        const capture = await this.finalizeCapture(runId, evidence);
        captures.push(capture);
        if (capture.error !== undefined) {
          warnings.push(`${capture.id}: ${capture.error}`);
        }

        const captureFindings = await this.detectFindings(runId, capture);
        findings.push(...captureFindings);
      }

      if (this.visionAdapter !== undefined) {
        const visionFindings = await this.runVisionReview(runId, captures, findings, designBrief);
        findings.push(...visionFindings);
      }
    } catch (error) {
      const partialFindings = sortFindings(findings);
      const failedManifest: RunManifest = {
        ...manifest,
        status: "failed",
        finishedAt: new Date().toISOString(),
        captures: captures.map((capture) => ({
          id: capture.id,
          route: capture.route,
          scenario: capture.scenario,
          viewport: capture.viewport,
          status: capture.status,
          url: capture.url,
          durationMs: capture.durationMs,
          ...(capture.error !== undefined ? { error: capture.error } : {}),
        })),
        findingCount: partialFindings.length,
        findingsBySeverity: severityCounts(partialFindings),
        findingsByCategory: categoryCounts(partialFindings),
        errors: [...warnings, "Capture run stopped before completion."],
        artifacts: captures.flatMap((capture) => capture.artifacts),
      };
      await Promise.allSettled([
        this.store.writeFindings(runId, partialFindings),
        this.store.writeCaptures(runId, captures),
      ]);
      await this.store.writeManifest(failedManifest).catch(() => undefined);
      throw error;
    } finally {
      if (launchedBrowser !== undefined) {
        await closeBrowser(launchedBrowser.browser, this.logger);
      }
      await preview?.stop();
    }

    const finishedAt = new Date();
    const sortedFindings = sortFindings(findings);

    await this.store.writeFindings(runId, sortedFindings);
    await this.store.writeCaptures(runId, captures);

    const failed = captures.filter((capture) => capture.status === "failed");
    const finalManifest: RunManifest = {
      ...manifest,
      status: failed.length === captures.length && captures.length > 0 ? "failed" : "completed",
      finishedAt: finishedAt.toISOString(),
      captures: captures.map((capture) => ({
        id: capture.id,
        route: capture.route,
        scenario: capture.scenario,
        viewport: capture.viewport,
        status: capture.status,
        url: capture.url,
        durationMs: capture.durationMs,
        ...(capture.error !== undefined ? { error: capture.error } : {}),
      })),
      findingCount: sortedFindings.length,
      findingsBySeverity: severityCounts(sortedFindings),
      findingsByCategory: categoryCounts(sortedFindings),
      errors: warnings,
      artifacts: captures.flatMap((capture) => capture.artifacts),
    };
    await this.store.writeManifest(finalManifest);

    const reportPath = await this.store.writeReport(
      runId,
      renderReport({ manifest: finalManifest, captures, findings: sortedFindings }),
    );
    await this.store.writeFindingState(
      mergeFindingState(await this.store.readFindingState(), sortedFindings),
    );

    if (this.config.storage.keepRuns > 0) {
      await this.store.pruneRuns(this.config.storage.keepRuns);
    }

    return {
      runId,
      status: finalManifest.status,
      operation,
      runDir: this.store.run(runId).runDir,
      reportPath,
      target: finalManifest.targetBaseUrl,
      createdAt: finalManifest.createdAt,
      captures: finalManifest.captures,
      findings: sortedFindings,
      summary: {
        captures: captures.length,
        findings: sortedFindings.length,
        bySeverity: finalManifest.findingsBySeverity,
        byCategory: finalManifest.findingsByCategory,
      },
      artifacts: finalManifest.artifacts,
      warnings,
      ...(parentRunId !== undefined ? { parentRunId } : {}),
      ...(finalManifest.finishedAt !== undefined ? { finishedAt: finalManifest.finishedAt } : {}),
    };
  }

  private async resolveBaseUrl(
    warnings: string[],
  ): Promise<{ baseUrl: string; preview: PreviewServer | undefined }> {
    if (this.config.baseUrl !== undefined) {
      return { baseUrl: this.config.baseUrl, preview: undefined };
    }
    const server = await startPreview(this.config, this.logger);
    if (server.output().trim() !== "") {
      this.logger.debug("preview output", { output: server.output().slice(-1_000) });
    }
    warnings.push(`Preview command started: ${server.command}`);
    return { baseUrl: server.url, preview: server };
  }

  private resolveStorageState(
    scenario: Config["routes"][number]["scenarios"][number],
  ): string | undefined {
    if (scenario.storageState === undefined) {
      return undefined;
    }
    return path.isAbsolute(scenario.storageState)
      ? scenario.storageState
      : path.resolve(path.dirname(this.configPath), scenario.storageState);
  }

  private async finalizeCapture(runId: string, evidence: CaptureEvidence): Promise<Capture> {
    const artifacts: Artifact[] = [];
    if (evidence.buffers.viewport !== undefined) {
      const dims = pngSize(evidence.buffers.viewport);
      artifacts.push(
        await this.store.writeArtifact(runId, {
          captureId: evidence.id,
          kind: "screenshot_viewport",
          fileName: "viewport.png",
          mimeType: "image/png",
          data: evidence.buffers.viewport,
          ...dims,
        }),
      );
    }
    if (evidence.buffers.fullPage !== undefined) {
      const dims = pngSize(evidence.buffers.fullPage);
      artifacts.push(
        await this.store.writeArtifact(runId, {
          captureId: evidence.id,
          kind: "screenshot_full",
          fileName: "full.png",
          mimeType: "image/png",
          data: evidence.buffers.fullPage,
          ...dims,
        }),
      );
    }

    const capture: Capture = {
      id: evidence.id,
      route: evidence.route,
      routeName: evidence.routeName,
      scenario: evidence.scenario,
      viewport: evidence.viewport,
      url: evidence.url,
      status: evidence.status,
      startedAt: evidence.startedAt,
      finishedAt: evidence.finishedAt,
      durationMs: evidence.durationMs,
      stability: evidence.stability,
      runtime: evidence.runtime,
      artifacts,
      redaction: evidence.redaction,
      ...(evidence.error !== undefined ? { error: evidence.error } : {}),
      ...(evidence.axe !== undefined ? { axe: evidence.axe } : {}),
      ...(evidence.aria !== undefined ? { aria: evidence.aria } : {}),
      ...(evidence.semantics !== undefined ? { semantics: evidence.semantics } : {}),
    };

    if (capture.status === "captured") {
      const comparison = await compareAgainstBaseline(this.store, runId, capture, {
        threshold: this.config.compare.threshold,
        regionMinPixels: this.config.compare.regionMinPixels,
      });
      if (comparison !== undefined) {
        capture.diff = comparison.diff;
        if (comparison.diffPng !== undefined) {
          const dims = pngSize(comparison.diffPng);
          capture.artifacts = [
            ...capture.artifacts,
            await this.store.writeArtifact(runId, {
              captureId: capture.id,
              kind: "diff",
              fileName: "diff.png",
              mimeType: "image/png",
              data: comparison.diffPng,
              ...dims,
            }),
          ];
        }
        // Keep the approved baseline next to the capture so the review artifact
        // can show expected/actual/diff without leaving the run directory.
        const baselineArtifact = await this.store.writeArtifact(runId, {
          captureId: capture.id,
          kind: "baseline",
          fileName: "baseline.png",
          mimeType: "image/png",
          data: comparison.expected,
          ...pngSize(comparison.expected),
        });
        capture.artifacts = [...capture.artifacts, baselineArtifact];
      }
    } else {
      capture.diff = { status: "no_baseline", ratio: 0, diffPixels: 0, regions: [] };
    }

    return capture;
  }

  private async detectFindings(runId: string, capture: Capture): Promise<Finding[]> {
    const raw = runRules({
      runId,
      capture,
      rules: this.config.rules,
      compare: this.config.compare,
      artifactFor: (kind) => capture.artifacts.find((artifact) => artifact.kind === kind),
    });
    return normalizeFindings(raw, {
      runId,
      route: capture.route,
      scenario: capture.scenario,
      viewport: capture.viewport,
      url: capture.url,
      detectedAt: capture.finishedAt,
    });
  }

  private async runVisionReview(
    runId: string,
    captures: readonly Capture[],
    existingFindings: readonly Finding[],
    designBrief: string | undefined,
  ): Promise<Finding[]> {
    const adapter = this.visionAdapter;
    if (adapter === undefined) {
      return [];
    }
    const results: Finding[] = [];
    for (const capture of captures) {
      if (capture.status !== "captured") {
        continue;
      }
      const structural = buildStructuralFacts(capture.semantics, capture.url);
      const knownSelectors = new Set(structural.nodes.map((node) => node.selector));
      const screenshotArtifact =
        capture.artifacts.find((artifact) => artifact.kind === "screenshot_viewport") ??
        capture.artifacts.find((artifact) => artifact.kind === "screenshot_full");
      let screenshot: { mimeType: string; data: Buffer } | undefined;
      if (this.config.vision.allowScreenshots && screenshotArtifact !== undefined) {
        screenshot = {
          mimeType: screenshotArtifact.mimeType,
          data: await this.store.readArtifactFile(runId, screenshotArtifact.path),
        };
      }
      const outcome = await adapter.review({
        runId,
        captureId: capture.id,
        route: capture.route,
        scenario: capture.scenario,
        viewport: capture.viewport,
        url: capture.url,
        designBrief: designBrief ?? this.config.vision.designBrief,
        structural,
        existingFindings: existingFindings
          .filter((finding) => finding.viewport === capture.viewport)
          .map((finding) => ({
            ruleId: finding.ruleId,
            category: finding.category,
            observation: finding.observation,
          })),
        ...(screenshot !== undefined ? { screenshot } : {}),
      });
      results.push(
        ...normalizeFindings(
          normalizeVisionFindings(outcome, { knownSelectors, adapterName: adapter.name }),
          {
            runId: "",
            route: capture.route,
            scenario: capture.scenario,
            viewport: capture.viewport,
            url: capture.url,
            detectedAt: capture.finishedAt,
          },
        ),
      );
    }
    return results;
  }

  private async applyRecheckOutcomes(
    runId: string,
    findings: readonly SelectedFinding[],
    outcomes: ReadonlyMap<string, RecheckOutcome>,
    state: FindingState,
  ): Promise<void> {
    const stored = await this.store.readFindings(runId);
    const updated = stored.map((finding) => {
      const outcome = outcomes.get(finding.id);
      if (outcome === undefined) {
        return finding;
      }
      return {
        ...finding,
        status: outcome.status,
        history: [
          ...finding.history,
          { runId, status: outcome.status, at: new Date().toISOString(), note: outcome.note },
        ],
      };
    });
    await this.store.writeFindings(runId, updated);

    const entries = new Map(state.entries.map((entry) => [entry.id, entry]));
    const timestamp = new Date().toISOString();
    for (const finding of findings) {
      const outcome = outcomes.get(finding.id);
      if (outcome === undefined) {
        continue;
      }
      const existing = entries.get(finding.id);
      const history = existing?.history ?? finding.history;
      entries.set(finding.id, {
        id: finding.id,
        route: finding.route,
        scenario: finding.scenario,
        viewport: finding.viewport,
        category: finding.category,
        origin: finding.origin,
        ruleId: finding.ruleId,
        severity: finding.severity,
        observation: finding.observation,
        firstSeenRunId: existing?.firstSeenRunId ?? finding.runId,
        lastRunId: runId,
        status: outcome.status,
        history: [...history, { runId, status: outcome.status, at: timestamp, note: outcome.note }],
        ...(finding.metric !== undefined ? { metric: finding.metric } : {}),
      });
    }
    await this.store.writeFindingState({
      version: 1,
      updatedAt: timestamp,
      entries: [...entries.values()],
    });
  }

  private async pickAnnotationSource(
    runId: string,
    capture: Capture,
  ): Promise<{ data: Buffer; width: number; height: number } | undefined> {
    const artifact =
      capture.artifacts.find((candidate) => candidate.kind === "screenshot_viewport") ??
      capture.artifacts.find((candidate) => candidate.kind === "screenshot_full");
    if (artifact === undefined || artifact.width === undefined || artifact.height === undefined) {
      return undefined;
    }
    return {
      data: await this.store.readArtifactFile(runId, artifact.path),
      width: artifact.width,
      height: artifact.height,
    };
  }

  /** Read a persisted artifact for MCP resource requests. */
  async readArtifact(runId: string, artifactPath: string): Promise<Buffer> {
    return this.store.readArtifactFile(await this.resolveRunId(runId), artifactPath);
  }

  async findArtifact(runId: string, artifactPath: string): Promise<Artifact | undefined> {
    const resolved = await this.resolveRunId(runId);
    const captures = await this.store.readCaptures(resolved);
    for (const capture of captures) {
      const match = capture.artifacts.find((artifact) => artifact.path === artifactPath);
      if (match !== undefined) {
        return match;
      }
    }
    return undefined;
  }
}

export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

function pngSize(buffer: Buffer): { width?: number; height?: number } {
  // PNG IHDR: width and height are big-endian uint32 at offsets 16 and 20.
  if (buffer.byteLength < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    return {};
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function groupFindings(
  findings: readonly Finding[],
  captures: readonly Capture[],
): { capture: Capture; findings: Finding[] }[] {
  const groups: { capture: Capture; findings: Finding[] }[] = [];
  for (const capture of captures) {
    const matching = findings.filter(
      (finding) =>
        finding.route === capture.route &&
        finding.scenario === capture.scenario &&
        finding.viewport === capture.viewport,
    );
    if (matching.length > 0) {
      groups.push({ capture, findings: matching });
    }
  }
  return groups;
}

function mergeFindingState(state: FindingState, findings: readonly Finding[]): FindingState {
  const entries = new Map(state.entries.map((entry) => [entry.id, entry]));
  const timestamp = new Date().toISOString();
  for (const finding of findings) {
    const existing = entries.get(finding.id);
    entries.set(finding.id, {
      id: finding.id,
      route: finding.route,
      scenario: finding.scenario,
      viewport: finding.viewport,
      category: finding.category,
      origin: finding.origin,
      ruleId: finding.ruleId,
      severity: finding.severity,
      observation: finding.observation,
      firstSeenRunId: existing?.firstSeenRunId ?? finding.runId,
      lastRunId: finding.runId,
      status: finding.status,
      history: [...(existing?.history ?? []), ...finding.history],
      ...(finding.metric !== undefined ? { metric: finding.metric } : {}),
    });
  }
  return { version: 1, updatedAt: timestamp, entries: [...entries.values()] };
}
