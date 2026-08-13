# Use one canonical MinerU Reference representation

Reference for Zotero normalizes the shared MinerU `full.md`, `content_list.json`, and `manifest.json` in place instead of retaining a plugin-private raw and parsed pair. This makes the normalized Markdown the one source of truth for Reference for Zotero, Paper Translate for Zotero, and llm-for-zotero; preserving a second raw projection would let consumers observe different Reference entries and force each plugin to repeat format-specific repair.
