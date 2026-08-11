import json
from pathlib import Path
import sys
from zipfile import ZipFile


REPOSITORY = Path(__file__).resolve().parents[2]
BUILD_DIRECTORY = REPOSITORY / "build"
REQUIRED_ASSETS = {
    "NOTICE",
    "python/reference_for_zotero_scansci/__init__.py",
    "python/reference_for_zotero_scansci/bridge.py",
    "python/reference_for_zotero_scansci/sidecar.py",
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
    "diagnostics",
    "scanscicache",
    "test",
    "tests",
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
    ".log",
)
EXPECTED_UPDATE_URL = (
    "https://github.com/Woif-sha/reference-for-zotro/"
    "releases/latest/download/update-beta.json"
)


def main():
    archives = sorted(BUILD_DIRECTORY.glob("*.xpi"))
    if len(archives) != 1:
        raise SystemExit(
            f"Expected exactly one built XPI in {BUILD_DIRECTORY}, found {len(archives)}"
        )

    archive = archives[0]
    with ZipFile(archive) as package:
        names = {
            name for name in package.namelist() if name and not name.endswith("/")
        }
        manifest = json.loads(package.read("manifest.json"))
        production_javascript = package.read(
            "chrome/content/scripts/referenceforzotero.js"
        ).decode("utf-8")

    zotero = manifest.get("applications", {}).get("zotero", {})
    if manifest.get("name") != "Reference for Zotero (Second-stage Test)":
        raise SystemExit("XPI is not visibly marked as the second-stage test build")
    if manifest.get("version") != "1.1.0-beta.1":
        raise SystemExit("XPI test-build version is unexpected")
    if zotero.get("update_url") != EXPECTED_UPDATE_URL:
        raise SystemExit(
            "XPI is missing the update_url required by Zotero's bootstrap-addon "
            "manifest validation"
        )
    if zotero.get("strict_min_version") != "9.0.6" or zotero.get(
        "strict_max_version"
    ) != "9.0.*":
        raise SystemExit("Test XPI Zotero compatibility range is unexpected")

    missing = sorted(REQUIRED_ASSETS - names)
    if missing:
        raise SystemExit(f"XPI is missing required ScanSci assets: {missing}")

    unexpected_python = sorted(
        name
        for name in names
        if name.startswith("python/") and name not in REQUIRED_ASSETS
    )
    if unexpected_python:
        raise SystemExit(
            f"XPI contains unregistered Python module assets: {unexpected_python}"
        )

    required_protocol_markers = {
        "reference-for-zotero.scansci-sidecar",
        "sidecar.py",
        "downloadOne",
        "downloadBatch",
        "visibleLogin",
    }
    missing_protocol_markers = sorted(
        marker
        for marker in required_protocol_markers
        if marker not in production_javascript
    )
    if missing_protocol_markers:
        raise SystemExit(
            "XPI production adapter is missing sidecar protocol markers: "
            f"{missing_protocol_markers}"
        )
    if '"download-one"' in production_javascript:
        raise SystemExit("XPI production adapter still contains the legacy bridge protocol")

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
