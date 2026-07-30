import assert from "node:assert/strict";
import test from "node:test";
import {
  createRelatedLiteratureGateway,
  type RelatedLiteraturePorts,
} from "../../src/literature/gateway";

const NOW = new Date("2026-07-30T00:00:00.000Z");

function ports(fetch: typeof globalThis.fetch): RelatedLiteraturePorts {
  return {
    fetch,
    clock: { now: () => NOW },
    scheduler: { sleep: async () => {} },
  };
}

test("exact DOI resolution uses registrar metadata and opens only the verified landing page", async () => {
  const seen: string[] = [];
  const gateway = createRelatedLiteratureGateway(
    ports(async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("api.crossref.org")) {
        return Response.json({
          message: {
            DOI: "10.1000/example",
            title: ["The Example Paper"],
            author: [{ family: "Smith", given: "Ada" }],
            published: { "date-parts": [[2024, 2, 3]] },
            "container-title": ["Journal of Examples"],
            URL: "https://doi.org/10.1000/example",
          },
        });
      }
      if (url.includes("api.datacite.org")) {
        return new Response(null, { status: 404 });
      }
      if (url === "https://doi.org/10.1000/example") {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://publisher.example/article" },
        });
      }
      if (url === "https://publisher.example/article") {
        return new Response("<html></html>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }),
  );

  const result = await gateway.resolveReference({
    identifiers: { doi: "10.1000/example" },
    title: "The Example Paper",
    authors: ["Smith"],
    year: 2024,
    channel: "journal",
  });

  assert.equal(result.status, "resolved");
  assert.equal(
    result.primaryResult.landingURL,
    "https://publisher.example/article",
  );
  assert.deepEqual(
    result.outcomes.map(({ source, status }) => [source, status]),
    [
      ["crossref", "success"],
      ["datacite", "no-candidate"],
    ],
  );
  assert.ok(seen.includes("https://doi.org/10.1000/example"));
});

test("DataCite string publisher is retained as venue metadata", async () => {
  const gateway = createRelatedLiteratureGateway(
    ports(async (input) => {
      const url = String(input);
      if (url.includes("api.crossref.org")) {
        return new Response(null, { status: 404 });
      }
      if (url.includes("api.datacite.org")) {
        return Response.json({
          data: {
            id: "10.2000/dataset",
            attributes: {
              doi: "10.2000/dataset",
              titles: [{ title: "A Dataset" }],
              creators: [{ familyName: "Smith", givenName: "Ada" }],
              publicationYear: 2025,
              publisher: "Example Repository",
              url: "https://doi.org/10.2000/dataset",
            },
          },
        });
      }
      if (url.startsWith("https://doi.org/")) {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://repository.example/dataset" },
        });
      }
      return new Response("<html></html>", {
        headers: { "Content-Type": "text/html" },
      });
    }),
  );

  const result = await gateway.resolveReference({
    identifiers: { doi: "10.2000/dataset" },
    title: "A Dataset",
    authors: ["Smith"],
    year: 2025,
    channel: "dataset",
  });

  assert.equal(result.status, "resolved");
  assert.equal(result.primaryResult.venue, "Example Repository");
});

