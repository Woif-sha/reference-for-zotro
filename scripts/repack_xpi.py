"""Normalize the generated XPI so identical contents produce identical bytes."""

from __future__ import annotations

import os
from pathlib import Path
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


REPOSITORY = Path(__file__).resolve().parents[1]
BUILD_DIRECTORY = REPOSITORY / "build"
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
REGULAR_FILE_MODE = 0o100644


def repack(archive: Path) -> None:
    with ZipFile(archive) as source:
        names = [entry.filename for entry in source.infolist() if not entry.is_dir()]
        if len(names) != len(set(names)):
            raise ValueError("XPI contains duplicate members")
        files = [(name, source.read(name)) for name in sorted(names)]

    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f"{archive.stem}-",
            suffix=".xpi",
            dir=archive.parent,
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
        with ZipFile(
            temporary,
            "w",
            compression=ZIP_DEFLATED,
            compresslevel=9,
        ) as target:
            for name, contents in files:
                info = ZipInfo(name, FIXED_TIMESTAMP)
                info.compress_type = ZIP_DEFLATED
                info.create_system = 3
                info.external_attr = REGULAR_FILE_MODE << 16
                target.writestr(info, contents, compress_type=ZIP_DEFLATED, compresslevel=9)
        os.replace(temporary, archive)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    archives = sorted(BUILD_DIRECTORY.glob("*.xpi"))
    if len(archives) != 1:
        raise SystemExit(
            f"Expected exactly one built XPI in {BUILD_DIRECTORY}, found {len(archives)}"
        )
    repack(archives[0])


if __name__ == "__main__":
    main()
