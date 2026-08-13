import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlparse

sys.dont_write_bytecode = True


REPOSITORY = Path(__file__).resolve().parents[2]
MODULE_ROOT = REPOSITORY / "addon" / "python" / "reference_for_zotero_scansci"
BRIDGE = MODULE_ROOT / "bridge.py"
SOURCES = MODULE_ROOT / "vendored" / "sources.py"


class ScanSciBridgeTest(unittest.TestCase):
    def test_probe_is_one_stdout_message_and_has_no_side_effects(self):
        response, stderr = run_bridge("probe", {})

        self.assertEqual(stderr, "")
        self.assertTrue(response["ok"])
        self.assertEqual(response["schemaVersion"], 3)
        self.assertEqual(response["sourceRulesVersion"], 3)
        self.assertEqual(response["result"]["moduleVersion"], "3.2.0")
        self.assertEqual(response["result"]["features"]["visibleLogin"], "disabled")
        self.assertEqual(
            [item["name"] for item in response["result"]["dependencies"]],
            ["requests", "certifi", "charset-normalizer", "idna", "urllib3"],
        )
        self.assertEqual(
            [item["requirement"] for item in response["result"]["dependencies"]],
            [
                "==2.34.2",
                "==2026.7.22",
                "==3.4.9",
                "==3.18",
                "==2.7.0",
            ],
        )
        self.assertFalse(any(MODULE_ROOT.rglob("__pycache__")))
        self.assertFalse(any(MODULE_ROOT.rglob("*.pyc")))

    def test_visible_login_is_explicitly_disabled(self):
        response, stderr = run_bridge(
            "visible-login",
            {"userInitiated": True, "routeID": "institution-browser"},
        )

        self.assertEqual(stderr, "")
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "route-disabled")

    def test_download_rejects_any_policy_wider_than_legal_only(self):
        response, stderr = run_bridge(
            "download-one",
            {
                "paper": {"title": "Paper", "arxivID": "2101.00001"},
                "outputDirectory": str(REPOSITORY),
                "policy": {
                    "strategy": "legal_only",
                    "scihubEnabled": True,
                    "useTor": False,
                    "useVpnsci": False,
                },
            },
        )

        self.assertEqual(stderr, "")
        self.assertFalse(response["ok"])
        self.assertIn("legal-only", response["error"]["message"])

    def test_vendored_identifier_fragments_construct_only_fixed_routes(self):
        sources = load_sources()

        self.assertEqual(sources.normalize_arxiv_id("arXiv:2101.00001v2"), "2101.00001")
        self.assertEqual(
            sources.arxiv_pdf_url("10.48550/arXiv.2101.00001"),
            "https://arxiv.org/pdf/2101.00001.pdf",
        )
        self.assertEqual(
            sources.pmc_pdf_url("pmc12345"),
            "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12345/pdf/",
        )
        self.assertIsNone(sources.pmc_pdf_url("../../outside"))

    def test_conflicting_arxiv_identifiers_fail_before_network_access(self):
        response, _ = run_bridge(
            "download-one",
            {
                "paper": {
                    "title": "Conflicting paper",
                    "arxivID": "2101.00001",
                    "doi": "10.48550/arXiv.2201.00001",
                },
                "outputDirectory": str(REPOSITORY),
                "policy": {
                    "strategy": "legal_only",
                    "scihubEnabled": False,
                    "useTor": False,
                    "useVpnsci": False,
                },
            },
        )

        self.assertFalse(response["ok"])
        self.assertIn("conflicting arXiv", response["error"]["message"])

    def test_strict_transport_never_deletes_a_preexisting_collision(self):
        strict_http = load_module("rfz_strict_http", MODULE_ROOT / "strict_http.py")
        response = FakeResponse(200)
        client = strict_http.StrictHttpClient.__new__(strict_http.StrictHttpClient)
        client._request = lambda _url, stream: (response, "https://arxiv.org/paper")
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "paper.pdf"
            target.write_bytes(b"existing")

            with self.assertRaises(FileExistsError):
                client.download_to("https://arxiv.org/paper", target)

            self.assertEqual(target.read_bytes(), b"existing")

    def test_strict_transport_records_every_redirect_egress_host(self):
        strict_http = load_module("rfz_strict_http_redirect", MODULE_ROOT / "strict_http.py")
        client = strict_http.StrictHttpClient.__new__(strict_http.StrictHttpClient)
        client._session = FakeSession(
            [
                FakeResponse(302, {"Location": "https://export.arxiv.org/paper"}),
                FakeResponse(200),
            ]
        )
        client._timeout_seconds = 1
        client.egress_hosts = []
        client._validate_egress = lambda url: urlparse(url).hostname

        response, final_url = client._request("https://arxiv.org/paper", stream=True)

        self.assertEqual(final_url, "https://export.arxiv.org/paper")
        self.assertEqual(client.egress_hosts, ["arxiv.org", "export.arxiv.org"])
        response.close()


def run_bridge(operation, request):
    process = subprocess.run(
        [sys.executable, "-B", "-E", "-s", str(BRIDGE)],
        input=json.dumps(
            {
                "schemaVersion": 3,
                "sourceRulesVersion": 3,
                "operation": operation,
                "request": request,
            }
        ),
        text=True,
        capture_output=True,
        check=True,
        timeout=15,
    )
    lines = process.stdout.splitlines()
    if len(lines) != 1:
        raise AssertionError(f"Expected one stdout protocol line, got {lines!r}")
    return json.loads(lines[0]), process.stderr


def load_sources():
    return load_module("rfz_vendored_sources", SOURCES)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError("Cannot load vendored sources")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, status_code, headers=None):
        self.status_code = status_code
        self.headers = headers or {}
        self.raw = FakeRawConnection()

    def close(self):
        pass

    def iter_content(self, chunk_size):
        del chunk_size
        yield b"download"


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)

    def get(self, *args, **kwargs):
        del args, kwargs
        return self.responses.pop(0)


class FakeRawConnection:
    class _Connection:
        class _Socket:
            def getpeername(self):
                return ("8.8.8.8", 443)

        sock = _Socket()

    _connection = _Connection()


if __name__ == "__main__":
    unittest.main()
