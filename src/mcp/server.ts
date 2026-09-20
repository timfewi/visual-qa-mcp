import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { categorySchema, severitySchema, SEVERITY_ORDER } from "../domain/schema.js";
import type { Logger } from "../logging.js";
import type {
  EvidenceResult,
  ProgressHooks,
  RecheckResult,
  RunResult,
  VisualQaService,
} from "../service.js";
import { ServiceError } from "../service.js";

export const SERVER_NAME = "visual-qa-mcp";
export const SERVER_VERSION = "0.1.0";

const severityEnum = severitySchema;
const categoryEnum = categorySchema;

const progressSchema = z
  .object({
    progressToken: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

interface ToolExtra {
  readonly _meta?: { readonly progressToken?: string | number | undefined } | undefined;
  sendNotification(notification: {
    method: "notifications/progress";
    params: { progressToken: string | number; progress: number; total: number; message: string };
  }): Promise<void>;
}

/** Bridge service progress reports onto MCP progress notifications. */
function progressHooks(extra: ToolExtra, logger: Logger): ProgressHooks {
  const token = progressSchema.safeParse(extra._meta ?? {}).data?.progressToken;
  return {
    report: (report) => {
      if (token === undefined) {
        return;
      }
      void extra
        .sendNotification({
          method: "notifications/progress",
          params: {
            progressToken: token,
            progress: report.step,
            total: report.total,
            message: report.message,
          },
        })
        .catch((error: unknown) => {
          logger.debug("progress notification failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        });
    },
  };
}

function textResult(text: string): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text }] };
}

function errorResult(error: unknown): { isError: true; content: { type: "text"; text: string }[] } {
  const message =
    error instanceof ServiceError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/** Compact summary of a run: IDs, counts and locations, never the whole run. */
export function summarizeRun(run: RunResult): string {
  const lines: string[] = [
    `Run ${run.runId} (${run.operation}) finished with status ${run.status}.`,
    `Target: ${run.target}`,
    `Captures: ${run.summary.captures} · Findings: ${run.summary.findings}`,
    `Severity: ${SEVERITY_ORDER.map((severity) => `${severity}=${run.summary.bySeverity[severity]}`).join(", ")}`,
    `Run directory: ${run.runDir}`,
    `Report: ${run.reportPath}`,
  ];
  if (run.warnings.length > 0) {
    lines.push(`Warnings: ${run.warnings.slice(0, 5).join(" | ")}`);
  }
  if (run.findings.length === 0) {
    lines.push("No findings were reported for this run.");
    return lines.join("\n");
  }
  lines.push("Findings:");
  for (const finding of run.findings.slice(0, 60)) {
    lines.push(
      `- ${finding.id} [${finding.severity}/${finding.category}/${finding.origin}] ${finding.viewport} · ${finding.route} · ${finding.scenario}: ${finding.observation}`,
    );
  }
  if (run.findings.length > 60) {
    lines.push(`… ${run.findings.length - 60} more findings; filter them via visual_get_evidence.`);
  }
  return lines.join("\n");
}

export function summarizeRecheck(result: RecheckResult): string {
  const lines = [summarizeRun(result), "", `Recheck of run ${result.parentRunId ?? "(unknown)"}:`];
  for (const entry of result.recheck) {
    lines.push(`- ${entry.findingId}: ${entry.previousStatus} → ${entry.status} (${entry.note})`);
  }
  return lines.join("\n");
}

export function summarizeEvidence(evidence: EvidenceResult): string {
  const lines: string[] = [
    `Run ${evidence.runId} (${evidence.operation}): ${evidence.captures.length} capture(s), ${evidence.findings.length} finding(s).`,
  ];
  for (const note of evidence.notes) {
    lines.push(`Note: ${note}`);
  }
  for (const capture of evidence.captures) {
    const axe =
      capture.axe !== undefined ? `, axe violations=${capture.axe.violations.length}` : "";
    const diff = capture.diff !== undefined ? `, diff=${capture.diff.status}` : "";
    lines.push(
      `- ${capture.id} [${capture.status}] ${capture.viewport} · ${capture.route} · ${capture.scenario}: runtime events=${capture.runtime.length}${axe}${diff}`,
    );
  }
  if (evidence.images.length > 0) {
    lines.push(
      `Images attached: ${evidence.images.map((image) => `${image.kind}:${image.path}`).join(", ")}`,
    );
  }
  if (evidence.resourceLinks.length > 0) {
    lines.push(
      `Resource links: ${evidence.resourceLinks.length} (use resources/read with the visual-qa:// URI).`,
    );
  }
  return lines.join("\n");
}

export interface McpServerOptions {
  readonly service: VisualQaService;
  readonly logger: Logger;
}

export interface UnconfiguredMcpServerOptions {
  /** Directory the server was started in; reported back to the caller. */
  readonly directory: string;
  /** Why no service could be created (missing or invalid configuration). */
  readonly reason: string;
  /** Config file names the server looks for, in discovery order. */
  readonly configFileCandidates: readonly string[];
}

/**
 * Build the diagnostic-only MCP server used when a workspace has no usable
 * visual QA configuration.
 *
 * A harness starts every registered stdio server in every workspace. Exiting at
 * startup would surface as a transport failure ("Connection closed") in
 * workspaces that are simply not visual QA targets. This server instead
 * completes the handshake, exposes no capture tool, and answers a single
 * read-only status tool so an agent can explain what is missing.
 */
export function buildUnconfiguredMcpServer(options: UnconfiguredMcpServerOptions): McpServer {
  const { directory, reason, configFileCandidates } = options;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "This workspace has no usable visual QA configuration, so no capture, evidence or baseline tools are " +
        "available. Call visual_status to see what is missing.",
    },
  );

  server.registerTool(
    "visual_status",
    {
      title: "Visual QA status",
      description:
        "Report whether visual QA is configured for this workspace and what is missing. Read-only; no browser is started.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      textResult(
        [
          "Visual QA is not configured for this workspace, so no visual_* capture tools are available.",
          `Directory: ${directory}`,
          `Reason: ${reason}`,
          `Add one of these configuration files to the workspace root: ${configFileCandidates.join(", ")}.`,
          "Validate a configuration file with `visual-qa-mcp validate-config` before relying on it.",
        ].join("\n"),
      ),
  );

  return server;
}

