# Visual QA MCP

## Running the tool

The [CLI](../src/cli/main.ts) and the [stdio MCP server](../src/mcp/server.ts)
share the [visual QA service](../src/service.ts). Both load a target project's
configuration. The service captures the selected routes, scenarios and viewports
and records evidence in the project's run store. The [README](../README.md)
contains client setup, configuration examples and the inspect-to-recheck workflow.

## Evidence and baselines

A [capture session](../src/capture/session.ts) drives Chromium and collects
screenshots, semantic data, accessibility results and runtime events. The
[run store](../src/storage/run-store.ts) persists the evidence. Explicit
[baseline approval](../src/compare/baseline.ts) supplies reference images
for subsequent comparisons.

## Development and verification

The [devenv module](../devenv.nix) and the [flake](../flake.nix) share the
[development tools and browser environment](../nix/dev-tools.nix).
The [Justfile](../Justfile) defines the fast checks and the native package
check. The [integration suite](../tests/integration/visual-loop.test.ts)
exercises the visual QA loop against a local fixture. See the
[project policy](../AGENTS.md) for build, state and publication conventions.
