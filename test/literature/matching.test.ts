import assert from "node:assert/strict";
import test from "node:test";
import {
  matchScholarlyCandidates,
  type MatchablePaper,
} from "../../src/literature/matching";
import type { ScholarlyCandidate } from "../../src/literature/providers/types";

function candidate(overrides: Partial<ScholarlyCandidate>): ScholarlyCandidate {
  return {
    source: "crossref",
    sourceRecordID: "record-1",
    retrievedAt: "2026-07-30T00:00:00.000Z",
    identifiers: {},
    title: "A reliable paper title",
    authors: [{ family: "Smith", given: "Ada" }],
    publicationDate: "2024-01-01",
    publicationYear: 2024,
    venue: "Journal of Tests",
    abstract: null,
    referenceCount: null,
    citationCount: null,
    canonicalURL: null,
    landingURL: null,
    matchedFields: [],
    rawProvenance: [],
    ...overrides,
  };
}

test("exact stable identifier agreement wins over attractive text ordering", () => {
  const reference: MatchablePaper = {
    identifiers: { doi: "10.1000/right" },
    title: "A reliable paper title",
    authors: ["Smith"],
    year: 2024,
  };

  const result = matchScholarlyCandidates(reference, [
    candidate({
      sourceRecordID: "wrong",
      identifiers: { doi: "10.1000/wrong" },
    }),
    candidate({
      sourceRecordID: "right",
      identifiers: { doi: "10.1000/RIGHT" },
      title: "Deposited title variant",
    }),
  ]);

  assert.equal(result.status, "confirmed");
  assert.equal(result.candidate.sourceRecordID, "right");
  assert.equal(result.matchedBy, "doi");
  assert.deepEqual(result.candidate.matchedFields, ["doi"]);
  assert.deepEqual(result.candidates[0].matchedFields, ["doi"]);
});

test("combined title author and year evidence confirms a unique candidate", () => {
  const reference: MatchablePaper = {
    identifiers: {},
    title: "Deep Residual Learning for Image Recognition",
    authors: ["He", "Zhang", "Ren", "Sun"],
    year: 2016,
  };

  const result = matchScholarlyCandidates(reference, [
    candidate({
      sourceRecordID: "other",
      title: "Deep Learning for Image Recognition",
      authors: [{ family: "Other" }],
      publicationYear: 2016,
    }),
    candidate({
      sourceRecordID: "resnet",
      title: "Deep residual learning for image recognition",
      authors: [
        { family: "He" },
        { family: "Zhang" },
        { family: "Ren" },
        { family: "Sun" },
      ],
      publicationYear: 2015,
    }),
  ]);

  assert.equal(result.status, "confirmed");
  assert.equal(result.candidate.sourceRecordID, "resnet");
  assert.equal(result.matchedBy, "metadata");
  assert.deepEqual(result.candidate.matchedFields, [
    "title",
    "first-author",
    "authors",
    "year",
  ]);
});

test("close metadata candidates remain ambiguous instead of selecting provider order", () => {
  const reference: MatchablePaper = {
    identifiers: {},
    title: "Attention Is All You Need",
    authors: ["Vaswani", "Shazeer"],
    year: 2017,
  };

  const result = matchScholarlyCandidates(reference, [
    candidate({
      sourceRecordID: "first",
      title: "Attention Is All You Need",
      authors: [{ family: "Vaswani" }, { family: "Shazeer" }],
      publicationYear: 2017,
    }),
    candidate({
      source: "datacite",
      sourceRecordID: "second",
      title: "Attention Is All You Need",
      authors: [{ family: "Vaswani" }, { family: "Shazeer" }],
      publicationYear: 2017,
    }),
  ]);

  assert.equal(result.status, "ambiguous");
  assert.ok(
    result.candidates.every(
      ({ matchedFields }) =>
        matchedFields.includes("title") &&
        matchedFields.includes("first-author") &&
        matchedFields.includes("authors") &&
        matchedFields.includes("year"),
    ),
  );
});

test("same exact DOI from multiple registrars remains one confirmed identity with all provenances", () => {
  const reference: MatchablePaper = {
    identifiers: { doi: "10.1000/shared" },
    title: null,
    authors: [],
    year: null,
  };

  const result = matchScholarlyCandidates(reference, [
    candidate({
      source: "crossref",
      sourceRecordID: "crossref-shared",
      identifiers: { doi: "10.1000/shared" },
    }),
    candidate({
      source: "datacite",
      sourceRecordID: "datacite-shared",
      identifiers: { doi: "10.1000/shared" },
    }),
  ]);

  assert.equal(result.status, "confirmed");
  assert.deepEqual(
    result.candidates.map(({ source }) => source),
    ["crossref", "datacite"],
  );
});

test("HTML entities are decoded before title evidence is scored", () => {
  const result = matchScholarlyCandidates(
    {
      identifiers: {},
      title: "Research & Development",
      authors: ["Smith"],
      year: 2024,
    },
    [
      candidate({
        title: "Research &amp; Development",
        authors: [{ family: "Smith" }],
        publicationYear: 2024,
      }),
    ],
  );

  assert.equal(result.status, "confirmed");
});

test("named scholarly HTML entities are decoded before title evidence is scored", () => {
  const namedEntityCandidate = candidate({
    title: "Alpha–beta methods",
    authors: [{ family: "Smith" }],
    publicationYear: 2024,
  });

  assert.equal(
    matchScholarlyCandidates(
      {
        title: "Alpha&ndash;beta methods",
        authors: ["Smith"],
        year: 2024,
        identifiers: {},
      },
      [namedEntityCandidate],
    ).status,
    "confirmed",
  );
});
