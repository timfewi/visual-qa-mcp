import { createHash, randomUUID } from "node:crypto";

/** Stable, filesystem-safe slug for routes, scenarios and viewports. */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "root";
}

export interface FindingIdentity {
  readonly route: string;
  readonly scenario: string;
  readonly viewport: string;
  readonly category: string;
  readonly origin: string;
  readonly ruleId: string;
  /** Extra disambiguation for rules that emit more than one finding per rule id. */
  readonly key?: string | undefined;
}

/**
 * Stable finding ID.
 *
 * The identity deliberately excludes the run ID and any geometry: findings must
 * stay correlatable across runs for targeted rechecks to work, even when the
 * selector or bounding box of the offending element changes.
 */
export function stableFindingId(identity: FindingIdentity): string {
  const digest = createHash("sha256")
    .update(
      [
        identity.route,
        identity.scenario,
        identity.viewport,
        identity.category,
        identity.origin,
        identity.ruleId,
        identity.key ?? "",
      ].join("\u0000"),
    )
    .digest("hex")
    .slice(0, 20);
  return `fnd_${digest}`;
}

export function createRunId(now: Date = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `run_${stamp}_${randomUUID().slice(0, 8)}`;
}

export function createCaptureId(input: {
  readonly route: string;
  readonly scenario: string;
  readonly viewport: string;
}): string {
  return [slugify(input.route), slugify(input.scenario), slugify(input.viewport)].join("__");
}
