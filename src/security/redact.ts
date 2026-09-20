import { ConfigError } from "../config/load.js";

export interface RedactionConfigInput {
  readonly selectors: readonly string[];
  readonly patterns: readonly string[];
  readonly replacement: string;
}

export interface CompiledRedaction {
  readonly selectors: readonly string[];
  readonly patterns: readonly RegExp[];
  readonly replacement: string;
}

export const EMPTY_REDACTION: CompiledRedaction = {
  selectors: [],
  patterns: [],
  replacement: "[redacted]",
};

/** Minimal structural view of a Playwright page, so this module stays transport free. */
export interface InPageEvaluation {
  evaluate<A, R>(pageFunction: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
}

/** Compile configured regular expressions once, failing loudly on typos. */
export function compileRedaction(input: RedactionConfigInput): CompiledRedaction {
  const patterns: RegExp[] = [];
  const issues: string[] = [];
  for (const source of input.patterns) {
    try {
      patterns.push(new RegExp(source, "g"));
    } catch (error) {
      issues.push(`${source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (issues.length > 0) {
    throw new ConfigError("Invalid redaction.patterns entries", issues);
  }
  return {
    selectors: [...input.selectors],
    patterns,
    replacement: input.replacement,
  };
}

export function redactString(value: string, redaction: CompiledRedaction): string {
  let result = value;
  for (const pattern of redaction.patterns) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, redaction.replacement);
  }
  return result;
}

/** Recursively redact every string in a JSON-like value. */
export function redactDeep<T>(value: T, redaction: CompiledRedaction): T {
  return walk(value, redaction) as T;
}

function walk(value: unknown, redaction: CompiledRedaction): unknown {
  if (typeof value === "string") {
    return redactString(value, redaction);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => walk(entry, redaction));
  }
  if (value !== null && typeof value === "object") {
    // Binary payloads must never be interpreted as text.
    if (value instanceof Uint8Array || value instanceof Date) {
      return value;
    }
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = walk(entry, redaction);
    }
    return result;
  }
  return value;
}

/**
 * Replace the content of configured selectors in the live page before any
 * evidence is collected, so configured secrets never reach a collector.
 */
export async function redactPageDom(
  page: InPageEvaluation,
  redaction: CompiledRedaction,
): Promise<number> {
  if (redaction.selectors.length === 0) {
    return 0;
  }
  const selectors = [...redaction.selectors];
  const replacement = redaction.replacement;
  return page.evaluate(
    (arg) => {
      let count = 0;
      for (const selector of arg.selectors) {
        let nodes: NodeListOf<Element>;
        try {
          nodes = document.querySelectorAll(selector);
        } catch {
          continue;
        }
        for (const node of Array.from(nodes)) {
          if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
            node.value = arg.replacement;
            count += 1;
            continue;
          }
          node.textContent = arg.replacement;
          count += 1;
        }
      }
      return count;
    },
    { selectors, replacement },
  );
}
