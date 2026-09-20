import type { FindingMetric, RecheckStatus } from "./schema.js";

export interface RecheckComparison {
  /** Whether the rule still reports the condition on the rechecked capture. */
  readonly present: boolean;
  readonly previousStatus: RecheckStatus;
  readonly previousMetric?: FindingMetric | undefined;
  readonly currentMetric?: FindingMetric | undefined;
  /** True when the recheck capture itself failed, making the result inconclusive. */
  readonly captureFailed: boolean;
}

export interface RecheckOutcome {
  readonly status: RecheckStatus;
  readonly note: string;
}

/** Relative tolerance applied to ratio metrics before a change is reported. */
export const RATIO_TOLERANCE = 0.2;
/** Absolute tolerance applied to ratio metrics. */
export const RATIO_ABSOLUTE_TOLERANCE = 0.001;

/**
 * Classify a finding after a targeted recheck.
 *
 * Pure and deterministic so regression coverage is cheap: absence of the
 * condition is `fixed`, a shrinking metric is `improved`, a growing one is
 * `regressed`, and anything inconclusive is `needs_review`.
 */
export function classifyRecheck(comparison: RecheckComparison): RecheckOutcome {
  if (comparison.captureFailed) {
    return {
      status: "needs_review",
      note: "Recheck capture failed; the previous state could not be verified.",
    };
  }

  if (!comparison.present) {
    return {
      status: "fixed",
      note: "The condition is no longer detected on the rechecked capture.",
    };
  }

  // A condition that comes back after it was reported as fixed is a regression,
  // regardless of how its metric compares to the previous run.
  if (comparison.previousStatus === "fixed") {
    return {
      status: "regressed",
      note: "The condition reappeared after it had been reported as fixed.",
    };
  }

  const previous = comparison.previousMetric;
  const current = comparison.currentMetric;

  if (previous === undefined || current === undefined) {
    return {
      status: "unchanged",
      note: "The condition is still detected without a comparable metric.",
    };
  }

  const delta = current.value - previous.value;

  if (previous.kind === "count" || (previous.kind === "boolean" && current.kind === "boolean")) {
    if (current.value < previous.value) {
      return {
        status: "improved",
        note: `Metric decreased from ${previous.value} to ${current.value}.`,
      };
    }
    if (current.value > previous.value) {
      return {
        status: "regressed",
        note: `Metric increased from ${previous.value} to ${current.value}.`,
      };
    }
    return { status: "unchanged", note: `Metric unchanged at ${current.value}.` };
  }

  const tolerance = Math.max(Math.abs(previous.value) * RATIO_TOLERANCE, RATIO_ABSOLUTE_TOLERANCE);
  if (Math.abs(delta) <= tolerance) {
    return {
      status: "unchanged",
      note: `Ratio changed from ${format(previous.value)} to ${format(current.value)} within tolerance.`,
    };
  }
  if (delta < 0) {
    return {
      status: "improved",
      note: `Ratio decreased from ${format(previous.value)} to ${format(current.value)}.`,
    };
  }
  return {
    status: "regressed",
    note: `Ratio increased from ${format(previous.value)} to ${format(current.value)}.`,
  };
}

function format(value: number): string {
  return value.toFixed(4);
}
