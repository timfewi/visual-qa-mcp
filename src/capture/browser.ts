import { chromium, type Browser, type BrowserContext } from "playwright";
import axeCore from "axe-core";

import type { VisualQaConfig, Viewport } from "../config/schema.js";
import type { Logger } from "../logging.js";
import type { SecurityPolicy } from "../security/url-guard.js";

/**
 * Deterministic rendering defaults.
 *
 * Font rendering and colour profiles are pinned so that a baseline captured on
 * one machine stays comparable on another machine with the same browser build.
 */
const DETERMINISTIC_LAUNCH_ARGS = [
  "--force-color-profile=srgb",
  "--font-render-hinting=none",
  "--disable-lcd-text",
  "--hide-scrollbars",
  "--disable-dev-shm-usage",
  "--disable-features=Translate,BackForwardCache",
  "--no-first-run",
  "--no-default-browser-check",
];

export interface BrowserLaunchResult {
  readonly browser: Browser;
  /** Human-readable description of the resolved browser for the run manifest. */
  readonly resolvedFrom: string;
}

/**
 * Launch Chromium.
 *
 * Never installs or downloads a browser: `PLAYWRIGHT_BROWSERS_PATH` (or an
 * explicit executable path) decides which build is used, which keeps the
 * NixOS-first environment authoritative.
 */
export async function launchBrowser(
  config: VisualQaConfig,
  logger: Logger,
): Promise<BrowserLaunchResult> {
  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const executablePath = config.browser.executablePath;
  const launchOptions: Parameters<typeof chromium.launch>[0] = {
    headless: config.browser.headless,
    args: [...DETERMINISTIC_LAUNCH_ARGS],
    timeout: config.browser.launchTimeoutMs,
    ...(executablePath !== undefined ? { executablePath } : {}),
    ...(config.browser.channel !== undefined ? { channel: config.browser.channel } : {}),
  };

  const browser = await chromium.launch(launchOptions);
  const resolvedFrom =
    executablePath !== undefined
      ? `config:${executablePath}`
      : browsersPath !== undefined
        ? `PLAYWRIGHT_BROWSERS_PATH:${browsersPath}`
        : "playwright-default";
  logger.debug("browser launched", { version: browser.version(), resolvedFrom });
  return { browser, resolvedFrom };
}

export interface ContextHandle {
  readonly context: BrowserContext;
  close(): Promise<void>;
}

/** Create a browser context that matches one viewport plus the security policy. */
export async function createContext(
  browser: Browser,
  viewport: Viewport,
  config: VisualQaConfig,
  policy: SecurityPolicy,
  allowedOrigins: ReadonlySet<string>,
  logger: Logger,
  storageStatePath: string | undefined,
): Promise<ContextHandle> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    locale: config.browser.locale,
    timezoneId: config.browser.timezoneId,
    colorScheme: config.browser.colorScheme,
    reducedMotion: config.browser.reducedMotion,
    // The inspected page keeps its own Content-Security-Policy: the collector
    // and axe-core are injected through the context (CDP init scripts), which a
    // page's `script-src` policy does not block.
    bypassCSP: false,
    // Service workers make captures non-deterministic across runs.
    serviceWorkers: "block",
    ...(storageStatePath !== undefined ? { storageState: storageStatePath } : {}),
  });
  context.setDefaultTimeout(config.browser.navigationTimeoutMs);
  context.setDefaultNavigationTimeout(config.browser.navigationTimeoutMs);

  if (policy.blockRequestsToOtherOrigins) {
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (
        requestUrl.startsWith("data:") ||
        requestUrl.startsWith("blob:") ||
        requestUrl.startsWith("about:")
      ) {
        await route.continue();
        return;
      }
      let origin: string;
      try {
        origin = new URL(requestUrl).origin;
      } catch {
        await route.abort("blockedbyclient");
        return;
      }
      if (allowedOrigins.has(origin)) {
        await route.continue();
        return;
      }
      logger.debug("blocked out-of-origin request", { url: requestUrl });
      await route.abort("blockedbyclient");
    });
  }

  await context.addInitScript({
    content: `
      (function () {
        var style = document.createElement('style');
        style.setAttribute('data-visual-qa', 'animation-reset');
        style.textContent = '*,*::before,*::after{animation-duration:0s !important;animation-delay:0s !important;animation-iteration-count:1 !important;transition-duration:0s !important;transition-delay:0s !important;caret-color:transparent !important}html{scroll-behavior:auto !important}';
        var attach = function () {
          if (document.head && !document.head.querySelector('style[data-visual-qa="animation-reset"]')) {
            document.head.appendChild(style);
          }
        };
        if (document.head) { attach(); } else {
          document.addEventListener('DOMContentLoaded', attach, { once: true });
        }
      })();
    `,
  });

  // axe-core is injected through the context rather than page.addScriptTag:
  // injecting inline script into the page is subject to its content security
  // policy, which makes every capture fail on sites that send `script-src`.
  if (config.axe.enabled) {
    await context.addInitScript({ content: axeCore.source });
  }

  return {
    context,
    close: async () => {
      await context.close();
    },
  };
}
