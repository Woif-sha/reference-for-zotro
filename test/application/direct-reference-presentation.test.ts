import assert from "node:assert/strict";
import test from "node:test";

import type { ResolutionContext } from "../../src/application/related-papers-controller";
import {
  PROVIDER_SCHEMA_VERSION,
  PROVIDER_QUERY_VERSION,
  resolveReferenceEntry,
} from "../../src/composition-root";
import type { RelatedLiteratureGateway } from "../../src/literature/gateway";

test("unique Reader row identities invalidate the old cached provider projection", () => {
  assert.equal(PROVIDER_SCHEMA_VERSION, 4);
});

test("Reader reference projection changes invalidate previous cached results", () => {
  assert.equal(PROVIDER_QUERY_VERSION, 12);
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
  let resolvedDoi: string | undefined;
  const gateway: RelatedLiteratureGateway = {
    resolveReference: (query) => {
      resolvedDoi = query.identifiers.doi;
      return Promise.resolve({
        status: "unresolved",
        reason: "incomplete-metadata",
        outcomes: [{ source: "crossref", status: "success" }],
      });
    },
    getCitingPapers: () => {
      throw new Error("not used");
    },
    dispose() {},
  };

  const paper = await resolveReferenceEntry(
    27,
    lookupText,
    lookupText,
    gateway,
    async (url) => {
      const response = new Response(
        `<html><head>
          <meta content="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding" name=citation_title>
          <meta content="Jacob Devlin" name=citation_author>
          <meta content="Ming-Wei Chang" name=citation_author>
          <meta content="Kenton Lee" name=citation_author>
          <meta content="Kristina Toutanova" name=citation_author>
          <meta content="Proceedings of the 2019 Conference of the North American Chapter of the Association for Computational Linguistics: Human Language Technologies, Volume 1 (Long and Short Papers)" name=citation_conference_title>
          <meta content="2019/6" name=citation_publication_date>
          <meta content="10.18653/v1/N19-1423" name=citation_doi>
        </head><body>
          <div class="card-body acl-abstract"><h5>Abstract</h5><span>BERT abstract.</span></div>
        </body></html>`,
        {
          headers: { "Content-Type": "text/html" },
        },
      );
      Object.defineProperty(response, "url", { value: url });
      return response;
    },
    context,
  );

  assert.equal(paper.status, "resolved");
  assert.equal(resolvedDoi, "10.18653/v1/n19-1423");
  assert.equal(
    paper.title,
    "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
  );
  assert.doesNotMatch(
    paper.title,
    /Proceedings|Burstein|Minneapolis|\[Online\]|https:/u,
  );
  assert.equal(
    paper.authors,
    "Jacob Devlin, Ming-Wei Chang, Kenton Lee, Kristina Toutanova",
  );
  assert.match(paper.venue ?? "", /^Proceedings of the 2019 Conference/u);
  assert.equal(paper.year, "2019");
  assert.equal(paper.abstract, "BERT abstract.");
});

test("unresolved references display titles wrapped in MinerU right double quotes", async () => {
  const lookupText =
    "L. Jin, W. Fu, H. Yan, and L. Shi, ”A Statistical Cell Delay Model for Estimating the 3σ Delay by Matching Kurtosis”, IEEE Trans. Circuits Syst. II Express Briefs, 2022, vol. 69, no. 6, pp. 2932–2936.";
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
    resolveReference: async () => ({
      status: "unresolved",
      reason: "no-candidate",
      outcomes: [{ source: "crossref", status: "no-candidate" }],
    }),
    getCitingPapers: () => {
      throw new Error("not used");
    },
    dispose() {},
  };

  const paper = await resolveReferenceEntry(
    10,
    lookupText,
    lookupText,
    gateway,
    () => {
      throw new Error("not used");
    },
    context,
  );

  assert.equal(
    paper.title,
    "A Statistical Cell Delay Model for Estimating the 3σ Delay by Matching Kurtosis",
  );
  assert.doesNotMatch(paper.title, /L\. Jin|IEEE Trans|2022/u);
});

test("a landing-page timeout is unreachable instead of a red fatal failure", async () => {
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
      throw new Error("not used");
    },
    getCitingPapers: () => {
      throw new Error("not used");
    },
    dispose() {},
  };

  const paper = await resolveReferenceEntry(
    4,
    "OpenAI. GPT-4 Technical Report. Preprint at https://arxiv.org/abs/2303.08774 (2023).",
    "OpenAI. GPT-4 Technical Report. Preprint at https://arxiv.org/abs/2303.08774 (2023).",
    gateway,
    async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    },
    context,
  );

  assert.equal(abortController.signal.aborted, false);
  assert.equal(paper.status, "unreachable");
  assert.equal(paper.title, "GPT-4 Technical Report");
  assert.equal(paper.statusText, "Landing page is unreachable");
});

test("an unparsed bibliography never falls back to the complete reference", async () => {
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
  const rawReference =
    "Unknown, A. Author data https://example.test/paper, 2024.";
  const gateway: RelatedLiteratureGateway = {
    resolveReference: () => {
      throw new Error("unparsed references must not be queried");
    },
    getCitingPapers: () => {
      throw new Error("not used");
    },
    dispose() {},
  };

  const paper = await resolveReferenceEntry(
    0,
    rawReference,
    rawReference,
    gateway,
    () => {
      throw new Error("not used");
    },
    context,
  );

  assert.equal(paper.title, "Title unavailable");
  assert.equal(paper.statusText, "Reference title could not be parsed");
  assert.equal(paper.rawReference, rawReference);
  assert.doesNotMatch(paper.title, /Unknown|example\.test|2024/u);
});
