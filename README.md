# visual-qa-mcp

Official source: <https://github.com/timfewi/visual-qa-mcp>.

An MCP server that gives coding agents a closed, evidence-backed visual QA loop
for browser-based user interfaces: inspect a running application, read compact
findings with screenshots, fix one thing, and recheck only the evidence that the
fix could affect.

The implementation follows [HANDOFF.md](HANDOFF.md). The tool surface is
deliberately small, the domain layer is transport-independent, and every finding
records which evidence produced it.

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

```sh
nix develop
bun install --frozen-lockfile
bun run check          # biome format/lint + tsc --noEmit + bun run test
bun run build          # tsc -p tsconfig.build.json -> dist/
```

Use `bun run test` to run the complete suite. It starts three Bun worker
processes immediately, keeping the browser integration suites in separate
processes. With the pinned Bun version, the shared-process `bun test` run can
lose Chromium's DevTools pipe and hang during screenshots. The worker run
executes all tests with the same assertions and timeouts. For a focused check,
`bun test tests/integration/visual-loop.test.ts` runs that suite directly.

Repository-wide checks are declared in `.project-checks.json`:

```sh
project-check fast     # format/lint, both native outputs, sources/tool versions, check, build
project-check full     # nix flake check; run fast separately
```

Browser-backed integration tests are skipped with an explicit diagnostic when no
Chromium is available, for example outside `nix develop`.
The source check still fails if declared Bun or Playwright versions differ from
the pinned Nix tools, so a mismatched browser revision cannot silently skip
integration coverage. The development shell includes the shared project-check
runner on both supported Linux platforms.

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

The same service is reachable from the command line, which keeps the domain layer
honest about not depending on MCP:

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
The command is taken verbatim from configuration:

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

See [docs/workflows.md](docs/workflows.md) for an Astro landing page workflow, a
stateful application workflow and the security model.

## Architecture

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
