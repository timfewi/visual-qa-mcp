import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ENTRY = path.resolve(import.meta.dir, "../../src/index.ts");
const TEST_TIMEOUT = 30_000;

/** Spawn the real CLI over stdio from a scratch directory, as a harness would. */
async function withSpawnedClient(
  directory: string,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const client = new Client({ name: "visual-qa-degraded-test", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [ENTRY, "mcp"],
    cwd: directory,
    stderr: "pipe",
  });
  await client.connect(transport);
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

function textOf(result: unknown): string {
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .filter(
      (block): block is { type: string; text?: string } =>
        typeof block === "object" && block !== null && "type" in block,
    )
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

/**
 * Regression guard for harness-agnostic startup.
 *
 * A harness spawns every registered stdio server in every workspace. Without a
 * usable configuration the process must stay on the protocol and answer a
 * diagnostic instead of exiting, which the harness would report as
 * "Connection closed".
 */
describe("MCP surface without a usable visual QA configuration", () => {
  test(
    "completes the handshake without a configuration and serves only the status tool",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-mcp-empty-"));
      await withSpawnedClient(directory, async (client) => {
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toEqual(["visual_status"]);
        const status = await client.callTool({ name: "visual_status", arguments: {} });
        const text = textOf(status);
        expect(text).toContain("not configured");
        expect(text).toContain(directory);
        expect(text).toContain(".visual-qa.config.json");
      });
    },
    TEST_TIMEOUT,
  );

  test(
    "reports an invalid configuration instead of exiting",
    async () => {
      const directory = await mkdtemp(path.join(tmpdir(), "visual-qa-mcp-invalid-"));
      await writeFile(
        path.join(directory, "visual-qa.config.json"),
        JSON.stringify({ routes: [] }),
        "utf8",
      );
      await withSpawnedClient(directory, async (client) => {
        const status = await client.callTool({ name: "visual_status", arguments: {} });
        const text = textOf(status);
        expect(text).toContain("Invalid visual QA configuration");
        expect(text).toContain("baseUrl or preview.command");
      });
    },
    TEST_TIMEOUT,
  );
});
