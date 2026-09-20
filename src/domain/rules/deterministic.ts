import type { BoundingBox, EvidenceItem, SemanticNode, Severity } from "../schema.js";
import { type RawFinding, type RuleContext, round, truncate, unionBox } from "./types.js";

/**
 * Deterministic layout rules derived from the semantic snapshot.
 *
 * These rules must stay conservative: a low false-positive rate matters more
 * than coverage, because every deterministic finding is presented to the agent
 * as verified evidence.
 */

export function responsiveOverflowRules(context: RuleContext): RawFinding[] {
  const semantics = context.capture.semantics;
  if (!semantics) {
    return [];
  }
  const findings: RawFinding[] = [];
  const clientWidth = semantics.document.clientWidth;
  const overflowNodes = semantics.nodes.filter(
    (node) =>
      node.visible && node.bbox.width > 0 && node.bbox.x + node.bbox.width > clientWidth + 1,
  );
  const documentOverflows = semantics.document.hasHorizontalOverflow;

  if (documentOverflows || overflowNodes.length > 0) {
    const examples = overflowNodes.slice(0, 5);
    const overflowPx = Math.max(0, semantics.document.scrollWidth - clientWidth);
    findings.push({
      ruleId: "layout:horizontal-overflow",
      category: "responsive_overflow",
      origin: "deterministic_rule",
      severity: clientWidth <= 768 ? "high" : "medium",
      observation: documentOverflows
        ? `The document scrolls horizontally by ${round(overflowPx)} CSS px${overflowNodes.length > 0 ? `; ${overflowNodes.length} element(s) extend past the viewport` : ""}.`
        : `${overflowNodes.length} element(s) extend past the viewport width.`,
      expected: "Content fits the viewport width without horizontal scrolling.",
      suggestedFix:
        "Constrain the offending element (max-width: 100%, min-width: 0 on flex/grid children, wrapping or truncating long content).",
      confidence: 0.9,
      verified: true,
      selector: examples[0]?.selector,
      bbox: unionBox(examples.map((node) => node.bbox)),
      evidence: [
        {
          kind: "dom",
          summary: `document.scrollWidth=${semantics.document.scrollWidth}, clientWidth=${clientWidth}`,
          detail: { examples: nodeDetails(examples) },
        },
      ],
      metric: { kind: "count", value: Math.max(overflowNodes.length, documentOverflows ? 1 : 0) },
    });
  }

  const clipped = semantics.nodes.filter((node) => node.clipped && node.text.length > 0);
  if (clipped.length > 0) {
    const examples = clipped.slice(0, 5);
    findings.push({
      ruleId: "layout:text-clipped",
      category: "responsive_overflow",
      origin: "deterministic_rule",
      severity: "low",
      observation: `${clipped.length} text element(s) are clipped by their own container.`,
      expected: "Text is fully visible or replaced by a deliberate, accessible truncation pattern.",
      suggestedFix:
        "Allow the container to grow, reduce the content, or use a documented truncation pattern with a full-text fallback.",
      confidence: 0.75,
      verified: true,
      selector: examples[0]?.selector,
      bbox: unionBox(examples.map((node) => node.bbox)),
      evidence: [
        {
          kind: "dom",
          summary: `${clipped.length} clipped text element(s)`,
          detail: { examples: nodeDetails(examples) },
        },
      ],
      metric: { kind: "count", value: clipped.length },
    });
  }

  return findings;
}

