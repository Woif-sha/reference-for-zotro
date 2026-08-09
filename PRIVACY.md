# Privacy and network requests

Reference for Zotero reads the current Reader attachment identity and its existing local MinerU Markdown. It does not upload the current PDF.

## External metadata requests

Depending on the selected feature, the plugin may send:

- reference title, first author and year to Crossref or DataCite;
- DOI to the DOI resolver to verify a paper landing page;
- DOI or other supported identifiers to OpenCitations for Citing papers;
- DOI to OpenAlex and, if necessary, Semantic Scholar when the user opens a detail card whose resolved record has no Abstract;
- a trusted scholarly landing-page URL, such as ACL Anthology, to read public citation metadata.

Returned records are accepted only through the plugin's identity, schema and reachability checks. Abstract fallback responses must contain the exact requested DOI.

## Local cache

Resolved literature data is stored under Zotero's data directory in `reference-for-zotero-cache/v1`. Cache identities include the current attachment, MinerU fingerprint and provider contract versions. The plugin does not persist Crossref-sourced Abstract text.

## Download setup

The Reader download area stores only the selected Download destination and non-sensitive Python runtime identity (executable path, Python version, and compatibility-module version) in Zotero preferences. A confirmed dependency installation is isolated under Zotero's data directory and never modifies the selected base Python or global pip configuration.

The plugin does not store institution usernames, passwords, verification codes, cookies, tokens, or browser-profile contents. Institution login and its external browser runtime remain disabled until a specific institution and publisher route has an audited vendor artifact, binary license, signature verification, strict network boundary, and Windows/Zotero acceptance evidence.

## Optional translation

If Paper Translate is installed and compatible, text selected inside this plugin can be sent through Paper Translate's public translation API. The configured translation provider and its privacy policy are controlled by Paper Translate, not by Reference for Zotero.
