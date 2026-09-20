import { describe, expect, test } from "bun:test";

import { escapeHtml } from "../../src/annotate/annotate.js";
import { renderReport } from "../../src/annotate/report.js";
import { CREATED_CAPTURE, CREATED_FINDING, CREATED_MANIFEST } from "../helpers/documents.js";
import type { Finding } from "../../src/domain/schema.js";

describe("HTML escaping", () => {
  test("escapes everything that could break out of markup or attributes", () => {
    expect(escapeHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("a & b 'c'")).toBe("a &amp; b &#39;c&#39;");
  });
});

describe("review report", () => {
  const hostile: Finding = {
    ...CREATED_FINDING,
    observation: `</td><script>alert('owned')</script>`,
    expected: `"quoted" & <b>bold</b>`,
    suggestedFix: `<img src=x onerror=alert(1)>`,
  };

  test("renders findings with filter metadata and escapes untrusted text", () => {
    const html = renderReport({
      manifest: CREATED_MANIFEST,
      captures: [CREATED_CAPTURE],
      findings: [hostile],
    });
    expect(html).toContain("Visual QA report");
    expect(html).toContain(`data-severity="medium"`);
    expect(html).toContain(`data-viewport="mobile"`);
    expect(html).toContain(CREATED_FINDING.id);
    expect(html).not.toContain("<script>alert('owned')</script>");
    expect(html).toContain("&lt;script&gt;alert(&#39;owned&#39;)&lt;/script&gt;");
    expect(html).not.toContain("onerror=alert(1)>");
  });

  test("references captured artifacts by relative path and mentions annotation output", () => {
    const html = renderReport({
      manifest: CREATED_MANIFEST,
      captures: [CREATED_CAPTURE],
      findings: [CREATED_FINDING],
      annotations: new Map([
        [CREATED_CAPTURE.id, "artifacts/root__default__mobile/annotation.png"],
      ]),
    });
    expect(html).toContain("artifacts/root__default__mobile/viewport.png");
    expect(html).toContain("artifacts/root__default__mobile/annotation.png");
    expect(html).toContain("annotation");
  });

  test("shows an expected/actual/diff comparison once a baseline exists", () => {
    const withDiff = {
      ...CREATED_CAPTURE,
      diff: {
        status: "mismatch" as const,
        ratio: 0.0123,
        diffPixels: 123,
        baselineRunId: "run_0",
        regions: [{ x: 1, y: 2, width: 3, height: 4, pixels: 5 }],
      },
      artifacts: [
        {
          id: "a",
          kind: "screenshot_viewport" as const,
          path: "artifacts/root__default__mobile/viewport.png",
          mimeType: "image/png",
          bytes: 1,
          sha256: "a",
        },
        {
          id: "b",
          kind: "baseline" as const,
          path: "artifacts/root__default__mobile/baseline.png",
          mimeType: "image/png",
          bytes: 1,
          sha256: "b",
        },
        {
          id: "c",
          kind: "diff" as const,
          path: "artifacts/root__default__mobile/diff.png",
          mimeType: "image/png",
          bytes: 1,
          sha256: "c",
        },
      ],
    };
    const html = renderReport({
      manifest: { ...CREATED_MANIFEST, operation: "recheck", parentRunId: "run_0" },
      captures: [withDiff],
      findings: [CREATED_FINDING],
    });
    expect(html).toContain("expected (approved baseline)");
    expect(html).toContain(">actual<");
    expect(html).toContain(">diff<");
    expect(html).toContain("baseline run_0");
  });

  test("states the limits of automated accessibility evidence", () => {
    const html = renderReport({
      manifest: CREATED_MANIFEST,
      captures: [CREATED_CAPTURE],
      findings: [CREATED_FINDING],
    });
    expect(html).toContain("not complete WCAG validation");
  });

  test("renders a run without findings", () => {
    const html = renderReport({
      manifest: { ...CREATED_MANIFEST, findingCount: 0 },
      captures: [CREATED_CAPTURE],
      findings: [],
    });
    expect(html).toContain('id="findings-table"');
    expect(html).toContain("findings shown");
    expect(html).not.toContain('sev-critical">critical: 1');
  });
});
