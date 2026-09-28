import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseConfig } from "../../src/config/load.js";
import { SILENT_LOGGER } from "../../src/logging.js";
import { NavigationBlockedError } from "../../src/security/url-guard.js";
import { PreviewStartupError, startPreview, type PreviewServer } from "../../src/target/preview.js";

test("preview readiness URL follows navigation policy before starting a command", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-preview-"));
  const sentinel = path.join(directory, "started");
  try {
    const config = parseConfig({
      preview: {
        command: [
          process.execPath,
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'started')`,
        ],
        url: "file:///tmp/visual-qa-preview-probe",
        readyTimeoutMs: 200,
      },
      routes: [{ path: "/" }],
    });

    await expect(startPreview(config, SILENT_LOGGER)).rejects.toBeInstanceOf(
      NavigationBlockedError,
    );
    expect(existsSync(sentinel)).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("preview readiness cannot outlive its configured timeout", async () => {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200);
      response.end("ready");
    }, 500);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP listener");
  }

  let preview: PreviewServer | undefined;
  try {
    const config = parseConfig({
      preview: {
        command: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
        url: `http://127.0.0.1:${address.port}/`,
        readyTimeoutMs: 100,
        terminateTimeoutMs: 100,
      },
      routes: [{ path: "/" }],
    });

    let failure: unknown;
    try {
      preview = await startPreview(config, SILENT_LOGGER);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PreviewStartupError);
    expect((failure as Error).message).toContain("did not become ready within 100 ms");
  } finally {
    await preview?.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
