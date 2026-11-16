from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import textwrap
import unittest


REPOSITORY = Path(__file__).resolve().parents[2]
WORKFLOW = REPOSITORY / ".github" / "workflows" / "release.yml"
VERSION = "2.0.4"
TAG = f"v{VERSION}"


def publication_script() -> str:
    workflow = WORKFLOW.read_text(encoding="utf-8")
    step = workflow.split("      - name: Create immutable GitHub Release\n", 1)[1]
    return textwrap.dedent(step.split("        run: |\n", 1)[1])


class ReleaseWorkflowTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="rfz-release-")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.checkout = root / "checkout"
        self.checkout.mkdir()
        self.remote = root / "origin.git"
        self.runner_temp = root / "runner"
        self.runner_temp.mkdir()
        self.release_calls = root / "release-calls.txt"
        self.git("init", "--initial-branch=main")
        self.git("config", "user.name", "Release workflow test")
        self.git("config", "user.email", "release-test@example.invalid")
        (self.checkout / "CHANGELOG.md").write_text(
            f"## [{VERSION}] - 2026-11-16\n\nRelease fixture.\n", encoding="utf-8"
        )
        source = self.checkout / "source.txt"
        source.write_text("triggered source\n", encoding="utf-8")
        self.git("add", ".")
        self.git("-c", "commit.gpgsign=false", "commit", "-m", "Triggered source")
        self.trigger_commit = self.git("rev-parse", "HEAD").stdout.strip()
        source.write_text("built source\n", encoding="utf-8")
        self.git("-c", "commit.gpgsign=false", "commit", "-am", "Built source")
        self.built_commit = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("init", "--bare", self.remote.as_posix())
        self.git("remote", "add", "origin", self.remote.as_posix())
        self.git("push", "origin", "main")
        build = self.checkout / "build"
        build.mkdir()
        (build / "test.xpi").write_text(self.built_commit, encoding="utf-8")
        (build / "update.json").write_text("{}", encoding="utf-8")

    def git(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["git", *arguments],
            cwd=self.checkout,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )

    def publish(self) -> subprocess.CompletedProcess[str]:
        if os.name == "nt":
            git = Path(shutil.which("git"))
            bash = git.parent.parent / "bin" / "bash.exe"
        else:
            bash = shutil.which("bash")
        environment = {
            **os.environ,
            "VERSION": VERSION,
            "GITHUB_SHA": self.trigger_commit,
            "GITHUB_REPOSITORY": "fixture/reference-for-zotero",
            "RUNNER_TEMP": self.runner_temp.as_posix(),
            "RELEASE_CALLS": self.release_calls.as_posix(),
        }
        stub_github = """
gh() {
  if [ "$1 $2" = "release view" ]; then return 1; fi
  printf '%s\\n' "$@" > "$RELEASE_CALLS"
}
"""
        return subprocess.run(
            [str(bash), "-e", "-o", "pipefail", "-s"],
            input=stub_github + publication_script(),
            cwd=self.checkout,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )

    def assert_tag_points_to(self, commit: str):
        remote_tag = self.git("ls-remote", "--tags", "origin", f"refs/tags/{TAG}")
        self.assertEqual(remote_tag.stdout.split()[0], commit)

    def assert_release_created(self):
        self.assertEqual(
            self.release_calls.read_text(encoding="utf-8").splitlines()[:3],
            ["release", "create", TAG],
        )

    def test_new_tag_points_to_built_commit_instead_of_trigger_commit(self):
        result = self.publish()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_tag_points_to(self.built_commit)
        self.assert_release_created()

    def test_existing_tag_for_built_commit_is_accepted(self):
        self.git("tag", TAG, self.built_commit)
        self.git("push", "origin", TAG)

        result = self.publish()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_tag_points_to(self.built_commit)
        self.assert_release_created()

    def test_existing_tag_for_other_commit_blocks_publication(self):
        self.git("tag", TAG, self.trigger_commit)
        self.git("push", "origin", TAG)

        result = self.publish()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not point to the release commit", result.stderr)
        self.assert_tag_points_to(self.trigger_commit)
        self.assertFalse(self.release_calls.exists())


if __name__ == "__main__":
    unittest.main()
