import type { Category, Finding, SemanticSnapshot, Severity } from "../domain/schema.js";
import type { RawFinding } from "../domain/rules/types.js";

export interface VisionStructuralFacts {
  readonly title: string;
  readonly url: string;
  readonly counts: SemanticSnapshot["counts"];
  readonly document: {
    readonly clientWidth: number;
    readonly clientHeight: number;
    readonly scrollHeight: number;
    readonly hasHorizontalOverflow: boolean;
  };
  readonly nodes: readonly {
    readonly selector: string;
    readonly role: string;
    readonly name: string;
    readonly text: string;
    readonly bbox: { x: number; y: number; width: number; height: number };
    readonly interactive: boolean;
  }[];
}

export interface VisionImage {
  readonly mimeType: string;
  readonly data: Buffer;
}

export interface VisionReviewRequest {
  readonly runId: string;
  readonly captureId: string;
  readonly route: string;
  readonly scenario: string;
  readonly viewport: string;
  readonly url: string;
  readonly designBrief: string | undefined;
  /** Only present when `vision.allowScreenshots` is enabled. */
  readonly screenshot?: VisionImage | undefined;
  readonly reference?: VisionImage | undefined;
  readonly diff?: VisionImage | undefined;
  readonly structural: VisionStructuralFacts;
  readonly existingFindings: readonly Pick<Finding, "ruleId" | "category" | "observation">[];
}

export interface VisionFindingClaim {
  readonly category: Category;
  readonly severity: Severity;
  readonly observation: string;
  readonly expected: string;
  readonly suggestedFix: string;
  readonly confidence: number;
  readonly selector?: string | undefined;
  readonly ruleId?: string | undefined;
}

export interface VisionReviewOutcome {
  readonly findings: readonly VisionFindingClaim[];
  readonly notes?: readonly string[] | undefined;
  readonly model?: string | undefined;
}

/** Pluggable review layer. The core server works with no adapter configured. */
export interface VisionReviewAdapter {
  readonly name: string;
  review(request: VisionReviewRequest): Promise<VisionReviewOutcome>;
}

/** Build the bounded structural summary handed to a review adapter. */
export function buildStructuralFacts(
  snapshot: SemanticSnapshot | undefined,
  url: string,
  maxNodes = 60,
): VisionStructuralFacts {
  if (snapshot === undefined) {
    return {
      title: "",
      url,
      counts: { elements: 0, interactive: 0, images: 0, headings: 0, text: 0 },
      document: {
        clientWidth: 0,
        clientHeight: 0,
        scrollHeight: 0,
        hasHorizontalOverflow: false,
      },
      nodes: [],
    };
  }
  return {
    title: snapshot.document.title,
    url,
    counts: snapshot.counts,
    document: {
      clientWidth: snapshot.document.clientWidth,
      clientHeight: snapshot.document.clientHeight,
      scrollHeight: snapshot.document.scrollHeight,
      hasHorizontalOverflow: snapshot.document.hasHorizontalOverflow,
    },
    nodes: snapshot.nodes.slice(0, maxNodes).map((node) => ({
      selector: node.selector,
      role: node.role,
      name: node.name,
      text: node.text,
      bbox: node.bbox,
      interactive: node.interactive,
    })),
  };
}

/**
 * Convert model claims into findings.
 *
 * Model judgement is never upgraded to verified evidence: a claim that points
 * at a selector which does not exist in the captured structure is downgraded to
 * an unverified suggestion instead of being dropped silently or trusted.
 */
export function normalizeVisionFindings(
  outcome: VisionReviewOutcome,
  context: { readonly knownSelectors: ReadonlySet<string>; readonly adapterName: string },
): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const [index, claim] of outcome.findings.entries()) {
    const selectorKnown =
      claim.selector !== undefined && context.knownSelectors.has(claim.selector);
    const ruleId = claim.ruleId ?? `vision:${context.adapterName}:${claim.category}:${index}`;
    if (selectorKnown) {
      findings.push({
        ruleId,
        category: claim.category,
        origin: "vision_review",
        severity: claim.severity,
        observation: claim.observation,
        expected: claim.expected,
        suggestedFix: claim.suggestedFix,
        confidence: clamp(claim.confidence, 0, 0.9),
        verified: false,
        selector: claim.selector,
        evidence: [
          {
            kind: "dom",
            summary: `Grounded in captured element ${claim.selector}`,
            selector: claim.selector,
          },
          {
            kind: "note",
            summary: `Model judgement from adapter "${context.adapterName}"; not deterministically verified.`,
          },
        ],
        metric: { kind: "boolean", value: 1 },
      });
      continue;
    }
    findings.push({
      ruleId,
      category: claim.category,
      origin: "vision_review",
      severity: "info",
      observation: `[unverified] ${claim.observation}`,
      expected: claim.expected,
      suggestedFix: claim.suggestedFix,
      confidence: clamp(claim.confidence, 0, 0.25),
      verified: false,
      evidence: [
        {
          kind: "note",
          summary:
            claim.selector === undefined
              ? "No selector supplied; treated as a suggestion."
              : `Selector "${claim.selector}" was not present in the captured structure; treated as a suggestion.`,
        },
      ],
      metric: { kind: "boolean", value: 1 },
    });
  }
  return findings;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}
