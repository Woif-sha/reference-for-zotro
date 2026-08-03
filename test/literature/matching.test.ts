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

test("exact title year and ordered authors confirm duplicate publication records for Primary result selection", () => {
  const title =
    "Cell Library Characterization for Composite Current Source Models Based on Gaussian Process Regression and Active Learning";
  const result = matchScholarlyCandidates(
    {
      identifiers: {},
      title,
      authors: ["Bai", "Deng", "Cao"],
      year: 2024,
    },
    [
      candidate({
        sourceRecordID: "10.1109/mlcad62225.2024.10740261",
        identifiers: { doi: "10.1109/mlcad62225.2024.10740261" },
        title,
        authors: ["Bai", "Deng", "Cao"].map((family) => ({ family })),
        publicationYear: 2024,
      }),
      candidate({
        sourceRecordID: "10.1145/3670474.3685965",
        identifiers: { doi: "10.1145/3670474.3685965" },
        title,
        authors: ["Bai", "Deng", "Cao"].map((family) => ({ family })),
        publicationYear: 2024,
      }),
    ],
  );

  assert.equal(result.status, "confirmed");
  assert.equal(result.candidates.length, 2);
  assert.ok(
    result.candidates.every(({ matchedFields }) =>
      ["title", "first-author", "authors", "year"].every((field) =>
        matchedFields.includes(field),
      ),
    ),
  );
});

test("different DOI records remain ambiguous when any ordered author list conflicts", () => {
  const title = "A Jointly Published Paper";
  const result = matchScholarlyCandidates(
    {
      identifiers: {},
      title,
      authors: ["Smith", "Jones"],
      year: 2024,
    },
    [
      candidate({
        sourceRecordID: "10.1000/one",
        identifiers: { doi: "10.1000/one" },
        title,
        authors: [{ family: "Smith" }, { family: "Jones" }],
        publicationYear: 2024,
      }),
      candidate({
        sourceRecordID: "10.1000/two",
        identifiers: { doi: "10.1000/two" },
        title,
        authors: [{ family: "Smith" }, { family: "Other" }],
        publicationYear: 2024,
      }),
    ],
  );

  assert.equal(result.status, "ambiguous");
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

test("an exact title and year can confirm a candidate when the citation has no parsed authors", () => {
  const result = matchScholarlyCandidates(
    {
      identifiers: {},
      title:
        "CSyn-fp: Standard Cell Synthesis of Advanced Nodes With Simultaneous Transistor Folding and Placement",
      authors: [],
      year: 2024,
    },
    [
      candidate({
        title:
          "CSyn-fp: Standard Cell Synthesis of Advanced Nodes With Simultaneous Transistor Folding and Placement",
        authors: [{ family: "Baek" }, { family: "Kim" }],
        publicationYear: 2024,
      }),
    ],
  );

  assert.equal(result.status, "confirmed");
  assert.deepEqual(result.candidate.matchedFields, ["title", "year"]);
});

test("strong author and year evidence tolerates publisher title formatting", () => {
  for (const example of [
    {
      referenceTitle:
        "High-correlation 3d routability estimation for congestionguided global routing",
      candidateTitle:
        "High-Correlation 3D Routability Estimation for Congestion-guided Global Routing",
      expectedAuthors: ["Zhou", "Jin", "Tan"],
      actualAuthors: ["Zhou", "Jin", "Tan"],
    },
    {
      referenceTitle:
        "Routenet: Routability prediction for mixed-size designs using convolutional neural network",
      candidateTitle: "RouteNet",
      expectedAuthors: ["Xie", "Huang", "Fang", "Ren", "Chen", "Hu"],
      actualAuthors: ["Xie", "Huang", "Fang", "Ren", "Chen", "Corporation"],
    },
  ]) {
    const result = matchScholarlyCandidates(
      {
        identifiers: {},
        title: example.referenceTitle,
        authors: example.expectedAuthors,
        year: 2020,
      },
      [
        candidate({
          title: example.candidateTitle,
          authors: example.actualAuthors.map((family) => ({ family })),
          publicationYear: 2020,
        }),
      ],
    );

    assert.equal(result.status, "confirmed");
  }
});

test("exact title and year do not depend on author spelling", () => {
  const result = matchScholarlyCandidates(
    {
      identifiers: {},
      title: "BonnCell: Automatic Cell Layout in the 7-nm Era",
      authors: ["Reported-Author"],
      year: 2020,
    },
    [
      candidate({
        title: "BonnCell: Automatic Cell Layout in the 7-nm Era",
        authors: [{ family: "Different-Author" }],
        publicationYear: 2020,
      }),
    ],
  );

  assert.equal(result.status, "confirmed");
});
