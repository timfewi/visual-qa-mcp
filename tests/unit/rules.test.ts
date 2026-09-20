import { describe, expect, test } from "bun:test";

import { parseConfig } from "../../src/config/load.js";
import { runRules } from "../../src/domain/rules/index.js";
import type { RuleContext } from "../../src/domain/rules/types.js";
import {
  axeViolation,
  makeAxe,
  makeCapture,
  makeSemantics,
  semanticNode,
} from "../helpers/fixtures.js";

const config = parseConfig({
  baseUrl: "http://localhost:3000",
  routes: [{ path: "/" }],
});

function context(capture: Parameters<typeof makeCapture>[0], rules = config.rules): RuleContext {
  const built = makeCapture(capture);
  return {
    runId: "run_test",
    capture: built,
    rules,
    compare: config.compare,
    artifactFor: (kind) => built.artifacts.find((artifact) => artifact.kind === kind),
  };
}

function ruleIds(capture: Parameters<typeof makeCapture>[0]): string[] {
  return runRules(context(capture)).map((finding) => finding.ruleId);
}

describe("runtime rules", () => {
  test("reports page errors with high severity and a count metric", () => {
    const findings = runRules(
      context({
        runtime: [
          {
            kind: "page_error",
            message: "TypeError: x is not a function",
            at: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );
    const pageError = findings.find((finding) => finding.ruleId === "runtime:page-error");
    expect(pageError?.severity).toBe("high");
    expect(pageError?.metric).toEqual({ kind: "count", value: 1 });
    expect(pageError?.verified).toBe(true);
  });

  test("ignores aborted requests but reports real failures and error responses", () => {
    const findings = ruleIds({
      runtime: [
        {
          kind: "request_failed",
          message: "net::ERR_ABORTED",
          url: "http://localhost:3000/x",
          at: "t",
        },
        {
          kind: "request_failed",
          message: "net::ERR_CONNECTION_REFUSED",
          url: "http://localhost:3000/y",
          at: "t",
        },
        {
          kind: "response_error",
          message: "HTTP 500",
          url: "http://localhost:3000/z",
          status: 500,
          at: "t",
        },
      ],
    });
    expect(findings).toContain("runtime:request-failed");
    expect(findings).toContain("runtime:response-error");
    const failed = runRules(
      context({
        runtime: [
          {
            kind: "request_failed",
            message: "net::ERR_ABORTED",
            url: "http://localhost:3000/x",
            at: "t",
          },
        ],
      }),
    );
    expect(failed.map((finding) => finding.ruleId)).not.toContain("runtime:request-failed");
  });

  test("deduplicates repeated console errors", () => {
    const findings = runRules(
      context({
        runtime: [
          { kind: "console_error", message: "boom", at: "t1" },
          { kind: "console_error", message: "boom", at: "t2" },
        ],
      }),
    );
    expect(findings.find((finding) => finding.ruleId === "runtime:console-error")?.metric).toEqual({
      kind: "count",
      value: 1,
    });
  });
});

describe("accessibility rules", () => {
  test("maps axe impacts onto severities and keeps contrast separate", () => {
    const findings = runRules(
      context({
        axe: makeAxe({
          violations: [
            axeViolation(),
            axeViolation({
              id: "color-contrast",
              impact: "critical",
              help: "Elements must meet contrast",
            }),
          ],
        }),
      }),
    );
    const buttonName = findings.find((finding) => finding.ruleId === "axe:button-name");
    const contrast = findings.find((finding) => finding.ruleId === "axe:color-contrast");
    expect(buttonName?.severity).toBe("high");
    expect(buttonName?.category).toBe("accessibility");
    expect(contrast?.severity).toBe("critical");
    expect(contrast?.category).toBe("contrast");
    expect(buttonName?.origin).toBe("accessibility_engine");
  });

  test("reports incomplete checks as unverified info findings", () => {
    const findings = runRules(context({ axe: makeAxe({ violations: [], incompleteCount: 4 }) }));
    const incomplete = findings.find((finding) => finding.ruleId === "axe:incomplete");
    expect(incomplete?.severity).toBe("info");
    expect(incomplete?.verified).toBe(false);
  });

  test("does not invent accessibility findings when axe is disabled", () => {
    expect(ruleIds({})).not.toContain("axe:button-name");
  });
});

describe("layout rules", () => {
  test("reports document-level horizontal overflow with full severity on small viewports", () => {
    const findings = runRules(
      context({
        semantics: makeSemantics(
          [
            semanticNode({
              selector: "main > .wide",
              bbox: { x: 0, y: 0, width: 600, height: 200 },
            }),
          ],
          {
            scrollWidth: 600,
            clientWidth: 375,
            hasHorizontalOverflow: true,
          },
        ),
      }),
    );
    const overflow = findings.find((finding) => finding.ruleId === "layout:horizontal-overflow");
    expect(overflow?.severity).toBe("high");
    expect(overflow?.category).toBe("responsive_overflow");
    expect(overflow?.selector).toBe("main > .wide");
  });

  test("reports clipped text separately", () => {
    const findings = ruleIds({
      semantics: makeSemantics([
        semanticNode({
          text: "A very long truncated headline",
          clipped: true,
          selector: ".card h3",
        }),
      ]),
    });
    expect(findings).toContain("layout:text-clipped");
  });

  test("stays quiet for a clean capture", () => {
    expect(
      ruleIds({
        semantics: makeSemantics([
          semanticNode({
            tag: "h1",
            text: "Headline",
            selector: "h1",
            bbox: { x: 0, y: 0, width: 300, height: 40 },
          }),
        ]),
      }),
    ).toEqual([]);
  });

  test("detects tiny fonts and tight line heights", () => {
    const findings = ruleIds({
      semantics: makeSemantics([
        semanticNode({
          text: "fine print",
          selector: ".fine",
          styles: { ...semanticNode().styles, fontSize: 9, lineHeight: 11 },
        }),
        semanticNode({
          text: "a".repeat(80),
          selector: ".tight",
          bbox: { x: 0, y: 40, width: 300, height: 60 },
          styles: { ...semanticNode().styles, fontSize: 16, lineHeight: 17 },
        }),
      ]),
    });
    expect(findings).toContain("typography:min-font-size");
    expect(findings).toContain("typography:line-height");
  });
});

describe("imagery rules", () => {
  test("detects broken and distorted images", () => {
    const findings = ruleIds({
      semantics: makeSemantics([
        semanticNode({
          tag: "img",
          selector: "img.broken",
          naturalSize: { width: 0, height: 0 },
          bbox: { x: 0, y: 0, width: 100, height: 100 },
        }),
        semanticNode({
          tag: "img",
          selector: "img.squashed",
          naturalSize: { width: 400, height: 200 },
          bbox: { x: 0, y: 200, width: 200, height: 200 },
        }),
      ]),
    });
    expect(findings).toContain("imagery:broken-image");
    expect(findings).toContain("imagery:aspect-distortion");
  });
});

describe("affordance rules", () => {
  test("defers missing accessible names to axe when the engine ran", () => {
    const findings = ruleIds({
      axe: makeAxe({ violations: [] }),
      semantics: makeSemantics([
        semanticNode({ tag: "button", interactive: true, selector: "button.icon" }),
      ]),
    });
    expect(findings).not.toContain("affordance:unnamed-control");
  });

  test("reports unnamed controls when no accessibility engine ran", () => {
    const findings = ruleIds({
      semantics: makeSemantics([
        semanticNode({ tag: "button", interactive: true, selector: "button.icon" }),
      ]),
    });
    expect(findings).toContain("affordance:unnamed-control");
  });

  test("reports undersized button-like controls", () => {
    const findings = ruleIds({
      semantics: makeSemantics([
        semanticNode({
          tag: "button",
          interactive: true,
          selector: "button.tiny",
          bbox: { x: 0, y: 0, width: 16, height: 16 },
        }),
      ]),
    });
    expect(findings).toContain("affordance:small-target");
  });
});

describe("heading rules", () => {
  test("reports a missing h1 and level skips", () => {
    const findings = ruleIds({
      semantics: makeSemantics([
        semanticNode({
          tag: "h2",
          text: "Section",
          selector: "h2",
          bbox: { x: 0, y: 0, width: 200, height: 30 },
        }),
        semanticNode({
          tag: "h4",
          text: "Deep",
          selector: "h4",
          bbox: { x: 0, y: 40, width: 200, height: 30 },
        }),
      ]),
    });
    expect(findings).toContain("hierarchy:missing-h1");
    expect(findings).toContain("hierarchy:heading-order");
  });

  test("reports multiple h1 elements", () => {
    const findings = ruleIds({
      semantics: makeSemantics([
        semanticNode({
          tag: "h1",
          text: "One",
          selector: "h1.one",
          bbox: { x: 0, y: 0, width: 200, height: 30 },
        }),
        semanticNode({
          tag: "h1",
          text: "Two",
          selector: "h1.two",
          bbox: { x: 0, y: 40, width: 200, height: 30 },
        }),
      ]),
    });
    expect(findings).toContain("hierarchy:multiple-h1");
  });
});

describe("overlap rules", () => {
  test("detects overlapping text in normal flow", () => {
    const findings = ruleIds({
      semantics: makeSemantics([
        semanticNode({
          text: "Left column",
          selector: ".left",
          bbox: { x: 0, y: 0, width: 200, height: 40 },
        }),
        semanticNode({
          text: "Right column",
          selector: ".right",
          bbox: { x: 100, y: 10, width: 200, height: 40 },
        }),
      ]),
    });
    expect(findings).toContain("alignment:overlapping-text");
  });

  test("ignores nested elements and intentionally positioned overlays", () => {
    const findings = ruleIds({
      semantics: makeSemantics([
        semanticNode({
          text: "Parent block",
          selector: ".card",
          bbox: { x: 0, y: 0, width: 300, height: 200 },
        }),
        semanticNode({
          text: "Child line",
          selector: ".card > p",
          bbox: { x: 10, y: 20, width: 200, height: 40 },
        }),
        semanticNode({
          text: "Modal overlay",
          selector: ".modal",
          bbox: { x: 20, y: 20, width: 200, height: 60 },
          styles: { ...semanticNode().styles, position: "absolute" },
        }),
      ]),
    });
    expect(findings).not.toContain("alignment:overlapping-text");
  });
});

describe("regression rules", () => {
  test("reports a diff against the baseline as a regression", () => {
    const findings = runRules(
      context({
        diff: {
          status: "mismatch",
          ratio: 0.02,
          diffPixels: 400,
          baselineRunId: "run_old",
          regions: [{ x: 10, y: 20, width: 100, height: 40, pixels: 400 }],
        },
      }),
    );
    const regression = findings.find((finding) => finding.ruleId === "regression:screenshot-diff");
    expect(regression?.category).toBe("regression");
    expect(regression?.origin).toBe("screenshot_diff");
    expect(regression?.bbox).toEqual({ x: 10, y: 20, width: 100, height: 40 });
    expect(regression?.metric).toEqual({ kind: "ratio", value: 0.02 });
  });

  test("stays quiet without a baseline or with a matching capture", () => {
    expect(
      ruleIds({ diff: { status: "no_baseline", ratio: 0, diffPixels: 0, regions: [] } }),
    ).not.toContain("regression:screenshot-diff");
    expect(
      ruleIds({ diff: { status: "match", ratio: 0, diffPixels: 0, regions: [] } }),
    ).not.toContain("regression:screenshot-diff");
  });
});
