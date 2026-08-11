import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateToReaderPaper,
  resolutionToReaderPaper,
} from "../../src/application/reader-paper-presentation";
import { preparePaperForCache } from "../../src/cache/related-papers-cache-policy";

test("resolved paper presentation retains provider record, retrieval time and match evidence", () => {
  const paper = candidateToReaderPaper(
    {
      source: "crossref",
      sourceRecordID: "10.1000/example",
      retrievedAt: "2026-07-30T00:00:00.000Z",
      identifiers: {
        doi: "10.1000/example",
        arxiv: "2101.00001",
        pmcid: "PMC1234",
      },
      title: "Example",
      authors: [{ family: "Smith", given: "Ada" }],
      publicationDate: "2024-01-01",
      publicationYear: 2024,
      venue: "Journal",
      abstract: null,
      referenceCount: null,
      citationCount: null,
      canonicalURL: "https://doi.org/10.1000/example",
      landingURL: "https://publisher.example/example",
      matchedFields: ["doi"],
      rawProvenance: ["crossref:10.1000/example"],
    },
    2,
  );

  assert.equal(paper.source, "crossref");
  assert.equal(paper.sourceRecordID, "10.1000/example");
  assert.equal(paper.retrievedAt, "2026-07-30T00:00:00.000Z");
  assert.deepEqual(paper.matchedFields, ["doi"]);
  assert.equal(paper.metadataIncomplete, false);
  assert.deepEqual(paper.rawProvenance, ["crossref:10.1000/example"]);
  assert.equal(paper.arxivID, "2101.00001");
  assert.equal(paper.pmcid, "PMC1234");
});

test("presentation rows stay unique when one stable identifier agrees and another conflicts", () => {
  const candidate = {
    source: "crossref" as const,
    sourceRecordID: "record-one",
    retrievedAt: "2026-07-30T00:00:00.000Z",
    identifiers: { doi: "10.1000/shared", arxiv: "2401.00001" },
    title: "First record",
    authors: [{ family: "Smith" }],
    publicationDate: "2024",
    publicationYear: 2024,
    venue: "Journal",
    abstract: null,
    referenceCount: null,
    citationCount: null,
    canonicalURL: "https://doi.org/10.1000/shared",
    landingURL: "https://example.test/one",
    matchedFields: ["doi"],
    rawProvenance: ["crossref:record-one"],
  };

  const first = candidateToReaderPaper(candidate, 0);
  const second = candidateToReaderPaper(
    {
      ...candidate,
      sourceRecordID: "record-two",
      identifiers: { ...candidate.identifiers, arxiv: "2401.99999" },
      landingURL: "https://example.test/two",
    },
    1,
  );

  assert.notEqual(first.id, second.id);
});

test("cache preserves permitted Abstracts and omits Crossref Abstracts", () => {
  const base = {
    id: "paper",
    ordinal: 0,
    title: "Paper",
    status: "resolved" as const,
    primaryResultURL: "https://example.test/paper",
    abstract: "Available abstract",
  };

  assert.equal(
    preparePaperForCache({ ...base, source: "datacite" }).abstract,
    "Available abstract",
  );
  assert.equal(
    preparePaperForCache({ ...base, source: "crossref" }).abstract,
    undefined,
  );
  assert.equal(
    preparePaperForCache({
      ...base,
      source: "crossref",
      abstractSource: "semantic-scholar",
    }).abstract,
    "Available abstract",
  );
});

test("resolved papers expose incomplete descriptive metadata without losing identity", () => {
  const paper = candidateToReaderPaper({
    source: "datacite",
    sourceRecordID: "10.1000/sparse",
    retrievedAt: "2026-07-30T00:00:00.000Z",
    identifiers: { doi: "10.1000/sparse" },
    title: "Sparse record",
    authors: [],
    publicationDate: null,
    publicationYear: null,
    venue: null,
    abstract: null,
    referenceCount: null,
    citationCount: null,
    canonicalURL: "https://doi.org/10.1000/sparse",
    landingURL: "https://repository.example/sparse",
    matchedFields: ["doi"],
    rawProvenance: ["datacite:10.1000/sparse"],
  });

  assert.equal(paper.status, "resolved");
  assert.equal(paper.metadataIncomplete, true);
});

test("a successful Primary result retains failures from its other planned provider", () => {
  const paper = candidateToReaderPaper(
    {
      source: "datacite",
      sourceRecordID: "10.1000/example",
      retrievedAt: "2026-07-30T00:00:00.000Z",
      identifiers: { doi: "10.1000/example" },
      title: "Example",
      authors: [{ family: "Smith" }],
      publicationDate: "2024",
      publicationYear: 2024,
      venue: "Repository",
      abstract: null,
      referenceCount: null,
      citationCount: null,
      canonicalURL: "https://doi.org/10.1000/example",
      landingURL: "https://repository.example/example",
      matchedFields: ["doi"],
      rawProvenance: ["datacite:10.1000/example"],
    },
    0,
    "doi",
    [
      {
        source: "crossref",
        status: "failed",
        errorCode: "rate-limited",
      },
      { source: "datacite", status: "success" },
    ],
  );

  assert.deepEqual(paper.providerFailures, ["crossref: rate-limited"]);
});

test("ambiguous presentation retains candidate provenance and provider failures", () => {
  const paper = resolutionToReaderPaper(0, "Ambiguous reference", {
    status: "ambiguous",
    candidates: [
      {
        source: "datacite",
        sourceRecordID: "10.1000/candidate",
        retrievedAt: "2026-07-30T00:00:00.000Z",
        identifiers: { doi: "10.1000/candidate" },
        title: "Candidate",
        authors: [{ family: "Smith" }],
        publicationDate: "2024",
        publicationYear: 2024,
        venue: "Repository",
        abstract: null,
        referenceCount: null,
        citationCount: null,
        canonicalURL: "https://doi.org/10.1000/candidate",
        landingURL: null,
        matchedFields: ["title", "author", "year"],
        rawProvenance: ["datacite:10.1000/candidate"],
      },
    ],
    outcomes: [
      {
        source: "crossref",
        status: "failed",
        errorCode: "source-unavailable",
      },
      { source: "datacite", status: "success" },
    ],
  });

  assert.equal(paper.status, "ambiguous");
  assert.match(paper.connectedPaperInfo ?? "", /datacite:10\.1000\/candidate/);
  assert.deepEqual(paper.providerFailures, ["crossref: source-unavailable"]);
});