export function typographyRules(context: RuleContext): RawFinding[] {
  const semantics = context.capture.semantics;
  if (!semantics) {
    return [];
  }
  const findings: RawFinding[] = [];
  const minFontSize = context.rules.minFontSizePx;
  const tiny = semantics.nodes.filter(
    (node) => node.visible && node.text.length > 0 && node.styles.fontSize < minFontSize,
  );
  if (tiny.length > 0) {
    const examples = tiny.slice(0, 5);
    const smallest = Math.min(...tiny.map((node) => node.styles.fontSize));
    findings.push({
      ruleId: "typography:min-font-size",
      category: "typography",
      origin: "deterministic_rule",
      severity: "low",
      observation: `${tiny.length} text element(s) render below ${minFontSize}px (smallest: ${smallest}px).`,
      expected: `Body text renders at ${minFontSize}px or larger.`,
      suggestedFix:
        "Raise the font size for the offending elements, or confirm that they are non-essential fine print.",
      confidence: 0.8,
      verified: true,
      selector: examples[0]?.selector,
      bbox: unionBox(examples.map((node) => node.bbox)),
      evidence: [
        {
          kind: "dom",
          summary: `${tiny.length} element(s) below ${minFontSize}px`,
          detail: { examples: nodeDetails(examples) },
        },
      ],
      metric: { kind: "count", value: tiny.length },
    });
  }

  const tight = semantics.nodes.filter(
    (node) =>
      node.visible &&
      node.text.length > 40 &&
      node.styles.fontSize >= minFontSize &&
      node.styles.lineHeight > 0 &&
      node.styles.lineHeight / node.styles.fontSize < 1.1,
  );
  if (tight.length > 0) {
    const examples = tight.slice(0, 5);
    findings.push({
      ruleId: "typography:line-height",
      category: "typography",
      origin: "deterministic_rule",
      severity: "low",
      observation: `${tight.length} block(s) of running text use a line-height below 1.1×.`,
      expected: "Multi-line running text keeps a comfortable line-height (typically 1.4–1.6×).",
      suggestedFix: "Increase line-height for the offending text blocks.",
      confidence: 0.7,
      verified: true,
      selector: examples[0]?.selector,
      bbox: unionBox(examples.map((node) => node.bbox)),
      evidence: [
        {
          kind: "dom",
          summary: `${tight.length} tight text block(s)`,
          detail: { examples: nodeDetails(examples) },
        },
      ],
      metric: { kind: "count", value: tight.length },
    });
  }

  return findings;
}

export function imageryRules(context: RuleContext): RawFinding[] {
  const semantics = context.capture.semantics;
  if (!semantics) {
    return [];
  }
  const findings: RawFinding[] = [];
  const images = semantics.nodes.filter((node) => node.tag === "img");
  const broken = images.filter(
    (node) =>
      node.naturalSize !== undefined &&
      (node.naturalSize.width === 0 || node.naturalSize.height === 0),
  );
  if (broken.length > 0) {
    const examples = broken.slice(0, 5);
    findings.push({
      ruleId: "imagery:broken-image",
      category: "imagery",
      origin: "deterministic_rule",
      severity: "medium",
      observation: `${broken.length} image(s) failed to load.`,
      expected: "Every referenced image loads and renders its intrinsic content.",
      suggestedFix:
        "Fix the image URL or remove the reference; verify the asset is part of the build output.",
      confidence: 0.95,
      verified: true,
      selector: examples[0]?.selector,
      bbox: unionBox(examples.map((node) => node.bbox)),
      evidence: [
        {
          kind: "dom",
          summary: `${broken.length} broken image(s)`,
          detail: { examples: nodeDetails(examples) },
        },
      ],
      metric: { kind: "count", value: broken.length },
    });
  }

  const distorted = images.filter((node) => {
    if (node.naturalSize === undefined || node.bbox.width <= 0 || node.bbox.height <= 0) {
      return false;
    }
    const { width: naturalWidth, height: naturalHeight } = node.naturalSize;
    if (naturalWidth <= 0 || naturalHeight <= 0) {
      return false;
    }
    const naturalRatio = naturalWidth / naturalHeight;
    const renderedRatio = node.bbox.width / node.bbox.height;
    return Math.abs(renderedRatio - naturalRatio) / naturalRatio > 0.15;
  });
  if (distorted.length > 0) {
    const examples = distorted.slice(0, 5);
    findings.push({
      ruleId: "imagery:aspect-distortion",
      category: "imagery",
      origin: "deterministic_rule",
      severity: "low",
      observation: `${distorted.length} image(s) render with a distorted aspect ratio.`,
      expected: "Images keep their intrinsic aspect ratio unless distortion is intentional.",
      suggestedFix: "Use object-fit or explicit width/height that preserves the intrinsic ratio.",
      confidence: 0.7,
      verified: true,
      selector: examples[0]?.selector,
      bbox: unionBox(examples.map((node) => node.bbox)),
      evidence: [
        {
          kind: "dom",
          summary: `${distorted.length} distorted image(s)`,
          detail: { examples: nodeDetails(examples) },
        },
      ],
      metric: { kind: "count", value: distorted.length },
    });
  }

  return findings;
}

