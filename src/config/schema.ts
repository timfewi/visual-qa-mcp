import { z } from "zod";

/**
 * Configuration schema for the visual QA server.
 *
 * Everything an inspected project needs (preview command, routes, scenarios,
 * viewports, security policy, redaction) is expressed here so that no
 * application-specific logic has to live inside this server.
 */

export const viewportSchema = z
  .strictObject({
    name: z.string().min(1),
    width: z.int().positive().max(7680),
    height: z.int().positive().max(4320),
    deviceScaleFactor: z.number().positive().max(4).default(1),
    isMobile: z.boolean().default(false),
    hasTouch: z.boolean().default(false),
  })
  .describe("A named viewport in the capture matrix.");

export type Viewport = z.infer<typeof viewportSchema>;

/** Default capture matrix required by the implementation brief. */
export const DEFAULT_VIEWPORTS: readonly Viewport[] = [
  viewportSchema.parse({
    name: "mobile",
    width: 375,
    height: 812,
    isMobile: true,
    hasTouch: true,
  }),
  viewportSchema.parse({
    name: "tablet",
    width: 768,
    height: 1024,
    isMobile: true,
    hasTouch: true,
  }),
  viewportSchema.parse({ name: "desktop", width: 1440, height: 900 }),
];

const selectorSchema = z.string().min(1);

export const scenarioActionSchema = z
  .discriminatedUnion("type", [
    z.strictObject({ type: z.literal("click"), selector: selectorSchema }),
    z.strictObject({
      type: z.literal("fill"),
      selector: selectorSchema,
      value: z.string(),
      redact: z.boolean().default(false),
    }),
    z.strictObject({
      type: z.literal("selectOption"),
      selector: selectorSchema,
      value: z.string(),
    }),
    z.strictObject({
      type: z.literal("press"),
      key: z.string().min(1),
      selector: selectorSchema.optional(),
    }),
    z.strictObject({ type: z.literal("hover"), selector: selectorSchema }),
    z.strictObject({ type: z.literal("check"), selector: selectorSchema }),
    z.strictObject({ type: z.literal("uncheck"), selector: selectorSchema }),
    z.strictObject({
      type: z.literal("waitForSelector"),
      selector: selectorSchema,
      state: z.enum(["attached", "detached", "visible", "hidden"]).default("visible"),
    }),
    z.strictObject({ type: z.literal("waitForTimeout"), ms: z.int().positive().max(30_000) }),
    z.strictObject({ type: z.literal("scrollTo"), selector: selectorSchema }),
  ])
  .describe("A declarative interaction that does not embed application-specific logic.");

export type ScenarioAction = z.infer<typeof scenarioActionSchema>;

export const scenarioSchema = z
  .strictObject({
    name: z.string().min(1),
    description: z.string().optional(),
    actions: z.array(scenarioActionSchema).default([]),
    /** Path to a Playwright storage state file used for authenticated states. */
    storageState: z.string().min(1).optional(),
    /** Additional readiness condition on top of the global load/stable-layout wait. */
    readySelector: selectorSchema.optional(),
    /** Extra settle time applied after actions, before the stability check. */
    settleMs: z.int().nonnegative().max(30_000).default(0),
  })
  .describe("A named capture point such as an open dialog, tab or validation state.");

export type Scenario = z.infer<typeof scenarioSchema>;

export const routeSchema = z
  .strictObject({
    /** A path resolved against `baseUrl`, or an absolute http(s) URL. */
    path: z.string().min(1),
    name: z.string().optional(),
    scenarios: z.array(scenarioSchema).default([]),
  })
  .describe("A route or state group to inspect.");

export type Route = z.infer<typeof routeSchema>;

export const previewCommandSchema = z
  .strictObject({
    command: z.array(z.string().min(1)).min(1),
    /** URL that must become reachable before capture starts. */
    url: z.url(),
    cwd: z.string().min(1).optional(),
    env: z.record(z.string(), z.string()).optional(),
    readyTimeoutMs: z.int().positive().max(600_000).default(60_000),
    terminateTimeoutMs: z.int().positive().max(60_000).default(5_000),
  })
  .describe("The inspected project's own preview command; never rewritten by this tool.");

export const securitySchema = z.strictObject({
  /** Opt-in for anything that is not a loopback address. */
  allowRemote: z.boolean().default(false),
  /** Explicit hostname allowlist, required for remote navigation. */
  allowedHosts: z.array(z.string().min(1)).default([]),
  /** Block page requests that leave the allowed origin set. */
  blockRequestsToOtherOrigins: z.boolean().default(true),
  /** Refuse cloud metadata and link-local endpoints in every mode. */
  blockLinkLocal: z.boolean().default(true),
});

export const redactionSchema = z.strictObject({
  /** Selectors whose text content is replaced before persistence or review. */
  selectors: z.array(z.string().min(1)).default([]),
  /** Regular expressions (JavaScript source) applied to captured strings. */
  patterns: z.array(z.string().min(1)).default([]),
  replacement: z.string().default("[redacted]"),
});