test("Citing papers keep a stable newest-first prefix across 10/30/50 and shrinking", async () => {
  let metadataRequests = 0;
  const edges = Array.from({ length: 55 }, (_, index) => {
    const number = index + 1;
    return {
      oci: `edge-${number}`,
      citing: `doi:10.2000/${number}`,
      cited: "doi:10.1000/current",
      creation: new Date(Date.UTC(2025, 11, 31 - index))
        .toISOString()
        .slice(0, 10),
    };
  });
  const gateway = createRelatedLiteratureGateway(
    ports(async (input) => {
      const url = String(input);
      if (url.includes("/index/v2/citations/")) return Response.json(edges);
      if (url.includes("/meta/v1/metadata/")) {
        metadataRequests += 1;
        const encoded = url.split("/metadata/")[1];
        const ids = encoded.split("__").map(decodeURIComponent);
        return Response.json(
          ids.map((id) => {
            const doi = id.replace(/^doi:/u, "");
            return {
              id: `doi:${doi} omid:br/${doi.split("/")[1]}`,
              title: `Paper ${doi}`,
              author: "Smith, Ada",
              pub_date: "2025",
              venue: "Journal",
            };
          }),
        );
      }
      if (url.startsWith("https://doi.org/")) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: `https://publisher.example/${url.split("/").at(-1)}`,
          },
        });
      }
      if (url.startsWith("https://publisher.example/")) {
        return new Response("<html></html>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }),
  );

  const ten = await gateway.getCitingPapers(
    { identifiers: { doi: "10.1000/current" } },
    10,
  );
  const thirty = await gateway.getCitingPapers(
    { identifiers: { doi: "10.1000/current" } },
    30,
  );
  const fifty = await gateway.getCitingPapers(
    { identifiers: { doi: "10.1000/current" } },
    50,
  );
  const shrunk = await gateway.getCitingPapers(
    { identifiers: { doi: "10.1000/current" } },
    10,
  );

  assert.equal(ten.status, "ready");
  assert.equal(ten.papers.length, 10);
  assert.equal(thirty.papers.length, 30);
  assert.equal(fifty.papers.length, 50);
  assert.deepEqual(thirty.papers.slice(0, 10), ten.papers);
  assert.deepEqual(fifty.papers.slice(0, 30), thirty.papers);
  assert.deepEqual(shrunk.papers, ten.papers);
  assert.equal(metadataRequests, 3);
});

test("citation sessions are isolated by paper generation and can be disposed", async () => {
  let edgeRequests = 0;
  const gateway = createRelatedLiteratureGateway(
    ports(async (input) => {
      const url = String(input);
      if (url.includes("/index/v2/citations/")) {
        edgeRequests += 1;
        return Response.json([]);
      }
      throw new Error(`Unexpected URL ${url}`);
    }),
  );
  const baseContext = {
    libraryID: 1,
    attachmentKey: "ATTACHMENT",
    sourceFingerprint: "fingerprint",
    requestedAt: "2026-07-30T00:00:00.000Z",
  };

  await gateway.getCitingPapers(
    {
      identifiers: { doi: "10.1000/current" },
      context: { ...baseContext, generation: 1 },
    },
    10,
  );
  await gateway.getCitingPapers(
    {
      identifiers: { doi: "10.1000/current" },
      context: { ...baseContext, generation: 2 },
    },
    10,
  );
  gateway.dispose();
  await gateway.getCitingPapers(
    {
      identifiers: { doi: "10.1000/current" },
      context: { ...baseContext, generation: 2 },
    },
    10,
  );

  assert.equal(edgeRequests, 3);
});

