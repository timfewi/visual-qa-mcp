export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

/**
 * Diagnostics always go to stderr: stdout carries the MCP protocol and must
 * stay protocol-clean.
 */
export function createLogger(level: LogLevel = "info", scope?: string): Logger {
  const threshold = LEVEL_WEIGHT[level];
  const emit = (
    levelName: Exclude<LogLevel, "silent">,
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    if (LEVEL_WEIGHT[levelName] < threshold) {
      return;
    }
    const prefix = scope ? `[visual-qa:${scope}]` : "[visual-qa]";
    const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    process.stderr.write(`${prefix} ${levelName}: ${message}${suffix}\n`);
  };
  return {
    debug: (message, meta) => emit("debug", message, meta),
    info: (message, meta) => emit("info", message, meta),
    warn: (message, meta) => emit("warn", message, meta),
    error: (message, meta) => emit("error", message, meta),
    child: (childScope) => createLogger(level, scope ? `${scope}:${childScope}` : childScope),
  };
}

export const SILENT_LOGGER: Logger = createLogger("silent");
