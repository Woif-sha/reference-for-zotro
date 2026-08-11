"""Single-request JSON stdio bridge for the ScanSciPort v3 adapter."""

import importlib.metadata
import importlib
import json
import os
import platform
import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True

from strict_http import StrictHttpClient
from vendored.sources import (
    arxiv_pdf_url,
    normalize_doi,
    normalize_arxiv_id,
    normalize_pmcid,
    pmc_id_conversion_url,
    pmc_pdf_url,
    safe_output_name,
)


SCHEMA_VERSION = 3
SOURCE_RULES_VERSION = 3
MODULE_VERSION = "3.2.0"
PROXY_ENVIRONMENT = (
    "ALL_PROXY",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "all_proxy",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    "PIP_CONFIG_FILE",
    "PIP_EXTRA_INDEX_URL",
    "PIP_INDEX_URL",
    "PIP_TRUSTED_HOST",
    "PIP_CERT",
    "PIP_CLIENT_CERT",
    "PIP_PROXY",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "SSL_CERT_FILE",
    "SCANSCI_PDF_PROXY",
    "CLOAKBROWSER_LICENSE_KEY",
    "CLOAKBROWSER_BINARY_PATH",
    "CLOAKBROWSER_DOWNLOAD_URL",
)

LOCKED_DEPENDENCIES = (
    ("requests", "requests", "2.34.2"),
    ("certifi", "certifi", "2026.7.22"),
    ("charset-normalizer", "charset_normalizer", "3.4.9"),
    ("idna", "idna", "3.18"),
    ("urllib3", "urllib3", "2.7.0"),
)


def main():
    for name in PROXY_ENVIRONMENT:
        os.environ.pop(name, None)
    try:
        message = json.loads(sys.stdin.read())
        response = dispatch(message)
    except Exception as error:
        response = failure("bridge", "bridge-error", sanitize_error(error))
    sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.write("\n")
    sys.stdout.flush()


def dispatch(message):
    if not isinstance(message, dict):
        return failure("unknown", "invalid-request", "Protocol request must be an object")
    operation = str(message.get("operation") or "unknown")
    if message.get("schemaVersion") != SCHEMA_VERSION:
        return failure(operation, "incompatible-schema", "Protocol schema is incompatible")
    if message.get("sourceRulesVersion") != SOURCE_RULES_VERSION:
        return failure(
            operation, "incompatible-source-rules", "Source-rules version is incompatible"
        )
    request = message.get("request")
    if not isinstance(request, dict):
        return failure(operation, "invalid-request", "Protocol request payload is invalid")
    if operation == "probe":
        return success(operation, probe())
    if operation == "visible-login":
        return failure(
            operation,
            "route-disabled",
            "Institution browser route is disabled pending acceptance",
        )
    if operation == "download-one":
        try:
            return success(operation, download_one(request))
        except Exception as error:
            return failure(operation, "download-failed", sanitize_error(error))
    return failure(operation, "unknown-operation", "Unknown protocol operation")


def probe():
    dependencies = [dependency_status(*dependency) for dependency in LOCKED_DEPENDENCIES]
    python_supported = sys.version_info >= (3, 11)
    return {
        "executable": str(Path(sys.executable).resolve()),
        "pythonVersion": platform.python_version(),
        "architecture": normalize_architecture(platform.machine()),
        "moduleVersion": MODULE_VERSION,
        "dependencies": dependencies,
        "features": {
            "onePaperDownload": (
                "available"
                if python_supported
                and all(item["status"] == "available" for item in dependencies)
                else "unavailable"
            ),
            "visibleLogin": "disabled",
        },
    }


def dependency_status(distribution, import_name, expected_version):
    try:
        installed = importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        return {
            "name": distribution,
            "requirement": f"=={expected_version}",
            "status": "missing",
        }
    status = "available" if installed == expected_version else "incompatible"
    if status == "available":
        try:
            importlib.import_module(import_name)
        except Exception:
            status = "incompatible"
    return {
        "name": distribution,
        "requirement": f"=={expected_version}",
        "installedVersion": installed,
        "status": status,
    }


