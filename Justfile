# Format, lint, typecheck and test.
check:
    bun run check

# Same as `bun run check` plus the repository build.
build:
    bun run build

lint:
    project-check fast

verify:
    project-check full
