import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { VisualQaService } from "../../src/service.js";
import { createLogger } from "../../src/logging.js";
import { FakeVisionReviewAdapter } from "../../src/review/fake.js";
import { browserProbe, probeBrowser } from "../helpers/browser-probe.js";
import { startFixtureSite, type FixtureSite } from "../helpers/fixture-site.js";

const logger = createLogger("silent");
const TEST_TIMEOUT = 120_000;

interface Harness {
  readonly site: FixtureSite;
  readonly service: VisualQaService;
  readonly storageRoot: string;
  readonly configPath: string;
}

async function buildHarness(): Promise<Harness> {
  const site = await startFixtureSite();
  const storageRoot = await mkdtemp(path.join(tmpdir(), "visual-qa-int-storage-"));
  const configDirectory = await mkdtemp(path.join(tmpdir(), "visual-qa-int-config-"));
  const configPath = path.join(configDirectory, "visual-qa.config.json");
  const config = {
    version: 1,
    name: "integration-fixture",
    baseUrl: site.url,
    routes: [
      { path: "/", name: "home", scenarios: [{ name: "default" }] },
      { path: "/ok", name: "ok" },
      { path: "/csp", name: "csp" },
    ],
    viewports: [
      { name: "mobile", width: 375, height: 812, isMobile: true, hasTouch: true },
      { name: "desktop", width: 1440, height: 900 },
    ],
    capture: { maxSemanticElements: 150, maxTextLength: 80 },
    storage: { root: storageRoot, keepRuns: 5 },
    browser: { stabilityAttempts: 3, stabilityDelayMs: 40 },
    redaction: { selectors: [], patterns: [], replacement: "[redacted]" },
  };
  await Bun.write(configPath, JSON.stringify(config, null, 2));

  const service = await VisualQaService.create({
    configPath,
    logger,
    visionAdapter: new FakeVisionReviewAdapter(),
  });
  return { site, service, storageRoot, configPath };
}

const skip = !browserProbe.available;