export function affordanceRules(context: RuleContext): RawFinding[] {
  const semantics = context.capture.semantics;
  if (!semantics) {
    return [];
  }
  const findings: RawFinding[] = [];

  // Missing accessible names are already covered by axe's name rules whenever
  // the accessibility engine ran; only report them when it was skipped.
  if (context.capture.axe === undefined) {
    const unnamed = semantics.nodes.filter(
      (node) =>
        node.interactive && node.visible && !node.hasAccessibleName && node.text.length === 0,
    );
    if (unnamed.length > 0) {
      const examples = unnamed.slice(0, 5);
      findings.push({
        ruleId: "affordance:unnamed-control",
        category: "affordance",
        origin: "deterministic_rule",
        severity: "medium",
        observation: `${unnamed.length} interactive element(s) have neither an accessible name nor visible text.`,
        expected: "Every interactive element exposes an accessible name and a visible purpose.",
        suggestedFix:
          "Add an accessible name (visible label or aria-label) that describes the action.",
        confidence: 0.8,
        verified: true,
        selector: examples[0]?.selector,
        bbox: unionBox(examples.map((node) => node.bbox)),
        evidence: [
          {
            kind: "dom",
            summary: `${unnamed.length} unnamed control(s)`,
            detail: { examples: nodeDetails(examples) },
          },
        ],
        metric: { kind: "count", value: unnamed.length },
      });
    }
  }

  const minTarget = context.rules.minTapTargetPx;
  const smallTargets = semantics.nodes.filter((node) => {
    if (!node.visible || !node.interactive) {
      return false;
    }
    const isButtonLike =
      node.tag === "button" ||
      node.role === "button" ||
      node.tag === "select" ||
      node.tag === "textarea";
    if (!isButtonLike) {
      return false;
    }
    if (node.bbox.width === 0 || node.bbox.height === 0) {
      return false;
    }
    return node.bbox.width < minTarget || node.bbox.height < minTarget;
  });
  if (smallTargets.length > 0) {
    const examples = smallTargets.slice(0, 5);
    findings.push({
      ruleId: "affordance:small-target",
      category: "affordance",
      origin: "deterministic_rule",
      severity: "low",
      observation: `${smallTargets.length} control(s) are smaller than ${minTarget}×${minTarget} CSS px.`,
      expected: `Interactive controls offer a hit area of at least ${minTarget}×${minTarget} CSS px.`,
      suggestedFix:
        "Increase padding or the minimum size of the control without changing its visual weight.",
      confidence: 0.7,
      verified: true,
      selector: examples[0]?.selector,
      bbox: unionBox(examples.map((node) => node.bbox)),
      evidence: [
        {
          kind: "dom",
          summary: `${smallTargets.length} small control(s)`,
          detail: { examples: nodeDetails(examples) },
        },
      ],
      metric: { kind: "count", value: smallTargets.length },
    });
  }

  return findings;
}

