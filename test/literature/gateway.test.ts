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

test("Citing papers keep a stable newest-first prefix across 10/30 and shrinking", async () => {
  let metadataRequests = 0;
  const edges = Array.from({ length: 35 }, (_, index) => {
    const number = index + 1;
    return {
      oci: `edge-${number}`,
      citing: `doi:10.2000/${number}`,
      cited: "doi:10.1000/current",
      creation: `2025-${String(12 - Math.floor(index / 3)).padStart(2, "0")}-${String(28 - (index % 3)).padStart(2, "0")}`,
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
  const shrunk = await gateway.getCitingPapers(
    { identifiers: { doi: "10.1000/current" } },
    10,
  );

  assert.equal(ten.status, "ready");
  assert.equal(ten.papers.length, 10);
  assert.equal(thirty.papers.length, 30);
  assert.deepEqual(thirty.papers.slice(0, 10), ten.papers);
  assert.deepEqual(shrunk.papers, ten.papers);
  assert.equal(metadataRequests, 2);
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
