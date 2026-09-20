import type { Capture, Finding, RunManifest } from "../../src/domain/schema.js";
import { makeCapture } from "./fixtures.js";

export const CREATED_FINDING: Finding = {
  id: "fnd_0123456789abcdef0123",
  runId: "run_1",
  route: "/",
  scenario: "default",
  viewport: "mobile",
  url: "http://localhost:3000/",
  severity: "medium",
  category: "runtime_error",
  origin: "deterministic_rule",
  ruleId: "runtime:console-error",
  observation: "Console error(s): boom",
  expected: "The page logs no console errors during load and interaction.",
  suggestedFix: "Trace the message to its source.",
  confidence: 1,
  evidence: [{ kind: "runtime", summary: "1 console error(s)" }],
  metric: { kind: "count", value: 1 },
  verified: true,
  status: "open",
  history: [{ runId: "run_1", status: "open", at: "2026-01-01T00:00:01.000Z", note: "detected" }],
  detectedAt: "2026-01-01T00:00:01.000Z",
};

export const CREATED_CAPTURE: Capture = makeCapture({
  id: "root__default__mobile",
  artifacts: [
    {
      id: "root__default__mobile:viewport.png",
      kind: "screenshot_viewport",
      path: "artifacts/root__default__mobile/viewport.png",
      mimeType: "image/png",
      bytes: 4,
      sha256: "abc",
      captureId: "root__default__mobile",
      width: 375,
      height: 812,
    },
  ],
});

export const CREATED_MANIFEST: RunManifest = {
  id: "run_1",
  createdAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:02.000Z",
  status: "completed",
  operation: "inspect",
  configPath: "/project/visual-qa.config.json",
  configName: "fixture",
  configSummary: {},
  targetBaseUrl: "http://localhost:3000",
  routes: ["/"],
  viewports: ["mobile"],
  captures: [
    {
      id: "root__default__mobile",
      route: "/",
      scenario: "default",
      viewport: "mobile",
      status: "captured",
      url: "http://localhost:3000/",
      durationMs: 1000,
    },
  ],
  findingCount: 1,
  findingsBySeverity: { critical: 0, high: 0, medium: 1, low: 0, info: 0 },
  findingsByCategory: { runtime_error: 1 },
  errors: [],
  artifacts: [],
};
