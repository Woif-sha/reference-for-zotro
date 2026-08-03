import assert from "node:assert/strict";
import test from "node:test";
import {
  createRelatedLiteratureGateway,
  type RelatedLiteraturePorts,
} from "../../src/literature/gateway";

test("rate limits remain explicit and do not trigger an unplanned provider fallback", async () => {
  const waits: number[] = [];
  const seen: string[] = [];
  const ports: RelatedLiteraturePorts = {
    fetch: async (input) => {
      seen.push(String(input));
      return new Response(null, {
        status: 429,
      });
    },
    clock: { now: () => new Date("2026-07-30T00:00:00.000Z") },
    scheduler: {
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    },
  };
  const gateway = createRelatedLiteratureGateway(ports);

  const result = await gateway.resolveReference({
    identifiers: {},
    title: "A Journal Paper",
    authors: ["Smith"],
    year: 2024,
    channel: "journal",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.outcomes[0].errorCode, "rate-limited");
  assert.deepEqual(waits, [2000, 4000]);
  assert.ok(seen.every((url) => url.includes("api.crossref.org")));
});

test("an empty OpenCitations response is source-scoped absence, not global zero citations", async () => {
  const gateway = createRelatedLiteratureGateway({
    fetch: async () => Response.json([]),
    clock: { now: () => new Date("2026-07-30T00:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  });

  const result = await gateway.getCitingPapers(
    { identifiers: { doi: "10.1000/current" } },
    10,
  );

  assert.deepEqual(result, {
    status: "no-results",
    reason: "no-citations-from-source",
    source: "opencitations-index",
    papers: [],
    limit: 10,
  });
});

test("oversized provider responses fail explicitly instead of becoming partial success", async () => {
  const gateway = createRelatedLiteratureGateway({
    fetch: async () =>
      new Response("{}", {
        headers: { "Content-Length": String(10 * 1024 * 1024 + 1) },
      }),
    clock: { now: () => new Date("2026-07-30T00:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  });

  const result = await gateway.resolveReference({
    identifiers: {},
    title: "A Journal Paper",
    authors: ["Smith"],
    year: 2024,
    channel: "journal",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.outcomes[0].errorCode, "provider-response-too-large");
});

test("source-scoped empty Citations uses a one-hour negative TTL", async () => {
  let now = new Date("2026-07-30T00:00:00.000Z");
  let requests = 0;
  const gateway = createRelatedLiteratureGateway({
    fetch: async () => {
      requests += 1;
      return Response.json([]);
    },
    clock: { now: () => now },
    scheduler: { sleep: async () => {} },
  });
  const query = { identifiers: { doi: "10.1000/current" } } as const;

  await gateway.getCitingPapers(query, 10);
  await gateway.getCitingPapers(query, 10);
  assert.equal(requests, 1);

  now = new Date("2026-07-30T01:00:00.001Z");
  await gateway.getCitingPapers(query, 10);
  assert.equal(requests, 2);
});

test("a malformed successful search envelope is a provider contract failure, not no candidate", async () => {
  const gateway = createRelatedLiteratureGateway({
    fetch: async () => Response.json({ message: {} }),
    clock: { now: () => new Date("2026-07-30T00:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  });

  const result = await gateway.resolveReference({
    identifiers: {},
    title: "A Journal Paper",
    authors: ["Smith"],
    year: 2024,
    channel: "journal",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.outcomes[0].errorCode, "provider-contract-error");
});

test("a confirmed reachable record with required metadata missing stays incomplete", async () => {
  const gateway = createRelatedLiteratureGateway({
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("api.crossref.org")) {
        return Response.json({
          message: {
            DOI: "10.1000/incomplete",
            title: [],
            URL: "https://doi.org/10.1000/incomplete",
          },
        });
      }
      if (url.includes("api.datacite.org")) {
        return new Response(null, { status: 404 });
      }
      if (url === "https://doi.org/10.1000/incomplete") {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://publisher.example/incomplete" },
        });
      }
      if (url === "https://publisher.example/incomplete") {
        return new Response("<html></html>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    },
    clock: { now: () => new Date("2026-07-30T00:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  });

  const result = await gateway.resolveReference({
    identifiers: { doi: "10.1000/incomplete" },
    title: "Expected title",
    authors: ["Smith"],
    year: 2024,
    channel: "journal",
  });

  assert.equal(result.status, "unresolved");
  assert.equal(result.reason, "incomplete-metadata");
  assert.equal(result.candidates?.length, 1);
  assert.deepEqual(result.outcomes, [
    { source: "crossref", status: "success" },
    {
      source: "datacite",
      status: "no-candidate",
      errorCode: "no-candidate",
    },
  ]);
});

test("malformed search rows fail the whole provider response instead of becoming partial success", async () => {
  for (const channel of ["journal", "dataset"] as const) {
    const gateway = createRelatedLiteratureGateway({
      fetch: async (input) =>
        String(input).includes("crossref")
          ? Response.json({ message: { items: [null] } })
          : Response.json({ data: [null] }),
      clock: { now: () => new Date("2026-07-30T00:00:00.000Z") },
      scheduler: { sleep: async () => {} },
    });

    const result = await gateway.resolveReference({
      identifiers: {},
      title: "Malformed row",
      authors: ["Smith"],
      year: 2024,
      channel,
    });

    assert.equal(result.status, "failed");
    assert.equal(result.outcomes[0].errorCode, "provider-contract-error");
  }
});
