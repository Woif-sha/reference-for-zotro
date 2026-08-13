from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import stat
import sys
from zipfile import BadZipFile, ZipFile, ZipInfo


REPOSITORY = Path(__file__).resolve().parents[2]
BUILD_DIRECTORY = REPOSITORY / "build"
POLICY_PATH = REPOSITORY / "test" / "xpi" / "package-policy.json"
PACKAGE_METADATA = json.loads((REPOSITORY / "package.json").read_text(encoding="utf-8"))
EXPECTED_ADDON_NAME = PACKAGE_METADATA["config"]["addonName"]
EXPECTED_ADDON_VERSION = PACKAGE_METADATA["version"]
EXPECTED_XPI_FILENAME = "reference-for-zotero.xpi"
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
    "python/reference_for_zotero_scansci/vendored/__init__.py",
    "python/reference_for_zotero_scansci/THIRD-PARTY-LICENSES/SCANSci-APACHE-2.0.txt",
    "python/reference_for_zotero_scansci/vendored/sources.py",
}
EXPECTED_UPDATE_URL = "https://github.com/Woif-sha/reference-for-zotro/releases/latest/download/" + (
    "update-beta.json" if "-" in EXPECTED_ADDON_VERSION else "update.json"
)


@dataclass(frozen=True)
class AuditSummary:
    filename: str
    size_bytes: int
    sha256: str
    member_count: int


def load_policy() -> dict[str, object]:
    return json.loads(POLICY_PATH.read_text(encoding="utf-8"))


def audit_archive(archive: Path) -> AuditSummary:
    policy = load_policy()
    with ZipFile(archive) as package:
        entries = [entry for entry in package.infolist() if not entry.is_dir()]
        _validate_entries(entries, policy)
        names = {entry.filename for entry in entries}
        manifest = json.loads(package.read("manifest.json"))
        production_javascript = package.read(
            "chrome/content/scripts/referenceforzotero.js"
        ).decode("utf-8")

    _validate_manifest(manifest)
    missing = sorted(REQUIRED_ASSETS - names)
    if missing:
        raise ValueError(f"XPI is missing required ScanSci assets: {missing}")
    unexpected_python = sorted(
        name
        for name in names
        if name.startswith("python/") and name not in REQUIRED_ASSETS
    )
    if unexpected_python:
        raise ValueError(
            f"XPI contains unregistered Python module assets: {unexpected_python}"
        )
    _validate_production_bundle(production_javascript)

    contents = archive.read_bytes()
    return AuditSummary(
        filename=archive.name,
        size_bytes=len(contents),
        sha256=sha256(contents).hexdigest(),
        member_count=len(names),
    )


def _validate_entries(entries: list[ZipInfo], policy: dict[str, object]) -> None:
    names = [entry.filename for entry in entries]
    if len(names) != len(set(names)):
        raise ValueError("XPI contains duplicate ZIP members")
    max_members = int(policy["maxMembers"])
    if len(entries) > max_members:
        raise ValueError(f"XPI contains more than {max_members} members")

    total_size = 0
    for entry in entries:
        _validate_member_path(entry, policy)
        if entry.flag_bits & 0x1:
            raise ValueError(f"XPI member is encrypted: {entry.filename}")
        unix_mode = entry.external_attr >> 16
        if stat.S_ISLNK(unix_mode):
            raise ValueError(f"XPI member is a symbolic link: {entry.filename}")
        max_member_bytes = int(policy["maxMemberBytes"])
        if entry.file_size > max_member_bytes:
            raise ValueError(f"XPI member exceeds size limit: {entry.filename}")
        if entry.file_size > max(1, entry.compress_size) * int(
            policy["maxCompressionRatio"]
        ):
            raise ValueError(f"XPI member exceeds compression ratio: {entry.filename}")
        total_size += entry.file_size
    if total_size > int(policy["maxUncompressedBytes"]):
        raise ValueError("XPI exceeds the total uncompressed size limit")


def _validate_member_path(entry: ZipInfo, policy: dict[str, object]) -> None:
    name = entry.filename
    if "\\" in name:
        raise ValueError(f"XPI member uses a backslash path: {name}")
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError(f"XPI member path is unsafe: {name}")
    if path.parts[0] not in set(policy["allowedTopLevel"]):
        raise ValueError(f"XPI member has an unexpected top-level path: {name}")

    normalized = name.casefold()
    segments = {part.casefold() for part in path.parts}
    forbidden_segments = {
        str(part).casefold() for part in policy["forbiddenPathSegments"]
    }
    forbidden_fragments = [
        str(fragment).casefold() for fragment in policy["forbiddenNameFragments"]
    ]
    forbidden_suffixes = tuple(
        str(suffix).casefold() for suffix in policy["forbiddenSuffixes"]
    )
    if (
        segments & forbidden_segments
        or any(fragment in normalized for fragment in forbidden_fragments)
        or normalized.endswith(forbidden_suffixes)
    ):
        raise ValueError(f"XPI contains a forbidden asset: {name}")


def _validate_manifest(manifest: object) -> None:
    if not isinstance(manifest, dict):
        raise ValueError("XPI manifest must be an object")
    applications = manifest.get("applications")
    if not isinstance(applications, dict) or not isinstance(
        applications.get("zotero"), dict
    ):
        raise ValueError("XPI Zotero application manifest is invalid")
    zotero = applications["zotero"]
    if manifest.get("name") != EXPECTED_ADDON_NAME:
        raise ValueError("XPI addon name does not match package metadata")
    if manifest.get("version") != EXPECTED_ADDON_VERSION:
        raise ValueError("XPI version does not match package metadata")
    if zotero.get("update_url") != EXPECTED_UPDATE_URL:
        raise ValueError("XPI update_url is unexpected")
    if zotero.get("strict_min_version") != "9.0.6" or zotero.get(
        "strict_max_version"
    ) != "9.0.*":
        raise ValueError("Test XPI Zotero compatibility range is unexpected")


def _validate_production_bundle(production_javascript: str) -> None:
    required_protocol_markers = {
        "reference-for-zotero.scansci-sidecar",
        "sidecar.py",
        "downloadOne",
        "downloadBatch",
        "visibleLogin",
    }
    missing = sorted(
        marker
        for marker in required_protocol_markers
        if marker not in production_javascript
    )
    if missing:
        raise ValueError(f"XPI production adapter is missing protocol markers: {missing}")
    if '"download-one"' in production_javascript:
        raise ValueError("XPI production adapter contains the legacy bridge protocol")
    for marker in (
        "prepareRuntime",
        "pythonExecutable",
        "privateRuntimeRoot",
        "allowInstall",
        "executableOverride",
    ):
        if marker in production_javascript:
            raise ValueError(f"XPI contains an obsolete runtime path: {marker}")


def main() -> None:
    archives = sorted(BUILD_DIRECTORY.glob("*.xpi"))
    if len(archives) != 1:
        raise SystemExit(
            f"Expected exactly one built XPI in {BUILD_DIRECTORY}, found {len(archives)}"
        )
    if archives[0].name != EXPECTED_XPI_FILENAME:
        raise SystemExit(
            f"Expected XPI filename {EXPECTED_XPI_FILENAME}, found {archives[0].name}"
        )
    try:
        summary = audit_archive(archives[0])
    except (BadZipFile, KeyError, UnicodeDecodeError, ValueError) as error:
        raise SystemExit(str(error)) from error
    print(
        "Audited "
        f"{summary.filename}: size_bytes={summary.size_bytes}; "
        f"sha256={summary.sha256}; member_count={summary.member_count}; "
        "required assets present; denylist clean"
    )


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    main()
