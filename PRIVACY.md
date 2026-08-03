# Privacy and network requests

Reference for Zotero reads the current Reader attachment identity and its existing local MinerU Markdown. It does not upload the current PDF.

## External metadata requests

Depending on the selected feature, the plugin may send:

- reference title, first author and year to Crossref or DataCite;
- DOI to the DOI resolver to verify a paper landing page;
- DOI or other supported identifiers to OpenCitations for Citing papers;
- DOI to OpenAlex and, if necessary, Semantic Scholar when the user opens a detail card whose resolved record has no Abstract;
- a trusted scholarly landing-page URL, such as ACL Anthology, to read public citation metadata;
- the visible paper title to Google only when the user explicitly uses `Ctrl + left click` on an unresolved, ambiguous or unreachable entry.

Returned records are accepted only through the plugin's identity, schema and reachability checks. Abstract fallback responses must contain the exact requested DOI.

## Local cache

Resolved literature data is stored under Zotero's data directory in `reference-for-zotero-cache/v1`. Cache identities include the current attachment, MinerU fingerprint and provider contract versions. The plugin does not persist Crossref-sourced Abstract text.

## Optional translation

If Paper Translate is installed and compatible, text selected inside this plugin can be sent through Paper Translate's public translation API. The configured translation provider and its privacy policy are controlled by Paper Translate, not by Reference for Zotero.
