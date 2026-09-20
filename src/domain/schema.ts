import { z } from "zod";

/** Severity vocabulary shared by every finding origin. */
export const severitySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export type Severity = z.infer<typeof severitySchema>;

export const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "info"];

export const categorySchema = z.enum([
  "visual_hierarchy",
  "cta_clarity",
  "spacing",
  "typography",
  "alignment",
  "contrast",
  "responsive_overflow",
  "imagery",
  "affordance",
  "consistency",
  "accessibility",
  "runtime_error",
  "regression",
]);
export type Category = z.infer<typeof categorySchema>;

export const originSchema = z.enum([
  "deterministic_rule",
  "accessibility_engine",
  "screenshot_diff",
  "vision_review",
]);
export type Origin = z.infer<typeof originSchema>;

export const recheckStatusSchema = z.enum([
  "open",
  "fixed",
  "improved",
  "unchanged",
  "regressed",
  "needs_review",
]);
export type RecheckStatus = z.infer<typeof recheckStatusSchema>;

export const boundingBoxSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

export const evidenceItemSchema = z.strictObject({
  kind: z.enum(["screenshot", "diff", "dom", "aria", "axe", "runtime", "metric", "note"]),
  summary: z.string(),
  artifactPath: z.string().optional(),
  selector: z.string().optional(),
  bbox: boundingBoxSchema.optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const findingMetricSchema = z.strictObject({
  kind: z.enum(["boolean", "count", "ratio"]),
  value: z.number(),
});
export type FindingMetric = z.infer<typeof findingMetricSchema>;

export const findingHistoryEntrySchema = z.strictObject({
  runId: z.string(),
  status: recheckStatusSchema,
  at: z.string(),
  note: z.string(),
});
export type FindingHistoryEntry = z.infer<typeof findingHistoryEntrySchema>;

export const findingSchema = z.strictObject({
  id: z.string(),
  runId: z.string(),
  route: z.string(),
  scenario: z.string(),
  viewport: z.string(),
  url: z.string(),
  severity: severitySchema,
  category: categorySchema,
  origin: originSchema,
  ruleId: z.string(),
  observation: z.string(),
  expected: z.string(),
  suggestedFix: z.string(),
  confidence: z.number().min(0).max(1),
  selector: z.string().optional(),
  bbox: boundingBoxSchema.optional(),
  evidence: z.array(evidenceItemSchema),
  metric: findingMetricSchema.optional(),
  /** False when the claim comes from a model and is not deterministically verified. */
  verified: z.boolean(),
  status: recheckStatusSchema,
  history: z.array(findingHistoryEntrySchema),
  detectedAt: z.string(),
});
export type Finding = z.infer<typeof findingSchema>;

export const computedStylesSchema = z.strictObject({
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.number(),
  lineHeight: z.number(),
  letterSpacing: z.number(),
  color: z.string(),
  backgroundColor: z.string(),
  textAlign: z.string(),
  position: z.string(),
  display: z.string(),
  overflowX: z.string(),
  overflowY: z.string(),
  opacity: z.number(),
  visibility: z.string(),
  zIndex: z.string(),
});
export type ComputedStyles = z.infer<typeof computedStylesSchema>;

export const semanticNodeSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  depth: z.number().int().nonnegative(),
  tag: z.string(),
  role: z.string(),
  name: z.string(),
  text: z.string(),
  selector: z.string(),
  bbox: boundingBoxSchema,
  styles: computedStylesSchema,
  interactive: z.boolean(),
  visible: z.boolean(),
  hasAccessibleName: z.boolean(),
  clipped: z.boolean(),
  overflows: z.boolean(),
  naturalSize: z.strictObject({ width: z.number(), height: z.number() }).optional(),
});
export type SemanticNode = z.infer<typeof semanticNodeSchema>;

export const semanticSnapshotSchema = z.strictObject({
  capturedAt: z.string(),
  document: z.strictObject({
    title: z.string(),
    lang: z.string(),
    url: z.string(),
    scrollWidth: z.number(),
    scrollHeight: z.number(),
    clientWidth: z.number(),
    clientHeight: z.number(),
    hasHorizontalOverflow: z.boolean(),
    hasVerticalOverflow: z.boolean(),
  }),
  counts: z.strictObject({
    elements: z.number().int().nonnegative(),
    interactive: z.number().int().nonnegative(),
    images: z.number().int().nonnegative(),
    headings: z.number().int().nonnegative(),
    text: z.number().int().nonnegative(),
  }),
  nodes: z.array(semanticNodeSchema),
  truncated: z.boolean(),
});
export type SemanticSnapshot = z.infer<typeof semanticSnapshotSchema>;

export const runtimeEventSchema = z.strictObject({
  kind: z.enum([
    "console_error",
    "console_warning",
    "page_error",
    "request_failed",
    "response_error",
  ]),
  message: z.string(),
  url: z.string().optional(),
  status: z.number().optional(),
  at: z.string(),
});
export type RuntimeEvent = z.infer<typeof runtimeEventSchema>;

