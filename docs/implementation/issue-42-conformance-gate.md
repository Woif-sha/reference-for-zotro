# Issue #42 conformance gate

This record checks the repository against the complete parent contract in
[#38](https://github.com/Woif-sha/reference-for-zotro/issues/38). The integration
baseline is issue #41 commit `5c558ca0132ea595a98e7dffcc472ac0f9d906c0`, with
issue #40 commit `e0f47699cda4b666c96d45d580b28a207f0654fc` merged into
the issue #42 branch.

The evidence below is limited to code, contracts, automated tests, and package
inspection. It does not claim real Zotero, Paper Translate service,
institution login, or publisher-entitlement acceptance. The XPI built during
this gate is an intermediate verification artifact and is not a user acceptance
deliverable.

## Problem and solution

| Requirement                                                                                                                                                                                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                 | Result                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Preserve the first-stage Reader while completing a reproducible Zotero 9 second-stage path for translation, conservative selection, and legal file download.                                                                 | `src/application/related-papers-controller.ts`, `src/addon.ts`, and `src/index.ts` compose Reader registration independently from the startup probe. `test/application/related-papers-controller.test.ts` and `test/reader/reader-lifecycle.test.ts` cover browsing, translation, selection, and failure isolation. `scripts/repack_xpi.py` makes package ordering, timestamps, and modes deterministic. | Satisfied by code and automated tests. |
| Use one plugin-owned, versioned JSONL sidecar as the Zotero-facing ScanSci boundary, delegating to the existing compatibility bridge without a second downloader or silent fallback. Keep the institution route a candidate. | `src/scansci/python-scan-sci-port.ts`, `src/scansci/sidecar-protocol.ts`, and `addon/python/reference_for_zotero_scansci/sidecar.py` expose the single production path. The sidecar delegates downloads to `bridge.py`; probe and protocol tests assert the four-operation contract and candidate institution state.                                                                                     | Satisfied by code and automated tests. |
| Preserve MinerU-derived relationships and Paper Translate while isolating all download failures.                                                                                                                             | Literature gateways remain independent of ScanSci. Controller tests retain References, Citing papers, landing pages, detail state, and translation after probe or download failure.                                                                                                                                                                                                                      | Satisfied by automated tests.          |
| Download into a request-scoped cache, validate evidence and containment, then exclusively commit a canonical title into the snapshotted destination.                                                                         | `src/scansci/download-filesystem.ts`, the controller/port contract, filesystem tests, and Python sidecar tests cover request isolation, relative paths, containment, no-overwrite, cleanup, and per-paper failure.                                                                                                                                                                                       | Satisfied by code and automated tests. |

## Implementation decisions

| #   | Parent decision                                                                                                                                      | Evidence                                                                                                                                                                                                                                                                            | Result                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | MinerU Markdown is the only source of Reference entries.                                                                                             | `src/literature/gateway.ts` and Reader/controller regression tests; no ScanSci result feeds the literature gateway.                                                                                                                                                                 | Satisfied.                        |
| 2   | Identity is conservative: stable identifiers, otherwise unique exact normalized title and exact year; unresolved or ambiguous papers are ineligible. | `src/literature/matching.ts`, centralized `src/literature/identifiers.ts`, and matching tests cover DOI URL decoding, NFKC title equality, stable-ID conflicts, ambiguity, and eligibility.                                                                                         | Satisfied.                        |
| 3   | Reader/controller inject one `ScanSciPort` and the existing `PaperTranslateBridge`.                                                                  | `src/application/related-papers-controller.ts` consumes ports and does not import Python, subprocess, publisher, or alternate translation implementations.                                                                                                                          | Satisfied.                        |
| 4   | Production uses only the plugin-owned JSONL sidecar; the legacy bridge remains internal.                                                             | `src/scansci/python-scan-sci-port.ts` launches `sidecar.py`; only the Python sidecar imports the compatibility bridge.                                                                                                                                                              | Satisfied.                        |
| 5   | Sidecar ownership remains in this repository and compatibility namespace.                                                                            | Assets are under `addon/python/reference_for_zotero_scansci`; the package audit requires exactly the owned Python assets and rejects external runtime/package trees.                                                                                                                | Satisfied.                        |
| 6   | Protocol exposes exactly `probe`, `visibleLogin`, `downloadOne`, and `downloadBatch`, with exact versions and request identity.                      | `src/scansci/sidecar-protocol.ts`, `sidecar.py`, TypeScript protocol tests, and Python interface tests reject unknown operations, fields, and versions.                                                                                                                             | Satisfied.                        |
| 7   | Probe reports actual identity/runtime/provenance/manifest/policy/routes, without guessed success.                                                    | `sidecar.py` derives runtime facts and bridge probe data; tests assert exact compatibility and legal/candidate route projection.                                                                                                                                                    | Satisfied.                        |
| 8   | Probe occurs at startup, after visible login, and immediately before downloads, without fallback.                                                    | `src/addon.ts`, `src/application/related-papers-controller.ts`, and lifecycle/controller tests cover each boundary and explicit incompatibility.                                                                                                                                    | Satisfied.                        |
| 9   | Subprocess adapter owns framing, EOF, wait/kill, cancellation, timeout, and bounded output.                                                          | `src/platform/zotero-subprocess.ts` and subprocess/`PythonScanSciPort` tests cover malformed JSON, missing/duplicate terminal messages, unexpected progress, cancellation, and output overflow.                                                                                     | Satisfied.                        |
| 10  | Stdout is protocol-only; process-wide stderr is bounded and redacted.                                                                                | `sidecar.py` redirects process stdout/stderr through `BoundedRedactingWriter` while retaining the protocol stream; Python tests cover dependency output, Authorization/Cookie/query data, string secrets, and numeric JSON secrets.                                                 | Satisfied.                        |
| 11  | Reject URLs, config/profile/credential material, tokens, and unknown fields; fix legal policy before egress.                                         | Exact request/params validation and policy checks in `sidecar.py`; Python tests cover rejected fields and policy input.                                                                                                                                                             | Satisfied.                        |
| 12  | Open access is limited to audited arXiv/PMC; results carry evidence, hosts, and relative path or a bounded failure.                                  | Sidecar schemas, protocol parsing, and bridge tests cover route whitelist, source evidence, host evidence, relative paths, and failed payloads.                                                                                                                                     | Satisfied.                        |
| 13  | `institution-webvpn/ieee/one-click-single` remains unavailable candidate; visible login does not start a browser.                                    | Probe projection and Python tests assert candidate state and explicit visible-login failure.                                                                                                                                                                                        | Satisfied.                        |
| 14  | One item uses `downloadOne`; multiple use one bounded `downloadBatch`, with per-item progress and isolated failures.                                 | Controller, port, protocol, and sidecar batch tests cover dispatch shape, bounded concurrency, one progress event per item, and mixed results.                                                                                                                                      | Satisfied.                        |
| 15  | Snapshot ordered selection and destination; restrict UI/final states.                                                                                | Controller snapshots inputs before dispatch; application tests cover order, destination changes, progress states, and downloaded/failed terminal results.                                                                                                                           | Satisfied.                        |
| 16  | Each request gets exactly one caller-created `ScanSciCache` directory and returns relative paths only.                                               | Filesystem/port code and tests cover one request directory, containment, and relative result paths.                                                                                                                                                                                 | Satisfied.                        |
| 17  | Validate evidence/path/title and commit exclusively without overwrite.                                                                               | `src/scansci/download-filesystem.ts` and filesystem/controller tests cover traversal, absolute/missing/directory paths, unsafe titles, collisions, and disk failures.                                                                                                               | Satisfied.                        |
| 18  | Canonical title is the only rename; no suffix, alternate directory, retry, or weaker source.                                                         | Filesystem commit path is single-shot and exclusive; tests assert same-name failure and no application retry/fallback.                                                                                                                                                              | Satisfied.                        |
| 19  | Clean only the handled request directory; retain cache root and do not recover crash residue.                                                        | Scoped cleanup code and filesystem tests assert request removal and root retention; no startup recovery path exists.                                                                                                                                                                | Satisfied.                        |
| 20  | Downloads are filesystem-only and never mutate Zotero library objects.                                                                               | Download composition exposes filesystem reveal/commit only; no Web API or item/attachment/collection calls exist in the download path.                                                                                                                                              | Satisfied.                        |
| 21  | Paper Translate uses public capability/translation API for plugin-UI academic selections only.                                                       | Existing `PaperTranslateBridge`, controller anchoring, and Reader tests cover capability, selected text, stale-result suppression, and isolated failure.                                                                                                                            | Satisfied.                        |
| 22  | Reader browsing and translation remain usable when ScanSci is absent, incompatible, cancelled, or failed.                                            | Addon registration no longer awaits probe; lifecycle and controller tests cover every failure class and retain References, Citing papers, landing/detail state, and translation.                                                                                                    | Satisfied.                        |
| 23  | Keep the second-stage test identity and Zotero 9 range; do not publish a release or update metadata.                                                 | `zotero-plugin.config.ts` retains `Reference for Zotero (Second-stage Test)` and supported range. Build hook removes test-build update metadata. No release/tag is created by this ticket.                                                                                          | Satisfied; no artifact delivered. |
| 24  | XPI contains only owned required assets and excludes runtimes, external packages, secrets, caches, tests, PDFs, logs, and diagnostics.               | Shared `test/xpi/package-policy.json`, `test/python/audit_scansci_xpi.py`, synthetic-XPI tests, and artifact audit enforce allow/deny, path, link, duplicate, size, compression, and exact-asset rules.                                                                             | Satisfied.                        |
| 25  | No second truth source, silent default, broad swallowing, mock success, guessed capability, or compatibility fallback.                               | Central identifier normalization removed duplicate DOI logic; old fuzzy matching is marked superseded; runtime revalidates packaged assets for every probe; invalid protocol and failures surface explicitly. Full diff review found and removed the observed duplicate/weak paths. | Satisfied.                        |

## Testing decisions

| #   | Parent decision                                                                                               | Evidence                                                                                                                                                               | Result                                       |
| --- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Real installed-XPI behavior belongs to user acceptance.                                                       | This record marks all real Zotero/service/login/publisher checks pending below.                                                                                        | Pending user verification by design.         |
| 2   | Test public seams and observable behavior.                                                                    | Tests drive matching exports, controller/ports, JSONL, subprocess, filesystem, and XPI contents rather than private helpers.                                           | Satisfied.                                   |
| 3   | Controller/`ScanSciPort` contracts cover snapshots, dispatch, progress, isolation, and cancellation.          | `test/application/related-papers-controller.test.ts` and `test/scansci/python-scan-sci-port.test.ts`.                                                                  | Satisfied.                                   |
| 4   | Reader tests cover eligibility, tab selection, DOM selection, translation, status, and reveal.                | `test/reader/reader-section.test.ts`, lifecycle tests, and controller integration tests.                                                                               | Satisfied.                                   |
| 5   | Production and deterministic adapters share exact capability/result expectations.                             | Port/protocol/controller contract tests assert the same capability and terminal result schemas without invented runtime success.                                       | Satisfied.                                   |
| 6   | Protocol tests cover identity, operations, progress, terminals, malformed input, fields, evidence, and paths. | TypeScript and Python protocol suites include all listed cases, including exact request shape and counter/result consistency.                                          | Satisfied.                                   |
| 7   | Python tests exercise the real owned interface; network smoke remains explicit.                               | `test/python/test_scansci_sidecar.py` exercises real sidecar/bridge seams without network fixtures posing as acceptance. Network smoke was not run and is not claimed. | Satisfied; network smoke explicitly not run. |
| 8   | Subprocess tests cover EOF, framing, wait/kill, timeout, abort, one-time termination, and budgets.            | Zotero subprocess and production-port suites cover lifecycle and failure propagation.                                                                                  | Satisfied.                                   |
| 9   | Filesystem tests cover isolation, sanitization, containment, no-overwrite, per-item failure, and cleanup.     | Download-filesystem and controller tests use isolated destinations and assert each behavior.                                                                           | Satisfied.                                   |
| 10  | Translation tests follow the public bridge prior art.                                                         | Reader/controller suites cover capability, academic selection, anchoring, stale suppression, and independent failure.                                                  | Satisfied.                                   |
| 11  | Regression suites prove ScanSci cannot alter identity or Reader availability.                                 | Full literature, Reader, paper-session, and controller suites pass; targeted tests cover startup-probe and download-failure isolation.                                 | Satisfied.                                   |
| 12  | Artifact verification covers clean install, all tests/checks/build/audit and records hash/size.               | Validation record below includes all gates and the deterministic XPI identity.                                                                                         | Satisfied.                                   |
| 13  | A failing automated check blocks completion; missing manual evidence remains pending.                         | All required automated checks pass. No fixture or inference is substituted for manual acceptance.                                                                      | Satisfied.                                   |

## Out of scope

| #   | Excluded behavior                                                                                                              | Verification                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 1   | Agent-performed or agent-claimed real Zotero, Paper Translate service, institution login, or publisher-entitlement acceptance. | Not performed or claimed; listed as pending user work.                 |
| 2   | Promote WebVPN to IEEE from candidate to available.                                                                            | Route remains unavailable candidate.                                   |
| 3   | Authenticated metadata enrichment or describing public Semantic Scholar data as institution-authenticated.                     | No such path added.                                                    |
| 4   | Modify/fork/submodule/copy external ScanSci or add another downloader.                                                         | Only the owned compatibility sidecar assets are packaged.              |
| 5   | General MCP/HTTP control planes, arbitrary operations/URLs/config/secrets, or Zotero Web API upload.                           | Exact four-operation stdio protocol rejects these inputs.              |
| 6   | Zotero item/attachment/collection creation, indexing, automatic import, or library deduplication.                              | Download path is filesystem-only.                                      |
| 7   | PDF-byte verification, content deduplication, journal/recovery/queue/retry/prefetch/automatic download.                        | No such state or path added.                                           |
| 8   | Overwrite, suffix rename, alternate destination, second-source fallback, or weaker legal policy.                               | Exclusive single-destination commit and fixed legal policy remain.     |
| 9   | Sci-Hub, LibGen, SciBban, Tor, proxy/VPN/IP rotation, hidden login, CAPTCHA bypass, or circumvention.                          | Packaging/policy tests deny prohibited routes and assets.              |
| 10  | Paper Translate configuration/PDF translation/OCR, Zotero 7/8, dark redesign, or formal public release.                        | No such changes; artifact remains Zotero 9 second-stage test identity. |
| 11  | Third-stage `auth.json` filtering, ranking, or relevance analysis.                                                             | No such implementation added.                                          |

## Closed Map behavior retention

The issue #39 baseline map remains the detailed inventory. This gate rechecked
the closed behavior groups most exposed to the #40/#41 merge:

| Map issue | Retained evidence                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #23       | Default `E:\paper`, native destination selection, and persisted preference remain covered by download-settings and Reader tests; removed private-runtime controls did not return.                |
| #25       | Paper Translate public API, selection anchoring, stale-result suppression, and independent failure remain covered by Reader/controller tests.                                                    |
| #26       | Confirmed-paper-only ordered selection across References/Citations and tab-local select-all remain covered, including cross-tab projection and complete stable-identity conflict handling.       |
| #27       | Explicit one-paper dispatch, destination creation, one request-local `ScanSciCache`, canonical naming, and exclusive no-overwrite commit remain covered by controller/port/filesystem tests.     |
| #29       | Second-stage manifest/build identity and XPI content rules remain covered by configuration, deterministic build, synthetic package tests, and the XPI audit; this issue does not deliver an XPI. |
| #32       | The plugin-owned legal-only compatibility bridge, fixed arXiv/PMC routes, provenance manifest, and source rules remain; runtime installation branches did not return.                            |
| #35       | The plugin-owned four-operation JSONL sidecar, bounded/redacted output, policy enforcement, batch progress, and candidate institution route remain covered by TypeScript/Python protocol tests.  |
| #36       | Production subprocess lifecycle, single/batch dispatch, cancellation, timeout, containment, failure isolation, and scoped cleanup remain covered by adapter and filesystem tests.                |
| #37       | `institution-webvpn/ieee/one-click-single` remains an unavailable candidate pending the complete real-world audit; probe and visible-login tests reject promotion.                               |
| #40       | Reader selection/translation integration is merged at `e0f47699cda4b666c96d45d580b28a207f0654fc`; startup registration and failure-isolation regressions are retained.                           |
| #41       | Complete single/batch download, subprocess, filesystem, and sidecar behavior remains the integration baseline at `5c558ca0132ea595a98e7dffcc472ac0f9d906c0`.                                     |

No vendored external ScanSci tree, private venv/runtime installer, alternate
TypeScript-facing legacy protocol, MCP/HTTP fallback, or second downloader is
present in the production package path.

## Findings corrected by this gate

- Unified DOI normalization, including DOI URLs and percent-decoding, in one
  identifier module; removed the provider parser's second implementation.
- Restored the contracted NFKC exact-title rule and stopped collapsing accented
  and unaccented titles.
- Rejected stable-identifier candidate sets that agree on one identifier but
  conflict on another.
- Projected and deduplicated Reader selection, download status, and reveal-file
  actions by complete scholarly identity rather than presentation row ID, while
  preserving conflicts in any shared stable-identifier scheme.
- Kept presentation row IDs unique by source record and ordinal, and advanced
  the cached provider schema so complete-identity conflicts cannot alias one
  controller or DOM row.
- Strengthened Citing-paper preservation coverage after sidecar failure.
- Enforced exact sidecar request shapes, protocol-only stdout, process-wide
  bounded/redacted diagnostics across fragmented writes, exact diagnostic byte
  limits, actual batch counter consistency, and packaged asset revalidation
  before every probe.
- Replaced drifting package deny lists with one policy and added structural ZIP
  safety checks plus deterministic repacking.
- Replaced stale fuzzy-score research guidance with the exact identity contract.
- Kept CI focused on repository hygiene and diff whitespace; the tag-triggered
  release gate alone runs the complete source, build, and XPI audit before
  publishing metadata derived from `package.json`.

## Automated validation record

Executed from a clean dependency installation on Windows:

| Gate                        | Result                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                    | Passed.                                                                                                              |
| Full Node test suite        | 184 passed, 0 failed.                                                                                                |
| Full Python test suite      | 28 passed, 0 failed.                                                                                                 |
| TypeScript typecheck        | Passed.                                                                                                              |
| ESLint                      | Passed.                                                                                                              |
| Source/document formatting  | Passed.                                                                                                              |
| GitHub workflow formatting  | Passed.                                                                                                              |
| Production build            | Passed twice.                                                                                                        |
| XPI content/denylist audit  | Passed; 18 members.                                                                                                  |
| Deterministic package check | Both builds produced SHA-256 `e25d22ed1cbdac66ad3246c619addcca417f867b5dac76d63ffad7d096136170`, size 106,849 bytes. |
| Diff whitespace check       | Passed on the complete issue #42 diff.                                                                               |
| Network-dependent smoke     | Explicitly not run; no fixture/mock success is reported as a real network result.                                    |

The dependency audit also reports two high-severity advisories in the
development-only `zotero-plugin-scaffold@0.8.8` dependency chain through
`adm-zip@0.5.18`. The current scaffold release still selects that version, and
the offered automated fix is a breaking downgrade. This gate does not conceal
the advisory or treat it as resolved; the deterministic post-pack step and XPI
structural audit bound the package produced here.

## Pending user acceptance

The user remains the authority for all of the following after a later packaging
ticket provides an identified acceptance XPI:

- install and exercise the XPI in real Zotero 9;
- verify the real Paper Translate service result;
- perform any institution login in the intended dedicated profile;
- verify actual publisher entitlement and a real one-paper institution route;
- report observed filenames, paths, UI behavior, and failures back to the
  project.

This issue does not deliver or designate the locally built XPI as that final
acceptance artifact.
