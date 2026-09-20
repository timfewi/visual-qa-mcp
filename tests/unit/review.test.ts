import { describe, expect, test } from "bun:test";

import { FakeVisionReviewAdapter } from "../../src/review/fake.js";
import { buildStructuralFacts, normalizeVisionFindings } from "../../src/review/adapter.js";
import { makeSemantics, semanticNode } from "../helpers/fixtures.js";

const snapshot = makeSemantics([
  semanticNode({
    selector: "button.cta",
    tag: "button",
    role: "button",
    text: "Buy now",
    interactive: true,
    hasAccessibleName: true,
    bbox: { x: 10, y: 700, width: 200, height: 40 },
  }),
  semanticNode({
    selector: "h1",
    tag: "h1",
    text: "Welcome",
    bbox: { x: 10, y: 20, width: 300, height: 40 },
  }),
]);

describe("structural facts", () => {
  test("bounds the node list and keeps the document summary", () => {
    const facts = buildStructuralFacts(snapshot, "http://localhost:3000/", 1);
    expect(facts.nodes).toHaveLength(1);
    expect(facts.counts.elements).toBe(2);
    expect(facts.document.clientWidth).toBe(375);
    expect(facts.title).toBe("Fixture");
  });

  test("tolerates a capture without a semantic snapshot", () => {
    const facts = buildStructuralFacts(undefined, "http://localhost:3000/");
    expect(facts.nodes).toEqual([]);
    expect(facts.counts.elements).toBe(0);
  });
});

describe("vision finding normalization", () => {
  const known = new Set(["button.cta", "h1"]);

  test("keeps grounded claims but never marks them verified", () => {
    const [finding] = normalizeVisionFindings(
      {
        findings: [
          {
            category: "cta_clarity",
            severity: "medium",
            observation: "The call to action competes with the headline.",
            expected: "One clear primary action.",
            suggestedFix: "Increase the visual weight of the primary button.",
            confidence: 0.99,
            selector: "button.cta",
          },
        ],
      },
      { knownSelectors: known, adapterName: "fake" },
    );
    expect(finding?.origin).toBe("vision_review");
    expect(finding?.verified).toBe(false);
    expect(finding?.confidence).toBeLessThanOrEqual(0.9);
    expect(finding?.selector).toBe("button.cta");
    expect(finding?.category).toBe("cta_clarity");
  });

  test("downgrades claims that point at elements which were never captured", () => {
    const [finding] = normalizeVisionFindings(
      {
        findings: [
          {
            category: "spacing",
            severity: "critical",
            observation: "Spacing feels cramped.",
            expected: "More breathing room.",
            suggestedFix: "Add padding.",
            confidence: 0.95,
            selector: ".not-captured",
          },
        ],
      },
      { knownSelectors: known, adapterName: "fake" },
    );
    expect(finding?.severity).toBe("info");
    expect(finding?.verified).toBe(false);
    expect(finding?.confidence).toBeLessThanOrEqual(0.25);
    expect(finding?.observation.startsWith("[unverified]")).toBe(true);
    expect(finding?.evidence[0]?.summary).toContain("not present in the captured structure");
  });

  test("downgrades claims without any selector", () => {
    const [finding] = normalizeVisionFindings(
      {
        findings: [
          {
            category: "visual_hierarchy",
            severity: "high",
            observation: "The hierarchy feels flat.",
            expected: "Clear hierarchy.",
            suggestedFix: "Differentiate levels.",
            confidence: 0.8,
          },
        ],
      },
      { knownSelectors: known, adapterName: "fake" },
    );
    expect(finding?.severity).toBe("info");
    expect(finding?.evidence[0]?.summary).toContain("No selector supplied");
  });

  test("clamps out-of-range confidence values", () => {
    const [finding] = normalizeVisionFindings(
      {
        findings: [
          {
            category: "consistency",
            severity: "low",
            observation: "Inconsistent buttons.",
            expected: "One button style.",
            suggestedFix: "Unify styles.",
            confidence: Number.NaN,
            selector: "h1",
          },
        ],
      },
      { knownSelectors: known, adapterName: "fake" },
    );
    expect(finding?.confidence).toBe(0);
  });
});

describe("fake vision adapter", () => {
  test("is deterministic and grounded in the capture", async () => {
    const adapter = new FakeVisionReviewAdapter();
    const facts = buildStructuralFacts(snapshot, "http://localhost:3000/");
    const request = {
      runId: "run_1",
      captureId: "root__default__mobile",
      route: "/",
      scenario: "default",
      viewport: "mobile",
      url: "http://localhost:3000/",
      designBrief: undefined,
      structural: facts,
      existingFindings: [],
    };
    const first = await adapter.review(request);
    const second = await adapter.review(request);
    expect(first.findings).toEqual(second.findings);
    expect(first.findings.length).toBeGreaterThan(0);
    for (const claim of first.findings) {
      if (claim.selector !== undefined) {
        expect(facts.nodes.some((node) => node.selector === claim.selector)).toBe(true);
      }
    }
    expect(adapter.name).toBe("fake");
  });

  test("reports no claims for a clean, simple capture", async () => {
    const adapter = new FakeVisionReviewAdapter();
    const clean = makeSemantics([
      semanticNode({
        selector: "button.cta",
        tag: "button",
        role: "button",
        interactive: true,
        hasAccessibleName: true,
        name: "Buy",
        bbox: { x: 10, y: 40, width: 200, height: 40 },
      }),
      semanticNode({
        selector: "h1",
        tag: "h1",
        text: "Welcome",
        bbox: { x: 10, y: 20, width: 300, height: 40 },
      }),
    ]);
    const outcome = await adapter.review({
      runId: "run_1",
      captureId: "capture",
      route: "/",
      scenario: "default",
      viewport: "mobile",
      url: "http://localhost:3000/",
      designBrief: undefined,
      structural: buildStructuralFacts(clean, "http://localhost:3000/"),
      existingFindings: [],
    });
    expect(outcome.findings).toEqual([]);
  });
});
