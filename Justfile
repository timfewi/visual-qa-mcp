# Format, lint, typecheck and test.
check:
    bun run check

# Compile the CLI and MCP server.
build:
    bun run build

# Run the fast checks for both native outputs and the TypeScript source.
lint: nix-format flake-eval source-filter statix deadnix check build

# Build the native package through the flake checks.
verify:
    nix flake check --offline --no-write-lock-file .

nix-format:
    nix fmt --offline --no-write-lock-file -- --ci

flake-eval:
    nix flake check --offline --all-systems --no-build --no-write-lock-file .

source-filter:
    python3 -I -B scripts/check_source_filter.py

statix:
    statix check .

deadnix:
    deadnix --fail .
