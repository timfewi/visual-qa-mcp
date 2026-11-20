set shell := ["bash", ".just-shell"]
set positional-arguments

# Format, lint, typecheck and test.
check:
    bun run check

fmt:
    @python3 .project-format.py write default

fmt-check:
    @python3 .project-format.py check default

# Start the stdio MCP server from the development checkout.
start *args:
    @bun run src/index.ts mcp "$@"

test:
    bun run test

# Set up the optional pre-commit check in this checkout.
hooks:
    @python3 .husky-setup.py

# Open the guide using an external Tabula installation.
tabula-view:
    @tabula view . --open

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
