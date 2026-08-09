from pathlib import Path
import sys
from zipfile import ZipFile


REPOSITORY = Path(__file__).resolve().parents[2]
BUILD_DIRECTORY = REPOSITORY / "build"
REQUIRED_ASSETS = {
    "NOTICE",
    "python/reference_for_zotero_scansci/__init__.py",
    "python/reference_for_zotero_scansci/bridge.py",
    "python/reference_for_zotero_scansci/strict_http.py",
    "python/reference_for_zotero_scansci/source-rules-v3.json",
    "python/reference_for_zotero_scansci/VENDORED-SOURCE.json",
    "python/reference_for_zotero_scansci/MODIFICATIONS.md",
    "python/reference_for_zotero_scansci/requirements.lock",
    "python/reference_for_zotero_scansci/institution-requirements.lock",
    "python/reference_for_zotero_scansci/browser-runtime-policy-v3.json",
    "python/reference_for_zotero_scansci/vendored/__init__.py",
    "python/reference_for_zotero_scansci/THIRD-PARTY-LICENSES/SCANSci-APACHE-2.0.txt",
    "python/reference_for_zotero_scansci/vendored/sources.py",
}
FORBIDDEN_PARTS = {
    "__pycache__",
    "scansci_pdf",
    "browsermetrics-spare.pma",
    "grshadercache",
    "graphitedawncache",
    "shadercache",
    "local state",
    "cookies",
    "venv",
    "pyproject.toml",
    ".git",
}
FORBIDDEN_SUFFIXES = (
    ".pyc",
    ".pyd",
    ".so",
    ".dll",
    ".dylib",
    ".exe",
    ".pak",
    ".bin",
    ".zip",
    ".pdf",
)


def main():
    archives = sorted(BUILD_DIRECTORY.glob("*.xpi"))
    if len(archives) != 1:
        raise SystemExit(
            f"Expected exactly one built XPI in {BUILD_DIRECTORY}, found {len(archives)}"
        )

    archive = archives[0]
    with ZipFile(archive) as package:
        names = {name.rstrip("/") for name in package.namelist() if name.rstrip("/")}

    missing = sorted(REQUIRED_ASSETS - names)
    if missing:
        raise SystemExit(f"XPI is missing required ScanSci assets: {missing}")

    forbidden = []
    for name in sorted(names):
        normalized = name.replace("\\", "/").casefold()
        parts = normalized.split("/")
        if (
            any(marker in parts or marker in normalized for marker in FORBIDDEN_PARTS)
            or normalized.endswith(FORBIDDEN_SUFFIXES)
            or "/_core/" in f"/{normalized}/"
        ):
            forbidden.append(name)
    if forbidden:
        raise SystemExit(f"XPI contains forbidden ScanSci assets: {forbidden}")

    print(f"Audited {archive.name}: required assets present; denylist clean")


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    main()
