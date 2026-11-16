import assert from "node:assert/strict";
import test from "node:test";
import { decideRelatedPapersCacheWrite } from "../../src/cache/related-papers-cache-policy";

test("a completed resolved snapshot is cacheable", () => {
  const results = {
    references: [
      {
        id: "reference:0",
        ordinal: 0,
        title: "Paper",
        status: "resolved" as const,
        primaryResultURL: "https://publisher.example/paper",
      },
    ],
    citingPapers: [],
    citingPapersLoaded: 0,
  };

  assert.deepEqual(decideRelatedPapersCacheWrite(results), {
    kind: "write",
    value: results,
  });
});

test("provider and landing failures are never persisted as negative results", () => {
  for (const status of ["failed", "unreachable"] as const) {
    assert.deepEqual(
      decideRelatedPapersCacheWrite({
        references: [
          {
            id: "reference:0",
            ordinal: 0,
            title: "Temporarily blocked paper",
            status,
            statusText: "rate-limited",
          },
        ],
        citingPapers: [],
        citingPapersLoaded: 0,
      }),
      { kind: "skip" },
    );
  }
});

test("an incomplete matching snapshot cannot replace a complete cache", () => {
  const decision = decideRelatedPapersCacheWrite({
    references: [
      {
        id: "reference:0",
        ordinal: 0,
        title: "Still matching",
        status: "matching",
      },
    ],
    citingPapers: [],
    citingPapersLoaded: 0,
  });

  assert.deepEqual(decision, { kind: "skip" });
});
