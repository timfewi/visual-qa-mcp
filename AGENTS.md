# Project policy

- Keep credentials, personal data and runtime state outside Git.
- Preserve existing user changes. Write documentation and CLI text in English.
- Run `project-check fast` after meaningful changes and `project-check full`
  before handoff. Checks are declared in `.project-checks.json` and never run on
  their own.
- Missing tools or offline dependencies are environment blockers, not failures.
- Do not stage, commit, push, publish or deploy without explicit authorization.

## Toolchain

- Bun is the package manager and the test runner (`bun install`,
  `bun run check`, `bun test`). Use `bun install --frozen-lockfile` when the
  lockfile must not change.
- `nix develop` is the verified development route: it provides Bun, Node 22,
  Biome, the Nix linters and the Playwright browser build. Chromium always comes
  from `PLAYWRIGHT_BROWSERS_PATH`; never call `playwright install`.
- Lint and format with Biome (provided by the dev shell, not a dependency), and
  keep the `.direnv` and `result*` trees out of lint scope.
- Runtime state lives under `.visual-qa/` and stays out of Git.
