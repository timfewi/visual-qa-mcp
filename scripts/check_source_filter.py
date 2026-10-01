"""Verify minimal, cache-independent sources and native platform/tool versions."""

import json
import os
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote


def write(root: Path, relative: str, text: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def evaluate(project: Path, fixture: Path) -> dict:
    result = subprocess.run(
        [
            "nix",
            "eval",
            "--offline",
            "--no-write-lock-file",
            "--impure",
            "--option",
            "allow-import-from-derivation",
            "false",
            "--json",
            "--file",
            str(project / "scripts/source_filter.nix"),
        ],
        env={
            **os.environ,
            "SOURCE_CHECK_FLAKE_URI": "git+file://" + quote(str(project), safe="/"),
            "SOURCE_CHECK_FIXTURE_ROOT": str(fixture),
        },
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    if result.returncode:
        raise SystemExit(result.stderr)
    return json.loads(result.stdout)


def main() -> None:
    project = Path(__file__).resolve().parent.parent
    package_files = [
        "LICENSE",
        "bun.lock",
        "package.json",
        "src/main.ts",
        "tsconfig.build.json",
        "tsconfig.json",
    ]
    dependency_files = ["bun.lock", "package.json"]
    with tempfile.TemporaryDirectory(prefix="visual-source-check-") as temporary:
        base = Path(temporary)
        clean, dirty = base / "clean", base / "dirty"
        for root in (clean, dirty):
            for path in package_files:
                write(root, path, "Synthetic source fixture.\n")
        for path in (
            ".git/config",
            ".ast-index/index.json",
            ".direnv/environment",
            ".visual-qa/run.json",
            "node_modules/private.ts",
            "dist/index.js",
            "coverage/index.ts",
            "src/.visual-qa/private.ts",
            "src/node_modules/cache.ts",
            "README.md",
            "HANDOFF.md",
            "tests/test.ts",
            "private.txt",
        ):
            write(dirty, path, "Synthetic runtime state.\n")
        outside = base / "outside.ts"
        outside.write_text("export const outside = true;\n")
        (dirty / "src/linked.ts").symlink_to(outside)
        os.mkfifo(dirty / "src/pipe.ts")
        first, second = evaluate(project, clean), evaluate(project, dirty)
        for key, files in (
            ("package", package_files),
            ("dependencies", dependency_files),
        ):
            assert first[key]["files"] == files == second[key]["files"]
            assert first[key]["path"] == second[key]["path"], (
                "Runtime changed source path"
            )
        write(dirty, "src/main.ts", "export const value = 2;\n")
        changed = evaluate(project, dirty)
        assert changed["package"]["path"] != first["package"]["path"], (
            "Source edit omitted"
        )
        assert changed["dependencies"]["path"] == first["dependencies"]["path"]
        write(dirty, "bun.lock", "Changed dependency fixture.\n")
        changed = evaluate(project, dirty)
        for key in ("package", "dependencies"):
            assert changed[key]["path"] != first[key]["path"], "Lockfile edit omitted"
        assert set(second["native"]) == {"x86_64-linux", "aarch64-linux"}
        tracked = subprocess.run(
            ["git", "ls-files", "-z", "src"],
            cwd=project,
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        ).stdout
        required = set(package_files) - {"src/main.ts"} | {
            path for path in tracked.split("\0") if path.endswith(".ts")
        }
        for system, package in second["native"].items():
            assert package["system"] == system
            assert set(package["packageFiles"]) == required, "Package sources differ"
            assert package["dependencyFiles"] == dependency_files
        assert len({p["dependencyHash"] for p in second["native"].values()}) == 2
    print(
        "Source, native outputs, distinct dependency hashes and pinned SDK/tool versions passed."
    )


if __name__ == "__main__":
    main()
