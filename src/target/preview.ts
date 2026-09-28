import { spawn, type ChildProcess } from "node:child_process";

import type { VisualQaConfig } from "../config/schema.js";
import type { Logger } from "../logging.js";
import { assertNavigationAllowed } from "../security/url-guard.js";

export interface PreviewServer {
  readonly url: string;
  readonly command: string;
  /** Recent stdout/stderr output, useful when startup fails. */
  output(): string;
  stop(): Promise<void>;
}

export class PreviewStartupError extends Error {
  readonly output: string;

  constructor(message: string, output: string) {
    super(message);
    this.name = "PreviewStartupError";
    this.output = output;
  }
}

const MAX_OUTPUT_CHARS = 8_000;

/**
 * Run the inspected project's own preview command.
 *
 * The command is taken verbatim from configuration; this server never assumes
 * a package manager, framework or runtime for the inspected project.
 */
export async function startPreview(config: VisualQaConfig, logger: Logger): Promise<PreviewServer> {
  const preview = config.preview;
  if (preview === undefined) {
    throw new PreviewStartupError("No preview command configured", "");
  }

  const [command, ...args] = preview.command;
  if (command === undefined) {
    throw new PreviewStartupError("preview.command must not be empty", "");
  }
  assertNavigationAllowed(preview.url, config.security);

  const child: ChildProcess = spawn(command, args, {
    cwd: preview.cwd ?? process.cwd(),
    env: { ...process.env, ...(preview.env ?? {}) },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const capture = (chunk: Buffer): void => {
    output = (output + chunk.toString("utf8")).slice(-MAX_OUTPUT_CHARS);
  };
  child.stdout?.on("data", capture);
  child.stderr?.on("data", capture);

  let exited = false;
  let exitInfo = "";
  child.on("exit", (code, signal) => {
    exited = true;
    exitInfo = `exit code ${code ?? "null"}${signal !== null ? `, signal ${signal}` : ""}`;
  });

  const stop = async (): Promise<void> => {
    if (child.pid === undefined || exited) {
      return;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    const deadline = Date.now() + preview.terminateTimeoutMs;
    while (!exited && Date.now() < deadline) {
      await delay(50);
    }
    if (!exited && child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  };

  const deadline = Date.now() + preview.readyTimeoutMs;
  while (Date.now() < deadline) {
    if (exited) {
      throw new PreviewStartupError(
        `Preview command exited before becoming ready (${exitInfo}): ${preview.command.join(" ")}`,
        output,
      );
    }
    if (await isReachable(preview.url, deadline)) {
      logger.info("preview server ready", { url: preview.url });
      return { url: preview.url, command: preview.command.join(" "), output: () => output, stop };
    }
    await delay(Math.min(250, Math.max(0, deadline - Date.now())));
  }

  await stop();
  throw new PreviewStartupError(
    `Preview server at ${preview.url} did not become ready within ${preview.readyTimeoutMs} ms`,
    output,
  );
}

async function isReachable(url: string, deadline: number): Promise<boolean> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return false;
  }
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(remaining),
    });
    await response.body?.cancel();
    return response.status > 0 && Date.now() < deadline;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