/**
 * Build the MCP server.
 *
 * The tool surface stays deliberately small; every tool validates its input and
 * returns bounded, structured output.
 */
export function buildMcpServer(options: McpServerOptions): McpServer {
  const { service, logger } = options;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Evidence-backed visual QA for browser interfaces. Inspect a configured target, read findings and screenshots, " +
        "recheck only the affected captures after a fix, annotate the evidence, and approve baselines explicitly. " +
        "Deterministic findings are machine-checked; vision_review findings are model judgement.",
    },
  );

  server.registerTool(
    "visual_inspect",
    {
      title: "Inspect a UI",
      description:
        "Capture the configured routes, named UI states and viewport matrix, persist evidence and return a run ID with a compact finding summary.",
      inputSchema: {
        routes: z
          .array(z.string())
          .optional()
          .describe("Restrict to these configured route paths."),
        viewports: z.array(z.string()).optional().describe("Restrict to these viewport names."),
        scenarios: z.array(z.string()).optional().describe("Restrict to these scenario names."),
        designBrief: z
          .string()
          .optional()
          .describe(
            "Design intent handed to the optional review adapter; never sent anywhere unless an adapter is configured.",
          ),
        url: z
          .string()
          .optional()
          .describe(
            "Inspect exactly this URL as a single ad-hoc page instead of the configured routes. Must satisfy the configured security policy; the URL must be reachable.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input, extra) => {
      try {
        const run = await service.inspect(input, progressHooks(extra as ToolExtra, logger));
        return textResult(summarizeRun(run));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "visual_get_evidence",
    {
      title: "Get finding evidence",
      description:
        "Return structured evidence for selected findings or captures, optionally including a bounded set of screenshots. Use it after visual_inspect to look at specific findings instead of a whole run.",
      inputSchema: {
        runId: z.string().min(1).describe('Run ID, or "latest" for the most recent run.'),
        findingIds: z.array(z.string()).optional(),
        captureIds: z.array(z.string()).optional(),
        routes: z.array(z.string()).optional(),
        viewports: z.array(z.string()).optional(),
        includeImages: z
          .boolean()
          .optional()
          .describe("Attach screenshots as image content (default false)."),
        includeSemantics: z
          .boolean()
          .optional()
          .describe("Include the semantic DOM snapshot (can be large)."),
        includeAria: z.boolean().optional().describe("Include the ARIA snapshot text."),
        maxImages: z.number().int().positive().max(12).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const evidence = await service.getEvidence(input);
        const content: (
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        )[] = [{ type: "text", text: summarizeEvidence(evidence) }];
        for (const image of evidence.images) {
          content.push({
            type: "image",
            data: image.data.toString("base64"),
            mimeType: image.mimeType,
          });
        }
        return { content };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "visual_recheck",
    {
      title: "Recheck selected findings",
      description:
        "Recapture only the routes, scenarios and viewports associated with the selected finding IDs and classify each as fixed, improved, unchanged, regressed or needs_review.",
      inputSchema: {
        runId: z.string().min(1).describe('Run that produced the findings, or "latest".'),
        findingIds: z.array(z.string()).min(1),
        designBrief: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input, extra) => {
      try {
        const result = await service.recheck(input, progressHooks(extra as ToolExtra, logger));
        return textResult(summarizeRecheck(result));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "visual_annotate",
    {
      title: "Annotate findings",
      description:
        "Produce numbered annotation overlays for selected findings plus the static HTML review report. Annotations never modify the captured or baseline screenshots.",
      inputSchema: {
        runId: z.string().min(1),
        findingIds: z.array(z.string()).optional(),
        severities: z.array(severityEnum).optional(),
        categories: z.array(categoryEnum).optional(),
        viewports: z.array(z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const result = await service.annotate(input);
        const lines = [
          `Annotated ${result.findings} finding(s) in run ${result.runId}.`,
          `Report: ${result.reportPath}`,
        ];
        for (const annotation of result.annotations) {
          lines.push(
            `- ${annotation.captureId}: ${annotation.path} (${annotation.width}×${annotation.height}${annotation.clipped ? ", clipped around markers" : ""})`,
          );
        }
        return textResult(lines.join("\n"));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "visual_approve_baseline",
    {
      title: "Approve regression baseline",
      description:
        "Explicitly approve captured screenshots as regression baselines. This is a deliberate mutation and never runs automatically.",
      inputSchema: {
        runId: z.string().min(1),
        captureIds: z.array(z.string()).optional(),
        routes: z.array(z.string()).optional(),
        viewports: z.array(z.string()).optional(),
        scenarios: z.array(z.string()).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        const result = await service.approveBaseline(input);
        const lines = [
          `Approved ${result.approved.length} baseline image(s) from run ${result.runId}.`,
        ];
        for (const entry of result.approved) {
          lines.push(`- ${entry.captureId} (${entry.view}): ${entry.path}`);
        }
        if (result.skipped.length > 0) {
          lines.push(`Skipped: ${result.skipped.join("; ")}`);
        }
        return textResult(lines.join("\n"));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerResource(
    "run-artifact",
    new ResourceTemplate("visual-qa://runs/{runId}/artifacts/{+artifactPath}", {
      list: undefined,
    }),
    {
      title: "Visual QA artifact",
      description: "Screenshots, diffs and annotations persisted by a visual QA run.",
      mimeType: "image/png",
    },
    async (uri, variables) => {
      const runId = String(variables.runId ?? "");
      const artifactPath = String(variables.artifactPath ?? "");
      const artifact = await service.findArtifact(runId, artifactPath);
      if (artifact === undefined) {
        throw new Error(`Unknown artifact for run ${runId}: ${artifactPath}`);
      }
      const data = await service.readArtifact(runId, artifactPath);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: artifact.mimeType,
            blob: data.toString("base64"),
          },
        ],
      };
    },
  );

  return server;
}
