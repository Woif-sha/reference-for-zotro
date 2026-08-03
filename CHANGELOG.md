# Changelog

All notable changes to Reference for Zotero are documented in this file.

## [1.0.0] - 2026-08-03

### Highlights

- Added a Zotero 9 Reader section with References and Citations views.
- Preserved Reference entry order from validated MinerU Markdown.
- Added conservative multi-provider resolution using DOI, trusted scholarly URLs, bibliographic metadata, Crossref and DataCite.
- Added cumulative Citing papers retrieval through OpenCitations with 10, 30 and 50 result limits.
- Added anchored paper detail cards with citation counts, reference counts, DOI, author, venue, year and Abstract fields.
- Added on-demand Abstract enrichment through OpenAlex with Semantic Scholar fallback and exact DOI verification.
- Added optional selection translation through the public Paper Translate API.
- Added typed MinerU reference-block parsing and Reader detail-card outside-click dismissal.

### Correctness and safety

- Opened confirmed records on the best reachable original-paper landing page, preferring identity-consistent publisher records with downloadable version-of-record evidence.
- Kept only the parsed paper title for unresolved, ambiguous or unreachable records and made `Ctrl + left click` open a Google search for that exact title.
- Required title, year and author evidence to remain consistent when choosing among competing landing-page candidates, while preserving ambiguity instead of silently selecting conflicting metadata.
- Isolated asynchronous work and cache writes by Reader paper generation.
- Versioned persistent caches by attachment identity, MinerU fingerprint, provider schema and query version.
- Prevented stale responses and aborted writes from replacing current paper state.
- Added XHTML/XUL-safe Reader rendering for Zotero 9.
- Fixed long bibliography entries such as ACL Anthology references so only the paper title appears in the list while authors, venue, year, DOI and Abstract remain available as metadata.
- Removed provider provenance rows from the user-facing paper list and detail card.

### Compatibility and validation

- Supports Zotero `9.0.6` through `9.0.x`.
- Requires valid MinerU Markdown generated for the current attachment by the user's `llm-for-zotero` workflow.
- Validated the development source with 115 automated tests, TypeScript checks, ESLint, Prettier and a production XPI build; the clean release source was separately dependency-installed, type-checked and built from its pruned lockfile.

[1.0.0]: https://github.com/Woif-sha/reference-for-zotro/releases/tag/v1.0.0