describe.skipIf(skip)("inspect → evidence → annotate → baseline → recheck", () => {
  let harness: Harness;

  beforeAll(async () => {
    const probe = await probeBrowser();
    if (!probe.available) {
      throw new Error(probe.message);
    }
    harness = await buildHarness();
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await harness?.site.close();
  });

  test(
    "captures every route and viewport and reports deterministic findings",
    async () => {
      const run = await harness.service.inspect({ routes: ["/"] });
      expect(run.status).toBe("completed");
      expect(run.captures).toHaveLength(2);
      expect([...new Set(run.captures.map((capture) => capture.viewport))].sort()).toEqual([
        "desktop",
        "mobile",
      ]);

      const ruleIds = new Set(run.findings.map((finding) => finding.ruleId));
      expect(ruleIds.has("runtime:console-error")).toBe(true);
      expect(ruleIds.has("runtime:response-error")).toBe(true);
      expect(ruleIds.has("imagery:broken-image")).toBe(true);
      expect(ruleIds.has("hierarchy:missing-h1")).toBe(true);
      expect(ruleIds.has("layout:horizontal-overflow")).toBe(true);
      expect(ruleIds.has("typography:min-font-size")).toBe(true);
      expect(ruleIds.has("axe:button-name")).toBe(true);

      const overflow = run.findings.find(
        (finding) => finding.ruleId === "layout:horizontal-overflow",
      );
      expect(overflow?.viewport).toBe("mobile");
      expect(overflow?.severity).toBe("high");
      expect(overflow?.verified).toBe(true);

      const visionFindings = run.findings.filter((finding) => finding.origin === "vision_review");
      expect(visionFindings.length).toBeGreaterThan(0);
      expect(visionFindings.every((finding) => finding.verified === false)).toBe(true);

      const mobileCapture = run.captures.find((capture) => capture.viewport === "mobile");
      expect(mobileCapture?.status).toBe("captured");
      expect(run.summary.bySeverity.critical + run.summary.bySeverity.high).toBeGreaterThan(0);

      const viewportArtifact = run.artifacts.find(
        (artifact) =>
          artifact.kind === "screenshot_viewport" && artifact.captureId === mobileCapture?.id,
      );
      expect(viewportArtifact).toBeDefined();
      const bytes = await readFile(path.join(run.runDir, viewportArtifact?.path ?? ""));
      expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(viewportArtifact?.width).toBe(375);
      expect(viewportArtifact?.height).toBeGreaterThan(0);

      const report = await readFile(path.join(run.runDir, "report.html"), "utf8");
      expect(report).toContain("Visual QA report");

      const captures = await harness.service.getEvidence({ runId: run.runId });
      expect(captures.captures).toHaveLength(2);
      expect(captures.resourceLinks.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );

  test(
    "returns selected findings with images and resource links",
    async () => {
      const runs = await harness.service.listRuns();
      const runId = runs[0]?.id ?? "";
      const evidence = await harness.service.getEvidence({
        runId,
        viewports: ["mobile"],
        includeImages: true,
        maxImages: 2,
      });
      expect(evidence.images.length).toBeGreaterThan(0);
      expect(evidence.images.length).toBeLessThanOrEqual(2);
      expect(evidence.images[0]?.data.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(evidence.captures.every((capture) => capture.viewport === "mobile")).toBe(true);

      const scoped = await harness.service.getEvidence({
        runId,
        findingIds: evidence.findings.slice(0, 1).map((finding) => finding.id),
      });
      expect(scoped.findings).toHaveLength(1);
      expect(scoped.captures.length).toBeGreaterThan(0);
    },
    TEST_TIMEOUT,
  );

  test(
    "annotates the selected findings and links them from the report",
    async () => {
      const runId = (await harness.service.listRuns())[0]?.id ?? "";
      const annotated = await harness.service.annotate({ runId, viewports: ["mobile"] });
      expect(annotated.annotations.length).toBeGreaterThan(0);
      const annotation = annotated.annotations[0];
      const written = await stat(
        path.join(harness.service.storeInstance.run(runId).runDir, annotation?.path ?? ""),
      );
      expect(written.size).toBeGreaterThan(0);
      const report = await readFile(
        path.join(harness.service.storeInstance.run(runId).runDir, "report.html"),
        "utf8",
      );
      expect(report).toContain("annotation.png");
    },
    TEST_TIMEOUT,
  );

  test(
    "requires explicit approval before a diff is produced",
    async () => {
      const runId = (await harness.service.listRuns())[0]?.id ?? "";
      const approved = await harness.service.approveBaseline({ runId, viewports: ["mobile"] });
      expect(approved.approved.length).toBeGreaterThan(0);
      expect(approved.approved.every((entry) => entry.path.endsWith(".png"))).toBe(true);
      const baselineFile = path.join(
        harness.service.storeInstance.paths.baselineDir,
        approved.approved[0]?.path ?? "",
      );
      expect((await stat(baselineFile)).size).toBeGreaterThan(0);

      const second = await harness.service.inspect({ routes: ["/"], viewports: ["mobile"] });
      const mobile = second.captures.find((capture) => capture.viewport === "mobile");
      expect(mobile?.status).toBe("captured");
      expect(second.artifacts.find((artifact) => artifact.kind === "diff")).toBeUndefined();
      expect(
        second.findings.find((finding) => finding.ruleId === "regression:screenshot-diff"),
      ).toBeUndefined();

      // A changed page must now produce a diff artifact and a regression finding.
      harness.site.setMode("clean");
      try {
        const changed = await harness.service.inspect({ routes: ["/"], viewports: ["mobile"] });
        const diffArtifact = changed.artifacts.find((artifact) => artifact.kind === "diff");
        expect(diffArtifact).toBeDefined();
        expect(diffArtifact?.width).toBeGreaterThan(0);
        const baselineArtifact = changed.artifacts.find((artifact) => artifact.kind === "baseline");
        expect(baselineArtifact).toBeDefined();
        const regression = changed.findings.find(
          (finding) => finding.ruleId === "regression:screenshot-diff",
        );
        expect(regression).toBeDefined();
        expect(regression?.category).toBe("regression");
        expect(regression?.origin).toBe("screenshot_diff");
        expect(regression?.bbox).toBeDefined();
        const diffBytes = await readFile(path.join(changed.runDir, diffArtifact?.path ?? ""));
        expect(diffBytes.subarray(1, 4).toString("ascii")).toBe("PNG");
      } finally {
        harness.site.setMode("broken");
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "classifies rechecked findings as fixed and detects a reappearance as regressed",
    async () => {
      const runs = await harness.service.listRuns();
      const wanted = [
        "layout:horizontal-overflow",
        "runtime:console-error",
        "imagery:broken-image",
      ];
      let runId = "";
      let targetIds: string[] = [];
      for (const candidate of runs) {
        const evidence = await harness.service.getEvidence({ runId: candidate.id });
        const targets = evidence.findings.filter(
          (finding) => wanted.includes(finding.ruleId) && finding.viewport === "mobile",
        );
        if (targets.length > 0) {
          runId = candidate.id;
          targetIds = targets.map((finding) => finding.id);
          break;
        }
      }
      expect(runId).not.toBe("");
      expect(targetIds.length).toBeGreaterThan(0);

      harness.site.setMode("clean");
      const fixed = await harness.service.recheck({ runId, findingIds: targetIds });
      expect(fixed.parentRunId).toBe(runId);
      expect(fixed.recheck).toHaveLength(targetIds.length);
      expect(fixed.recheck.every((entry) => entry.status === "fixed")).toBe(true);

      harness.site.setMode("broken");
      const regressed = await harness.service.recheck({
        runId: fixed.runId,
        findingIds: targetIds,
      });
      expect(regressed.recheck.every((entry) => entry.status === "regressed")).toBe(true);

      const state = await harness.service.storeInstance.readFindingState();
      const entry = state.entries.find((candidate) => candidate.id === targetIds[0]);
      expect(entry?.status).toBe("regressed");
      expect(entry?.history.length).toBeGreaterThanOrEqual(2);

      const evidence = await harness.service.getEvidence({ runId: regressed.runId });
      expect(evidence.operation).toBe("recheck");
    },
    TEST_TIMEOUT,
  );

  test(
    "inspects a single ad-hoc URL and keeps it recheckable",
    async () => {
      const run = await harness.service.inspect({
        url: `${harness.site.url}/ok`,
        viewports: ["mobile"],
      });
      expect(run.status).toBe("completed");
      expect(run.captures).toHaveLength(1);
      expect(run.captures[0]?.route).toBe(`${harness.site.url}/ok`);
      expect(run.captures[0]?.status).toBe("captured");
      const artifacts = run.artifacts.filter((artifact) => artifact.kind === "screenshot_viewport");
      expect(artifacts).toHaveLength(1);

      // An ad-hoc URL is not part of the configuration, yet its findings are
      // still recheckable because the recorded route is captured directly.
      const findingId = run.findings[0]?.id;
      if (findingId !== undefined) {
        const recheck = await harness.service.recheck({
          runId: run.runId,
          findingIds: [findingId],
        });
        expect(recheck.recheck).toHaveLength(1);
        const status = recheck.recheck[0]?.status;
        expect(
          ["fixed", "improved", "unchanged", "regressed", "needs_review"].includes(status ?? ""),
        ).toBe(true);
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "refuses unknown finding IDs instead of silently rechecking nothing",
    async () => {
      await expect(
        harness.service.recheck({ runId: "latest", findingIds: ["fnd_does_not_exist"] }),
      ).rejects.toThrow(/None of the requested finding IDs/);
    },
    TEST_TIMEOUT,
  );

  test(
    "captures a page whose content security policy blocks inline scripts",
    async () => {
      const run = await harness.service.inspect({ routes: ["/csp"] });
      expect(run.status).toBe("completed");
      const evidence = await harness.service.getEvidence({ runId: run.runId, routes: ["/csp"] });
      const capture = evidence.captures.find((entry) => entry.route === "/csp");
      expect(capture?.status).toBe("captured");
      expect(capture?.axe).toBeDefined();
    },
    TEST_TIMEOUT,
  );
});

describe.skipIf(skip)("security posture", () => {
  test(
    "refuses remote navigation that is not explicitly allowed",
    async () => {
      const site = await startFixtureSite();
      const storageRoot = await mkdtemp(path.join(tmpdir(), "visual-qa-sec-"));
      const configPath = path.join(storageRoot, "visual-qa.config.json");
      await Bun.write(
        configPath,
        JSON.stringify({
          baseUrl: site.url,
          routes: [{ path: "https://example.com/" }],
          viewports: [{ name: "mobile", width: 375, height: 812 }],
          storage: { root: storageRoot },
        }),
      );
      try {
        const service = await VisualQaService.create({
          configPath,
          logger,
          browserLauncher: async () => {
            throw new Error("Blocked navigation must not launch Chromium");
          },
        });
        const run = await service.inspect({});
        expect(run.status).toBe("failed");
        expect(run.captures[0]?.status).toBe("failed");
        expect(run.captures[0]?.error).toContain("allowedHosts");
      } finally {
        await site.close();
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "refuses an ad-hoc URL that violates the navigation policy",
    async () => {
      const site = await startFixtureSite();
      const storageRoot = await mkdtemp(path.join(tmpdir(), "visual-qa-sec-url-"));
      const configPath = path.join(storageRoot, "visual-qa.config.json");
      await Bun.write(
        configPath,
        JSON.stringify({
          baseUrl: site.url,
          routes: [{ path: "/" }],
          viewports: [{ name: "mobile", width: 375, height: 812 }],
          storage: { root: storageRoot },
        }),
      );
      try {
        const service = await VisualQaService.create({
          configPath,
          logger,
          browserLauncher: async () => {
            throw new Error("Blocked navigation must not launch Chromium");
          },
        });
        const run = await service.inspect({ url: "https://example.com/", viewports: ["mobile"] });
        expect(run.captures[0]?.status).toBe("failed");
        expect(run.captures[0]?.error).toContain("allowedHosts");

        const fileRun = await service.inspect({ url: "file:///etc/passwd", viewports: ["mobile"] });
        expect(fileRun.captures[0]?.status).toBe("failed");
        expect(fileRun.captures[0]?.error).toMatch(/not allowed|refused/);
      } finally {
        await site.close();
      }
    },
    TEST_TIMEOUT,
  );
});

test("marks a capture run failed when Chromium cannot launch", async () => {
  const storageRoot = await mkdtemp(path.join(tmpdir(), "visual-qa-launch-failure-"));
  const configPath = path.join(storageRoot, "visual-qa.config.json");
  await Bun.write(
    configPath,
    JSON.stringify({
      baseUrl: "http://127.0.0.1:54321",
      routes: [{ path: "/" }],
      viewports: [{ name: "mobile", width: 375, height: 812 }],
      storage: { root: storageRoot },
    }),
  );
  const service = await VisualQaService.create({
    configPath,
    logger,
    browserLauncher: async () => {
      throw new Error("Chromium unavailable");
    },
  });

  await expect(service.inspect({})).rejects.toThrow("Chromium unavailable");
  const runs = await service.storeInstance.listRuns();
  expect(runs).toHaveLength(1);
  const runId = runs[0]?.id ?? "";
  expect(runId).not.toBe("");
  const manifest = await service.storeInstance.readManifest(runId);
  expect(manifest.status).toBe("failed");
  expect(manifest.finishedAt).toBeDefined();
});
