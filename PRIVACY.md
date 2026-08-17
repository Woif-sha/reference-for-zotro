# Privacy and network requests

Reference for Zotero reads the current Reader attachment identity and its existing local MinerU Markdown. It does not upload the current PDF.

## External metadata requests

Depending on the selected feature, the plugin may send:

- reference title, first author and year to Crossref or DataCite;
- DOI to the DOI resolver to verify a paper landing page;
- DOI or other supported identifiers to OpenCitations when the Related Papers section automatically loads the first 10 Citing papers or the user requests more;
- DOI to OpenAlex and, if necessary, Semantic Scholar while the plugin automatically fills missing Abstracts for resolved References and loaded Citing papers;
- a trusted scholarly landing-page URL, such as ACL Anthology, to read public citation metadata.

Returned records are accepted only through the plugin's identity, schema and reachability checks. Abstract fallback responses must contain the exact requested DOI.

## Local cache

Resolved literature data is stored under Zotero's data directory in `reference-for-zotero-cache/v2/papers`. Cache identities include the current attachment, MinerU fingerprint and provider contract versions. Each paper directory may contain `abstract.json`; it stores OpenAlex- or Semantic Scholar-sourced Abstracts together with their DOI, source record and retrieval time for local reuse. The plugin does not persist Crossref-sourced Abstract text.

## Download setup

The Reader download area stores only the selected Download destination in Zotero preferences. Runtime identity and route capability come from the sidecar `probe` for the current process and are not persisted. The plugin does not create a private environment, install Python dependencies, modify a detected Python, or write global pip configuration.

The plugin does not store institution usernames, passwords, verification codes, cookies, tokens, or browser-profile contents. WebVPN → IEEE Xplore remains an unavailable candidate until its complete real-world audit; the Reader does not expose an institution configuration or login command.

## Optional translation

If Paper Translate is installed and compatible, text selected inside this plugin can be sent through Paper Translate's public translation API. The configured translation provider and its privacy policy are controlled by Paper Translate, not by Reference for Zotero.
