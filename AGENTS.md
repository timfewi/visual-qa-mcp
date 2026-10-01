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
- `nix develop` is the verified development route: it provides Bun, Node 24,
  Biome, the Nix linters and the Playwright browser build. Chromium always comes
  from `PLAYWRIGHT_BROWSERS_PATH`; never call `playwright install`.
- Lint and format with Biome (provided by the dev shell, not a dependency), and
  keep the `.direnv` and `result*` trees out of lint scope.
- Runtime state lives under `.visual-qa/` and stays out of Git.
- Native flake outputs cover x86-64 and ARM64 Linux. Fast checks evaluate both
  without building the server or browsers; full checks build the native package.
- The Bun and Playwright SDK versions in `package.json` must match the pinned
  Nix tools. `scripts/check_source_filter.py` enforces this even when browser
  integration tests cannot run.
- Flakes and Direnv use Git-index files. Stage authorized new source before
  evaluation. `nix/sources.nix` owns package and dependency source allowlists;
  runtime state, symlinks and special files must stay out of them.
- `packages/bun-deps.nix` fixes Linux and the selected CPU explicitly. Regenerate
  both hashes in `nix/dependency-hashes.nix` after dependency changes; TypeScript
  includes architecture-specific binaries. Dependency fetching does not render
  or build Chromium. Keep multi-session checkpoints in `HANDOFF.md`.