def download_one(request):
    if set(request) != {"paper", "outputDirectory", "policy"}:
        raise ValueError("Download request contains unsupported fields")
    if request.get("policy") != {
        "strategy": "legal_only",
        "scihubEnabled": False,
        "useTor": False,
        "useVpnsci": False,
    }:
        raise ValueError("Download request did not enforce legal-only source policy")
    paper = request.get("paper")
    if not isinstance(paper, dict) or not str(paper.get("title") or "").strip():
        raise ValueError("Confirmed paper is invalid")
    output_directory = Path(str(request.get("outputDirectory") or "")).resolve()
    if not output_directory.is_dir():
        raise ValueError("ScanSci request directory does not exist")
    rules = load_source_rules()
    errors = []

    explicit_arxiv_id = normalize_arxiv_id(paper.get("arxivID"))
    doi = normalize_doi(paper.get("doi"))
    doi_arxiv_id = normalize_arxiv_id(doi)
    if explicit_arxiv_id and doi_arxiv_id and explicit_arxiv_id != doi_arxiv_id:
        raise ValueError("Confirmed paper contains conflicting arXiv identifiers")
    arxiv_id = explicit_arxiv_id or doi_arxiv_id
    if arxiv_id:
        try:
            return download_arxiv(arxiv_id, output_directory, rules)
        except Exception as error:
            errors.append(f"arxiv: {sanitize_error(error)}")

    pmcid = normalize_pmcid(paper.get("pmcid"))
    if pmcid or doi:
        try:
            return download_pmc(pmcid, doi, output_directory, rules)
        except Exception as error:
            errors.append(f"pmc: {sanitize_error(error)}")

    if errors:
        raise RuntimeError("; ".join(errors))
    raise ValueError("Paper has no identifier supported by an enabled legal source")


def download_arxiv(arxiv_id, output_directory, rules):
    route = enabled_route(rules, "arxiv")
    client = StrictHttpClient(route, timeout_seconds=60)
    target = output_directory / safe_output_name("arxiv", arxiv_id)
    final_url = client.download_to(arxiv_pdf_url(arxiv_id), target)
    return result("arxiv", final_url, client.egress_hosts, target)


def download_pmc(pmcid, doi, output_directory, rules):
    route = enabled_route(rules, "pmc")
    client = StrictHttpClient(route, timeout_seconds=60)
    resolved_pmcid = pmcid
    if doi:
        conversion_url = pmc_id_conversion_url(doi)
        if not conversion_url:
            raise ValueError("Confirmed DOI is invalid")
        payload, _ = client.get_json(conversion_url)
        records = payload.get("records", []) if isinstance(payload, dict) else []
        matched_pmcid = None
        for record in records if isinstance(records, list) else []:
            if isinstance(record, dict):
                record_doi = normalize_doi(record.get("doi"))
                candidate_pmcid = normalize_pmcid(record.get("pmcid"))
                if record_doi == doi and candidate_pmcid:
                    matched_pmcid = candidate_pmcid
                    break
        if not matched_pmcid:
            raise RuntimeError("NCBI did not return an exact DOI-to-PMCID binding")
        if resolved_pmcid and resolved_pmcid != matched_pmcid:
            raise ValueError("Confirmed DOI and PMCID identify different papers")
        resolved_pmcid = matched_pmcid
    if not resolved_pmcid:
        raise RuntimeError("NCBI did not resolve the DOI to a PMCID")
    target = output_directory / safe_output_name("pmc", resolved_pmcid)
    final_url = client.download_to(pmc_pdf_url(resolved_pmcid), target)
    return result("pmc", final_url, client.egress_hosts, target)


def result(source_id, source_url, egress_hosts, output_path):
    return {
        "source": {
            "id": source_id,
            "url": source_url,
            "egressHosts": list(egress_hosts),
        },
        "outputPath": str(output_path.resolve()),
    }


