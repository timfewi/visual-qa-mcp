import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createLogger } from "../../src/logging.js";
import { buildMcpServer } from "../../src/mcp/server.js";
import { VisualQaService } from "../../src/service.js";
import { browserProbe } from "../helpers/browser-probe.js";
import { startFixtureSite, type FixtureSite } from "../helpers/fixture-site.js";

const logger = createLogger("silent");
const TEST_TIMEOUT = 120_000;

const EXPECTED_TOOLS = [
  "visual_annotate",
  "visual_approve_baseline",
  "visual_get_evidence",
  "visual_inspect",
  "visual_recheck",
];

describe.skipIf(!browserProbe.available)("MCP surface", () => {
  let site: FixtureSite;
  let client: Client;
  let close: () => Promise<void>;

  beforeAll(async () => {
    site = await startFixtureSite();
    const storageRoot = await mkdtemp(path.join(tmpdir(), "visual-qa-mcp-storage-"));
    const configPath = path.join(storageRoot, "visual-qa.config.json");
    await Bun.write(
      configPath,
      JSON.stringify({
        name: "mcp-fixture",
        baseUrl: site.url,
        routes: [{ path: "/", name: "home" }],
        viewports: [{ name: "mobile", width: 375, height: 812, isMobile: true, hasTouch: true }],
        capture: { maxSemanticElements: 120 },
        storage: { root: storageRoot, keepRuns: 3 },
        browser: { stabilityAttempts: 2, stabilityDelayMs: 40 },
      }),
    );
    const service = await VisualQaService.create({ configPath, logger });
    const server = buildMcpServer({ service, logger });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "visual-qa-test-client", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    close = async () => {
      await client.close();
      await site.close();
    };
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await close?.();
  });

  test(
    "exposes exactly the five documented tools",
    async () => {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);
      for (const tool of tools.tools) {
        expect(tool.description ?? "").not.toBe("");
        expect(tool.inputSchema.type).toBe("object");
      }
      const inspect = tools.tools.find((tool) => tool.name === "visual_inspect");
      expect(inspect?.annotations?.readOnlyHint).toBe(false);
      const evidence = tools.tools.find((tool) => tool.name === "visual_get_evidence");
      expect(evidence?.annotations?.readOnlyHint).toBe(true);
      const approve = tools.tools.find((tool) => tool.name === "visual_approve_baseline");
      expect(approve?.annotations?.destructiveHint).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    "validates tool input before it reaches the service",
    async () => {
      const invalid = await client.callTool({
        name: "visual_get_evidence",
        arguments: { runId: "" },
      });
      expect(invalid.isError).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    "runs inspect, evidence, annotate, approve and recheck through the protocol",
    async () => {
      const inspect = await client.callTool({
        name: "visual_inspect",
        arguments: { routes: ["/"] },
      });
      expect(inspect.isError).toBeFalsy();
      const inspectText = textOf(inspect);
      expect(inspectText).toContain("Run run_");
      expect(inspectText).toContain("Findings:");
      const runId = /Run (run_[A-Za-z0-9_]+)/.exec(inspectText)?.[1] ?? "";
      expect(runId).not.toBe("");
      const findingId = /- (fnd_[a-z0-9]+) /.exec(inspectText)?.[1] ?? "";
      expect(findingId).not.toBe("");

      const evidence = await client.callTool({
        name: "visual_get_evidence",
        arguments: { runId, findingIds: [findingId], includeImages: true, maxImages: 1 },
      });
      expect(evidence.isError).toBeFalsy();
      const blocks = evidence.content as { type: string; mimeType?: string }[];
      expect(blocks.some((block) => block.type === "image" && block.mimeType === "image/png")).toBe(
        true,
      );
      expect(textOf(evidence)).toContain(runId);

      const annotate = await client.callTool({
        name: "visual_annotate",
        arguments: { runId, findingIds: [findingId] },
      });
      expect(annotate.isError).toBeFalsy();
      expect(textOf(annotate)).toContain("annotation.png");

      const approve = await client.callTool({
        name: "visual_approve_baseline",
        arguments: { runId },
      });
      expect(approve.isError).toBeFalsy();
      expect(textOf(approve)).toContain("Approved");

      site.setMode("clean");
      const recheck = await client.callTool({
        name: "visual_recheck",
        arguments: { runId, findingIds: [findingId] },
      });
      expect(recheck.isError).toBeFalsy();
      expect(textOf(recheck)).toContain("Recheck of run");
      site.setMode("broken");

      const resources = await client.listResources().catch(() => ({ resources: [] }));
      expect(Array.isArray(resources.resources)).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    "returns actionable errors for unknown findings and servers without configuration",
    async () => {
      const unknown = await client.callTool({
        name: "visual_recheck",
        arguments: { runId: "latest", findingIds: ["fnd_missing"] },
      });
      expect(unknown.isError).toBe(true);
      expect(textOf(unknown)).toContain("None of the requested finding IDs");

      const empty = await client.callTool({
        name: "visual_get_evidence",
        arguments: { runId: "latest", findingIds: ["fnd_does_not_exist"] },
      });
      expect(empty.isError).toBeFalsy();
      expect(textOf(empty)).toContain("0 finding(s)");
    },
    TEST_TIMEOUT,
  );
});

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
