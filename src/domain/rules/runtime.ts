import type { RuntimeEvent } from "../schema.js";
import type { RawFinding, RuleContext } from "./types.js";

const IGNORED_REQUEST_FAILURES = [
  "net::ERR_ABORTED",
  "net::ERR_NETWORK_CHANGED",
  "net::ERR_CONTENT_LENGTH_MISMATCH",
];

/** Console errors, page errors and failed requests. */
export function runtimeRule(context: RuleContext): RawFinding[] {
  const findings: RawFinding[] = [];
  const events = context.capture.runtime;

  const pageErrors = dedupe(events.filter((event) => event.kind === "page_error"));
  if (pageErrors.length > 0) {
    findings.push({
      ruleId: "runtime:page-error",
      category: "runtime_error",
      origin: "deterministic_rule",
      severity: "high",
      observation: `Uncaught page error: ${truncate(pageErrors[0]?.message ?? "", 240)}`,
      expected: "The page runs without uncaught exceptions during load and interaction.",
      suggestedFix:
        "Reproduce the exception with the emitted stack trace, fix the failing code path and re-run the capture.",
      confidence: 1,
      verified: true,
      evidence: [
        {
          kind: "runtime",
          summary: `${pageErrors.length} uncaught page error(s)`,
          detail: { messages: pageErrors.slice(0, 5).map((event) => truncate(event.message, 300)) },
        },
      ],
      metric: { kind: "count", value: pageErrors.length },
    });
  }

  const consoleErrors = dedupe(events.filter((event) => event.kind === "console_error"));
  if (consoleErrors.length > 0) {
    findings.push({
      ruleId: "runtime:console-error",
      category: "runtime_error",
      origin: "deterministic_rule",
      severity: "medium",
      observation: `Console error(s): ${truncate(consoleErrors[0]?.message ?? "", 240)}`,
      expected: "The page logs no console errors during load and interaction.",
      suggestedFix:
        "Trace each message to its source and remove the error, or document why it is expected.",
      confidence: 1,
      verified: true,
      evidence: [
        {
          kind: "runtime",
          summary: `${consoleErrors.length} console error(s)`,
          detail: {
            messages: consoleErrors.slice(0, 5).map((event) => truncate(event.message, 300)),
          },
        },
      ],
      metric: { kind: "count", value: consoleErrors.length },
    });
  }

  const failedRequests = dedupe(
    events.filter(
      (event) =>
        event.kind === "request_failed" &&
        !IGNORED_REQUEST_FAILURES.some((token) => event.message.includes(token)),
    ),
  );
  if (failedRequests.length > 0) {
    findings.push({
      ruleId: "runtime:request-failed",
      category: "runtime_error",
      origin: "deterministic_rule",
      severity: "medium",
      observation: `Failed network request: ${truncate(failedRequests[0]?.url ?? failedRequests[0]?.message ?? "", 240)}`,
      expected: "Every subresource the page requests resolves successfully.",
      suggestedFix: "Fix or remove the broken request; verify the URL and the server response.",
      confidence: 1,
      verified: true,
      evidence: [
        {
          kind: "runtime",
          summary: `${failedRequests.length} failed request(s)`,
          detail: {
            requests: failedRequests
              .slice(0, 5)
              .map((event) => `${event.url ?? "(unknown)"} — ${truncate(event.message, 160)}`),
          },
        },
      ],
      metric: { kind: "count", value: failedRequests.length },
    });
  }

  const responseErrors = dedupe(events.filter((event) => event.kind === "response_error"));
  if (responseErrors.length > 0) {
    findings.push({
      ruleId: "runtime:response-error",
      category: "runtime_error",
      origin: "deterministic_rule",
      severity: "medium",
      observation: `HTTP ${responseErrors[0]?.status ?? "?"} response for ${truncate(responseErrors[0]?.url ?? "", 200)}`,
      expected: "No subresource responds with a 4xx or 5xx status.",
      suggestedFix: "Fix the failing endpoint or stop requesting it.",
      confidence: 1,
      verified: true,
      evidence: [
        {
          kind: "runtime",
          summary: `${responseErrors.length} error response(s)`,
          detail: {
            responses: responseErrors
              .slice(0, 5)
              .map((event) => `${event.status ?? "?"} ${event.url ?? "(unknown)"}`),
          },
        },
      ],
      metric: { kind: "count", value: responseErrors.length },
    });
  }

  return findings;
}

function dedupe(events: readonly RuntimeEvent[]): RuntimeEvent[] {
  const seen = new Set<string>();
  const result: RuntimeEvent[] = [];
  for (const event of events) {
    const key = `${event.message}\u0000${event.url ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(event);
  }
  return result;
}

function truncate(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}
