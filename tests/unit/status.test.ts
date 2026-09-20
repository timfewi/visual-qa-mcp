import { describe, expect, test } from "bun:test";

import { classifyRecheck } from "../../src/domain/status.js";

describe("recheck classification", () => {
  test("reports fixed when the condition is gone", () => {
    const outcome = classifyRecheck({
      present: false,
      previousStatus: "open",
      previousMetric: { kind: "count", value: 3 },
      captureFailed: false,
    });
    expect(outcome.status).toBe("fixed");
    expect(outcome.note).toContain("no longer detected");
  });

  test("never claims a fix when the recheck capture failed", () => {
    const outcome = classifyRecheck({
      present: false,
      previousStatus: "open",
      captureFailed: true,
    });
    expect(outcome.status).toBe("needs_review");
  });

  test("reports improved and regressed for count metrics", () => {
    expect(
      classifyRecheck({
        present: true,
        previousStatus: "open",
        previousMetric: { kind: "count", value: 5 },
        currentMetric: { kind: "count", value: 2 },
        captureFailed: false,
      }).status,
    ).toBe("improved");

    expect(
      classifyRecheck({
        present: true,
        previousStatus: "open",
        previousMetric: { kind: "count", value: 2 },
        currentMetric: { kind: "count", value: 5 },
        captureFailed: false,
      }).status,
    ).toBe("regressed");
  });

  test("reports unchanged when a count metric is identical", () => {
    expect(
      classifyRecheck({
        present: true,
        previousStatus: "open",
        previousMetric: { kind: "count", value: 2 },
        currentMetric: { kind: "count", value: 2 },
        captureFailed: false,
      }).status,
    ).toBe("unchanged");
  });

  test("applies a relative and absolute tolerance to ratio metrics", () => {
    expect(
      classifyRecheck({
        present: true,
        previousStatus: "open",
        previousMetric: { kind: "ratio", value: 0.1 },
        currentMetric: { kind: "ratio", value: 0.105 },
        captureFailed: false,
      }).status,
    ).toBe("unchanged");

    expect(
      classifyRecheck({
        present: true,
        previousStatus: "open",
        previousMetric: { kind: "ratio", value: 0.1 },
        currentMetric: { kind: "ratio", value: 0.05 },
        captureFailed: false,
      }).status,
    ).toBe("improved");

    expect(
      classifyRecheck({
        present: true,
        previousStatus: "open",
        previousMetric: { kind: "ratio", value: 0.1 },
        currentMetric: { kind: "ratio", value: 0.2 },
        captureFailed: false,
      }).status,
    ).toBe("regressed");
  });

  test("treats tiny absolute ratio changes as unchanged", () => {
    expect(
      classifyRecheck({
        present: true,
        previousStatus: "open",
        previousMetric: { kind: "ratio", value: 0.0005 },
        currentMetric: { kind: "ratio", value: 0.0009 },
        captureFailed: false,
      }).status,
    ).toBe("unchanged");
  });

  test("flags a reappearing condition as regressed", () => {
    expect(
      classifyRecheck({
        present: true,
        previousStatus: "fixed",
        previousMetric: { kind: "count", value: 1 },
        currentMetric: { kind: "count", value: 1 },
        captureFailed: false,
      }).status,
    ).toBe("regressed");
  });

  test("falls back to unchanged without comparable metrics", () => {
    expect(
      classifyRecheck({ present: true, previousStatus: "open", captureFailed: false }).status,
    ).toBe("unchanged");
  });
});
