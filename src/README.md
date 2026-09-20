# Source layout

Browser capture, evidence normalization, review, reporting and MCP transport are
separate modules. The domain layer (`domain/`, `compare/`, `storage/`) never
imports MCP, so the CLI and the MCP server drive the same code.

| Path | Responsibility |
| --- | --- |
| `index.ts` | Executable entry point (`visual-qa-mcp <command>`). |
| `cli/main.ts` | Argument parsing and the `mcp`, `inspect`, `recheck`, `annotate`, `approve-baseline` and `validate-config` commands. |
| `service.ts` | Transport-independent orchestration of the five operations; owns run lifecycle, preview server, baselines and finding state. |
| `config/` | Zod schemas, defaults and configuration loading. |
| `security/` | Navigation/request policy and redaction (values, patterns and in-page DOM). |
| `capture/` | Playwright launch, deterministic context setup, readiness/stability, semantic DOM snapshot, ARIA snapshot, axe-core, runtime error collection. |
| `domain/` | Finding and run schemas, stable IDs, deterministic rules, recheck classification, filtering and counting. |
| `compare/` | Pixel diff, mismatch regions and explicit baseline approval. |
| `review/` | Vision adapter interface, deterministic fake adapter and the rules that downgrade ungrounded model claims. |
| `annotate/` | Annotation overlays (rendered as HTML+SVG through Playwright) and the static HTML review report. |
| `storage/` | Run persistence, artifact path safety, baseline index and cross-run finding history. |
| `mcp/` | Tool registration, MCP content shaping and progress notifications. |
| `target/` | Starting and stopping the inspected project's own preview command. |

Conventions:

- Relative imports use `.js` extensions so the same sources run under Bun
  (`bun test`) and compile under `tsc` for Node 22.
- Diagnostics always go to stderr; stdout stays reserved for the MCP protocol.
- Evidence is written before it is summarised, and every artifact path is
  validated to stay inside the run directory.
