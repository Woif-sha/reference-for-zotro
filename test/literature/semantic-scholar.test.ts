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
  let requestedURL = "";
  let requestInit: RequestInit | undefined;
  const ports: ProviderPorts = {
    fetch: async (input, init) => {
      requestedURL = input;
      requestInit = init;
      return Response.json({
        id: "https://openalex.org/W4285263863",
        doi: "https://doi.org/10.1109/ACCESS.2022.3184008",
        abstract_inverted_index: {
          Continued: [0],
          scaling: [1],
          "in&#x2019;s": [2],
        },
      });
    },
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
  assert.equal(new Headers(requestInit?.headers).get("Authorization"), null);
  assert.doesNotMatch(requestedURL, /api[_-]?key|bearer/iu);
});

test("OpenAlex Abstract lookup sends a configured API Key only as a Bearer header", async () => {
  const apiKey = "test-openalex-secret";
  let requestedURL = "";
  let requestInit: RequestInit | undefined;
  const ports: ProviderPorts = {
    fetch: async (input, init) => {
      requestedURL = input;
      requestInit = init;
      return Response.json({
        id: "https://openalex.org/W123",
        doi: "https://doi.org/10.1000/example",
        abstract_inverted_index: { Available: [0], abstract: [1] },
      });
    },
    clock: { now: () => new Date("2026-08-02T00:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  };

  const result = await lookupOpenAlexAbstract(
    "10.1000/example",
    ports,
    undefined,
    `  ${apiKey}  `,
  );

  assert.equal(
    new Headers(requestInit?.headers).get("Authorization"),
    `Bearer ${apiKey}`,
  );
  assert.doesNotMatch(requestedURL, new RegExp(apiKey, "u"));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(apiKey, "u"));
});

test("OpenAlex transport errors do not expose a configured API Key", async () => {
  const apiKey = "test-openalex-error-secret";
  const ports: ProviderPorts = {
    fetch: async () => {
      throw new Error(`request failed with Authorization: Bearer ${apiKey}`);
    },
    clock: { now: () => new Date("2026-08-02T00:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  };

  await assert.rejects(
    lookupOpenAlexAbstract("10.1000/example", ports, undefined, apiKey),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, new RegExp(apiKey, "u"));
      assert.equal(error.message, "openalex request failed");
      return true;
    },
  );
});

test("Abstract lookup reports its actual fallback source when OpenAlex has no record", async () => {
  const requested: Array<readonly [string, RequestInit | undefined]> = [];
  const ports: ProviderPorts = {
    fetch: async (input, init) => {
      requested.push([input, init]);
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

  const result = await lookupAvailableAbstract(
    "10.1000/example",
    ports,
    undefined,
    "test-openalex-fallback-secret",
  );

  assert.equal(result.source, "semantic-scholar");
  assert.deepEqual(
    requested.map(([url]) => new URL(url).hostname),
    ["api.openalex.org", "api.semanticscholar.org"],
  );
  assert.equal(
    new Headers(requested[0]?.[1]?.headers).get("Authorization"),
    "Bearer test-openalex-fallback-secret",
  );
  assert.equal(
    new Headers(requested[1]?.[1]?.headers).get("Authorization"),
    null,
  );
});
