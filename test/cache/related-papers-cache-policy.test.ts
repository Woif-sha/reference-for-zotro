import assert from "node:assert/strict";
import test from "node:test";
import { decideRelatedPapersCacheWrite } from "../../src/cache/related-papers-cache-policy";

test("completed results remain cacheable until an explicit refresh", () => {
  const results = {
    references: [
      {
        id: "reference:0",
        ordinal: 0,
        title: "Temporarily blocked paper",
        status: "unreachable" as const,
        statusText: "Paper landing page is unreachable",
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
