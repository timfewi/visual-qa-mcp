import type { Page } from "playwright";

import { type AxeResult, axeResultSchema } from "../domain/schema.js";

export interface AxeOptions {
  readonly tags: readonly string[];
  readonly maxViolations: number;
}

/**
 * Run axe-core in the page and normalise the result.
 *
 * axe-core is reused as-is: this project composes an accessibility engine
 * instead of reimplementing one, and the findings are always presented as
 * automated evidence, never as complete WCAG validation.
 */
export async function runAxe(page: Page, options: AxeOptions): Promise<AxeResult> {
  const raw = await page.evaluate(
    async (opts) => {
      interface AxeNodeLike {
        target: unknown[];
        html?: string;
        failureSummary?: string;
      }
      interface AxeViolationLike {
        id: string;
        impact?: string | null;
        help: string;
        helpUrl: string;
        description: string;
        tags: string[];
        nodes: AxeNodeLike[];
      }
      interface AxeResultsLike {
        violations: AxeViolationLike[];
        incomplete: AxeViolationLike[];
        passes: unknown[];
        inapplicable: unknown[];
      }
      interface AxeWindow extends Window {
        axe?: {
          run: (
            context: Document,
            options: { runOnly: { type: string; values: string[] } },
          ) => Promise<AxeResultsLike>;
        };
      }

      const axe = (window as AxeWindow).axe;
      if (axe === undefined) {
        throw new Error("axe-core did not attach to the page");
      }
      const results = await axe.run(document, {
        runOnly: { type: "tag", values: [...opts.tags] },
      });

      const clip = (value: string | undefined, max: number): string => {
        if (value === undefined) {
          return "";
        }
        const collapsed = value.replace(/\s+/g, " ").trim();
        return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
      };

      const boxFor = (
        selectors: unknown[],
      ): { x: number; y: number; width: number; height: number } | undefined => {
        const first = selectors[0];
        if (typeof first !== "string" || first === "") {
          return undefined;
        }
        let element: Element | null = null;
        try {
          element = document.querySelector(first);
        } catch {
          return undefined;
        }
        if (element === null) {
          return undefined;
        }
        const rect = element.getBoundingClientRect();
        return {
          x: Math.round((rect.left + window.scrollX) * 10) / 10,
          y: Math.round((rect.top + window.scrollY) * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        };
      };

      const violations = results.violations.slice(0, opts.maxViolations).map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? "minor",
        help: violation.help,
        helpUrl: violation.helpUrl,
        description: violation.description,
        tags: violation.tags,
        nodes: violation.nodes.slice(0, 20).map((node) => {
          const box = boxFor(node.target);
          return {
            selector: clip(node.target.map((target) => String(target)).join(" >>> "), 300),
            html: clip(node.html, 300),
            failureSummary: clip(node.failureSummary, 400),
            ...(box !== undefined ? { bbox: box } : {}),
          };
        }),
      }));

      return {
        violations,
        incompleteCount: results.incomplete.length,
        passCount: results.passes.length,
        inapplicableCount: results.inapplicable.length,
        tags: [...opts.tags],
        truncated: results.violations.length > opts.maxViolations,
      };
    },
    { tags: [...options.tags], maxViolations: options.maxViolations },
  );

  return axeResultSchema.parse(raw);
}
