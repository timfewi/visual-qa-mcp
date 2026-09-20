import { readFile } from "node:fs/promises";
import path from "node:path";

import { visualQaConfigSchema, type VisualQaConfig } from "./schema.js";

/** File names probed when no explicit config path is given. */
export const CONFIG_FILE_CANDIDATES = [
  "visual-qa.config.json",
  ".visual-qa.config.json",
  ".visual-qa/config.json",
  ".visual-qa.json",
] as const;

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[] = []) {
    super(message);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export interface LoadedConfig {
  readonly config: VisualQaConfig;
  readonly path: string;
}

/** Locate the config file to use, honouring an explicit path first. */
export async function resolveConfigPath(
  explicitPath: string | undefined,
  cwd = process.cwd(),
): Promise<string> {
  if (explicitPath !== undefined) {
    return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(cwd, explicitPath);
  }
  for (const candidate of CONFIG_FILE_CANDIDATES) {
    const resolved = path.resolve(cwd, candidate);
    if (await fileExists(resolved)) {
      return resolved;
    }
  }
  throw new ConfigError(
    `No visual QA configuration found. Looked for: ${CONFIG_FILE_CANDIDATES.join(", ")}.`,
  );
}

export async function loadConfig(
  explicitPath?: string,
  cwd = process.cwd(),
): Promise<LoadedConfig> {
  const configPath = await resolveConfigPath(explicitPath, cwd);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    throw new ConfigError(
      `Cannot read configuration at ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new ConfigError(
      `Configuration at ${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return { config: parseConfig(parsed, configPath), path: configPath };
}

/** Validate an in-memory configuration object. */
export function parseConfig(input: unknown, source = "<inline>"): VisualQaConfig {
  const result = visualQaConfigSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const location = issue.path.length > 0 ? issue.path.join(".") : "(root)";
      return `${location}: ${issue.message}`;
    });
    throw new ConfigError(`Invalid visual QA configuration in ${source}`, issues);
  }
  return result.data;
}

/** Serialise a fully resolved configuration (used by run manifests). */
export function summarizeConfig(config: VisualQaConfig): Record<string, unknown> {
  return {
    name: config.name,
    baseUrl: config.baseUrl ?? null,
    previewCommand: config.preview ? config.preview.command.join(" ") : null,
    routes: config.routes.map((route) => ({
      path: route.path,
      scenarios: route.scenarios.map((scenario) => scenario.name),
    })),
    viewports: config.viewports.map((viewport) => ({
      name: viewport.name,
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.isMobile,
    })),
    security: {
      allowRemote: config.security.allowRemote,
      allowedHosts: [...config.security.allowedHosts],
      blockRequestsToOtherOrigins: config.security.blockRequestsToOtherOrigins,
    },
    redaction: {
      selectors: [...config.redaction.selectors],
      patternCount: config.redaction.patterns.length,
    },
    vision: { adapter: config.vision.adapter },
    axe: { enabled: config.axe.enabled, tags: [...config.axe.tags] },
  };
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}
