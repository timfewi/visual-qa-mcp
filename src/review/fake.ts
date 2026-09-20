import type {
  VisionFindingClaim,
  VisionReviewAdapter,
  VisionReviewOutcome,
  VisionReviewRequest,
} from "./adapter.js";

/**
 * Deterministic stand-in for a real vision model.
 *
 * It exists so the review pipeline, the downgrade rules and the report can be
 * tested without any provider. It deliberately produces structural, checkable
 * claims rather than pretending to judge aesthetics.
 */
export class FakeVisionReviewAdapter implements VisionReviewAdapter {
  readonly name = "fake";

  review(request: VisionReviewRequest): Promise<VisionReviewOutcome> {
    const claims: VisionFindingClaim[] = [];
    const notes: string[] = [];
    const { structural } = request;

    const interactive = structural.nodes.filter((node) => node.interactive);
    const actionable = interactive.find((node) => node.bbox.y > 0);
    if (actionable !== undefined && actionable.bbox.y > structural.document.clientHeight * 0.8) {
      claims.push({
        category: "cta_clarity",
        severity: "low",
        observation: `The first interactive element ("${actionable.name || actionable.selector}") sits below ${Math.round(
          (actionable.bbox.y / Math.max(structural.document.clientHeight, 1)) * 100,
        )}% of the visible viewport.`,
        expected: "The primary action is reachable without scrolling on the first screen.",
        suggestedFix:
          "Move the primary action into the initial viewport or make the above-the-fold content point to it.",
        confidence: 0.5,
        selector: actionable.selector,
        ruleId: "vision:fake:cta-below-fold",
      });
    }

    if (structural.counts.headings === 0 && structural.counts.text > 10) {
      claims.push({
        category: "visual_hierarchy",
        severity: "medium",
        observation:
          "The capture contains text but no heading element to anchor the visual hierarchy.",
        expected: "A clear primary heading names the page and anchors the hierarchy.",
        suggestedFix: "Add a heading element for the page's primary message.",
        confidence: 0.6,
        ruleId: "vision:fake:no-headings",
      });
    }

    if (structural.document.hasHorizontalOverflow) {
      claims.push({
        category: "responsive_overflow",
        severity: "medium",
        observation: "The document scrolls horizontally at this viewport.",
        expected: "Content fits the viewport without horizontal scrolling.",
        suggestedFix: "Constrain wide elements or allow their content to wrap.",
        confidence: 0.55,
        ruleId: "vision:fake:horizontal-overflow",
      });
    }

    notes.push(
      `fake adapter evaluated ${structural.nodes.length} captured elements without any external provider`,
    );

    return Promise.resolve({ findings: claims, notes, model: "fake-deterministic" });
  }
}
