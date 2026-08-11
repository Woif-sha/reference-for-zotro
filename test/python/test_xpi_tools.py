from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock
import warnings
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from scripts.repack_xpi import repack
from test.python import audit_scansci_xpi as xpi_audit
from test.python.audit_scansci_xpi import (
    EXPECTED_ADDON_NAME,
    EXPECTED_ADDON_VERSION,
    EXPECTED_UPDATE_URL,
    REQUIRED_ASSETS,
    audit_archive,
)


def valid_files() -> dict[str, bytes]:
    manifest = {
        "name": EXPECTED_ADDON_NAME,
        "version": EXPECTED_ADDON_VERSION,
        "applications": {
            "zotero": {
                "update_url": EXPECTED_UPDATE_URL,
                "strict_min_version": "9.0.6",
                "strict_max_version": "9.0.*",
            }
        },
    }
    bundle = "\n".join(
        [
            "reference-for-zotero.scansci-sidecar",
            "sidecar.py",
            "downloadOne",
            "downloadBatch",
            "visibleLogin",
        ]
    )
    files = {name: b"asset" for name in REQUIRED_ASSETS}
    files["manifest.json"] = json.dumps(manifest).encode()
    files["bootstrap.js"] = b"bootstrap"
    files["chrome/content/scripts/referenceforzotero.js"] = bundle.encode()
    files["locale/en-US/referenceforzotero-addon.ftl"] = b"key = Value"
    return files


def write_archive(path: Path, files: dict[str, bytes], *, reverse: bool = False) -> None:
    items = list(files.items())
    if reverse:
        items.reverse()
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        for index, (name, contents) in enumerate(items):
            info = ZipInfo(name, (2026, 8, 11, 12, index % 60, 0))
            archive.writestr(info, contents)


class XpiToolsTest(unittest.TestCase):
    def test_audit_accepts_the_bounded_registered_package(self):
        with tempfile.TemporaryDirectory() as root:
            archive = Path(root) / "valid.xpi"
            write_archive(archive, valid_files())
            summary = audit_archive(archive)

        self.assertEqual(summary.member_count, len(valid_files()))
        self.assertEqual(len(summary.sha256), 64)

    def test_manifest_expectations_can_follow_stable_release_metadata(self):
        files = valid_files()
        manifest = json.loads(files["manifest.json"])
        manifest["name"] = "Reference for Zotero"
        manifest["version"] = "1.1.0"
        manifest["applications"]["zotero"]["update_url"] = (
            "https://github.com/Woif-sha/reference-for-zotro/"
            "releases/latest/download/update.json"
        )
        files["manifest.json"] = json.dumps(manifest).encode()

        with tempfile.TemporaryDirectory() as root:
            archive = Path(root) / "stable.xpi"
            write_archive(archive, files)
            with (
                mock.patch.object(
                    xpi_audit, "EXPECTED_ADDON_NAME", "Reference for Zotero"
                ),
                mock.patch.object(xpi_audit, "EXPECTED_ADDON_VERSION", "1.1.0"),
                mock.patch.object(
                    xpi_audit,
                    "EXPECTED_UPDATE_URL",
                    "https://github.com/Woif-sha/reference-for-zotro/"
                    "releases/latest/download/update.json",
                ),
            ):
                xpi_audit.audit_archive(archive)

    def test_audit_rejects_duplicate_traversal_secret_and_link_members(self):
        cases = []
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root)
            duplicate = root_path / "duplicate.xpi"
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                with ZipFile(duplicate, "w") as archive:
                    for name, contents in valid_files().items():
                        archive.writestr(name, contents)
                    archive.writestr("NOTICE", b"duplicate")
            cases.append((duplicate, "duplicate"))

            traversal = root_path / "traversal.xpi"
            write_archive(traversal, {**valid_files(), "../escape.txt": b"bad"})
            cases.append((traversal, "unsafe"))

            secret = root_path / "secret.xpi"
            write_archive(secret, {**valid_files(), "python/api-key.txt": b"bad"})
            cases.append((secret, "forbidden"))

            link = root_path / "link.xpi"
            write_archive(link, valid_files())
            with ZipFile(link, "a") as archive:
                info = ZipInfo("python/link")
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, "target")
            cases.append((link, "symbolic link"))

            for archive, message in cases:
                with self.subTest(archive=archive.name):
                    with self.assertRaisesRegex(ValueError, message):
                        audit_archive(archive)

    def test_repack_is_deterministic_across_order_and_timestamp(self):
        with tempfile.TemporaryDirectory() as root:
            first = Path(root) / "first.xpi"
            second = Path(root) / "second.xpi"
            write_archive(first, valid_files())
            write_archive(second, valid_files(), reverse=True)

            repack(first)
            repack(second)

            self.assertEqual(
                sha256(first.read_bytes()).hexdigest(),
                sha256(second.read_bytes()).hexdigest(),
            )


if __name__ == "__main__":
    unittest.main()