export const browserSchema = z.strictObject({
  headless: z.boolean().default(true),
  /** Explicit browser binary; defaults to Playwright resolution plus PLAYWRIGHT_BROWSERS_PATH. */
  executablePath: z.string().min(1).optional(),
  channel: z.enum(["chromium", "chrome", "msedge"]).optional(),
  locale: z.string().min(1).default("en-US"),
  timezoneId: z.string().min(1).default("UTC"),
  colorScheme: z.enum(["light", "dark"]).default("light"),
  reducedMotion: z.enum(["reduce", "no-preference"]).default("reduce"),
  launchTimeoutMs: z.int().positive().max(600_000).default(30_000),
  navigationTimeoutMs: z.int().positive().max(600_000).default(30_000),
  /** Consecutive identical frames required before a capture is accepted. */
  stabilityAttempts: z.int().positive().max(10).default(3),
  stabilityDelayMs: z.int().nonnegative().max(5_000).default(150),
});

export const visionSchema = z.strictObject({
  adapter: z.enum(["none", "fake"]).default("none"),
  designBrief: z.string().optional(),
  /**
   * Screenshots and page content are only handed to an adapter when this is
   * explicitly true. The core server never needs it.
   */
  allowScreenshots: z.boolean().default(false),
});

export const axeSchema = z.strictObject({
  enabled: z.boolean().default(true),
  tags: z
    .array(z.string().min(1))
    .default(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]),
  maxViolations: z.int().positive().max(2_000).default(200),
});

export const compareSchema = z.strictObject({
  /** pixelmatch matching threshold. */
  threshold: z.number().min(0).max(1).default(0.1),
  /** A diff ratio above this value is reported as a regression finding. */
  maxDiffRatio: z.number().min(0).max(1).default(0.001),
  /** Minimum diff pixels before a mismatch region is reported. */
  regionMinPixels: z.int().positive().max(100_000).default(24),
});

export const captureSchema = z.strictObject({
  fullPage: z.boolean().default(true),
  viewportScreenshot: z.boolean().default(true),
  semantic: z.boolean().default(true),
  ariaSnapshot: z.boolean().default(true),
  axe: z.boolean().default(true),
  /** Upper bound on elements in the semantic snapshot (context budget). */
  maxSemanticElements: z.int().positive().max(2_000).default(400),
  maxTextLength: z.int().positive().max(2_000).default(160),
});

export const storageSchema = z.strictObject({
  root: z.string().min(1).default(".visual-qa"),
  keepRuns: z.int().positive().max(1_000).default(20),
});

export const rulesSchema = z.strictObject({
  runtimeErrors: z.boolean().default(true),
  accessibility: z.boolean().default(true),
  contrast: z.boolean().default(true),
  responsiveOverflow: z.boolean().default(true),
  typography: z.boolean().default(true),
  imagery: z.boolean().default(true),
  affordance: z.boolean().default(true),
  headingStructure: z.boolean().default(true),
  overlappingText: z.boolean().default(true),
  minFontSizePx: z.number().positive().max(32).default(12),
  minTapTargetPx: z.number().positive().max(96).default(24),
  maxSemanticElementsForOverlap: z.int().positive().max(1_000).default(250),
});

export const visualQaConfigSchema = z
  .strictObject({
    version: z.literal(1).default(1),
    name: z.string().min(1).default("visual-qa"),
    baseUrl: z.url().optional(),
    preview: previewCommandSchema.optional(),
    routes: z.array(routeSchema).min(1),
    viewports: z
      .array(viewportSchema)
      .min(1)
      .default(() => [...DEFAULT_VIEWPORTS]),
    security: securitySchema.default(() => securitySchema.parse({})),
    redaction: redactionSchema.default(() => redactionSchema.parse({})),
    browser: browserSchema.default(() => browserSchema.parse({})),
    vision: visionSchema.default(() => visionSchema.parse({})),
    axe: axeSchema.default(() => axeSchema.parse({})),
    compare: compareSchema.default(() => compareSchema.parse({})),
    capture: captureSchema.default(() => captureSchema.parse({})),
    storage: storageSchema.default(() => storageSchema.parse({})),
    rules: rulesSchema.default(() => rulesSchema.parse({})),
  })
  .superRefine((config, ctx) => {
    if (!config.baseUrl && !config.preview) {
      ctx.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "Either baseUrl or preview.command must be configured.",
      });
    }
    if (config.security.allowRemote && config.security.allowedHosts.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["security", "allowedHosts"],
        message: "allowRemote requires at least one explicit entry in allowedHosts.",
      });
    }
    const viewportNames = new Set<string>();
    for (const [index, viewport] of config.viewports.entries()) {
      if (viewportNames.has(viewport.name)) {
        ctx.addIssue({
          code: "custom",
          path: ["viewports", index, "name"],
          message: `Duplicate viewport name: ${viewport.name}`,
        });
      }
      viewportNames.add(viewport.name);
    }
    const scenarioNames = new Set<string>();
    for (const [routeIndex, route] of config.routes.entries()) {
      scenarioNames.clear();
      for (const [scenarioIndex, scenario] of route.scenarios.entries()) {
        if (scenarioNames.has(scenario.name)) {
          ctx.addIssue({
            code: "custom",
            path: ["routes", routeIndex, "scenarios", scenarioIndex, "name"],
            message: `Duplicate scenario name on route ${route.path}: ${scenario.name}`,
          });
        }
        scenarioNames.add(scenario.name);
      }
    }
  })
  .describe("Complete configuration for one visual QA target.");

export type VisualQaConfig = z.infer<typeof visualQaConfigSchema>;
export type VisualQaConfigInput = z.input<typeof visualQaConfigSchema>;