export function headingStructureRules(context: RuleContext): RawFinding[] {
  const semantics = context.capture.semantics;
  if (!semantics) {
    return [];
  }
  const headings = semantics.nodes.filter((node) => /^h[1-6]$/.test(node.tag));
  const findings: RawFinding[] = [];
  const h1Count = headings.filter((node) => node.tag === "h1").length;

  if (headings.length > 0 && h1Count === 0) {
    findings.push({
      ruleId: "hierarchy:missing-h1",
      category: "visual_hierarchy",
      origin: "deterministic_rule",
      severity: "low",
      observation: "The page has headings but no level-1 heading.",
      expected: "Each route exposes exactly one primary heading that names the page.",
      suggestedFix: "Promote the primary page heading to h1 or add a descriptive h1.",
      confidence: 0.85,
      verified: true,
      selector: headings[0]?.selector,
      bbox: headings[0]?.bbox,
      evidence: [
        {
          kind: "dom",
          summary: `${headings.length} heading(s), no h1`,
          detail: { examples: nodeDetails(headings.slice(0, 5)) },
        },
      ],
      metric: { kind: "count", value: 0 },
    });
  } else if (h1Count > 1) {
    findings.push({
      ruleId: "hierarchy:multiple-h1",
      category: "visual_hierarchy",
      origin: "deterministic_rule",
      severity: "low",
      observation: `The page has ${h1Count} level-1 headings.`,
      expected: "Exactly one level-1 heading names the page.",
      suggestedFix: "Demote secondary headings to h2 or lower.",
      confidence: 0.8,
      verified: true,
      selector: headings.find((node) => node.tag === "h1")?.selector,
      bbox: unionBox(headings.filter((node) => node.tag === "h1").map((node) => node.bbox)),
      evidence: [
        {
          kind: "dom",
          summary: `${h1Count} h1 element(s)`,
          detail: {
            examples: nodeDetails(headings.filter((node) => node.tag === "h1").slice(0, 5)),
          },
        },
      ],
      metric: { kind: "count", value: h1Count },
    });
  }

  const skips: { from: SemanticNode; to: SemanticNode }[] = [];
  let previousLevel = 0;
  for (const heading of headings) {
    const level = Number(heading.tag.slice(1));
    if (previousLevel > 0 && level - previousLevel > 1) {
      skips.push({ from: headings[headings.indexOf(heading) - 1] as SemanticNode, to: heading });
    }
    previousLevel = level;
  }
  if (skips.length > 0) {
    findings.push({
      ruleId: "hierarchy:heading-order",
      category: "visual_hierarchy",
      origin: "deterministic_rule",
      severity: "low",
      observation: `${skips.length} heading level skip(s) in document order.`,
      expected: "Heading levels increase by one step at a time.",
      suggestedFix: "Use the next heading level instead of skipping levels.",
      confidence: 0.85,
      verified: true,
      selector: skips[0]?.to.selector,
      bbox: unionBox(skips.map((skip) => skip.to.bbox)),
      evidence: [
        {
          kind: "dom",
          summary: `${skips.length} skip(s)`,
          detail: {
            examples: skips.slice(0, 5).map((skip) => ({
              from: `${skip.from.tag} ${truncate(skip.from.text, 60)}`,
              to: `${skip.to.tag} ${truncate(skip.to.text, 60)}`,
            })),
          },
        },
      ],
      metric: { kind: "count", value: skips.length },
    });
  }

  return findings;
}

