import { stableFindingId } from "./ids.js";
import { type Finding, SEVERITY_ORDER, type Severity } from "./schema.js";
import type { RawFinding } from "./rules/types.js";

export interface FindingIdentityInput {
  readonly runId: string;
  readonly route: string;
  readonly scenario: string;
  readonly viewport: string;
  readonly url: string;
  readonly detectedAt: string;
}

/** Turn raw rule results into persisted findings with stable IDs. */
export function normalizeFindings(
  raw: readonly RawFinding[],
  identity: FindingIdentityInput,
): Finding[] {
  const byId = new Map<string, Finding>();
  for (const item of raw) {
    const id = stableFindingId({
      route: identity.route,
      scenario: identity.scenario,
      viewport: identity.viewport,
      category: item.category,
      origin: item.origin,
      ruleId: item.ruleId,
    });
    if (byId.has(id)) {
      continue;
    }
    const finding: Finding = {
      id,
      runId: identity.runId,
      route: identity.route,
      scenario: identity.scenario,
      viewport: identity.viewport,
      url: identity.url,
      severity: item.severity,
      category: item.category,
      origin: item.origin,
      ruleId: item.ruleId,
      observation: item.observation,
      expected: item.expected,
      suggestedFix: item.suggestedFix,
      confidence: item.confidence,
      evidence: [...item.evidence],
      verified: item.verified,
      status: "open",
      history: [
        { runId: identity.runId, status: "open", at: identity.detectedAt, note: "detected" },
      ],
      detectedAt: identity.detectedAt,
      ...(item.selector !== undefined ? { selector: item.selector } : {}),
      ...(item.bbox !== undefined ? { bbox: item.bbox } : {}),
      ...(item.metric !== undefined ? { metric: item.metric } : {}),
    };
    byId.set(id, finding);
  }
  return sortFindings([...byId.values()]);
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const severity = SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity);
    if (severity !== 0) {
      return severity;
    }
    const route = left.route.localeCompare(right.route);
    if (route !== 0) {
      return route;
    }
    const viewport = left.viewport.localeCompare(right.viewport);
    if (viewport !== 0) {
      return viewport;
    }
    return left.ruleId.localeCompare(right.ruleId);
  });
}

export function severityCounts(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

export function categoryCounts(findings: readonly Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const finding of findings) {
    counts[finding.category] = (counts[finding.category] ?? 0) + 1;
  }
  return counts;
}

export interface FindingFilter {
  readonly severities?: readonly Severity[] | undefined;
  readonly categories?: readonly string[] | undefined;
  readonly viewports?: readonly string[] | undefined;
  readonly routes?: readonly string[] | undefined;
  readonly ids?: readonly string[] | undefined;
}

export function filterFindings(
  findings: readonly Finding[],
  filter: FindingFilter | undefined,
): Finding[] {
  if (filter === undefined) {
    return [...findings];
  }
  return findings.filter((finding) => {
    if (filter.severities && !filter.severities.includes(finding.severity)) {
      return false;
    }
    if (filter.categories && !filter.categories.includes(finding.category)) {
      return false;
    }
    if (filter.viewports && !filter.viewports.includes(finding.viewport)) {
      return false;
    }
    if (filter.routes && !filter.routes.includes(finding.route)) {
      return false;
    }
    if (filter.ids && !filter.ids.includes(finding.id)) {
      return false;
    }
    return true;
  });
}
