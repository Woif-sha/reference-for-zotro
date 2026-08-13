# ScanSci compatibility module modifications

This module is maintained by the Reference for Zotero project. It is not the
`scansci_pdf` package and does not import an installed copy of that package.

The `vendored/sources.py` file derives only identifier normalization and fixed
official URL-construction fragments from
`Rimagination/scansci-pdf@5e4a6f20ee32b16c0fcb52e37b66ca7a0b31edc5`.
The fragments were moved into this project's namespace and changed to remove
upstream cache, auto-rename, generic source, proxy, browser, retry, PDF-content
validation, and overwrite behavior.

The stdio protocol, strict HTTPS client, source-rules enforcement, request
isolation, and final exclusive commit are original Reference for Zotero code.
The plugin-owned `sidecar.py` adds the versioned four-operation JSONL contract,
bounded batch scheduling, per-paper progress, result normalization, and the
non-available IEEE/WebVPN candidate projection. It delegates downloads to the
same audited bridge implementation and does not import or modify an installed
`scansci_pdf` package.
The enabled open-access route declares its exact compatibility dependency set
in `requirements.lock`. The plugin does not install that set or create a private
environment; it accepts only an already-compatible runtime whose sidecar
`probe` reports the required identity, provenance, policy and capabilities.
Institution/browser access remains an unavailable candidate until a concrete
route passes strict-TLS, source, egress, profile-ownership, Windows, and
installed-Zotero acceptance.
