import { createHash } from "node:crypto";

import type { Page } from "playwright";

import type { Logger } from "../logging.js";

export interface StabilityOptions {
  readonly attempts: number;
  readonly delayMs: number;
}

export interface StabilityResult {
  readonly attempts: number;
  readonly stable: boolean;
  readonly frameHash: string;
}

/**
 * Wait for a stable frame.
 *
 * Two consecutive viewport frames must be byte-identical before a capture is
 * accepted; this is what prevents font loading, layout shifts or late
 * animations from producing misleading evidence.
 */
export async function waitForStableFrame(
  page: Page,
  options: StabilityOptions,
  logger: Logger,
): Promise<StabilityResult> {
  let previousHash = "";
  let attempts = 0;

  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    attempts = attempt + 1;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    const buffer = await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" });
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (previousHash !== "" && hash === previousHash) {
      return { attempts, stable: true, frameHash: hash };
    }
    previousHash = hash;
    if (attempt < options.attempts - 1 && options.delayMs > 0) {
      await page.waitForTimeout(options.delayMs);
    }
  }

  logger.debug("frame did not stabilise", { attempts });
  return { attempts, stable: false, frameHash: previousHash };
}

/** Wait for fonts, load state and any configured readiness selector. */
export async function waitForReadiness(
  page: Page,
  options: { readySelector?: string | undefined; settleMs: number },
): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
  if (options.readySelector !== undefined) {
    await page.waitForSelector(options.readySelector, { state: "visible" });
  }
  if (options.settleMs > 0) {
    await page.waitForTimeout(options.settleMs);
  }
}
