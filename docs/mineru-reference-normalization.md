# MinerU Reference normalization

The validated MinerU cache has one authoritative Reference representation. Before extracting bibliographic fields, Reference for Zotero normalizes the Reference blocks and writes the same result to `full.md`, `content_list.json`, and the offset-adjusted `manifest.json`. Other plugins may consume the normalized `full.md` directly.

## Canonical forms

Numbered bibliographies use this shape:

```text
[source-number] normalized bibliography text
```

The source number is the number printed in the paper. It is not replaced by the entry's array position, and gaps are preserved. Numeric in-text marker navigation is available only for these source-provided numbers.

Each entry is one complete line. MinerU `ref_text` blocks without a marker between two consecutive numbered entries are continuations of the preceding entry and are joined with one space. A single unmarked block between source numbers `N` and `N+2` is assigned `[N+1]`. Other ambiguous missing-marker sequences fail explicitly. Unmarked blocks before the first or after the last numbered entry are not Reference entries and are typed as ordinary text.

When every Reference block is unnumbered, each remaining `ref_text` block is one marker-free bibliography entry. The canonical Markdown does not invent numeric markers; list positions are display ordinals only and cannot drive numeric in-text marker navigation. A `ref_text` block whose normalized text duplicates an explicit `footer`, `page_footnote`, `header`, or `page_number` block in the same content list is restored to that page-component type instead of becoming a Reference entry.

The bibliography text is normalized by these rules, in order:

1. Decode HTML entities and apply Unicode NFKC normalization.
2. Remove orphan combining marks between Latin tokens. Preserve one word space, or rejoin the tokens when the artifact interrupts a hyphenated word. Combining marks attached to a letter are retained.
3. Remove MinerU `<sup>` and `<sub>` wrappers while retaining their text.
4. Convert typographic single and double quotation marks to ASCII quotes.
5. Remove Markdown escapes from punctuation and symbol characters.
6. Repair whitespace around `http://`, `https://`, DOI paths, and whitespace inserted inside a trailing URL.
7. Collapse all remaining whitespace runs to one ASCII space and trim the entry.

Normalization is idempotent: applying it again produces no file changes. It repairs only evidence present in the MinerU output; it does not invent missing bibliography entries, author names, titles, years, venues, or identifier characters.

## Consumer contract

Consumers must treat `full.md` as canonical and must not maintain or display a separate raw Reference string. Bibliographic extraction receives the marker-free canonical text. Quoted titles are identified from a complete quoted region after citation punctuation, so author-list variants such as compound surnames do not determine the title boundary.
