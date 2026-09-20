import { chromium } from "playwright";

export interface BrowserProbe {
  readonly available: boolean;
  readonly message: string;
}

/**
 * Check whether a usable browser is present.
 *
 * Browsers come from the environment (`PLAYWRIGHT_BROWSERS_PATH` or an
 * explicit path), never from an implicit download. Browser-backed tests are
 * skipped with an explicit reason when no browser is available, because a
 * missing tool is an environment blocker rather than a code failure.
 */
export async function probeBrowser(): Promise<BrowserProbe> {
  if (process.env.VISUAL_QA_SKIP_BROWSER_TESTS === "1") {
    return { available: false, message: "VISUAL_QA_SKIP_BROWSER_TESTS=1 is set" };
  }
  try {
    const browser = await chromium.launch({ headless: true });
    const version = browser.version();
    await browser.close();
    return { available: true, message: `chromium ${version}` };
  } catch (error) {
    return {
      available: false,
      message: `no usable Chromium build: ${
        error instanceof Error ? (error.message.split("\n")[0] ?? error.message) : String(error)
      }`,
    };
  }
}

export const browserProbe: BrowserProbe = await probeBrowser();

if (!browserProbe.available) {
  process.stderr.write(
    `[visual-qa:tests] skipping browser-backed tests — ${browserProbe.message}\n` +
      "[visual-qa:tests] provide a browser via PLAYWRIGHT_BROWSERS_PATH (nix develop) to run them.\n",
  );
}
