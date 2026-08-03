import assert from "node:assert/strict";
import test from "node:test";

import { lookupAvailableAbstract } from "../../src/literature/providers/abstract";
import { lookupOpenAlexAbstract } from "../../src/literature/providers/openalex";
import { lookupSemanticScholarAbstract } from "../../src/literature/providers/semantic-scholar";
import type { ProviderPorts } from "../../src/literature/providers/types";

test("Semantic Scholar Abstract lookup verifies the returned DOI identity", async () => {
  let requestedURL = "";
  const ports: ProviderPorts = {
    fetch: async (input) => {
      requestedURL = input;
      return Response.json({
        paperId: "semantic-paper-id",
        externalIds: { DOI: "10.1109/ACCESS.2022.3184008" },
        abstract: "Continued scaling in accordance with Moore's law.",
      });
    },
    clock: { now: () => new Date("2026-08-02T00:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  };

  const result = await lookupSemanticScholarAbstract(
    "10.1109/access.2022.3184008",
    ports,
  );

  assert.match(requestedURL, /DOI%3A10\.1109%2Faccess\.2022\.3184008/u);
  assert.deepEqual(result, {
    text: "Continued scaling in accordance with Moore's law.",
    source: "semantic-scholar",
    sourceRecordID: "semantic-paper-id",
  });
});

test("OpenAlex Abstract lookup restores the DOI-matched inverted index", async () => {
  const ports: ProviderPorts = {
    fetch: async () =>
      Response.json({
        id: "https://openalex.org/W4285263863",
        doi: "https://doi.org/10.1109/ACCESS.2022.3184008",
        abstract_inverted_index: {
          Continued: [0],
          scaling: [1],
          "in&#x2019;s": [2],
        },
      }),
    clock: { now: () => new Date("2026-08-02T00:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  };

  const result = await lookupOpenAlexAbstract(
    "10.1109/access.2022.3184008",
    ports,
  );

  assert.deepEqual(result, {
    text: "Continued scaling in’s",
    source: "openalex",
    sourceRecordID: "https://openalex.org/W4285263863",
  });
});

test("Abstract lookup reports its actual fallback source when OpenAlex has no record", async () => {
  const requested: string[] = [];
  const ports: ProviderPorts = {
    fetch: async (input) => {
      requested.push(input);
      if (input.includes("api.openalex.org")) {
        return new Response(null, { status: 404 });
      }
      return Response.json({
        paperId: "semantic-paper-id",
        externalIds: { DOI: "10.1000/example" },
        abstract: "Fallback abstract.",
      });
    },
    clock: { now: () => new Date("2026-08-02T00:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  };

  const result = await lookupAvailableAbstract("10.1000/example", ports);

  assert.equal(result.source, "semantic-scholar");
  assert.deepEqual(
    requested.map((url) => new URL(url).hostname),
    ["api.openalex.org", "api.semanticscholar.org"],
  );
});
