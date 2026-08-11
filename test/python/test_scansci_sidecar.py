import io
import json
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True


REPOSITORY = Path(__file__).resolve().parents[2]
MODULE_ROOT = REPOSITORY / "addon" / "python" / "reference_for_zotero_scansci"
SIDECAR_PATH = MODULE_ROOT / "sidecar.py"
sys.path.insert(0, str(MODULE_ROOT))

import sidecar


def request(operation, request_id="request-1", **params):
    value = {
        "protocol": sidecar.PROTOCOL,
        "contractVersion": sidecar.CONTRACT_VERSION,
        "resultSchemaVersion": sidecar.RESULT_SCHEMA_VERSION,
        "requestId": request_id,
        "operation": operation,
        "params": params,
    }
    return value


def output_directory(root, request_id="request-1"):
    output = Path(root) / "ScanSciCache" / request_id
    output.mkdir(parents=True)
    return output


def fake_capability():
    return {
        "executable": str(Path(sys.executable).resolve()),
        "pythonVersion": "3.12.10",
        "architecture": "x64",
        "moduleVersion": "3.2.0",
        "dependencies": [],
        "features": {"onePaperDownload": "available", "visibleLogin": "disabled"},
    }


def raw_success(output, source_id="arxiv"):
    path = Path(output) / f"{source_id}.pdf"
    path.write_bytes(b"pdf")
    if source_id == "arxiv":
        url = "https://arxiv.org/pdf/2101.00001.pdf"
        hosts = ["arxiv.org"]
    else:
        url = "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123/pdf/"
        hosts = ["www.ncbi.nlm.nih.gov"]
    return {
        "source": {"id": source_id, "url": url, "egressHosts": hosts},
        "outputPath": str(path),
    }