def load_source_rules():
    path = Path(__file__).with_name("source-rules-v3.json")
    rules = json.loads(path.read_text(encoding="utf-8"))
    if set(rules) != {
        "schemaVersion",
        "sourceRulesVersion",
        "routes",
        "prohibitedSources",
        "forcedPolicy",
        "removedEnvironment",
    }:
        raise RuntimeError("Source-rules fields are incompatible")
    if rules.get("schemaVersion") != SCHEMA_VERSION:
        raise RuntimeError("Source-rules schema is incompatible")
    if rules.get("sourceRulesVersion") != SOURCE_RULES_VERSION:
        raise RuntimeError("Source-rules version is incompatible")
    if rules.get("forcedPolicy") != {
        "strategy": "legal_only",
        "scihubEnabled": False,
        "useTor": False,
        "useVpnsci": False,
    }:
        raise RuntimeError("Source-rules legal-only policy is incompatible")
    if tuple(rules.get("removedEnvironment", ())) != PROXY_ENVIRONMENT:
        raise RuntimeError("Source-rules environment isolation is incompatible")
    expected_routes = [
        {
            "id": "arxiv",
            "enabled": True,
            "kind": "open-access",
            "allowedHosts": ["arxiv.org", "export.arxiv.org"],
        },
        {
            "id": "pmc",
            "enabled": True,
            "kind": "open-access",
            "allowedHosts": ["www.ncbi.nlm.nih.gov", "pmc.ncbi.nlm.nih.gov"],
        },
        {
            "id": "institution-browser",
            "enabled": False,
            "kind": "institution",
            "allowedHosts": [],
            "disabledReason": (
                "Institution browser route is disabled pending strict-TLS, source, "
                "egress, Windows, and Zotero acceptance"
            ),
        },
    ]
    if rules.get("routes") != expected_routes:
        raise RuntimeError("Source-rules route set is incompatible")
    prohibited = tuple(str(item).lower() for item in rules.get("prohibitedSources", []))
    if prohibited != (
        "scihub",
        "libgen",
        "scibban",
        "tor",
        "proxy-pool",
        "vpnsci",
        "unknown",
    ):
        raise RuntimeError("Source-rules prohibited-source list is incompatible")
    return rules


def enabled_route(rules, route_id):
    prohibited = {str(item).lower() for item in rules.get("prohibitedSources", [])}
    if route_id.lower() in prohibited:
        raise RuntimeError(f"Source is prohibited: {route_id}")
    for route in rules.get("routes", []):
        if route.get("id") == route_id and route.get("enabled") is True:
            if route.get("kind") != "open-access":
                break
            return route
    raise RuntimeError(f"Source is unknown or disabled: {route_id}")


def success(operation, result_value):
    return {
        "schemaVersion": SCHEMA_VERSION,
        "sourceRulesVersion": SOURCE_RULES_VERSION,
        "operation": operation,
        "ok": True,
        "result": result_value,
    }


def failure(operation, code, message):
    return {
        "schemaVersion": SCHEMA_VERSION,
        "sourceRulesVersion": SOURCE_RULES_VERSION,
        "operation": operation,
        "ok": False,
        "error": {"code": code, "message": message},
    }


def normalize_architecture(value):
    normalized = str(value or "").lower()
    if normalized in ("amd64", "x86_64"):
        return "x64"
    if normalized in ("arm64", "aarch64"):
        return "arm64"
    if normalized in ("x86", "i386", "i686"):
        return "x86"
    return normalized or "unknown"


def version_tuple(value):
    parts = [int(part) for part in re.findall(r"\d+", value)[:3]]
    return tuple((parts + [0, 0, 0])[:3])


def sanitize_error(error):
    message = str(error)
    message = re.sub(r"([?&](?:token|code|key|auth)=)[^&\s]+", r"\1[redacted]", message, flags=re.I)
    message = re.sub(
        r"\b(password|passcode|token|cookie|authorization|api[_-]?key)\s*[:=]\s*[^\s]+",
        r"\1=[redacted]",
        message,
        flags=re.I,
    )
    return re.sub(r"[\x00-\x1f\x7f]+", " ", message).strip()[:1024]


if __name__ == "__main__":
    main()
