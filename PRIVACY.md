# Privacy and network requests

Reference for Zotero reads the current Reader attachment identity and its existing local MinerU Markdown. It does not upload the current PDF.

## External metadata requests

Depending on the selected feature, the plugin may send:

- reference title, first author and year to Crossref or DataCite;
- DOI to the DOI resolver to verify a paper landing page;
- DOI or other supported identifiers to OpenCitations when the Related Papers section automatically loads the first 10 Citing papers or the user requests more;
- DOI to OpenAlex and, if necessary, Semantic Scholar while the plugin automatically fills missing Abstracts for resolved References and loaded Citing papers. When configured, Abstract queries send the OpenAlex API Key in an `Authorization: Bearer` request header;
- a trusted scholarly landing-page URL, such as ACL Anthology, to read public citation metadata.
- when AI recommendation is enabled, the current paper's complete MinerU Markdown together with candidate paper titles, Reference/Citation source labels and non-empty Abstracts to the user-selected model service. Codex Auth sends this request to the Codex service; OpenAI Compatible sends it to the HTTPS API Base configured by the user.

Returned records are accepted only through the plugin's identity, schema and reachability checks. Abstract fallback responses must contain the exact requested DOI.

## Local cache

Resolved literature data is stored under Zotero's data directory in `reference-for-zotero-cache/v2/papers`. Cache identities include the current attachment, MinerU fingerprint and provider contract versions. Each paper directory may contain `abstract.json`; it stores OpenAlex- or Semantic Scholar-sourced Abstracts together with their DOI, source record and retrieval time for local reuse. The plugin does not persist Crossref-sourced Abstract text.

A paper directory may also contain `recommendation.json`. It stores only a complete AI recommendation that passed the response schema and current-paper identity checks, together with the non-secret model identity and the candidate evidence needed to decide whether the result can be reused. It does not store model API keys, Codex access or refresh tokens, the local `auth.json` path, or partial streaming output.

## OpenAlex API Key

The optional OpenAlex API Key is available for free from OpenAlex and is stored only in Zotero's local `extensions.referenceforzotero.*` plugin preferences. It is used to improve Abstract lookup availability. When the user explicitly tests the connection in Preferences, the Key is sent to OpenAlex's official `/rate-limit` endpoint as the documented `api_key` query parameter so the plugin can display the remaining daily balance. The Key is not written to the repository, add-on package, literature cache, logs or diagnostics. Leaving it empty keeps the existing keyless OpenAlex request and Semantic Scholar fallback behavior.

## Recommendation model credentials

Recommendation model configuration is stored only in this plugin's Zotero preferences and is independent of Paper Translate. Codex Auth reads the existing local Codex authentication file when a request starts. OpenAI Compatible stores the API Base, API Key and model selection in the plugin preference. The plugin does not copy credentials into `recommendation.json`, model runtime identity, diagnostics or user-visible errors.

The selected model provider receives the recommendation input described above and applies its own retention and privacy policy. The plugin does not automatically switch providers after a failure, and it does not use web search or tools while constructing the recommendation request.

## Download setup

The plugin stores the user-selected Download destination and ScanSci Cache path in Zotero preferences. The Cache path is used only as the root for isolated temporary download request directories; literature and recommendation caches remain under the fixed Zotero data directory namespace. Runtime identity and route capability come from the sidecar `probe` for the current process and are not persisted. The plugin does not create a private environment, install Python dependencies, modify a detected Python, or write global pip configuration.

The plugin does not store institution usernames, passwords, verification codes, cookies, tokens, or browser-profile contents. WebVPN → IEEE Xplore remains an unavailable candidate until its complete real-world audit; the Reader does not expose an institution configuration or login command.

## Optional translation

If Paper Translate is installed and compatible, text selected inside this plugin can be sent through Paper Translate's public translation API. The configured translation provider and its privacy policy are controlled by Paper Translate, not by Reference for Zotero.
