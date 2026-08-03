import assert from "node:assert/strict";
import test from "node:test";
import {
  selectPrimaryResult,
  type PrimaryResultCandidate,
} from "../../src/literature/primary-result";
import type { ScholarlyCandidate } from "../../src/literature/providers/types";

function option(
  source: ScholarlyCandidate["source"],
  sourceRecordID: string,
  overrides: Partial<ScholarlyCandidate> = {},
): PrimaryResultCandidate {
  return {
    confirmed: true,
    reachability: "reachable",
    candidate: {
      source,
      sourceRecordID,
      retrievedAt: "2026-07-30T00:00:00.000Z",
      identifiers: { doi: "10.1000/example" },
      title: "Example",
      authors: [{ family: "Smith" }],
      publicationDate: "2024-01-01",
      publicationYear: 2024,
      venue: "Journal",
      abstract: null,
      referenceCount: null,
      citationCount: null,
      canonicalURL: "https://doi.org/10.1000/example",
      landingURL: "https://publisher.example/paper",
      matchedFields: ["doi"],
      rawProvenance: [],
      ...overrides,
    },
  };
}

test("Primary result excludes unreachable records before authority and completeness", () => {
  const unreachable = {
    ...option("crossref", "unreachable", {
      referenceCount: 20,
      citationCount: 30,
    }),
    reachability: "unreachable" as const,
  };
  const reachable = option("opencitations-meta", "reachable");

  assert.equal(
    selectPrimaryResult([unreachable, reachable])?.sourceRecordID,
    "reachable",
  );
});

test("registration metadata authority wins, then completeness breaks equal-authority ties", () => {
  const aggregate = option("opencitations-meta", "aggregate", {
    referenceCount: 20,
    citationCount: 30,
  });
  const sparseRegistrar = option("crossref", "sparse", {
    authors: [],
    publicationDate: null,
    publicationYear: null,
    venue: null,
  });
  const completeRegistrar = option("datacite", "complete", {
    referenceCount: 2,
  });

  assert.equal(
    selectPrimaryResult([aggregate, sparseRegistrar, completeRegistrar])
      ?.sourceRecordID,
    "complete",
  );
});

test("safe version-of-record full text evidence breaks equal-authority ties", () => {
  const withoutFullText = option("crossref", "a-without-full-text");
  const withFullText = option("crossref", "z-with-full-text", {
    fullTextURL: "https://publisher.example/paper.pdf",
  });

  assert.equal(
    selectPrimaryResult([withoutFullText, withFullText])?.sourceRecordID,
    "z-with-full-text",
  );
});

test("Primary result requires a non-empty title and stable identity", () => {
  assert.equal(
    selectPrimaryResult([
      option("crossref", "empty-title", { title: "" }),
      option("datacite", "no-identifier", { identifiers: {} }),
    ]),
    undefined,
  );
});
