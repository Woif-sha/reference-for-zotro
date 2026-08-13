# Reference for Zotero

This context describes the scholarly-paper concepts shown by the Zotero reader extension.

## Language

**Current paper**:
The paper open in Zotero's reader whose relationships are being explored.
_Avoid_: Source paper, selected PDF

**Reference entry**:
One bibliography entry cited by the current paper and extracted from its existing MinerU Markdown.
_Avoid_: Citation

**Resolved reference**:
A reference entry that has been matched to a scholarly landing page and descriptive metadata.
_Avoid_: Download

**Citing paper**:
A paper that cites the current paper.
_Avoid_: Citation, reverse reference

**Paper landing page**:
The canonical publisher or scholarly web page for a paper, rather than a direct file download.
_Avoid_: Download page, PDF link

**Primary result**:
The reachable result preferred for a matched paper after comparing candidate results by identifier agreement, source authority, and metadata completeness. It is not necessarily the first result returned by a database search.
_Avoid_: First search result, Best guess

**MinerU Markdown**:
The required Markdown representation of the current paper produced by the user's `llm-for-zotero` MinerU workflow. Relationship exploration does not start until a valid MinerU Markdown exists.
_Avoid_: OCR output, parsed PDF

**Download selection**:
The ordered papers with confirmed identities that the user explicitly chooses for download in the current Reader section.
_Avoid_: Text selection, Automatic download queue

**Download destination**:
The user-configured Windows directory in which downloaded paper files are saved.
_Avoid_: Zotero storage, Attachment directory

**Download request**:
One user-authorized attempt to obtain a single paper from the Download selection and save it in the Download destination read when that attempt starts.
_Avoid_: Import job, Background prefetch

**Download result**:
The per-paper outcome of a Download request: either the actual saved path or the unchanged error from the boundary that failed.
_Avoid_: Import result, Batch partial result

**Institution download route**:
A user-entitled path from a confirmed paper through an institution login to an official publisher PDF. A route remains a candidate until its actual login, source, network, session ownership, and one-paper download have been audited together.
_Avoid_: Institution support, Browser available

**Route capability**:
A runtime claim that one specific institution download route has passed its required audit and is currently usable. Installed browser support or an upstream publisher list alone is not a route capability.
_Avoid_: Provider available, Browser installed
