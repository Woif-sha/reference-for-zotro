"""Audited legal-source fragments derived from scansci-pdf.

Modified by the Reference for Zotero project. See VENDORED-SOURCE.json and
MODIFICATIONS.md for the exact upstream files, hashes, fragments, and changes.
"""

import re
import urllib.parse


ARXIV_RE = re.compile(r"^(?:arxiv:)?(?P<id>\d{4}\.\d{4,5})(?:v\d+)?$", re.I)
ARXIV_DOI_RE = re.compile(
    r"10\.48550/arxiv\.(?P<id>\d{4}\.\d{4,5})(?:v\d+)?", re.I
)
OLD_ARXIV_RE = re.compile(
    r"^(?:arxiv:)?(?P<id>[a-z-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?$", re.I
)
PMCID_RE = re.compile(r"^PMC\d+$", re.I)
DOI_RE = re.compile(r"^10\.\d{4,9}/\S+$", re.I)


def normalize_arxiv_id(value):
    raw = str(value or "").strip()
    lower = raw.lower()
    if lower.startswith(("http://arxiv.org/abs/", "https://arxiv.org/abs/")):
        raw = raw.rsplit("/", 1)[-1]
    elif lower.startswith(("http://arxiv.org/pdf/", "https://arxiv.org/pdf/")):
        raw = raw.rsplit("/", 1)[-1].removesuffix(".pdf")

    doi_match = ARXIV_DOI_RE.search(raw)
    if doi_match:
        return doi_match.group("id")
    match = ARXIV_RE.match(raw)
    if match:
        return match.group("id")
    old_match = OLD_ARXIV_RE.match(raw)
    return old_match.group("id") if old_match else None


def arxiv_pdf_url(identifier):
    arxiv_id = normalize_arxiv_id(identifier)
    return f"https://arxiv.org/pdf/{arxiv_id}.pdf" if arxiv_id else None


def normalize_pmcid(value):
    candidate = str(value or "").strip().upper()
    return candidate if PMCID_RE.fullmatch(candidate) else None


def normalize_doi(value):
    candidate = str(value or "").strip()
    candidate = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", candidate, flags=re.I)
    return candidate.lower() if DOI_RE.fullmatch(candidate) else None


def pmc_id_conversion_url(doi):
    normalized = normalize_doi(doi)
    if not normalized:
        return None
    encoded = urllib.parse.quote(normalized, safe="")
    return (
        "https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/"
        f"?ids={encoded}&format=json"
    )


def pmc_pdf_url(pmcid):
    normalized = normalize_pmcid(pmcid)
    if not normalized:
        return None
    return f"https://www.ncbi.nlm.nih.gov/pmc/articles/{normalized}/pdf/"


def safe_output_name(source_id, identifier):
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", str(identifier)).strip("_")
    return f"{source_id}_{safe or 'paper'}.pdf"
