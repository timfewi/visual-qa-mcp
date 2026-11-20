"""Install the project's Husky hooks without replacing existing Git hooks."""

import os
import shutil
import subprocess
import sys
from pathlib import Path


def git(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=False)


def dispatcher_ready() -> bool:
    return (
        Path(".husky/pre-commit").is_file()
        and Path(".husky/_/h").is_file()
        and Path(".husky/_/pre-commit").is_file()
        and os.access(".husky/_/pre-commit", os.X_OK)
    )


def main() -> int:
    root = git("rev-parse", "--show-toplevel")
    if root.returncode or Path(root.stdout.strip()).resolve() != Path.cwd().resolve():
        print("Run hook setup from the repository root.", file=sys.stderr)
        return 1
    if Path(".husky").is_symlink() or Path(".git").is_symlink():
        print(
            "Symlinked hook or Git directories require manual integration.",
            file=sys.stderr,
        )
        return 1
    configured = git("config", "--get-all", "core.hooksPath")
    if configured.returncode not in (0, 1):
        print(configured.stderr, file=sys.stderr)
        return 1
    if configured.returncode == 0 and any(
        value != ".husky/_" for value in configured.stdout.splitlines()
    ):
        print("Existing core.hooksPath requires manual integration.", file=sys.stderr)
        return 1
    default_hooks = git("rev-parse", "--git-common-dir")
    if default_hooks.returncode:
        print(default_hooks.stderr, file=sys.stderr)
        return 1
    git_dir = git("rev-parse", "--absolute-git-dir")
    common_dir = Path(default_hooks.stdout.strip()).resolve()
    if git_dir.returncode or Path(git_dir.stdout.strip()).resolve() != common_dir:
        print("Linked worktrees require manual hook integration.", file=sys.stderr)
        return 1
    hooks = common_dir / "hooks"
    if hooks.is_dir() and any(not p.name.endswith(".sample") for p in hooks.iterdir()):
        print("Existing Git hooks require manual integration.", file=sys.stderr)
        return 1
    if os.environ.get("HUSKY") == "0":
        print("HUSKY=0 disables hook setup.", file=sys.stderr)
        return 1
    if not shutil.which("husky"):
        print("Husky 9 is missing from PATH.", file=sys.stderr)
        return 1
    if not Path(".husky/pre-commit").is_file():
        print("The pre-commit hook is missing.", file=sys.stderr)
        return 1
    generated = Path(".husky/_")
    if generated.exists() or generated.is_symlink():
        local = git("config", "--local", "--get", "core.hooksPath")
        if (
            not generated.is_symlink()
            and local.stdout.strip() == ".husky/_"
            and dispatcher_ready()
        ):
            return 0
        print("Existing .husky/_ requires manual integration.", file=sys.stderr)
        return 1
    result = subprocess.run(["husky"], check=False)
    installed = git("config", "--local", "--get", "core.hooksPath")
    if (
        result.returncode
        or installed.stdout.strip() != ".husky/_"
        or not dispatcher_ready()
    ):
        print("Husky hook setup failed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
