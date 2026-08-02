import assert from "node:assert/strict";
import test from "node:test";

import type { ResolutionContext } from "../../src/application/related-papers-controller";
import {
  PROVIDER_QUERY_VERSION,
  resolveReferenceEntry,
} from "../../src/composition-root";
import type { RelatedLiteratureGateway } from "../../src/literature/gateway";

test("trusted-title presentation invalidates previously cached provider results", () => {
  assert.equal(PROVIDER_QUERY_VERSION, 4);
});

test("trusted scholarly URLs display the parsed paper title instead of the full bibliography entry", async () => {
  const lookupText =
    "J. Devlin, M.-W. Chang, K. Lee, and K. Toutanova, “BERT: Pretraining of deep bidirectional transformers for language understanding,” in Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies, Volume 1 (Long and Short Papers), J. Burstein, C. Doran, and T. Solorio, Eds. Minneapolis, Minnesota: Association for Computational Linguistics, Jun. 2019, pp. 4171–4186. [Online]. Available: https://aclanthology.org/N19-1423/";
  const abortController = new AbortController();
  const context: ResolutionContext = {
    paper: {
      identity: {
        libraryID: 1,
        attachmentID: 2,
        attachmentKey: "ATTACHMENT",
        parentItemKey: "PARENT",
      },
      sourceFingerprint: "fingerprint",
      entries: [],
    },
    token: {
      libraryID: 1,
      attachmentID: 2,
      attachmentKey: "ATTACHMENT",
      parentItemKey: "PARENT",
      sourceFingerprint: "fingerprint",
      generation: 1,
    },
    signal: abortController.signal,
  };
  const gateway: RelatedLiteratureGateway = {
    resolveReference: () => {
      throw new Error("trusted URL must not call metadata providers");
    },
    getCitingPapers: () => {
      throw new Error("not used");
    },
    dispose() {},
  };

  const paper = await resolveReferenceEntry(
    27,
    lookupText,
    gateway,
    async (url) => {
      const response = new Response("<html></html>", {
        headers: { "Content-Type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: url });
      return response;
    },
    context,
  );

  assert.equal(paper.status, "resolved");
  assert.equal(
    paper.title,
    "BERT: Pretraining of deep bidirectional transformers for language understanding",
  );
  assert.doesNotMatch(
    paper.title,
    /Proceedings|Burstein|Minneapolis|\[Online\]|https:/u,
  );
});
