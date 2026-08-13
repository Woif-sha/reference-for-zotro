# MinerU Reference normalization

The validated MinerU cache has one authoritative Reference representation. Before extracting bibliographic fields, Reference for Zotero normalizes the Reference blocks and writes the same result to `full.md`, `content_list.json`, and the offset-adjusted `manifest.json`. Other plugins may consume the normalized `full.md` directly.

## Canonical form

Every Reference entry uses this shape:

```text
[source-number] normalized bibliography text
```

The source number is the number printed in the paper. It is not replaced by the entry's array position, and gaps are preserved.

Each entry is one complete line. MinerU `ref_text` blocks without a marker between two consecutive numbered entries are continuations of the preceding entry and are joined with one space. A single unmarked block between source numbers `N` and `N+2` is assigned `[N+1]`. Other ambiguous missing-marker sequences fail explicitly. Unmarked blocks before the first or after the last numbered entry are not Reference entries and are typed as ordinary text.

The bibliography text is normalized by these rules, in order:

1. Decode HTML entities and apply Unicode NFKC normalization.
2. Remove MinerU `<sup>` and `<sub>` wrappers while retaining their text.
3. Convert typographic single and double quotation marks to ASCII quotes.
4. Remove Markdown escapes from punctuation and symbol characters.
5. Repair whitespace around `http://`, `https://`, DOI paths, and whitespace inserted inside a trailing URL.
6. Collapse all remaining whitespace runs to one ASCII space and trim the entry.

Normalization is idempotent: applying it again produces no file changes. It repairs only evidence present in the MinerU output; it does not invent missing bibliography entries, author names, titles, years, venues, or identifier characters.

## Consumer contract

Consumers must treat `full.md` as canonical and must not maintain or display a separate raw Reference string. Bibliographic extraction receives the marker-free canonical text. Quoted titles are identified from a complete quoted region after citation punctuation, so author-list variants such as compound surnames do not determine the title boundary.
