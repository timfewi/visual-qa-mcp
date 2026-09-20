import type { Browser, Page } from "playwright";

import type { Route, Scenario, Viewport, VisualQaConfig } from "../config/schema.js";
import { createCaptureId, slugify } from "../domain/ids.js";
import type { AxeResult, RuntimeEvent, SemanticSnapshot } from "../domain/schema.js";
import type { Logger } from "../logging.js";
import {
  redactDeep,
  redactPageDom,
  redactString,
  type CompiledRedaction,
} from "../security/redact.js";
import {
  assertNavigationAllowed,
  sanitizeUrlForStorage,
  type SecurityPolicy,
} from "../security/url-guard.js";
import { runAxe } from "./accessibility.js";
import { createContext } from "./browser.js";
import { RuntimeCollector } from "./runtime-collector.js";
import { collectSemanticSnapshot } from "./semantic.js";
import { waitForReadiness, waitForStableFrame } from "./stability.js";

const MAX_ARIA_CHARS = 20_000;

export interface CaptureRequest {
  readonly runId: string;
  readonly route: Route;
  readonly scenario: Scenario;
  readonly viewport: Viewport;
  readonly baseUrl: string;
  readonly storageStatePath: string | undefined;
}

export interface CaptureDependencies {
  readonly config: VisualQaConfig;
  readonly redaction: CompiledRedaction;
  readonly policy: SecurityPolicy;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly logger: Logger;
}

export interface CaptureBuffers {
  readonly viewport?: Buffer | undefined;
  readonly fullPage?: Buffer | undefined;
}

/** Everything a capture collects, before artifacts and diffs are attached. */
export interface CaptureEvidence {
  readonly id: string;
  readonly route: string;
  readonly routeName: string;
  readonly scenario: string;
  readonly viewport: string;
  readonly url: string;
  readonly status: "captured" | "failed";
  readonly error?: string | undefined;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly stability: { attempts: number; stable: boolean; frameHash: string };
  readonly runtime: RuntimeEvent[];
  readonly axe?: AxeResult | undefined;
  readonly aria?: string | undefined;
  readonly semantics?: SemanticSnapshot | undefined;
  readonly redaction: { selectorCount: number; patternCount: number; nodesRedacted: number };
  readonly buffers: CaptureBuffers;
}

/** Resolve a route path (or absolute URL) against the configured base URL. */
export function resolveRouteUrl(baseUrl: string, routePath: string): string {
  return new URL(routePath, baseUrl).toString();
}

export function captureIdentity(
  route: Route,
  scenario: Scenario,
  viewport: Viewport,
): {
  id: string;
  routeName: string;
} {
  return {
    id: createCaptureId({ route: route.path, scenario: scenario.name, viewport: viewport.name }),
    routeName: route.name ?? slugify(route.path),
  };
}

/**
 * Capture one route/state/viewport combination.
 *
 * Capture failures are reported as a failed capture instead of throwing, so a
 * partially broken target still produces usable evidence for the rest of the
 * matrix.
 */
