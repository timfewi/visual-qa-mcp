import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createLogger, type LogLevel } from "../logging.js";
import {
  buildMcpServer,
  buildUnconfiguredMcpServer,
  SERVER_NAME,
  SERVER_VERSION,
} from "../mcp/server.js";
import { VisualQaService } from "../service.js";
import { CONFIG_FILE_CANDIDATES, ConfigError } from "../config/load.js";
import { SEVERITY_ORDER, type Severity } from "../domain/schema.js";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const DEFAULT_IO: CliIo = {
  stdout: (text) => process.stdout.write(text.endsWith("\n") ? text : `${text}\n`),
  stderr: (text) => process.stderr.write(text.endsWith("\n") ? text : `${text}\n`),
};

const HELP = `${SERVER_NAME} ${SERVER_VERSION}

Usage: visual-qa-mcp <command> [options]

Commands:
  mcp                       Run the stdio MCP server (protocol on stdout, diagnostics on stderr)
  inspect                   Capture the configured target and print the run summary
  recheck                   Recapture the captures behind selected finding IDs
  annotate                  Render annotation overlays and the HTML review report
  approve-baseline          Explicitly approve captured screenshots as baselines
  validate-config           Validate the configuration file and exit
  help, --help              Show this help

Common options:
  --config <path>           Configuration file (default: auto-discovered)
  --json                    Print machine-readable JSON instead of prose
  --log-level <level>       debug | info | warn | error | silent (default: info)

inspect options:
  --route <path>            Restrict to a configured route (repeatable)
  --url <url>               Inspect exactly this URL instead of the configured routes
  --viewport <name>         Restrict to a viewport name (repeatable)
  --scenario <name>         Restrict to a scenario name (repeatable)
  --brief <text>            Design brief passed to the optional review adapter

recheck options:
  --run <runId>             Run that produced the findings (default: latest)
  --findings <id,id>        Finding IDs to recheck (required)
  --brief <text>            Design brief passed to the optional review adapter

annotate options:
  --run <runId>             Run to annotate (default: latest)
  --finding <id>            Restrict to a finding (repeatable)
  --severity <name>         Restrict to a severity (repeatable)
  --category <name>         Restrict to a category (repeatable)
  --viewport <name>         Restrict to a viewport (repeatable)

approve-baseline options:
  --run <runId>             Run that contains the captures (default: latest)
  --capture <id>            Restrict to a capture ID (repeatable)
  --route <path>            Restrict to a route (repeatable)
  --viewport <name>         Restrict to a viewport (repeatable)
  --scenario <name>         Restrict to a scenario (repeatable)
`;

interface ParsedArgs {
  readonly command: string;
  readonly flags: Map<string, string[]>;
  readonly positionals: string[];
}

export const KNOWN_COMMANDS = new Set([
  "mcp",
  "inspect",
  "recheck",
  "annotate",
  "approve-baseline",
  "validate-config",
]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags = new Map<string, string[]>();
  const positionals: string[] = [];
  let command = "";
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (!token.startsWith("--")) {
      if (command === "") {
        command = token;
      } else {
        positionals.push(token);
      }
      continue;
    }
    const separator = token.indexOf("=");
    const name = separator === -1 ? token.slice(2) : token.slice(2, separator);
    const inlineValue = separator === -1 ? undefined : token.slice(separator + 1);
    if (name === "") {
      continue;
    }
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) {
      if (value === undefined || value.startsWith("--")) {
        pushFlag(flags, name, "true");
        continue;
      }
      index += 1;
    }
    pushFlag(flags, name, value ?? "true");
  }
  return { command, flags, positionals };
}

function pushFlag(flags: Map<string, string[]>, name: string, value: string): void {
  const existing = flags.get(name);
  if (existing === undefined) {
    flags.set(name, [value]);
  } else {
    existing.push(value);
  }
}

function flagValues(args: ParsedArgs, name: string): string[] {
  return args.flags.get(name) ?? [];
}

function flagValue(args: ParsedArgs, name: string): string | undefined {
  return flagValues(args, name)[0];
}

