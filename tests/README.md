# Test layout

Tests run with Bun's built-in runner:

```sh
bun test                       # everything
bun test tests/unit            # schemas, security, rules, storage, report, CLI
bun test tests/integration     # real Chromium against a local fixture site
```

`tests/unit` covers pure domain behaviour: configuration validation, navigation
and redaction policy, stable finding IDs, deterministic rules, pixel diffing,
recheck classification, report escaping, persistence and CLI parsing.

`tests/integration` starts a local fixture site (`tests/helpers/fixture-site.ts`)
and drives the real pipeline: capture across routes and viewports, finding
detection, evidence retrieval with images, annotation, explicit baseline
approval, diff-based regressions, targeted rechecks and the full MCP tool surface
through an in-memory client transport. The fixture switches between a page with
deliberate defects and a clean page so that `fixed` and `regressed` outcomes can
be observed for the same finding IDs.

Browser-backed tests need a Chromium build. Set `PLAYWRIGHT_BROWSERS_PATH` (the
flake dev shell does this) or use a path from `nix develop`. When no browser is
available the files report an explicit skip instead of failing, because a
missing tool is an environment blocker rather than a code defect. Set
`VISUAL_QA_SKIP_BROWSER_TESTS=1` to force the skip.

Helpers:

- `helpers/fixtures.ts` — semantic snapshot, capture, axe and runtime fixtures.
- `helpers/documents.ts` — valid persisted documents for storage tests.
- `helpers/fixture-site.ts` — the local HTTP fixture site.
- `helpers/browser-probe.ts` — browser availability probe and skip diagnostics.