export function overlappingTextRules(context: RuleContext): RawFinding[] {
  const semantics = context.capture.semantics;
  if (!semantics) {
    return [];
  }
  const candidates = semantics.nodes
    .filter(
      (node) =>
        node.visible &&
        node.text.length > 0 &&
        node.bbox.width > 1 &&
        node.bbox.height > 1 &&
        node.styles.position !== "absolute" &&
        node.styles.position !== "fixed" &&
        node.styles.position !== "sticky",
    )
    .slice(0, context.rules.maxSemanticElementsForOverlap);

  const collisions: { a: SemanticNode; b: SemanticNode; area: number }[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const a = candidates[i] as SemanticNode;
    const aRight = a.bbox.x + a.bbox.width;
    const aBottom = a.bbox.y + a.bbox.height;
    for (let j = i + 1; j < candidates.length; j += 1) {
      const b = candidates[j] as SemanticNode;
      const bRight = b.bbox.x + b.bbox.width;
      const bBottom = b.bbox.y + b.bbox.height;
      if (b.bbox.x >= aRight || bRight <= a.bbox.x || b.bbox.y >= aBottom || bBottom <= a.bbox.y) {
        continue;
      }
      if (contains(a.bbox, b.bbox) || contains(b.bbox, a.bbox)) {
        continue;
      }
      const overlapWidth = Math.min(aRight, bRight) - Math.max(a.bbox.x, b.bbox.x);
      const overlapHeight = Math.min(aBottom, bBottom) - Math.max(a.bbox.y, b.bbox.y);
      const area = overlapWidth * overlapHeight;
      const smaller = Math.min(a.bbox.width * a.bbox.height, b.bbox.width * b.bbox.height);
      if (smaller > 0 && area / smaller > 0.3) {
        collisions.push({ a, b, area });
      }
    }
  }

  if (collisions.length === 0) {
    return [];
  }
  collisions.sort((left, right) => right.area - left.area);
  const boxes: BoundingBox[] = [];
  for (const collision of collisions) {
    boxes.push(collision.a.bbox, collision.b.bbox);
  }
  return [
    {
      ruleId: "alignment:overlapping-text",
      category: "alignment",
      origin: "deterministic_rule",
      severity: "medium",
      observation: `${collisions.length} pair(s) of text elements overlap in normal flow.`,
      expected:
        "Text elements do not overlap; layout has enough space or the overlay is deliberate.",
      suggestedFix:
        "Adjust spacing, sizing or stacking so the overlapping text is either separated or rendered as an intentional overlay.",
      confidence: 0.6,
      verified: false,
      selector: collisions[0]?.a.selector,
      bbox: unionBox(boxes),
      evidence: [
        {
          kind: "dom",
          summary: `${collisions.length} overlapping pair(s)`,
          detail: {
            examples: collisions.slice(0, 5).map((collision) => ({
              a: `${collision.a.selector} "${truncate(collision.a.text, 40)}"`,
              b: `${collision.b.selector} "${truncate(collision.b.text, 40)}"`,
              overlapArea: round(collision.area),
            })),
          },
        },
      ],
      metric: { kind: "count", value: collisions.length },
    },
  ];
}

export function regressionRules(context: RuleContext): RawFinding[] {
  const diff = context.capture.diff;
  if (!diff || diff.status === "no_baseline" || diff.status === "match") {
    return [];
  }
  const severity: Severity =
    diff.status === "size_mismatch" ? "medium" : diff.ratio > 0.05 ? "high" : "medium";
  const artifact = context.artifactFor("diff");
  const evidence: EvidenceItem[] = [
    {
      kind: "diff",
      summary: `${diff.status}: ${round(diff.ratio * 100, 3)}% of pixels differ`,
      ...(artifact ? { artifactPath: artifact.path } : {}),
      detail: {
        diffPixels: diff.diffPixels,
        regions: diff.regions.slice(0, 5),
        baselineRunId: diff.baselineRunId ?? null,
      },
    },
  ];
  return [
    {
      ruleId: "regression:screenshot-diff",
      category: "regression",
      origin: "screenshot_diff",
      severity,
      observation:
        diff.status === "size_mismatch"
          ? "The captured screenshot no longer matches the size of the approved baseline."
          : `The rendered screenshot differs from the approved baseline in ${diff.regions.length} region(s).`,
      expected: "The rendered result matches the approved baseline for this viewport.",
      suggestedFix:
        "Inspect the diff region, confirm whether the change is intended, and approve a new baseline only for intended changes.",
      confidence: 0.9,
      verified: true,
      bbox: unionBox(
        diff.regions.map((region) => ({
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
        })),
      ),
      evidence,
      metric: { kind: "ratio", value: diff.ratio },
    },
  ];
}

function contains(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function nodeDetails(nodes: readonly SemanticNode[]): Record<string, unknown>[] {
  return nodes.map((node) => ({
    selector: node.selector,
    text: truncate(node.text, 80),
    bbox: node.bbox,
    fontSize: node.styles.fontSize,
    density: node.styles.fontSize > 0 ? node.styles.lineHeight / node.styles.fontSize : 0,
  }));
}