export const axeNodeSchema = z.strictObject({
  selector: z.string(),
  html: z.string(),
  failureSummary: z.string(),
  bbox: boundingBoxSchema.optional(),
});

export const axeViolationSchema = z.strictObject({
  id: z.string(),
  impact: z.string(),
  help: z.string(),
  helpUrl: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  nodes: z.array(axeNodeSchema),
});
export type AxeViolation = z.infer<typeof axeViolationSchema>;

export const axeResultSchema = z.strictObject({
  violations: z.array(axeViolationSchema),
  incompleteCount: z.number().int().nonnegative(),
  passCount: z.number().int().nonnegative(),
  inapplicableCount: z.number().int().nonnegative(),
  tags: z.array(z.string()),
  truncated: z.boolean(),
});
export type AxeResult = z.infer<typeof axeResultSchema>;

export const artifactKindSchema = z.enum([
  "screenshot_full",
  "screenshot_viewport",
  "baseline",
  "actual",
  "diff",
  "annotation",
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactSchema = z.strictObject({
  id: z.string(),
  kind: artifactKindSchema,
  /** Path relative to the run directory, always POSIX separators. */
  path: z.string(),
  mimeType: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  captureId: z.string().optional(),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const diffRegionSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  pixels: z.number().int().nonnegative(),
  selector: z.string().optional(),
});
export type DiffRegion = z.infer<typeof diffRegionSchema>;

export const diffResultSchema = z.strictObject({
  status: z.enum(["match", "mismatch", "no_baseline", "size_mismatch"]),
  ratio: z.number().min(0).max(1),
  diffPixels: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  baselineRunId: z.string().optional(),
  regions: z.array(diffRegionSchema),
});
export type DiffResult = z.infer<typeof diffResultSchema>;

export const captureStatusSchema = z.enum(["captured", "failed"]);

export const captureSchema = z.strictObject({
  id: z.string(),
  route: z.string(),
  routeName: z.string(),
  scenario: z.string(),
  viewport: z.string(),
  url: z.string(),
  status: captureStatusSchema,
  error: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number().nonnegative(),
  stability: z.strictObject({
    attempts: z.number().int().nonnegative(),
    stable: z.boolean(),
    frameHash: z.string(),
  }),
  runtime: z.array(runtimeEventSchema),
  axe: axeResultSchema.optional(),
  aria: z.string().optional(),
  semantics: semanticSnapshotSchema.optional(),
  diff: diffResultSchema.optional(),
  artifacts: z.array(artifactSchema),
  redaction: z.strictObject({
    selectorCount: z.number().int().nonnegative(),
    patternCount: z.number().int().nonnegative(),
    nodesRedacted: z.number().int().nonnegative(),
  }),
});
export type Capture = z.infer<typeof captureSchema>;

export const captureSummarySchema = captureSchema.pick({
  id: true,
  route: true,
  scenario: true,
  viewport: true,
  status: true,
  url: true,
  durationMs: true,
  error: true,
});
export type CaptureSummary = z.infer<typeof captureSummarySchema>;

export const runStatusSchema = z.enum(["running", "completed", "failed"]);

export const runManifestSchema = z.strictObject({
  id: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().optional(),
  status: runStatusSchema,
  operation: z.enum(["inspect", "recheck"]),
  parentRunId: z.string().optional(),
  configPath: z.string(),
  configName: z.string(),
  configSummary: z.record(z.string(), z.unknown()),
  targetBaseUrl: z.string(),
  routes: z.array(z.string()),
  viewports: z.array(z.string()),
  captures: z.array(captureSummarySchema),
  findingCount: z.number().int().nonnegative(),
  findingsBySeverity: z.record(severitySchema, z.number().int().nonnegative()),
  findingsByCategory: z.record(z.string(), z.number().int().nonnegative()),
  errors: z.array(z.string()),
  artifacts: z.array(artifactSchema),
});
export type RunManifest = z.infer<typeof runManifestSchema>;

export const findingDocumentSchema = z.strictObject({
  runId: z.string(),
  findings: z.array(findingSchema),
});
export type FindingDocument = z.infer<typeof findingDocumentSchema>;

export const captureDocumentSchema = z.strictObject({
  runId: z.string(),
  captures: z.array(captureSchema),
});
export type CaptureDocument = z.infer<typeof captureDocumentSchema>;

export const findingStateSchema = z.strictObject({
  version: z.literal(1),
  updatedAt: z.string(),
  entries: z.array(
    z.strictObject({
      id: z.string(),
      route: z.string(),
      scenario: z.string(),
      viewport: z.string(),
      category: categorySchema,
      origin: originSchema,
      ruleId: z.string(),
      severity: severitySchema,
      observation: z.string(),
      firstSeenRunId: z.string(),
      lastRunId: z.string(),
      status: recheckStatusSchema,
      metric: findingMetricSchema.optional(),
      history: z.array(findingHistoryEntrySchema),
    }),
  ),
});
export type FindingState = z.infer<typeof findingStateSchema>;
