import type {
  Artifact,
  AxeResult,
  Capture,
  DiffResult,
  RuntimeEvent,
  SemanticNode,
  SemanticSnapshot,
} from "../../src/domain/schema.js";

export function semanticNode(overrides: Partial<SemanticNode> = {}): SemanticNode {
  return {
    index: 0,
    depth: 2,
    tag: "div",
    role: "generic",
    name: "",
    text: "",
    selector: "div",
    bbox: { x: 0, y: 0, width: 100, height: 20 },
    styles: {
      fontFamily: "Arial",
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 24,
      letterSpacing: 0,
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      textAlign: "start",
      position: "static",
      display: "block",
      overflowX: "visible",
      overflowY: "visible",
      opacity: 1,
      visibility: "visible",
      zIndex: "auto",
    },
    interactive: false,
    visible: true,
    hasAccessibleName: false,
    clipped: false,
    overflows: false,
    ...overrides,
  };
}

export function makeSemantics(
  nodes: readonly SemanticNode[],
  document: Partial<SemanticSnapshot["document"]> = {},
): SemanticSnapshot {
  return {
    capturedAt: "2026-01-01T00:00:00.000Z",
    document: {
      title: "Fixture",
      lang: "en",
      url: "http://localhost:3000/",
      scrollWidth: 375,
      scrollHeight: 900,
      clientWidth: 375,
      clientHeight: 812,
      hasHorizontalOverflow: false,
      hasVerticalOverflow: true,
      ...document,
    },
    counts: {
      elements: nodes.length,
      interactive: nodes.filter((node) => node.interactive).length,
      images: nodes.filter((node) => node.tag === "img").length,
      headings: nodes.filter((node) => /^h[1-6]$/.test(node.tag)).length,
      text: nodes.filter((node) => node.text !== "").length,
    },
    nodes: [...nodes],
    truncated: false,
  };
}

export interface CaptureOverrides {
  readonly id?: string;
  readonly route?: string;
  readonly scenario?: string;
  readonly viewport?: string;
  readonly url?: string;
  readonly status?: Capture["status"];
  readonly error?: string;
  readonly runtime?: RuntimeEvent[];
  readonly axe?: AxeResult;
  readonly semantics?: SemanticSnapshot;
  readonly diff?: DiffResult;
  readonly artifacts?: Artifact[];
  readonly aria?: string;
}

export function makeCapture(overrides: CaptureOverrides = {}): Capture {
  return {
    id: overrides.id ?? "root__default__mobile",
    route: overrides.route ?? "/",
    routeName: "root",
    scenario: overrides.scenario ?? "default",
    viewport: overrides.viewport ?? "mobile",
    url: overrides.url ?? "http://localhost:3000/",
    status: overrides.status ?? "captured",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    stability: { attempts: 2, stable: true, frameHash: "deadbeef" },
    runtime: overrides.runtime ?? [],
    artifacts: overrides.artifacts ?? [],
    redaction: { selectorCount: 0, patternCount: 0, nodesRedacted: 0 },
    ...(overrides.error !== undefined ? { error: overrides.error } : {}),
    ...(overrides.axe !== undefined ? { axe: overrides.axe } : {}),
    ...(overrides.semantics !== undefined ? { semantics: overrides.semantics } : {}),
    ...(overrides.diff !== undefined ? { diff: overrides.diff } : {}),
    ...(overrides.aria !== undefined ? { aria: overrides.aria } : {}),
  };
}

export function axeViolation(
  overrides: Partial<AxeResult["violations"][number]> = {},
): AxeResult["violations"][number] {
  return {
    id: "button-name",
    impact: "serious",
    help: "Buttons must have discernible text",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.13/button-name",
    description: "Ensure buttons have discernible text",
    tags: ["cat.name-role-value", "wcag2a"],
    nodes: [
      {
        selector: "body > button",
        html: "<button></button>",
        failureSummary: "Fix any of the following: Element does not have inner text",
        bbox: { x: 10, y: 10, width: 40, height: 40 },
      },
    ],
    ...overrides,
  };
}

export function makeAxe(overrides: Partial<AxeResult> = {}): AxeResult {
  return {
    violations: [axeViolation()],
    incompleteCount: 0,
    passCount: 10,
    inapplicableCount: 3,
    tags: ["wcag2a"],
    truncated: false,
    ...overrides,
  };
}
