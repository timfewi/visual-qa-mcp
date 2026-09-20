import type { VisualQaConfig } from "../../config/schema.js";
import type {
  Artifact,
  BoundingBox,
  Capture,
  Category,
  EvidenceItem,
  FindingMetric,
  Origin,
  Severity,
} from "../schema.js";

export interface RawFinding {
  readonly ruleId: string;
  readonly category: Category;
  readonly origin: Origin;
  readonly severity: Severity;
  readonly observation: string;
  readonly expected: string;
  readonly suggestedFix: string;
  readonly confidence: number;
  readonly verified: boolean;
  readonly selector?: string | undefined;
  readonly bbox?: BoundingBox | undefined;
  readonly evidence: readonly EvidenceItem[];
  readonly metric?: FindingMetric | undefined;
}

export interface RuleContext {
  readonly runId: string;
  readonly capture: Capture;
  readonly rules: VisualQaConfig["rules"];
  readonly compare: VisualQaConfig["compare"];
  /** Look up a persisted artifact id for a screenshot kind. */
  readonly artifactFor: (kind: Artifact["kind"]) => Artifact | undefined;
}

export function unionBox(boxes: readonly BoundingBox[]): BoundingBox | undefined {
  if (boxes.length === 0) {
    return undefined;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let maxY = 0;
  for (const box of boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function truncate(value: string, max = 200): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
