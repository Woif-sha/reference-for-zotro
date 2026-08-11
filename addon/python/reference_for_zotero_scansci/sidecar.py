"""Versioned JSONL sidecar owned by the Reference for Zotero plugin."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import sys
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, TextIO
from urllib.parse import urlparse

sys.dont_write_bytecode = True

import bridge

PROTOCOL = "reference-for-zotero.scansci-sidecar"
CONTRACT_VERSION = "1.0.0"
RESULT_SCHEMA_VERSION = "1.0.0"
INSTITUTION_ROUTE_ID = "institution-webvpn/ieee/one-click-single"
OPERATIONS = frozenset({"probe", "visibleLogin", "downloadOne", "downloadBatch"})

MAX_REQUEST_BYTES = 1024 * 1024
MAX_DIAGNOSTIC_BYTES = 32 * 1024
MAX_BATCH_ITEMS = 500
MAX_BATCH_WORKERS = 5
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
REQUEST_KEYS = frozenset(
    {"protocol", "contractVersion", "resultSchemaVersion", "requestId", "operation", "params"}
)
PARAM_KEYS = {
    "probe": frozenset(),
    "visibleLogin": frozenset({"routeId", "userInitiated"}),
    "downloadOne": frozenset({"paper", "outputDir"}),
    "downloadBatch": frozenset({"items", "outputDir"}),
}
PAPER_KEYS = frozenset({"title", "doi", "arxivID", "pmcid"})
FORBIDDEN_KEYS = frozenset(
    {
        "apikey",
        "authorization",
        "config",
        "cookie",
        "cookies",
        "loginurl",
        "password",
        "profilepath",
        "secret",
        "token",
    }
)
FORCED_POLICY = {
    "strategy": "legal_only",
    "scihubEnabled": False,
    "useTor": False,
    "useVpnsci": False,
}


class ProtocolError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class BoundedRedactingWriter:
    """Process-wide bounded diagnostic stream with secret redaction."""

    _secret_header = re.compile(
        r"(?im)(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*"
    )
    _secret_assignment = re.compile(
        r"(?i)(api[_-]?key|token|secret|password|cookie|authorization)\s*[:=]\s*[^\s,;]+"
    )
    _json_secret = re.compile(
        r'(?i)(["\'](?:api[_-]?key|token|secret|password|cookie|authorization)["\']\s*:\s*)["\'][^"\']*["\']'
    )
    _url_query = re.compile(r"(https?://[^\s?]+)\?[^\s]+")

    def __init__(self, target: TextIO, limit: int = MAX_DIAGNOSTIC_BYTES) -> None:
        self._target = target
        self._remaining = limit
        self._truncated = False
        self._lock = threading.Lock()

    def write(self, value: str) -> int:
        original_length = len(value)
        redacted = self._redact(value).encode("utf-8", errors="replace")
        with self._lock:
            emitted = redacted[: self._remaining]
            self._remaining -= len(emitted)
            self._target.write(emitted.decode("utf-8", errors="ignore"))
            if len(emitted) < len(redacted) and not self._truncated:
                self._truncated = True
                self._target.write("\n[diagnostics truncated]\n")
        return original_length

    def flush(self) -> None:
        self._target.flush()

    @classmethod
    def _redact(cls, value: str) -> str:
        value = cls._secret_header.sub(lambda match: f"{match.group(1)}: [REDACTED]", value)
        value = cls._json_secret.sub(r'\1"[REDACTED]"', value)
        value = cls._secret_assignment.sub(lambda match: f"{match.group(1)}=[REDACTED]", value)
        return cls._url_query.sub(r"\1?[REDACTED]", value)


class Sidecar:
    """Deep module exposing the four-operation Zotero ScanSci interface."""

    def __init__(
        self,
        emit: Callable[[dict[str, Any]], None],
        diagnostics: TextIO,
        *,
        download: Callable[[dict[str, Any]], dict[str, Any]] = bridge.download_one,
        capability_probe: Callable[[], dict[str, Any]] = bridge.probe,
    ) -> None:
        self._emit = emit
        self._diagnostics = BoundedRedactingWriter(diagnostics)
        self._download = download
        self._capability_probe = capability_probe

    def handle(self, request: Any) -> dict[str, Any]:
        request_id = request.get("requestId") if isinstance(request, dict) else None
        operation = request.get("operation") if isinstance(request, dict) else None
        try:
            request_id, operation, params = self._validate_request(request)
            if operation == "probe":
                payload = self._probe()
            elif operation == "visibleLogin":
                payload = self._visible_login(params)
            elif operation == "downloadOne":
                payload = self._download_one(request_id, params)
            else:
                payload = self._download_batch(request_id, params)
            return self._complete(request_id, operation, payload=payload)
        except ProtocolError as error:
            return self._complete(
                request_id,
                operation,
                error={
                    "code": error.code,
                    "message": error.message,
                    "retryable": error.retryable,
                },
            )
        except Exception as error:  # noqa: BLE001 - protocol seam normalizes unexpected failures
            self._diagnostics.write(f"[ERROR] {type(error).__name__}: {_safe_error(error)}\n")
            return self._complete(
                request_id,
                operation,
                error={
                    "code": "internal-error",
                    "message": f"The sidecar failed internally ({type(error).__name__}).",
                    "retryable": False,
                },
            )

    def _validate_request(self, request: Any) -> tuple[str, str, dict[str, Any]]:
        if not isinstance(request, dict) or set(request) - REQUEST_KEYS:
            raise ProtocolError("invalid-request", "The protocol request is invalid.")
        if request.get("protocol") != PROTOCOL:
            raise ProtocolError("incompatible-protocol", "The protocol identity is incompatible.")
        request_id = request.get("requestId")
        if not isinstance(request_id, str) or not SAFE_ID.fullmatch(request_id):
            raise ProtocolError("invalid-request", "requestId has an invalid format.")
        operation = request.get("operation")
        if not isinstance(operation, str) or operation not in OPERATIONS:
            raise ProtocolError("unsupported-operation", "The requested operation is not exposed.")
        params = request.get("params", {})
        if not isinstance(params, dict):
            raise ProtocolError("invalid-request", "params must be an object.")
        _reject_forbidden(params)
        if set(params) - PARAM_KEYS[operation]:
            raise ProtocolError("invalid-request", "The operation contains unsupported parameters.")
        if operation != "probe":
            if request.get("contractVersion") != CONTRACT_VERSION:
                raise ProtocolError("incompatible-contract", "The contract version is incompatible.")
            if request.get("resultSchemaVersion") != RESULT_SCHEMA_VERSION:
                raise ProtocolError(
                    "incompatible-result-schema", "The result schema version is incompatible."
                )
        return request_id, operation, params

    def _probe(self) -> dict[str, Any]:
        capability = self._capability_probe()
        manifest = json.loads(
            Path(__file__).with_name("VENDORED-SOURCE.json").read_text(encoding="utf-8")
        )
        upstream = manifest["upstream"]
        open_access_available = (
            capability.get("features", {}).get("onePaperDownload") == "available"
        )
        return {
            "application": {
                "name": "reference-for-zotero-scansci",
                "version": capability["moduleVersion"],
            },
            "runtime": {
                "implementation": platform.python_implementation(),
                "pythonVersion": capability["pythonVersion"],
                "executable": capability["executable"],
                "architecture": capability["architecture"],
                "platform": platform.system(),
            },
            "source": {
                "repository": upstream["repository"],
                "revision": upstream["commit"],
                "installKind": "audited-plugin-fragments",
                "dirty": not _manifest_matches(manifest),
            },
            "contractVersion": CONTRACT_VERSION,
            "resultSchemaVersion": RESULT_SCHEMA_VERSION,
            "operations": sorted(OPERATIONS),
            "routeCapabilities": [
                {
                    "routeId": "open-access",
                    "available": open_access_available,
                    "sources": ["arxiv", "pmc"],
                    "operations": ["downloadOne", "downloadBatch"],
                    "concurrency": "bounded",
                },
                {
                    "routeId": INSTITUTION_ROUTE_ID,
                    "status": "candidate",
                    "available": False,
                    "operations": ["visibleLogin", "downloadOne"],
                    "concurrency": "single-profile-writer",
                    "profileId": "zotero",
                    "reason": "real-world-route-audit-pending",
                },
            ],
            "policy": {
                "mode": "legal-only",
                "disabledRoutes": [
                    "sci-hub",
                    "libgen",
                    "scibban",
                    "tor",
                    "proxy-pool",
                    "vpnsci",
                    "unknown",
                ],
            },
        }

    @staticmethod
    def _visible_login(params: dict[str, Any]) -> dict[str, Any]:
        if params.get("userInitiated") is not True:
            raise ProtocolError("invalid-request", "visibleLogin must be explicitly user initiated.")
        if params.get("routeId") != INSTITUTION_ROUTE_ID:
            raise ProtocolError("unsupported-route", "The requested institution route is unknown.")
        raise ProtocolError(
            "route-candidate",
            "The institution route remains a candidate until its real-world audit passes.",
        )

    def _download_one(self, request_id: str, params: dict[str, Any]) -> dict[str, Any]:
        output_dir = _validate_output_dir(params.get("outputDir"), request_id)
        paper = _validate_paper(params.get("paper"))
        return {"result": self._download_result(paper, output_dir)}

    def _download_batch(self, request_id: str, params: dict[str, Any]) -> dict[str, Any]:
        output_dir = _validate_output_dir(params.get("outputDir"), request_id)
        items = _validate_batch_items(params.get("items"))
        results: dict[str, dict[str, Any]] = {}
        completed = 0
        with ThreadPoolExecutor(max_workers=min(MAX_BATCH_WORKERS, len(items))) as pool:
            futures = {
                pool.submit(self._download_result, item["paper"], output_dir): item
                for item in items
            }
            for future in as_completed(futures):
                item = futures[future]
                result = future.result()
                completed += 1
                results[item["itemId"]] = result
                self._emit(
                    self._progress(
                        request_id,
                        sequence=completed,
                        total=len(items),
                        item_id=item["itemId"],
                        result=result,
                    )
                )
        ordered = [results[item["itemId"]] for item in items]
        return {
            "total": len(ordered),
            "downloaded": sum(result["status"] == "downloaded" for result in ordered),
            "failed": sum(result["status"] == "failed" for result in ordered),
            "results": [
                {"itemId": item["itemId"], "result": results[item["itemId"]]}
                for item in items
            ],
        }

    def _download_result(self, paper: dict[str, str], output_dir: Path) -> dict[str, Any]:
        identifier = _paper_identifier(paper)
        try:
            raw = self._download(
                {
                    "paper": paper,
                    "outputDirectory": str(output_dir),
                    "policy": FORCED_POLICY,
                }
            )
            return _normalize_download(identifier, raw, output_dir)
        except Exception as error:  # noqa: BLE001 - downloader seam returns a per-paper result
            return _failed_result(identifier, *_normalized_error(error))

    @staticmethod
    def _progress(
        request_id: str,
        *,
        sequence: int,
        total: int,
        item_id: str,
        result: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "protocol": PROTOCOL,
            "contractVersion": CONTRACT_VERSION,
            "resultSchemaVersion": RESULT_SCHEMA_VERSION,
            "requestId": request_id,
            "operation": "downloadBatch",
            "type": "progress",
            "payload": {
                "sequence": sequence,
                "completed": sequence,
                "total": total,
                "itemId": item_id,
                "result": result,
            },
        }

    @staticmethod
    def _complete(
        request_id: str | None,
        operation: str | None,
        *,
        payload: dict[str, Any] | None = None,
        error: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = {
            "protocol": PROTOCOL,
            "contractVersion": CONTRACT_VERSION,
            "resultSchemaVersion": RESULT_SCHEMA_VERSION,
            "requestId": request_id,
            "operation": operation,
            "type": "complete",
            "ok": error is None,
        }
        response["payload" if error is None else "error"] = payload or error or {}
        return response


def run(
    input_stream: TextIO | None = None,
    output_stream: TextIO | None = None,
    error_stream: TextIO | None = None,
) -> int:
    source = input_stream or sys.stdin
    target = output_stream or sys.stdout
    diagnostics = error_stream or sys.stderr
    write_lock = threading.Lock()

    for name in bridge.PROXY_ENVIRONMENT:
        os.environ.pop(name, None)
    os.environ["NO_PROXY"] = "*"
    os.environ["no_proxy"] = "*"

    def emit(message: dict[str, Any]) -> None:
        encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        with write_lock:
            target.write(encoded + "\n")
            target.flush()

    sidecar = Sidecar(emit, diagnostics)
    for raw_line in source:
        if len(raw_line.encode("utf-8", errors="replace")) > MAX_REQUEST_BYTES:
            emit(
                sidecar._complete(
                    None,
                    None,
                    error={
                        "code": "request-too-large",
                        "message": "The request exceeds the size limit.",
                        "retryable": False,
                    },
                )
            )
            continue
        if not raw_line.strip():
            continue
        try:
            request = json.loads(raw_line)
        except json.JSONDecodeError:
            emit(
                sidecar._complete(
                    None,
                    None,
                    error={
                        "code": "invalid-json",
                        "message": "The request is not valid JSON.",
                        "retryable": False,
                    },
                )
            )
            continue
        emit(sidecar.handle(request))
    return 0


def _reject_forbidden(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).replace("_", "").replace("-", "").casefold()
            if normalized in FORBIDDEN_KEYS:
                raise ProtocolError(
                    "forbidden-parameter",
                    "Secrets, configuration, URLs, and profile paths are not accepted.",
                )
            _reject_forbidden(child)
    elif isinstance(value, list):
        for child in value:
            _reject_forbidden(child)


def _validate_paper(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) - PAPER_KEYS:
        raise ProtocolError("invalid-request", "The confirmed paper is invalid.")
    paper = {
        key: str(value.get(key) or "").strip()
        for key in PAPER_KEYS
        if str(value.get(key) or "").strip()
    }
    if any(len(value) > 512 or re.search(r"[\x00-\x1f\x7f]", value) for value in paper.values()):
        raise ProtocolError("invalid-request", "The confirmed paper contains an invalid value.")
    if not paper.get("title") or not any(paper.get(key) for key in ("doi", "arxivID", "pmcid")):
        raise ProtocolError("invalid-request", "The confirmed paper requires a title and identifier.")
    return paper


def _validate_batch_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_BATCH_ITEMS:
        raise ProtocolError("invalid-request", "items must contain between 1 and 500 entries.")
    items = []
    item_ids = set()
    identifiers = set()
    for value_item in value:
        if not isinstance(value_item, dict) or set(value_item) != {"itemId", "paper"}:
            raise ProtocolError("invalid-request", "Each batch item is invalid.")
        item_id = value_item.get("itemId")
        if not isinstance(item_id, str) or not SAFE_ID.fullmatch(item_id) or item_id in item_ids:
            raise ProtocolError("invalid-request", "Batch itemId values must be unique and valid.")
        paper = _validate_paper(value_item.get("paper"))
        identifier = _paper_identifier(paper).casefold()
        if identifier in identifiers:
            raise ProtocolError("invalid-request", "Batch paper identifiers must be unique.")
        item_ids.add(item_id)
        identifiers.add(identifier)
        items.append({"itemId": item_id, "paper": paper})
    return items


def _paper_identifier(paper: dict[str, str]) -> str:
    for key in ("doi", "arxivID", "pmcid"):
        if paper.get(key):
            return paper[key]
    return "unknown"


def _validate_output_dir(value: Any, request_id: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ProtocolError("invalid-output-directory", "outputDir must be an absolute path.")
    path = Path(value)
    if not path.is_absolute() or not path.is_dir():
        raise ProtocolError(
            "invalid-output-directory", "outputDir must be a caller-created directory."
        )
    absolute = Path(os.path.abspath(path))
    resolved = path.resolve(strict=True)
    if os.path.normcase(str(absolute)) != os.path.normcase(str(resolved)):
        raise ProtocolError("output-outside-root", "outputDir cannot be a link or junction.")
    if resolved.name != request_id or resolved.parent.name.casefold() != "scanscicache":
        raise ProtocolError("output-outside-root", "outputDir must be ScanSciCache/<requestId>.")
    if any(resolved.iterdir()):
        raise ProtocolError("output-not-empty", "outputDir must be empty for a new request.")
    return resolved


def _normalize_download(identifier: str, raw: Any, output_dir: Path) -> dict[str, Any]:
    if not isinstance(raw, dict) or not isinstance(raw.get("source"), dict):
        return _failed_result(identifier, "download-failed", "The downloader returned no result.")
    source = raw["source"]
    source_id = str(source.get("id") or "").casefold()
    try:
        route = bridge.enabled_route(bridge.load_source_rules(), source_id)
    except (KeyError, RuntimeError, TypeError, ValueError):
        return _failed_result(identifier, "unknown-source", "The downloader returned unknown source evidence.")
    allowed_hosts = {str(host).casefold() for host in route.get("allowedHosts", [])}
    source_url = str(source.get("url") or "")
    parsed = urlparse(source_url)
    egress_hosts = [str(host).casefold() for host in source.get("egressHosts", [])]
    if (
        parsed.scheme != "https"
        or parsed.port not in (None, 443)
        or (parsed.hostname or "").casefold() not in allowed_hosts
        or not egress_hosts
        or any(host not in allowed_hosts for host in egress_hosts)
    ):
        return _failed_result(
            identifier, "invalid-source-evidence", "The downloader source evidence is invalid."
        )
    output_value = raw.get("outputPath")
    if not isinstance(output_value, str) or not output_value:
        return _failed_result(identifier, "missing-output", "The downloader returned no file path.")
    try:
        output_path = Path(output_value).resolve(strict=True)
        relative = output_path.relative_to(output_dir.resolve(strict=True))
    except (OSError, ValueError):
        return _failed_result(identifier, "output-outside-root", "The downloader output escaped its request directory.")
    if not output_path.is_file():
        return _failed_result(identifier, "missing-output", "The downloader output is not a file.")
    return {
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "status": "downloaded",
        "identifier": identifier,
        "sourceEvidence": {
            "routeId": "open-access",
            "source": source_id,
            "sourceUrl": source_url,
            "egressHosts": egress_hosts,
            "legal": True,
        },
        "relativePath": relative.as_posix(),
        "error": None,
    }


def _normalized_error(error: Exception) -> tuple[str, str]:
    message = _safe_error(error)
    detail = message.casefold()
    if "conflicting" in detail or "invalid" in detail:
        return "invalid-identifier", message
    if "http 429" in detail:
        return "rate-limited", message
    if "timeout" in detail:
        return "download-timeout", message
    return "no-pdf", message or "No audited legal source returned a PDF."


def _safe_error(error: Exception) -> str:
    redacted = BoundedRedactingWriter._redact(str(error))
    return bridge.sanitize_error(RuntimeError(redacted))


def _manifest_matches(manifest: dict[str, Any]) -> bool:
    root = Path(__file__).parent
    for entry in manifest.get("vendoredFiles", []):
        path = root / str(entry.get("localPath") or "")
        expected = str(entry.get("localSha256") or "").casefold()
        if not path.is_file() or not expected:
            return False
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual.casefold() != expected:
            return False
    return True


def _failed_result(identifier: str, code: str, message: str) -> dict[str, Any]:
    return {
        "schemaVersion": RESULT_SCHEMA_VERSION,
        "status": "failed",
        "identifier": identifier,
        "sourceEvidence": None,
        "relativePath": None,
        "error": {"code": code, "message": str(message)[:240]},
    }


if __name__ == "__main__":
    raise SystemExit(run())