test("prefixed multi-index citation fields merge identity and preserve every provenance segment", async () => {
  const gateway = createRelatedLiteratureGateway(
    ports(async (input) => {
      const url = String(input);
      if (url.includes("/index/v2/citations/")) {
        return Response.json([
          {
            oci: "[coci] => edge-coci; [doci] => edge-doci",
            citing:
              "[coci] => doi:10.2000/shared; [doci] => DOI:10.2000/SHARED",
            cited:
              "[coci] => doi:10.1000/current; [doci] => doi:10.1000/current",
            creation: "[coci] => 2025-01-02; [doci] => 2025-01-02",
          },
          {
            oci: "[other] => edge-other",
            citing: "[other] => doi:10.2000/shared",
            cited: "[other] => doi:10.1000/current",
            creation: "[other] => 2025-01-02",
          },
        ]);
      }
      if (url.includes("/meta/v1/metadata/")) {
        return Response.json([
          {
            id: "doi:10.2000/shared omid:br/1",
            title: "Shared citing paper",
            author: "Smith, Ada",
            pub_date: "2025-01-02",
            venue: "Journal",
          },
        ]);
      }
      if (url === "https://doi.org/10.2000/shared") {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://publisher.example/shared" },
        });
      }
      if (url === "https://publisher.example/shared") {
        return new Response("<html></html>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }),
  );

  const result = await gateway.getCitingPapers(
    { identifiers: { doi: "10.1000/current" } },
    10,
  );

  assert.equal(result.status, "ready");
  assert.equal(result.papers.length, 1);
  assert.equal(result.availableCount, 1);
  assert.ok(
    result.papers[0]?.rawProvenance.some((value) => value.includes("[coci]")),
  );
  assert.ok(
    result.papers[0]?.rawProvenance.some((value) => value.includes("[doci]")),
  );
  assert.ok(
    result.papers[0]?.rawProvenance.some((value) => value.includes("[other]")),
  );
});

test("conflicting identifiers in a multi-index citation field fail explicitly", async () => {
  const gateway = createRelatedLiteratureGateway(
    ports(async (input) => {
      const url = String(input);
      if (url.includes("/index/v2/citations/")) {
        return Response.json([
          {
            oci: "[coci] => edge-coci; [doci] => edge-doci",
            citing: "[coci] => doi:10.2000/one; [doci] => doi:10.2000/two",
            cited: "doi:10.1000/current",
            creation: "2025",
          },
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    }),
  );

  const result = await gateway.getCitingPapers(
    { identifiers: { doi: "10.1000/current" } },
    10,
  );

  assert.deepEqual(result, {
    status: "failed",
    errorCode: "provider-contract-error",
    source: "opencitations-index",
    papers: [],
    limit: 10,
  });
});

test("missing edge dates use hydrated publication dates once and keep undated papers last", async () => {
  let metadataRequests = 0;
  const gateway = createRelatedLiteratureGateway(
    ports(async (input) => {
      const url = String(input);
      if (url.includes("/index/v2/citations/")) {
        return Response.json([
          { oci: "edge-1", citing: "doi:10.2000/one", cited: "doi:x" },
          { oci: "edge-2", citing: "doi:10.2000/two", cited: "doi:x" },
          { oci: "edge-3", citing: "doi:10.2000/three", cited: "doi:x" },
        ]);
      }
      if (url.includes("/meta/v1/metadata/")) {
        metadataRequests += 1;
        return Response.json([
          metadata("10.2000/one", "2023-04-01"),
          metadata("10.2000/two", ""),
          metadata("10.2000/three", "2025"),
        ]);
      }
      if (url.startsWith("https://doi.org/")) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: `https://publisher.example/${url.split("/").at(-1)}`,
          },
        });
      }
      if (url.startsWith("https://publisher.example/")) {
        return new Response("<html></html>", {
          headers: { "Content-Type": "text/html" },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }),
  );

  const result = await gateway.getCitingPapers(
    { identifiers: { pmid: "1234" } },
    10,
  );

  assert.equal(result.status, "ready");
  assert.deepEqual(
    result.papers.map(({ identifiers }) => identifiers.doi),
    ["10.2000/three", "10.2000/one", "10.2000/two"],
  );
  assert.equal(metadataRequests, 1);
});

test("required citation metadata failures do not become a successful empty result", async () => {
  const gateway = createRelatedLiteratureGateway(
    ports(async (input) => {
      const url = String(input);
      if (url.includes("/index/v2/citations/")) {
        return Response.json([
          {
            oci: "edge-1",
            citing: "doi:10.2000/incomplete",
            cited: "doi:10.1000/current",
            creation: "2025",
          },
        ]);
      }
      if (url.includes("/meta/v1/metadata/")) {
        return Response.json([
          {
            id: "doi:10.2000/incomplete",
            title: "",
            pub_date: "2025",
          },
        ]);
      }
      throw new Error(`Unexpected URL ${url}`);
    }),
  );

  const result = await gateway.getCitingPapers(
    { identifiers: { doi: "10.1000/current" } },
    10,
  );

  assert.deepEqual(result, {
    status: "failed",
    errorCode: "incomplete-metadata",
    source: "opencitations-meta",
    papers: [],
    limit: 10,
  });
});

function metadata(doi: string, pubDate: string) {
  return {
    id: `doi:${doi}`,
    title: `Paper ${doi}`,
    author: "Smith, Ada",
    pub_date: pubDate,
    venue: "Journal",
  };
}
