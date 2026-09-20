import { describe, expect, test } from "bun:test";

import {
  categoryCounts,
  filterFindings,
  normalizeFindings,
  severityCounts,
  sortFindings,
} from "../../src/domain/findings.js";
import { createCaptureId, createRunId, slugify, stableFindingId } from "../../src/domain/ids.js";
import type { RawFinding } from "../../src/domain/rules/types.js";

const identity = {
  runId: "run_1",
  route: "/",
  scenario: "default",
  viewport: "mobile",
  url: "http://localhost:3000/",
  detectedAt: "2026-01-01T00:00:00.000Z",
};

function raw(overrides: Partial<RawFinding> = {}): RawFinding {
  return {
    ruleId: "layout:horizontal-overflow",
    category: "responsive_overflow",
    origin: "deterministic_rule",
    severity: "high",
    observation: "overflow",
    expected: "fits",
    suggestedFix: "constrain",
    confidence: 0.9,
    verified: true,
    evidence: [],
    ...overrides,
  };
}

describe("identifiers", () => {
  test("slugifies routes into filesystem-safe keys", () => {
    expect(slugify("/")).toBe("root");
    expect(slugify("/about us/")).toBe("about-us");
    expect(slugify("/Über/Ärger")).toBe("uber-arger");
    expect(slugify("")).toBe("root");
  });

  test("finding IDs are stable for the same identity", () => {
    const first = stableFindingId({
      route: "/",
      scenario: "default",
      viewport: "mobile",
      category: "responsive_overflow",
      origin: "deterministic_rule",
      ruleId: "layout:horizontal-overflow",
    });
    const second = stableFindingId({
      route: "/",
      scenario: "default",
      viewport: "mobile",
      category: "responsive_overflow",
      origin: "deterministic_rule",
      ruleId: "layout:horizontal-overflow",
    });
    expect(first).toBe(second);
    expect(first.startsWith("fnd_")).toBe(true);
  });

  test("finding IDs change with the location but not with the run", () => {
    const base = {
      route: "/",
      scenario: "default",
      viewport: "mobile",
      category: "responsive_overflow",
      origin: "deterministic_rule",
      ruleId: "layout:horizontal-overflow",
    };
    expect(stableFindingId(base)).toBe(stableFindingId({ ...base, viewport: "mobile" }));
    expect(stableFindingId(base)).not.toBe(stableFindingId({ ...base, viewport: "desktop" }));
    expect(stableFindingId(base)).not.toBe(stableFindingId({ ...base, route: "/about" }));
  });

  test("run and capture IDs are unique and ordered", () => {
    const runId = createRunId(new Date("2026-01-02T03:04:05.678Z"));
    expect(runId.startsWith("run_20260102T030405Z_")).toBe(true);
    expect(createRunId(new Date("2026-01-02T03:04:05.678Z"))).not.toBe(runId);
    expect(createCaptureId({ route: "/", scenario: "default", viewport: "mobile" })).toBe(
      "root__default__mobile",
    );
  });
});

describe("finding normalization", () => {
  test("attaches stable identifiers and an initial history entry", () => {
    const [finding] = normalizeFindings([raw()], identity);
    expect(finding?.id.startsWith("fnd_")).toBe(true);
    expect(finding?.status).toBe("open");
    expect(finding?.history).toHaveLength(1);
    expect(finding?.runId).toBe("run_1");
    expect(finding?.verified).toBe(true);
  });

  test("drops duplicate identities inside one capture", () => {
    const findings = normalizeFindings(
      [raw(), raw(), raw({ ruleId: "runtime:console-error", category: "runtime_error" })],
      identity,
    );
    expect(findings).toHaveLength(2);
  });

  test("sorts by severity, then route, viewport and rule", () => {
    const findings = normalizeFindings(
      [
        raw({ severity: "low", ruleId: "typography:min-font-size", category: "typography" }),
        raw({
          severity: "critical",
          ruleId: "axe:color-contrast",
          category: "contrast",
          origin: "accessibility_engine",
        }),
        raw({ severity: "medium", ruleId: "runtime:console-error", category: "runtime_error" }),
      ],
      identity,
    );
    expect(findings.map((finding) => finding.severity)).toEqual(["critical", "medium", "low"]);
  });

  test("counts findings by severity and category", () => {
    const findings = normalizeFindings(
      [
        raw(),
        raw({ severity: "low", ruleId: "typography:min-font-size", category: "typography" }),
        raw({ severity: "low", ruleId: "typography:line-height", category: "typography" }),
      ],
      identity,
    );
    expect(severityCounts(findings)).toEqual({ critical: 0, high: 1, medium: 0, low: 2, info: 0 });
    expect(categoryCounts(findings)).toEqual({ responsive_overflow: 1, typography: 2 });
  });

  test("filters by severity, category, viewport, route and id", () => {
    const findings = normalizeFindings([raw()], identity);
    const target = findings[0];
    expect(filterFindings(findings, { severities: ["high"] })).toHaveLength(1);
    expect(filterFindings(findings, { severities: ["low"] })).toHaveLength(0);
    expect(filterFindings(findings, { categories: ["responsive_overflow"] })).toHaveLength(1);
    expect(filterFindings(findings, { viewports: ["desktop"] })).toHaveLength(0);
    expect(filterFindings(findings, { routes: ["/"] })).toHaveLength(1);
    expect(filterFindings(findings, { ids: [target?.id ?? ""] })).toHaveLength(1);
    expect(filterFindings(findings, undefined)).toHaveLength(1);
  });

  test("sorts a list in place without mutating the input array", () => {
    const original = normalizeFindings(
      [raw({ severity: "low", ruleId: "a", category: "typography" }), raw()],
      identity,
    );
    const copy = [...original];
    const sorted = sortFindings(original);
    expect(sorted).toHaveLength(2);
    expect(original).toEqual(copy);
  });
});
