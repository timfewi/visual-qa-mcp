# visual-qa-mcp

Official source: <https://github.com/timfewi/visual-qa-mcp>.

A standalone CLI and stdio MCP server for visual QA of web applications. Inspect
a running application, read findings with screenshots, and recheck the affected
routes, scenarios and viewports after a fix. Every finding records the evidence
behind it.

## Run with Nix

On Linux, create a [configuration](#configuration) in the target project and run
these commands from its directory.

```sh
nix run github:timfewi/visual-qa-mcp -- validate-config
nix run github:timfewi/visual-qa-mcp -- inspect --json
```

For a stdio MCP client, use `nix` as the command and
`["run", "github:timfewi/visual-qa-mcp", "--", "mcp"]` as its arguments. Set the
working directory to the target project. If the client starts the server from a
different directory, pass an absolute `--config` path and set `preview.cwd` to
an absolute path when using a preview command. The server writes protocol messages
to stdout and diagnostics to stderr.

## Intended stack

- TypeScript on Node.js 24, package management with Bun
- Model Context Protocol TypeScript SDK (stdio transport)
- Playwright for deterministic capture and viewport emulation
- axe-core for automated accessibility evidence
- pixelmatch/pngjs for screenshot baselines and deterministic diffs
- an optional vision-review adapter (a deterministic fake ships for tests)

The inspected project keeps its own framework, package manager and preview
command: this server never assumes or rewrites them. The server itself is
Node-based and Nix-friendly; Chromium is always supplied by the environment
(`PLAYWRIGHT_BROWSERS_PATH` or an explicit path), never downloaded implicitly.

## Development

Enter the toolchain with `devenv shell` or `nix develop`. Both provide the
same Bun, Node, Biome and Playwright browser build.

```sh
devenv shell
bun install --frozen-lockfile
just lint              # format, lint, type checks, tests, build and flake evaluation
just verify            # build the native Nix package through nix flake check
```

Use `bun run test` to run the complete suite. It starts three Bun worker
processes immediately, keeping the browser integration suites in separate
processes. With the pinned Bun version, the shared-process `bun test` run can
lose Chromium's DevTools pipe and hang during screenshots. The worker run
executes all tests with the same assertions and timeouts. For a focused check,
`bun test tests/integration/visual-loop.test.ts` runs that suite directly.

Browser-backed integration tests are skipped with an explicit diagnostic when no
Chromium is available, for example outside `nix develop`.
The source check still fails if declared Bun or Playwright versions differ from
the pinned Nix tools, so a mismatched browser revision cannot silently skip
integration coverage. An external `project-check` runner can invoke the same
recipes through `.project-checks.json`.

## MCP surface

| Tool | Purpose |
| --- | --- |
| `visual_inspect` | Capture the configured routes, named states and viewport matrix — or one ad-hoc `url` — and return a run ID plus a compact finding summary. |
| `visual_get_evidence` | Return structured evidence for selected findings or captures, optionally with a bounded set of screenshots. |
| `visual_recheck` | Recapture only the captures behind the selected finding IDs and classify each as `fixed`, `improved`, `unchanged`, `regressed` or `needs_review`. |
| `visual_annotate` | Render numbered annotation overlays for selected findings and refresh the static HTML report. |
| `visual_approve_baseline` | Explicitly approve captured screenshots as regression baselines. Never runs automatically. |

Screenshots are returned as MCP image content or as `visual-qa://` resource
links. Long runs emit MCP progress notifications.

### CLI

The CLI uses the same capture service as the MCP server.

```sh
visual-qa-mcp mcp                       # stdio MCP server
visual-qa-mcp inspect --json
visual-qa-mcp inspect --url http://localhost:4321/pricing --viewport mobile
visual-qa-mcp recheck --findings fnd_…,fnd_…
visual-qa-mcp annotate --run latest --severity high
visual-qa-mcp approve-baseline --run latest --viewport mobile
visual-qa-mcp validate-config
```

## Configuration

The server looks for `visual-qa.config.json`, `.visual-qa.config.json`,
`.visual-qa/config.json` or `.visual-qa.json` in the working directory, or takes
an explicit `--config`. An unknown top-level key is an error, so typos cannot be
silently ignored.

A workspace without a configuration is a normal state, not a failure: the `mcp`
command still completes the handshake and serves a single read-only
`visual_status` tool that reports what is missing. Other commands such as
`inspect` and `validate-config` remain strict and exit nonzero without a
configuration.

```json
{
  "name": "my-site",
  "baseUrl": "http://localhost:4321",
  "routes": [
    { "path": "/" },
    {
      "path": "/pricing",
      "scenarios": [
        { "name": "default" },
        { "name": "annual", "actions": [{ "type": "click", "selector": "[data-billing='annual']" }] }
      ]
    }
  ],
  "viewports": [
    { "name": "mobile", "width": 375, "height": 812, "isMobile": true, "hasTouch": true },
    { "name": "tablet", "width": 768, "height": 1024 },
    { "name": "desktop", "width": 1440, "height": 900 }
  ],
  "security": { "allowRemote": false, "allowedHosts": [], "blockRequestsToOtherOrigins": true },
  "redaction": { "selectors": ["[data-secret]"], "patterns": ["sk-[A-Za-z0-9]+"] },
  "axe": { "enabled": true, "tags": ["wcag2a", "wcag2aa", "best-practice"] },
  "compare": { "threshold": 0.1, "maxDiffRatio": 0.001 },
  "capture": { "fullPage": true, "maxSemanticElements": 400 },
  "storage": { "root": ".visual-qa", "keepRuns": 20 },
  "vision": { "adapter": "none", "allowScreenshots": false }
}
```

Omit `viewports` to get the documented default matrix (375×812, 768×1024,
1440×900). Any additional width a project already enforces can be added
explicitly, for example:

```json
"viewports": [
  { "name": "mobile", "width": 375, "height": 812, "isMobile": true, "hasTouch": true },
  { "name": "tablet", "width": 768, "height": 1024 },
  { "name": "desktop", "width": 1440, "height": 900 },
  { "name": "desktop-wide", "width": 1280, "height": 800 },
  { "name": "desktop-xxl", "width": 1920, "height": 1080 }
]
```

### Preview commands

Instead of `baseUrl`, a target may let the server start its own preview process.
The configured command runs as the server user and inherits its environment.

```json
{
  "preview": {
    "command": ["bun", "run", "preview", "--", "--port", "4321"],
    "url": "http://localhost:4321/",
    "cwd": ".",
    "readyTimeoutMs": 60000
  },
  "routes": [{ "path": "/" }]
}
```

The process group is terminated when the run finishes, so no preview server is
left behind.

## Workflows

These workflows use `visual-qa-mcp mcp` over stdio. The Nix package and development
shell supply Chromium through `PLAYWRIGHT_BROWSERS_PATH`.

### Astro landing page

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
  ]
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