/** Run one CLI invocation and return the process exit code. */
export async function runCli(argv: readonly string[], io: CliIo = DEFAULT_IO): Promise<number> {
  const args = parseArgs(argv);
  const json = flagValue(args, "json") !== undefined;

  if (
    args.command === "" ||
    args.command === "help" ||
    args.command === "--help" ||
    args.command === "-h"
  ) {
    io.stdout(HELP);
    return 0;
  }
  if (args.command === "--version" || args.command === "-v" || args.command === "version") {
    io.stdout(`${SERVER_NAME} ${SERVER_VERSION}`);
    return 0;
  }

  const logLevel = (flagValue(args, "log-level") ?? "info") as LogLevel;
  const logger = createLogger(logLevel);

  if (!KNOWN_COMMANDS.has(args.command)) {
    io.stderr(`Unknown command: ${args.command}`);
    io.stderr("");
    io.stderr(HELP);
    return 2;
  }

  try {
    if (args.command === "mcp") {
      return await runMcpServer(args, logger);
    }
    if (args.command === "validate-config") {
      const service = await VisualQaService.create({
        configPath: flagValue(args, "config"),
        cwd: process.cwd(),
        logger,
      });
      const config = service.configuration;
      io.stdout(
        json
          ? JSON.stringify(
              {
                valid: true,
                name: config.name,
                routes: config.routes.map((route) => route.path),
                viewports: config.viewports.map((viewport) => viewport.name),
                baseUrl: config.baseUrl ?? null,
                preview: config.preview?.command.join(" ") ?? null,
              },
              null,
              2,
            )
          : `Configuration is valid: ${config.routes.length} route(s), ${config.viewports.length} viewport(s).`,
      );
      return 0;
    }

    const service = await VisualQaService.create({
      configPath: flagValue(args, "config"),
      cwd: process.cwd(),
      logger,
    });

    switch (args.command) {
      case "inspect": {
        const run = await service.inspect({
          routes: emptyToUndefined(flagValues(args, "route")),
          viewports: emptyToUndefined(flagValues(args, "viewport")),
          scenarios: emptyToUndefined(flagValues(args, "scenario")),
          designBrief: flagValue(args, "brief"),
          url: flagValue(args, "url"),
        });
        io.stdout(json ? JSON.stringify(run, null, 2) : summarizeRun(run));
        return run.status === "failed" ? 1 : 0;
      }
      case "recheck": {
        const findings = (flagValue(args, "findings") ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value !== "");
        if (findings.length === 0) {
          io.stderr("recheck requires --findings <id,id>");
          return 2;
        }
        const result = await service.recheck({
          runId: flagValue(args, "run") ?? "latest",
          findingIds: findings,
          designBrief: flagValue(args, "brief"),
        });
        io.stdout(
          json
            ? JSON.stringify(result, null, 2)
            : `${summarizeRun(result)}\n\n${result.recheck
                .map((entry) => `${entry.findingId}: ${entry.previousStatus} → ${entry.status}`)
                .join("\n")}`,
        );
        return 0;
      }
      case "annotate": {
        const severities = flagValues(args, "severity").filter((value): value is Severity =>
          (SEVERITY_ORDER as readonly string[]).includes(value),
        );
        const result = await service.annotate({
          runId: flagValue(args, "run") ?? "latest",
          findingIds: emptyToUndefined(flagValues(args, "finding")),
          categories: emptyToUndefined(flagValues(args, "category")),
          viewports: emptyToUndefined(flagValues(args, "viewport")),
          ...(severities.length > 0 ? { severities } : {}),
        });
        io.stdout(json ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
        return 0;
      }
      case "approve-baseline": {
        const result = await service.approveBaseline({
          runId: flagValue(args, "run") ?? "latest",
          captureIds: emptyToUndefined(flagValues(args, "capture")),
          routes: emptyToUndefined(flagValues(args, "route")),
          viewports: emptyToUndefined(flagValues(args, "viewport")),
          scenarios: emptyToUndefined(flagValues(args, "scenario")),
        });
        io.stdout(
          json
            ? JSON.stringify(result, null, 2)
            : `Approved ${result.approved.length} baseline image(s):\n${result.approved
                .map((entry) => `- ${entry.captureId} (${entry.view}): ${entry.path}`)
                .join("\n")}`,
        );
        return 0;
      }
      default:
        io.stderr(`Unknown command: ${args.command}\n\n${HELP}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof ConfigError) {
      io.stderr(error.message);
      for (const issue of error.issues) {
        io.stderr(`  - ${issue}`);
      }
      return 2;
    }
    io.stderr(error instanceof Error ? (error.stack ?? error.message) : String(error));
    return 1;
  }
}

async function runMcpServer(
  args: ParsedArgs,
  logger: ReturnType<typeof createLogger>,
): Promise<number> {
  const configPath = flagValue(args, "config");
  let service: VisualQaService;
  try {
    service = await VisualQaService.create({ configPath, cwd: process.cwd(), logger });
  } catch (error) {
    // A harness starts every registered stdio server in every workspace, so a
    // missing (or broken) configuration must not look like a crashed transport.
    // Degrade to a diagnostic-only server instead. An explicit --config is the
    // operator's deliberate choice and stays strict.
    if (configPath !== undefined || !(error instanceof ConfigError)) {
      throw error;
    }
    logger.warn("visual QA is not configured; serving diagnostics only", {
      cwd: process.cwd(),
      reason: error.message,
    });
    const reason =
      error.issues.length > 0 ? `${error.message}: ${error.issues.join("; ")}` : error.message;
    const unconfigured = buildUnconfiguredMcpServer({
      directory: process.cwd(),
      reason,
      configFileCandidates: CONFIG_FILE_CANDIDATES,
    });
    await unconfigured.connect(new StdioServerTransport());
    return 0;
  }

  const server = buildMcpServer({ service, logger });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("mcp server ready over stdio", { routes: service.configuration.routes.length });
  return 0;
}

function emptyToUndefined(values: readonly string[]): string[] | undefined {
  return values.length > 0 ? [...values] : undefined;
}

function summarizeRun(run: {
  runId: string;
  status: string;
  target: string;
  runDir: string;
  reportPath: string;
  summary: { captures: number; findings: number; bySeverity: Record<string, number> };
  findings: readonly {
    id: string;
    severity: string;
    category: string;
    observation: string;
    viewport: string;
  }[];
  warnings: readonly string[];
}): string {
  const lines = [
    `Run ${run.runId} (${run.status}) → ${run.runDir}`,
    `Target: ${run.target}`,
    `Captures: ${run.summary.captures} · Findings: ${run.summary.findings} · ${SEVERITY_ORDER.map(
      (severity) => `${severity}=${run.summary.bySeverity[severity] ?? 0}`,
    ).join(", ")}`,
    `Report: ${run.reportPath}`,
  ];
  for (const warning of run.warnings.slice(0, 5)) {
    lines.push(`Warning: ${warning}`);
  }
  for (const finding of run.findings.slice(0, 40)) {
    lines.push(
      `- ${finding.id} [${finding.severity}/${finding.category}] ${finding.viewport}: ${finding.observation}`,
    );
  }
  if (run.findings.length > 40) {
    lines.push(`… ${run.findings.length - 40} more findings.`);
  }
  return lines.join("\n");
}
