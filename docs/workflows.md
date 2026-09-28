# Workflows

Two end-to-end workflows, plus the security model that applies to both. Both
assume the MCP server is registered with `visual-qa-mcp mcp` over stdio and that
`nix develop` provides Chromium through `PLAYWRIGHT_BROWSERS_PATH`.

## 1. Astro landing page (code-owned, localhost)

A landing page is the smallest deterministic proving ground: one route, a
handful of states, three viewports.

`.visual-qa.config.json` (or `visual-qa.config.json`, `.visual-qa/config.json`,
`.visual-qa.json`) inside the Astro project:

```json
{
  "name": "marketing-site",
  "preview": {
    "command": ["bun", "run", "preview", "--", "--port", "4321"],
    "url": "http://localhost:4321/",
    "readyTimeoutMs": 60000
  },
  "routes": [
    { "path": "/" },
    {
      "path": "/",
      "name": "home-mobile-menu",
      "scenarios": [
        {
          "name": "menu-open",
          "actions": [{ "type": "click", "selector": "[data-menu-toggle]" }],
          "readySelector": "[data-menu-panel][data-open='true']"
        }
      ]
    }
  ],
  "viewports": [
    { "name": "mobile", "width": 375, "height": 812, "isMobile": true, "hasTouch": true },
    { "name": "tablet", "width": 768, "height": 1024 },
    { "name": "desktop", "width": 1440, "height": 900 }
  ],
  "vision": { "adapter": "fake" }
}
```

Typical loop:

1. `visual_inspect` with `{"routes": ["/"]}`. The result lists stable finding IDs
   such as `fnd_…` for horizontal overflow at 375 px, a broken image, or an axe
   violation, plus the run directory and report path.
2. `visual_get_evidence` with `{"runId": "latest", "findingIds": ["fnd_…"], "includeImages": true}` to
   look at the actual viewport screenshot instead of a whole run.
3. Fix one cause in the Astro source.
4. `visual_recheck` with the same finding IDs. Only the affected
   route/scenario/viewport combinations are recaptured and each finding is
   classified as `fixed`, `improved`, `unchanged`, `regressed` or `needs_review`.
5. `visual_approve_baseline` once the result is intended. From then on, a later
   `visual_inspect` produces a diff image and a `regression` finding when the
   rendering changes.

The `vision` adapter is optional. With `adapter: "none"` the loop is fully
deterministic. `adapter: "fake"` exercises the review pipeline without sending
anything anywhere; `allowScreenshots` must be enabled explicitly before any
adapter receives an image.

### One-off pages

Anything that is reachable under the configured security policy can be inspected
without adding a route to the configuration:

```json
{ "url": "http://localhost:4321/landing-experiment", "viewports": ["mobile", "desktop"] }
```

Only the viewports are taken from the configuration; the URL itself is validated
against the same policy as a configured route, and the origin set for request
interception shrinks to exactly the origins being inspected. The resulting
findings stay recheckable: `visual_recheck` captures the recorded URL directly
when it is not part of the configuration.

## 2. Stateful application (authenticated flow, multiple states)

For a dashboard, admin tool or SaaS flow, model states as scenarios rather than
routes and supply a Playwright storage state for authentication.

```json
{
  "name": "admin-app",
  "baseUrl": "http://localhost:3000",
  "routes": [
    {
      "path": "/dashboard",
      "scenarios": [
        { "name": "default", "storageState": ".visual-qa/auth/state.json" },
        {
          "name": "empty-state",
          "storageState": ".visual-qa/auth/state.json",
          "actions": [{ "type": "click", "selector": "[data-filter='archived']" }],
          "readySelector": "[data-empty-state]"
        },
        {
          "name": "row-menu-open",
          "storageState": ".visual-qa/auth/state.json",
          "actions": [
            { "type": "click", "selector": "[data-row='1'] [data-menu]" },
            { "type": "waitForSelector", "selector": "[role='menu']", "state": "visible" }
          ]
        }
      ]
    },
    {
      "path": "/settings",
      "scenarios": [
        {
          "name": "validation-error",
          "storageState": ".visual-qa/auth/state.json",
          "actions": [
            { "type": "fill", "selector": "#api-key", "value": "", "redact": true },
            { "type": "click", "selector": "button[type='submit']" }
          ],
          "readySelector": "[role='alert']"
        }
      ]
    }
  ],
  "redaction": {
    "selectors": ["[data-testid='account-email']", "#api-key-preview"],
    "patterns": ["eyJ[A-Za-z0-9._-]+"]
  }
}
```

Notes:

- Storage state files are produced by the inspected project (for example with
  `playwright codegen --save-storage`). They stay outside Git.
- `redact: true` on a `fill` action documents that the typed value is a secret.
  Input values are never captured in the first place: the semantic snapshot
  records labels, roles, text and geometry, not field values.
- `redaction.selectors` replaces element content before *any* evidence is
  collected, so configured secrets never reach a screenshot or the semantic
  snapshot. `redaction.patterns` additionally sanitises console output, failed
  request URLs and ARIA text.
- Scenario steps are declarative on purpose. Application-specific logic belongs
  in the application, not in the QA server.

## Security model

Defaults are restrictive and every relaxation is explicit:

- **Localhost by default.** `localhost`, `*.localhost`, `127.0.0.0/8`, `::1` and
  `0.0.0.0` are allowed. Everything else requires both
  `security.allowRemote: true` and a matching entry in
  `security.allowedHosts` (exact host or `*.suffix`).
- **Link-local and metadata endpoints are always blocked**
  (`169.254.0.0/16`, `fe80::/10`, `metadata.google.internal`, …), even when a
  wildcard allowlist entry would match. Only `security.blockLinkLocal: false`
  together with an explicit allowlist relaxes this.
- **Only `http` and `https` are navigable.** `file:`, `data:`, `blob:`,
  `javascript:` and friends are refused before the browser starts.
- **Preview readiness uses the same URL policy.** An unsafe `preview.url` is
  refused before its command starts, and the readiness request does not follow
  redirects.
- **Requests are intercepted.** With `blockRequestsToOtherOrigins: true`
  (default), any request leaving the allowed origin set is aborted, so a
  captured page cannot pull in third-party assets or be redirected off-site.
- **Service workers are blocked** during capture to keep runs reproducible.
- **Credentials never reach artifacts.** URLs are stored without userinfo and
  without fragments.
- **Page content is untrusted data.** It is captured, redacted, truncated and
  reported; it is never executed as instructions and never forwarded to a model
  provider unless an adapter is configured *and* `vision.allowScreenshots` is
  explicitly enabled.
- **Baselines are an explicit mutation.** `visual_approve_baseline` is the only
  code path that writes a baseline; capture, recheck and annotation never do.
- **Annotations never touch baselines.** Overlays are rendered from capture-time
  bounding boxes afterwards, as separate artifacts.
- **Runtime state stays outside Git** (`.visual-qa/`), and the number of
  retained runs is bounded by `storage.keepRuns`.

## Interpreting findings

- `origin: deterministic_rule` — machine-checked from the DOM geometry, computed
  styles and runtime events. `verified: true`.
- `origin: accessibility_engine` — axe-core output. Presented as automated
  evidence, never as complete WCAG validation.
- `origin: screenshot_diff` — pixel comparison against an approved baseline.
- `origin: vision_review` — model judgement. `verified: false`; claims that
  cannot be grounded in a captured element are downgraded to informational
  suggestions with low confidence.

`visual_recheck` only ever reports what it measured: a condition that
disappeared is `fixed`, a smaller metric is `improved`, a larger one is
`regressed`, an inconclusive or failed capture is `needs_review`.
