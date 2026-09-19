# visual-qa-mcp

Private project scaffold for an MCP server that gives coding agents an
evidence-backed visual QA loop for any user interface rendered in a browser.

The repository currently contains project configuration and the implementation
brief only. There is deliberately no MCP implementation yet.

## Intended stack

- TypeScript on Node.js 22
- Model Context Protocol TypeScript SDK
- Playwright for deterministic browser capture and viewport emulation
- axe-core for accessibility evidence
- screenshot baselines and pixel diffs for regression evidence
- an optional vision-model adapter for design critique

The server is Node-based, but inspected projects remain framework- and
package-manager-independent. Nix supplies the development toolchain and the
eventual capture layer must accept a Nix-provided Playwright browser path.

Read [HANDOFF.md](HANDOFF.md) before implementing.

The future integration contract is `visual-qa-mcp mcp` over stdio, packaged as
the flake's default package. Agent registration lives in `agent-configuration`;
the consuming NixOS host owns package pinning and activation.

## Development shell

```sh
nix develop
pnpm install --frozen-lockfile
pnpm check
```

Repository-wide checks are declared in `.project-checks.json`:

```sh
project-check fast
project-check full
```
