import type { Severity } from "../schema.js";
import { type RawFinding, type RuleContext, truncate, unionBox } from "./types.js";

/** axe `impact` values mapped onto the shared severity vocabulary. */
function axeSeverity(impact: string): Severity {
  switch (impact) {
    case "critical":
      return "critical";
    case "serious":
      return "high";
    case "moderate":
      return "medium";
    case "minor":
      return "low";
    default:
      return "low";
  }
}

const CONTRAST_RULES = new Set(["color-contrast", "color-contrast-enhanced"]);

/**
 * Automated accessibility evidence from axe-core.
 *
 * One finding per violation id keeps the list actionable and stable across
 * runs. These findings are never presented as complete WCAG validation.
 */
export function accessibilityRules(context: RuleContext): RawFinding[] {
  const axe = context.capture.axe;
  if (!axe) {
    return [];
  }
  const findings: RawFinding[] = [];

  for (const violation of axe.violations) {
    const nodes = violation.nodes;
    if (nodes.length === 0) {
      continue;
    }
    const boxes = nodes.flatMap((node) => (node.bbox ? [node.bbox] : []));
    const isContrast = CONTRAST_RULES.has(violation.id);
    const example = nodes[0];
    findings.push({
      ruleId: `axe:${violation.id}`,
      category: isContrast ? "contrast" : "accessibility",
      origin: "accessibility_engine",
      severity: axeSeverity(violation.impact),
      observation: `${violation.help} — ${nodes.length} element${nodes.length === 1 ? "" : "s"} affected.`,
      expected: `Automated axe rule "${violation.id}" reports no violations for this capture.`,
      suggestedFix: `Resolve the reported condition (${truncate(violation.description, 200)}). Rule reference: ${violation.helpUrl}`,
      confidence: 0.85,
      verified: true,
      selector: example?.selector,
      bbox: unionBox(boxes),
      evidence: [
        {
          kind: "axe",
          summary: `${violation.id} (impact: ${violation.impact}) on ${nodes.length} element(s)`,
          selector: example?.selector,
          bbox: unionBox(boxes),
          detail: {
            helpUrl: violation.helpUrl,
            tags: violation.tags,
            failures: nodes.slice(0, 5).map((node) => ({
              selector: node.selector,
              html: truncate(node.html, 200),
              failureSummary: truncate(node.failureSummary, 300),
            })),
          },
        },
      ],
      metric: { kind: "count", value: nodes.length },
    });
  }

  if (axe.incompleteCount > 0) {
    findings.push({
      ruleId: "axe:incomplete",
      category: "accessibility",
      origin: "accessibility_engine",
      severity: "info",
      observation: `${axe.incompleteCount} automated accessibility check(s) could not be decided automatically.`,
      expected: "Undecided automated checks are reviewed manually.",
      suggestedFix:
        "Review the listed incomplete checks manually; automated tooling cannot decide them reliably.",
      confidence: 0.3,
      verified: false,
      evidence: [
        {
          kind: "axe",
          summary: `${axe.incompleteCount} incomplete check(s)`,
          detail: { tags: axe.tags },
        },
      ],
      metric: { kind: "count", value: axe.incompleteCount },
    });
  }

  return findings;
}

/** Rule ids that already report missing accessible names. */
export const AXE_NAME_RULES = new Set([
  "button-name",
  "link-name",
  "input-button-name",
  "label",
  "aria-command-name",
  "aria-toggle-field-name",
]);
