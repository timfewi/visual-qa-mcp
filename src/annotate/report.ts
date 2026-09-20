import type { Capture, Finding, RunManifest } from "../domain/schema.js";
import { escapeHtml } from "./annotate.js";

export interface ReportInput {
  readonly manifest: RunManifest;
  readonly captures: readonly Capture[];
  readonly findings: readonly Finding[];
  /** captureId -> run-relative path of an annotated screenshot. */
  readonly annotations?: ReadonlyMap<string, string> | undefined;
}

/**
 * Static, self-contained review artifact.
 *
 * Images stay as run-relative references so the report can be opened directly
 * from the run directory without embedding megabytes into the HTML.
 */
export function renderReport(input: ReportInput): string {
  const { manifest, captures, findings } = input;
  const severityCounts = countBy(findings, (finding) => finding.severity);
  const categoryCounts = countBy(findings, (finding) => finding.category);
  const viewports = [...new Set(captures.map((capture) => capture.viewport))];

  const findingRows = findings.map((finding) => renderFindingRow(finding)).join("\n");

  const captureSections = captures
    .map((capture) => renderCapture(capture, input.annotations?.get(capture.id)))
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Visual QA report — ${escapeHtml(manifest.id)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; background: #f6f8fa; color: #1f2328; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 28px 0 8px; }
  h3 { font-size: 14px; margin: 16px 0 6px; }
  .muted { color: #57606a; font-size: 13px; }
  .card { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  .chip { border-radius: 999px; padding: 3px 10px; font-size: 12px; border: 1px solid #d0d7de; background: #fff; }
  .sev-critical { background: #ffebe9; border-color: #ff8182; color: #82071e; }
  .sev-high { background: #fff1e5; border-color: #f4a261; color: #8a3b00; }
  .sev-medium { background: #fff8c5; border-color: #d4a72c; color: #7d4e00; }
  .sev-low { background: #dafbe1; border-color: #4ac26b; color: #0f5323; }
  .sev-info { background: #ddf4ff; border-color: #54aeff; color: #0a3069; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border-bottom: 1px solid #d8dee4; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; font-weight: 600; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .shots { display: flex; flex-wrap: wrap; gap: 12px; }
  figure { margin: 0; }
  figure img { max-width: 320px; border: 1px solid #d0d7de; border-radius: 6px; display: block; background: #fff; }
  figcaption { font-size: 12px; color: #57606a; margin-top: 4px; }
  .filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
  label { font-size: 12px; color: #57606a; display: block; }
  select, input { font-size: 13px; padding: 4px 6px; border: 1px solid #d0d7de; border-radius: 6px; }
  .hidden { display: none !important; }
  pre { background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 6px; padding: 8px; overflow: auto; font-size: 12px; max-height: 240px; }
</style>
</head>
<body>
<h1>Visual QA report</h1>
<p class="muted">
  Run <code>${escapeHtml(manifest.id)}</code> · ${escapeHtml(manifest.createdAt)} · status ${escapeHtml(manifest.status)} ·
  operation ${escapeHtml(manifest.operation)}${manifest.parentRunId ? ` · recheck of <code>${escapeHtml(manifest.parentRunId)}</code>` : ""}<br>
  Target <code>${escapeHtml(manifest.targetBaseUrl)}</code> · config <code>${escapeHtml(manifest.configPath)}</code><br>
  Routes: ${escapeHtml(manifest.routes.join(", "))} · Viewports: ${escapeHtml(manifest.viewports.join(", "))}
</p>

<div class="chips">
  ${Object.entries(severityCounts)
    .map(
      ([severity, count]) =>
        `<span class="chip sev-${escapeHtml(severity)}">${escapeHtml(severity)}: ${count}</span>`,
    )
    .join("\n  ")}
</div>
<div class="chips">
  ${Object.entries(categoryCounts)
    .map(([category, count]) => `<span class="chip">${escapeHtml(category)}: ${count}</span>`)
    .join("\n  ")}
</div>

<div class="card">
  <h2>Findings</h2>
  <div class="filters">
    <div><label for="f-severity">Severity</label><select id="f-severity"><option value="">all</option>${Object.keys(
      severityCounts,
    )
      .map((severity) => `<option value="${escapeHtml(severity)}">${escapeHtml(severity)}</option>`)
      .join("")}</select></div>
    <div><label for="f-category">Category</label><select id="f-category"><option value="">all</option>${Object.keys(
      categoryCounts,
    )
      .map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
      .join("")}</select></div>
    <div><label for="f-viewport">Viewport</label><select id="f-viewport"><option value="">all</option>${viewports
      .map((viewport) => `<option value="${escapeHtml(viewport)}">${escapeHtml(viewport)}</option>`)
      .join("")}</select></div>
    <div><label for="f-search">Text</label><input id="f-search" type="search" placeholder="filter observations"></div>
  </div>
  <p class="muted" id="f-count"></p>
  <table id="findings-table">
    <thead><tr><th>Severity</th><th>ID</th><th>Category</th><th>Origin</th><th>Location</th><th>Observation</th><th>Expected</th><th>Suggested fix</th><th>Confidence</th></tr></thead>
    <tbody>
${findingRows}
    </tbody>
  </table>
</div>

<h2>Captures</h2>
${captureSections}

<p class="muted">
  Automated accessibility output comes from axe-core and is complementary evidence, not complete WCAG validation.
  Deterministic findings are machine-checked; findings with origin <code>vision_review</code> are model judgement and are
  marked unverified unless they are grounded in a captured element.
</p>

<script>
(function () {
  var severity = document.getElementById('f-severity');
  var category = document.getElementById('f-category');
  var viewport = document.getElementById('f-viewport');
  var search = document.getElementById('f-search');
  var rows = Array.prototype.slice.call(document.querySelectorAll('#findings-table tbody tr'));
  var count = document.getElementById('f-count');
  function apply() {
    var visible = 0;
    rows.forEach(function (row) {
      var ok = true;
      if (severity.value && row.dataset.severity !== severity.value) ok = false;
      if (category.value && row.dataset.category !== category.value) ok = false;
      if (viewport.value && row.dataset.viewport !== viewport.value) ok = false;
      if (search.value && row.textContent.toLowerCase().indexOf(search.value.toLowerCase()) === -1) ok = false;
      row.classList.toggle('hidden', !ok);
      if (ok) visible += 1;
    });
    count.textContent = visible + ' of ' + rows.length + ' findings shown';
  }
  [severity, category, viewport].forEach(function (el) { el.addEventListener('change', apply); });
  search.addEventListener('input', apply);
  apply();
})();
</script>
</body>
</html>
`;
}

function renderFindingRow(finding: Finding): string {
  const location = `${escapeHtml(finding.route)} · ${escapeHtml(finding.scenario)} · ${escapeHtml(finding.viewport)}`;
  const selector = finding.selector ? `<br><code>${escapeHtml(finding.selector)}</code>` : "";
  const evidenceLinks = finding.evidence
    .filter((item) => item.artifactPath !== undefined)
    .map((item) => `<a href="${escapeHtml(item.artifactPath ?? "")}">${escapeHtml(item.kind)}</a>`)
    .join(" ");
  return `      <tr data-severity="${escapeHtml(finding.severity)}" data-category="${escapeHtml(
    finding.category,
  )}" data-viewport="${escapeHtml(finding.viewport)}">
        <td class="sev-${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</td>
        <td><code>${escapeHtml(finding.id)}</code><br>${escapeHtml(finding.status)}</td>
        <td>${escapeHtml(finding.category)}<br><span class="muted">${escapeHtml(finding.ruleId)}</span></td>
        <td>${escapeHtml(finding.origin)}${finding.verified ? "" : '<br><span class="muted">unverified</span>'}</td>
        <td>${location}${selector}</td>
        <td>${escapeHtml(finding.observation)}</td>
        <td>${escapeHtml(finding.expected)}</td>
        <td>${escapeHtml(finding.suggestedFix)} ${evidenceLinks}</td>
        <td>${finding.confidence.toFixed(2)}</td>
      </tr>`;
}

function renderCapture(capture: Capture, annotationPath: string | undefined): string {
  const baseline = capture.artifacts.find((artifact) => artifact.kind === "baseline");
  const diffArtifact = capture.artifacts.find((artifact) => artifact.kind === "diff");
  const actual =
    capture.artifacts.find((artifact) => artifact.kind === "screenshot_viewport") ??
    capture.artifacts.find((artifact) => artifact.kind === "screenshot_full");

  const images: string[] = [];
  if (baseline !== undefined && actual !== undefined) {
    // Expected / actual / diff comparison for captures that have a baseline.
    images.push(figure(baseline.path, "expected (approved baseline)"));
    images.push(figure(actual.path, "actual"));
    if (diffArtifact !== undefined) {
      images.push(figure(diffArtifact.path, "diff"));
    }
  } else {
    for (const artifact of capture.artifacts) {
      if (artifact.kind === "diff" || artifact.kind === "baseline") {
        continue;
      }
      images.push(figure(artifact.path, artifact.kind, artifact.width, artifact.height));
    }
  }
  if (annotationPath !== undefined) {
    images.push(figure(annotationPath, "annotation"));
  }

  const runtime =
    capture.runtime.length > 0
      ? `<h3>Runtime</h3><pre>${escapeHtml(
          capture.runtime
            .slice(0, 20)
            .map((event) => `${event.kind}: ${event.message}${event.url ? ` (${event.url})` : ""}`)
            .join("\n"),
        )}</pre>`
      : "";

  const axe = capture.axe
    ? `<h3>Accessibility (axe-core)</h3><p class="muted">${capture.axe.violations.length} violation type(s), ${capture.axe.incompleteCount} incomplete, ${capture.axe.passCount} passed, ${capture.axe.inapplicableCount} inapplicable. Tags: ${escapeHtml(
        capture.axe.tags.join(", "),
      )}</p>`
    : "";

  const diff = capture.diff
    ? `<p class="muted">Baseline diff: ${escapeHtml(capture.diff.status)}, ratio ${capture.diff.ratio.toFixed(
        4,
      )}, regions ${capture.diff.regions.length}${capture.diff.baselineRunId ? `, baseline ${escapeHtml(capture.diff.baselineRunId)}` : ""}</p>`
    : "";

  const failure =
    capture.error !== undefined
      ? `<p class="sev-critical">Capture failed: ${escapeHtml(capture.error)}</p>`
      : "";

  return `<div class="card">
  <h2>${escapeHtml(capture.viewport)} · ${escapeHtml(capture.route)} · ${escapeHtml(capture.scenario)}</h2>
  <p class="muted">${escapeHtml(capture.url)} · status ${escapeHtml(capture.status)} · ${capture.durationMs} ms · frame ${capture.stability.stable ? "stable" : "unstable"} after ${capture.stability.attempts} attempt(s) · redacted nodes ${capture.redaction.nodesRedacted}</p>
  ${failure}
  <div class="shots">${images.join("")}</div>
  ${diff}
  ${axe}
  ${runtime}
</div>`;
}

function figure(path: string, label: string, width?: number, height?: number): string {
  const size = width !== undefined && height !== undefined ? ` (${width}×${height})` : "";
  return `<figure><a href="${escapeHtml(path)}"><img src="${escapeHtml(path)}" alt="${escapeHtml(label)}" loading="lazy"></a><figcaption>${escapeHtml(label)}${size}</figcaption></figure>`;
}

function countBy<T>(items: readonly T[], selector: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = selector(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
