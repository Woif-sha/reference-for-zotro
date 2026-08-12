# Issue #43 user-acceptance XPI

This record designates the only Zotero 9 second-stage XPI delivered for user
acceptance. It replaces every intermediate package produced by earlier
implementation and conformance tickets.

## Source and isolation

- Artifact source commit: `0a3716b685e38043648832ea25abb1ef3fab8d97`
  (`origin/dev`, merge of the completed issue #42 conformance gate).
- Direct blocker #42 and its blocking implementation tickets #40 and #41 were
  closed before this build. The convergence ticket #39 was also closed.
- The artifact was built in a dedicated clean worktree from the source commit.
  Uncommitted `AGENTS.md` and `CONTEXT.md` changes in the original worktree were
  not present in the source tree or package.
- Dependencies were installed from `package-lock.json` with `npm ci` before the
  final gate.
- This delivery-record commit is not an artifact input; `docs/` is outside the
  package source set.

## Unique artifact

| Field        | Value                                                              |
| ------------ | ------------------------------------------------------------------ |
| Add-on name  | `Reference for Zotero (Second-stage Test)`                         |
| Version      | `1.1.0-beta.1`                                                     |
| Zotero range | `9.0.6` through `9.0.*`                                            |
| Filename     | `reference-for-zotero-second-stage-test.xpi`                       |
| Size         | `106849` bytes                                                     |
| SHA-256      | `e25d22ed1cbdac66ad3246c619addcca417f867b5dac76d63ffad7d096136170` |
| ZIP members  | `18`                                                               |

The XPI audit found exactly one XPI in `build/`. Required plugin, compatibility
module, versioned sidecar, fixed provenance, license, and resource assets were
present. The shared package policy rejected unregistered Python assets and
forbids external ScanSci packages, Python runtimes or virtual environments,
native extensions, browser binaries or caches, profiles, credentials, cookies,
tokens, API keys, PDFs, `ScanSciCache`, tests, logs, and diagnostics.

## Automated verification

The following commands completed successfully on Windows with Node.js 22.14.0,
npm 10.9.2, and Python 3.12.10:

| Gate                                      | Result                                   |
| ----------------------------------------- | ---------------------------------------- |
| `npm ci`                                  | Passed from the locked dependency graph. |
| Full Node test suite                      | 184 passed, 0 failed.                    |
| Full Python test suite                    | 28 passed, 0 failed.                     |
| TypeScript typecheck                      | Passed.                                  |
| ESLint                                    | Passed.                                  |
| Source/document and workflow format check | Passed.                                  |
| Production build                          | Passed.                                  |
| XPI content and denylist audit            | Passed; identity recorded above.         |
| `git diff --check`                        | Passed.                                  |

Network-dependent smoke testing was not run and is not represented by a fixture
or inferred success. No Git tag, GitHub Release, or publishable update metadata
was created. Zotero's required manifest `update_url` remains, but this test build
does not publish the corresponding `update-beta.json`.

## User acceptance boundary

Install this one XPI in a real supported Zotero 9 profile and follow
`docs/testing/second-stage-xpi.md`. The user remains the authority for, and
should report the observed result of:

- real Zotero installation and Reader/XUL/XML behavior;
- the configured Paper Translate service;
- legal one-paper and batch file behavior, including destination, canonical
  filename, no-overwrite, cleanup, and absence of Zotero-library mutation;
- any institution-entitled route.

`institution-webvpn/ieee/one-click-single` remains an unavailable acceptance
candidate. Automated verification does not claim that login, publisher
entitlement, or an institution download succeeded.