class ScanSciSidecarTest(unittest.TestCase):
    def test_probe_reports_plugin_owned_source_and_candidate_route(self):
        service = sidecar.Sidecar(lambda message: None, io.StringIO(), capability_probe=fake_capability)

        response = service.handle(request("probe"))

        self.assertTrue(response["ok"])
        payload = response["payload"]
        self.assertEqual(payload["application"]["name"], "reference-for-zotero-scansci")
        self.assertEqual(payload["contractVersion"], "1.1.0")
        self.assertEqual(payload["resultSchemaVersion"], "1.0.0")
        self.assertEqual(
            payload["operations"], ["downloadBatch", "downloadOne", "probe", "visibleLogin"]
        )
        self.assertEqual(payload["source"]["repository"], "Rimagination/scansci-pdf")
        self.assertEqual(
            payload["source"]["revision"],
            "5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5",
        )
        self.assertFalse(payload["source"]["dirty"])
        self.assertEqual(
            payload["compatibility"],
            {
                "status": "compatible",
                "minimumPython": "3.11",
                "dependencies": [],
            },
        )
        candidate = next(
            route
            for route in payload["routeCapabilities"]
            if route["routeId"] == sidecar.INSTITUTION_ROUTE_ID
        )
        self.assertEqual(candidate["status"], "candidate")
        self.assertFalse(candidate["available"])

    def test_incompatible_contract_fails_before_downloader(self):
        called = False

        def download(_request):
            nonlocal called
            called = True

        service = sidecar.Sidecar(lambda message: None, io.StringIO(), download=download)
        with tempfile.TemporaryDirectory() as root:
            output = output_directory(root)
            value = request(
                "downloadOne",
                paper={"title": "Paper", "arxivID": "2101.00001"},
                outputDir=str(output),
            )
            value["contractVersion"] = "99"

            response = service.handle(value)

        self.assertEqual(response["error"]["code"], "incompatible-contract")
        self.assertFalse(called)

    def test_protocol_rejects_unknown_operations_fields_and_secrets(self):
        service = sidecar.Sidecar(lambda message: None, io.StringIO())
        self.assertEqual(
            service.handle(request("configWrite"))["error"]["code"],
            "unsupported-operation",
        )
        value = request("probe")
        value["config"] = {}
        self.assertEqual(service.handle(value)["error"]["code"], "invalid-request")
        missing_protocol = request("probe")
        del missing_protocol["protocol"]
        self.assertEqual(
            service.handle(missing_protocol)["error"]["code"], "invalid-request"
        )
        missing_params = request("probe")
        del missing_params["params"]
        self.assertEqual(
            service.handle(missing_params)["error"]["code"], "invalid-request"
        )
        incompatible_probe = request("probe")
        incompatible_probe["contractVersion"] = "99"
        self.assertEqual(
            service.handle(incompatible_probe)["error"]["code"],
            "incompatible-contract",
        )
        incompatible_probe = request("probe")
        incompatible_probe["resultSchemaVersion"] = "99"
        self.assertEqual(
            service.handle(incompatible_probe)["error"]["code"],
            "incompatible-result-schema",
        )
        secret = request("visibleLogin", routeId=sidecar.INSTITUTION_ROUTE_ID, userInitiated=True)
        secret["params"]["password"] = "do-not-log"
        self.assertEqual(service.handle(secret)["error"]["code"], "forbidden-parameter")

    def test_download_one_forces_policy_and_returns_relative_path(self):
        captured = {}

        def download(value):
            captured.update(value)
            return raw_success(value["outputDirectory"])

        service = sidecar.Sidecar(lambda message: None, io.StringIO(), download=download)
        with tempfile.TemporaryDirectory() as root:
            output = output_directory(root)
            response = service.handle(
                request(
                    "downloadOne",
                    paper={"title": "Paper", "arxivID": "2101.00001"},
                    outputDir=str(output),
                )
            )

        self.assertTrue(response["ok"])
        result = response["payload"]["result"]
        self.assertEqual(result["status"], "downloaded")
        self.assertEqual(result["identifier"], "2101.00001")
        self.assertEqual(result["relativePath"], "arxiv.pdf")
        self.assertEqual(result["sourceEvidence"]["source"], "arxiv")
        self.assertEqual(captured["policy"], sidecar.FORCED_POLICY)

    def test_output_directory_accepts_a_regular_canonical_alias(self):
        with tempfile.TemporaryDirectory() as root:
            output = output_directory(root)
            canonical = output.resolve()
            alias = output.parent.parent / "RUNNER~1" / "ScanSciCache" / output.name
            with (
                mock.patch.object(sidecar.os.path, "abspath", return_value=str(alias)),
                mock.patch.object(sidecar, "_contains_reparse_point", return_value=False),
                mock.patch.object(sidecar.Path, "resolve", return_value=canonical),
            ):
                validated = sidecar._validate_output_dir(str(output), "request-1")

        self.assertEqual(validated, canonical)

    def test_download_batch_is_bounded_and_streams_each_final_result(self):
        workers_started = threading.Event()
        state_lock = threading.Lock()
        active = 0
        maximum_active = 0
        emitted = []

        def download(value):
            nonlocal active, maximum_active
            with state_lock:
                active += 1
                maximum_active = max(maximum_active, active)
                if maximum_active == sidecar.MAX_BATCH_WORKERS:
                    workers_started.set()
            self.assertTrue(workers_started.wait(timeout=2))
            paper = value["paper"]
            arxiv_id = paper["arxivID"]
            time.sleep(int(arxiv_id.rsplit(".", 1)[1]) * 0.002)
            path = Path(value["outputDirectory"]) / f"{arxiv_id}.pdf"
            path.write_bytes(b"pdf")
            result = {
                "source": {
                    "id": "arxiv",
                    "url": f"https://arxiv.org/pdf/{arxiv_id}.pdf",
                    "egressHosts": ["arxiv.org"],
                },
                "outputPath": str(path),
            }
            with state_lock:
                active -= 1
            return result

        service = sidecar.Sidecar(emitted.append, io.StringIO(), download=download)
        with tempfile.TemporaryDirectory() as root:
            output = output_directory(root, "batch-1")
            response = service.handle(
                request(
                    "downloadBatch",
                    request_id="batch-1",
                    outputDir=str(output),
                    items=[
                        {
                            "itemId": f"item-{index}",
                            "paper": {
                                "title": f"Paper {index}",
                                "arxivID": f"2101.{index:05d}",
                            },
                        }
                        for index in range(1, 8)
                    ],
                )
            )

        self.assertTrue(response["ok"])
        self.assertEqual(response["payload"]["downloaded"], 7)
        self.assertEqual(maximum_active, sidecar.MAX_BATCH_WORKERS)
        self.assertEqual(len(emitted), 7)
        self.assertEqual(
            {event["payload"]["itemId"] for event in emitted},
            {f"item-{index}" for index in range(1, 8)},
        )
        self.assertEqual(
            [event["payload"]["sequence"] for event in emitted],
            list(range(1, 8)),
        )
        self.assertTrue(all(event["type"] == "progress" for event in emitted))

    def test_output_escape_and_unknown_source_are_failed_results(self):
        with tempfile.TemporaryDirectory() as root:
            output = output_directory(root)
            outside = Path(root) / "outside.pdf"
            outside.write_bytes(b"pdf")

            def outside_download(_value):
                return {
                    "source": {
                        "id": "arxiv",
                        "url": "https://arxiv.org/pdf/2101.00001.pdf",
                        "egressHosts": ["arxiv.org"],
                    },
                    "outputPath": str(outside),
                }

            service = sidecar.Sidecar(lambda message: None, io.StringIO(), download=outside_download)
            response = service.handle(
                request(
                    "downloadOne",
                    paper={"title": "Paper", "arxivID": "2101.00001"},
                    outputDir=str(output),
                )
            )
            self.assertEqual(
                response["payload"]["result"]["error"]["code"], "output-outside-root"
            )

        with tempfile.TemporaryDirectory() as root:
            output = output_directory(root)

            def forbidden_download(value):
                path = Path(value["outputDirectory"]) / "paper.pdf"
                path.write_bytes(b"pdf")
                return {
                    "source": {
                        "id": "scihub",
                        "url": "https://example.test/paper.pdf",
                        "egressHosts": ["example.test"],
                    },
                    "outputPath": str(path),
                }

            service = sidecar.Sidecar(lambda message: None, io.StringIO(), download=forbidden_download)
            response = service.handle(
                request(
                    "downloadOne",
                    paper={"title": "Paper", "arxivID": "2101.00001"},
                    outputDir=str(output),
                )
            )
            self.assertEqual(response["payload"]["result"]["error"]["code"], "unknown-source")

    def test_output_link_inside_request_directory_is_a_failed_result(self):
        with tempfile.TemporaryDirectory() as root:
            output = output_directory(root)
            regular = output / "regular.pdf"
            link = output / "linked.pdf"

            def linked_download(_value):
                regular.write_bytes(b"pdf")
                try:
                    link.symlink_to(regular)
                except OSError as error:
                    self.skipTest(f"symbolic links unavailable: {error}")
                return {
                    "source": {
                        "id": "arxiv",
                        "url": "https://arxiv.org/pdf/2101.00001.pdf",
                        "egressHosts": ["arxiv.org"],
                    },
                    "outputPath": str(link),
                }

            service = sidecar.Sidecar(
                lambda message: None,
                io.StringIO(),
                download=linked_download,
            )
            response = service.handle(
                request(
                    "downloadOne",
                    paper={"title": "Paper", "arxivID": "2101.00001"},
                    outputDir=str(output),
                )
            )

        self.assertEqual(
            response["payload"]["result"]["error"]["code"],
            "output-reparse-point",
        )

    def test_reparse_inspection_failure_is_not_treated_as_a_regular_path(self):
        with mock.patch.object(sidecar.os, "lstat", side_effect=PermissionError("denied")):
            with self.assertRaises(PermissionError):
                sidecar._is_reparse_point(Path("uninspectable.pdf"))

    def test_visible_login_never_claims_candidate_is_available(self):
        service = sidecar.Sidecar(lambda message: None, io.StringIO())
        response = service.handle(
            request(
                "visibleLogin",
                routeId=sidecar.INSTITUTION_ROUTE_ID,
                userInitiated=True,
            )
        )
        self.assertEqual(response["error"]["code"], "route-candidate")

    def test_diagnostics_are_bounded_and_redacted(self):
        target = io.StringIO()
        writer = sidecar.BoundedRedactingWriter(target, limit=96)
        writer.write("Authorization: Basic dXNlcjpwYXNz\n")
        writer.write("Cookie: sid=secret; token=also-secret\n")
        writer.write('{"password":"json-secret"}\n')
        writer.write('{"token":12345}\n')
        writer.write("https://example.test/path?token=url-secret\n")
        writer.write("x" * 1000)
        writer.write("y" * 1000)
        writer.finish()
        value = target.getvalue()
        self.assertNotIn("dXNlcjpwYXNz", value)
        self.assertNotIn("sid=secret", value)
        self.assertNotIn("json-secret", value)
        self.assertNotIn("12345", value)
        self.assertNotIn("url-secret", value)
        self.assertEqual(value.count("diagnostics truncated"), 1)
        self.assertLessEqual(len(value.encode("utf-8")), 96)

    def test_diagnostics_redact_secrets_split_across_writes(self):
        target = io.StringIO()
        writer = sidecar.BoundedRedactingWriter(target, limit=96)

        writer.write('{"token":')
        writer.write("12345}\n")
        writer.finish()

        self.assertNotIn("12345", target.getvalue())
        self.assertIn("[REDACTED]", target.getvalue())

    def test_oversized_fragmented_secret_is_truncated_before_later_chunks(self):
        target = io.StringIO()
        writer = sidecar.BoundedRedactingWriter(target, limit=96)

        writer.write('{"token":"' + "x" * 5000)
        writer.write('secret-tail"}\n')
        writer.finish()

        self.assertNotIn("secret-tail", target.getvalue())
        self.assertEqual(target.getvalue().count("diagnostics truncated"), 1)
        self.assertLessEqual(len(target.getvalue().encode("utf-8")), 96)

    def test_run_keeps_dependency_output_out_of_stdout_and_redacts_process_stderr(self):
        output = io.StringIO()
        diagnostics = io.StringIO()

        def noisy_handle(service, value):
            print("dependency wrote to stdout")
            print('{"token":12345}', file=sys.stderr)
            return service._complete(value["requestId"], value["operation"], payload={})

        with mock.patch.object(sidecar.Sidecar, "handle", noisy_handle):
            exit_code = sidecar.run(
                io.StringIO(json.dumps(request("probe")) + "\n"),
                output,
                diagnostics,
            )

        self.assertEqual(exit_code, 0)
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(messages), 1)
        self.assertTrue(messages[0]["ok"])
        self.assertNotIn("dependency wrote", output.getvalue())
        self.assertIn("dependency wrote to stdout", diagnostics.getvalue())
        self.assertNotIn("12345", diagnostics.getvalue())

    def test_download_errors_never_return_header_cookie_or_url_secrets(self):
        def failing_download(_value):
            raise RuntimeError(
                "Authorization: Basic dXNlcjpwYXNz\n"
                "Cookie: sid=cookie-secret; preference=value\n"
                "https://example.test/path?token=url-secret"
            )

        service = sidecar.Sidecar(lambda message: None, io.StringIO(), download=failing_download)
        with tempfile.TemporaryDirectory() as root:
            output = output_directory(root)
            response = service.handle(
                request(
                    "downloadOne",
                    paper={"title": "Paper", "arxivID": "2101.00001"},
                    outputDir=str(output),
                )
            )

        serialized = json.dumps(response)
        self.assertNotIn("dXNlcjpwYXNz", serialized)
        self.assertNotIn("cookie-secret", serialized)
        self.assertNotIn("url-secret", serialized)
        self.assertIn("REDACTED", serialized)

    def test_real_process_probe_has_one_stdout_protocol_line(self):
        process = subprocess.run(
            [sys.executable, "-B", "-E", "-s", str(SIDECAR_PATH)],
            input=json.dumps(request("probe")) + "\n",
            text=True,
            capture_output=True,
            check=True,
            timeout=15,
        )
        lines = process.stdout.splitlines()
        self.assertEqual(len(lines), 1)
        self.assertTrue(json.loads(lines[0])["ok"])
        self.assertEqual(process.stderr, "")

    def test_real_process_serves_multiple_jsonl_requests_until_eof(self):
        payload = json.dumps(request("probe")) + "\n" + json.dumps(request("probe", "probe-2")) + "\n"
        process = subprocess.run(
            [sys.executable, "-B", "-E", "-s", str(SIDECAR_PATH)],
            input=payload,
            text=True,
            capture_output=True,
            check=True,
            timeout=15,
        )
        messages = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual([message["requestId"] for message in messages], ["request-1", "probe-2"])
        self.assertTrue(all(message["ok"] for message in messages))


if __name__ == "__main__":
    unittest.main()
