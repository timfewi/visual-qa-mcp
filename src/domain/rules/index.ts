import type { VisualQaConfig } from "../../config/schema.js";
import { accessibilityRules } from "./accessibility.js";
import {
  affordanceRules,
  headingStructureRules,
  imageryRules,
  overlappingTextRules,
  regressionRules,
  responsiveOverflowRules,
  typographyRules,
} from "./deterministic.js";
import { runtimeRule } from "./runtime.js";
import type { RawFinding, RuleContext } from "./types.js";

export type { RawFinding, RuleContext } from "./types.js";

/**
 * Run every enabled deterministic rule for one capture.
 *
 * Deterministic rules and engine-backed rules stay separate from model
 * judgement; each returned finding records its own origin.
 */
export function runRules(context: RuleContext): RawFinding[] {
  const rules: VisualQaConfig["rules"] = context.rules;
  const findings: RawFinding[] = [];

  if (rules.runtimeErrors) {
    findings.push(...runtimeRule(context));
  }
  if (rules.accessibility || rules.contrast) {
    findings.push(...accessibilityRules(context));
  }
  if (rules.responsiveOverflow) {
    findings.push(...responsiveOverflowRules(context));
  }
  if (rules.typography) {
    findings.push(...typographyRules(context));
  }
  if (rules.imagery) {
    findings.push(...imageryRules(context));
  }
  if (rules.affordance) {
    findings.push(...affordanceRules(context));
  }
  if (rules.headingStructure) {
    findings.push(...headingStructureRules(context));
  }
  if (rules.overlappingText) {
    findings.push(...overlappingTextRules(context));
  }
  findings.push(...regressionRules(context));

  return findings;
}