#### One-off pages

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

### Stateful application

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
- `redaction.selectors` replaces matching element content before scenario actions.
  Later actions can introduce new content. `redaction.patterns` also sanitises
  console output, failed request URLs and ARIA text.
- Scenario steps are declarative on purpose. Application-specific logic belongs
  in the application, not in the QA server.

### Security model

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
- **Request interception.** With `blockRequestsToOtherOrigins: true` (default),
  the HTTP route handler checks intercepted requests against the target origins.
  Redirects and WebSockets require separate controls.
- **Service workers are blocked** during capture to keep runs reproducible.
- **URL handling.** The capture URL is sanitised for storage. Keep credentials
  out of configuration URLs and preview command arguments.
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

### Interpreting findings

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

## Architecture

The [Tabula guide](.tabula/ENTRY.md) links the implementation and its checks.
With Tabula available, run `tabula update .` after reviewing the guide,
then `tabula check .`.

```
src/
  config/        zod schemas, loading, defaults
  security/      navigation policy, redaction
  capture/       browser launch, readiness/stability, semantic DOM, ARIA, axe, runtime errors
  domain/        finding schema, stable IDs, deterministic rules, recheck classification
  compare/       pixel diff, baselines and explicit approval
  review/        vision adapter interface, deterministic fake, claim downgrade rules
  annotate/      annotation overlays, static HTML report
  storage/       run persistence, artifact paths, finding history
  mcp/           tool registration and MCP content shaping
  cli/           command line entry points
  service.ts     transport-independent orchestration used by MCP and CLI
```

Evidence lives under `.visual-qa/runs/<run-id>/` (`manifest.json`,
`findings.json`, `captures.json`, `artifacts/`, `report.html`), approved baselines
under `.visual-qa/baselines/`, and cross-run finding history under
`.visual-qa/state/findings.json`. Runtime state is gitignored.

### Findings

Each finding carries a stable ID (derived from route, scenario, viewport, rule
and origin — never from a run), severity, category, observation, expected
outcome, evidence, selector and bounding box where available, a suggested
direction, confidence, origin (`deterministic_rule`, `accessibility_engine`,
`screenshot_diff`, `vision_review`), and its recheck history.

Deterministic evidence and model judgement stay distinguishable: findings from a
review adapter are never marked verified, and claims that point at elements which
were not captured are downgraded to low-confidence, informational suggestions.

## Packaging

`flake.nix` exposes `packages.<system>.default`, a `visual-qa-mcp` executable
with the `mcp` subcommand. The wrapper uses Node, sets
`PLAYWRIGHT_BROWSERS_PATH` as a *default* (so an externally supplied value still
wins) and never downloads browsers. `nix flake check` builds it.

Packages, development shells, formatters and checks are provided natively for
`x86_64-linux` and `aarch64-linux`. The fast gate evaluates both without building
the server or browsers. Executing ARM64 packages requires an ARM64 machine or
builder.

`nix/sources.nix` selects only the package manifests, TypeScript configurations,
license and regular TypeScript files under `src/`. Dependency fetching uses only
`package.json` and `bun.lock`: application, documentation and runtime changes do
not alter its source. The regression check verifies both inventories, cache,
symlink and FIFO exclusions, and source-path changes for real code/lock edits.

The `bun-deps` package fetches locked dependencies without browser downloads or
lifecycle scripts. Its CPU selection and hashes are separate for x86-64 and ARM64
because TypeScript includes a native compiler. Build `nix build .#bun-deps` to
verify the native dependency hash independently of the full server/browser
closure. Update both hashes in `nix/dependency-hashes.nix` when dependencies change.
The installed package also includes this project's MIT license.

Flake commands and Direnv use Git-index files. Stage authorized new source files
before evaluation; caches and captured evidence stay outside the index.

## License

MIT. See [LICENSE](LICENSE). The package manifest keeps `private: true` to
prevent accidental publication to npm; it does not restrict use of the GitHub
repository under the MIT license.
