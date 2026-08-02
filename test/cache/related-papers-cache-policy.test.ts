import assert from "node:assert/strict";
import test from "node:test";
import { decideRelatedPapersCacheWrite } from "../../src/cache/related-papers-cache-policy";

test("transient unreachable results are not persisted", () => {
  const decision = decideRelatedPapersCacheWrite(
    {
      references: [
        {
          id: "reference:0",
          ordinal: 0,
          title: "Temporarily blocked paper",
          status: "unreachable",
          statusText: "Paper landing page is unreachable",
        },
      ],
      citingPapers: [],
      citingPapersLoaded: 0,
    },
    Date.parse("2026-08-02T00:00:00.000Z"),
  );

  assert.deepEqual(decision, { kind: "remove" });
});