export async function captureTarget(
  browser: Browser,
  request: CaptureRequest,
  dependencies: CaptureDependencies,
): Promise<CaptureEvidence> {
  const { config, redaction, policy, allowedOrigins, logger } = dependencies;
  const identity = captureIdentity(request.route, request.scenario, request.viewport);
  const startedAt = new Date();
  const base = {
    id: identity.id,
    route: request.route.path,
    routeName: identity.routeName,
    scenario: request.scenario.name,
    viewport: request.viewport.name,
    url: "",
    startedAt: startedAt.toISOString(),
    redaction: {
      selectorCount: redaction.selectors.length,
      patternCount: redaction.patterns.length,
      nodesRedacted: 0,
    },
    buffers: {} as CaptureBuffers,
    runtime: [] as RuntimeEvent[],
    stability: { attempts: 0, stable: false, frameHash: "" },
  };

  let url: string;
  try {
    url = resolveRouteUrl(request.baseUrl, request.route.path);
    assertNavigationAllowed(url, policy);
  } catch (error) {
    return {
      ...base,
      status: "failed",
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const safeUrl = sanitizeUrlForStorage(url);
  const collector = new RuntimeCollector(redaction);
  const handle = await createContext(
    browser,
    request.viewport,
    config,
    policy,
    allowedOrigins,
    logger,
    request.storageStatePath,
  );

  try {
    const page = await handle.context.newPage();
    collector.attach(page);

    await page.goto(url, { waitUntil: "load", timeout: config.browser.navigationTimeoutMs });

    const nodesRedacted = await redactPageDom(page, redaction);
    await runScenarioActions(page, request.scenario, logger);
    await waitForReadiness(page, {
      readySelector: request.scenario.readySelector,
      settleMs: request.scenario.settleMs,
    });

    const stability = await waitForStableFrame(
      page,
      {
        attempts: config.browser.stabilityAttempts,
        delayMs: config.browser.stabilityDelayMs,
      },
      logger,
    );

    const buffers: { viewport?: Buffer; fullPage?: Buffer } = {};
    if (config.capture.viewportScreenshot) {
      buffers.viewport = await page.screenshot({
        animations: "disabled",
        caret: "hide",
        scale: "css",
      });
    }
    if (config.capture.fullPage) {
      try {
        buffers.fullPage = await page.screenshot({
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          scale: "css",
        });
      } catch (error) {
        logger.warn("full-page screenshot failed; continuing with the viewport capture", {
          captureId: identity.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const semantics = config.capture.semantic
      ? redactDeep(
          await collectSemanticSnapshot(page, {
            maxElements: config.capture.maxSemanticElements,
            maxTextLength: config.capture.maxTextLength,
          }),
          redaction,
        )
      : undefined;

    let aria: string | undefined;
    if (config.capture.ariaSnapshot) {
      const snapshot = await page.locator("body").ariaSnapshot();
      aria = redactString(snapshot.slice(0, MAX_ARIA_CHARS), redaction);
    }

    const axe =
      config.capture.axe && config.axe.enabled
        ? await runAxe(page, { tags: config.axe.tags, maxViolations: config.axe.maxViolations })
        : undefined;

    const finishedAt = new Date();
    return {
      ...base,
      url: safeUrl,
      status: "captured",
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      stability,
      runtime: collector.snapshot(),
      redaction: { ...base.redaction, nodesRedacted },
      ...(axe !== undefined ? { axe } : {}),
      ...(aria !== undefined ? { aria } : {}),
      ...(semantics !== undefined ? { semantics } : {}),
      buffers,
    };
  } catch (error) {
    const finishedAt = new Date();
    logger.warn("capture failed", {
      captureId: identity.id,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      ...base,
      url: safeUrl,
      status: "failed",
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      runtime: collector.snapshot(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Execute the declarative scenario steps. */
export async function runScenarioActions(
  page: Page,
  scenario: Scenario,
  logger: Logger,
): Promise<void> {
  for (const action of scenario.actions) {
    switch (action.type) {
      case "click":
        await page.click(action.selector);
        break;
      case "fill":
        await page.fill(action.selector, action.value);
        break;
      case "selectOption":
        await page.selectOption(action.selector, action.value);
        break;
      case "press":
        if (action.selector !== undefined) {
          await page.press(action.selector, action.key);
        } else {
          await page.keyboard.press(action.key);
        }
        break;
      case "hover":
        await page.hover(action.selector);
        break;
      case "check":
        await page.check(action.selector);
        break;
      case "uncheck":
        await page.uncheck(action.selector);
        break;
      case "waitForSelector":
        await page.waitForSelector(action.selector, { state: action.state });
        break;
      case "waitForTimeout":
        await page.waitForTimeout(action.ms);
        break;
      case "scrollTo":
        await page.locator(action.selector).scrollIntoViewIfNeeded();
        break;
      default: {
        const exhaustive: never = action;
        logger.warn("unknown scenario action ignored", { action: String(exhaustive) });
      }
    }
  }
}
