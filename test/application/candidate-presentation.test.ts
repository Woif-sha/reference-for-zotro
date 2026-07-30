import assert from "node:assert/strict";
import test from "node:test";
import { candidateToReaderPaper } from "../../src/composition-root";

test("resolved paper presentation retains provider record, retrieval time and match evidence", () => {
  const paper = candidateToReaderPaper(
    {
      source: "crossref",
      sourceRecordID: "10.1000/example",
      retrievedAt: "2026-07-30T00:00:00.000Z",
      identifiers: { doi: "10.1000/example" },
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
