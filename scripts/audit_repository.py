"""Reject generated artifacts and unrelated files from the Git index."""

from __future__ import annotations

import subprocess
from pathlib import Path, PurePosixPath


ALLOWED_TOP_LEVEL = frozenset(
    {
        ".gitattributes",
        ".github",
        ".gitignore",
        "AGENTS.md",
        "CHANGELOG.md",
        "CONTEXT.md",
        "CONTRIBUTING.md",
        "LICENSE",
        "NOTICE",
        "PRIVACY.md",
        "README.md",
        "SECURITY.md",
        "addon",
        "docs",
        "eslint.config.js",
        "package-lock.json",
        "package.json",
        "scripts",
        "src",
        "test",
        "tsconfig.json",
        "typings",
        "zotero-plugin.config.ts",
    }
)
FORBIDDEN_SEGMENTS = frozenset(
    {
        ".idea",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".tox",
        ".venv",
        ".vscode",
        "__pycache__",
        "build",
        "coverage",
        "dist",
        "node_modules",
        "scanscicache",
        "temp",
        "tmp",
        "venv",
    }
)
FORBIDDEN_NAMES = frozenset({".ds_store", "desktop.ini", "thumbs.db"})
FORBIDDEN_SUFFIXES = (
    ".bak",
    ".dll",
    ".dylib",
    ".exe",
    ".log",
    ".pak",
    ".pdf",
    ".pyc",
    ".pyd",
    ".so",
    ".tmp",
    ".xpi",
    ".zip",
)
MAX_TRACKED_FILE_BYTES = 2 * 1024 * 1024


def tracked_paths() -> list[PurePosixPath]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        check=True,
        capture_output=True,
    )
    return [
        PurePosixPath(value.decode("utf-8"))
        for value in result.stdout.split(b"\0")
        if value
    ]


def violations(path: PurePosixPath) -> list[str]:
    messages: list[str] = []
    normalized_parts = tuple(part.casefold() for part in path.parts)
    name = path.name.casefold()
    if not path.parts or path.parts[0] not in ALLOWED_TOP_LEVEL:
        messages.append("unexpected top-level path")
    if any(part in FORBIDDEN_SEGMENTS for part in normalized_parts):
        messages.append("generated/cache directory")
    if name in FORBIDDEN_NAMES or name.startswith(".env"):
        messages.append("machine-local file")
    if name.endswith(FORBIDDEN_SUFFIXES):
        messages.append("generated/binary artifact")
    file_path = Path(*path.parts)
    if file_path.is_file() and file_path.stat().st_size > MAX_TRACKED_FILE_BYTES:
        messages.append(f"file exceeds {MAX_TRACKED_FILE_BYTES} bytes")
    return messages


def main() -> int:
    rejected = [
        (path, reason)
        for path in tracked_paths()
        for reason in violations(path)
    ]
    if not rejected:
        print("Repository hygiene passed: tracked files contain no unrelated artifacts.")
        return 0
    for path, reason in rejected:
        print(f"::error file={path}::{reason}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
