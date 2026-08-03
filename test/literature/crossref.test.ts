import assert from "node:assert/strict";
import test from "node:test";
import { searchCrossref } from "../../src/literature/providers/crossref";

test("Crossref search does not turn a parsed venue into a hard result filter", async () => {
  let requestedURL = "";
  await searchCrossref(
    {
      title: "High performance 4nm finfet platform",
      firstAuthor: "Yasuda-Masuoka",
      year: 2021,
      venue: "IEEE International Electron Devices Meeting (IEDM)",
    },
    {
      fetch: async (input) => {
        requestedURL = String(input);
        return Response.json({ message: { items: [] } });
      },
      clock: { now: () => new Date("2026-08-02T00:00:00.000Z") },
      scheduler: { sleep: async () => {} },
    },
  );

  const query = new URL(requestedURL).searchParams;
  assert.equal(query.has("query.container-title"), false);
  assert.equal(
    query.get("query.bibliographic"),
    "High performance 4nm finfet platform 2021",
  );
});

test("Crossref retains only a safe HTTPS version-of-record full text URL", async () => {
  const [candidate] = await searchCrossref(
    {
      title: "Cell Library Characterization",
      firstAuthor: "Bai",
      year: 2024,
    },
    {
      fetch: async () =>
        Response.json({
          message: {
            items: [
              {
                DOI: "10.1145/example",
                title: ["Cell Library Characterization"],
                author: [{ family: "Bai", given: "Tao" }],
                published: { "date-parts": [[2024]] },
                "container-title": ["MLCAD"],
                URL: "https://doi.org/10.1145/example",
                link: [
                  {
                    URL: "https://publisher.example/supplement.pdf",
                    "content-version": "am",
                  },
                  {
                    URL: "http://publisher.example/paper.pdf",
                    "content-version": "vor",
                  },
                  {
                    URL: "https://publisher.example/paper.pdf",
                    "content-version": "vor",
                  },
                ],
              },
            ],
          },
        }),
      clock: { now: () => new Date("2026-08-03T00:00:00.000Z") },
      scheduler: { sleep: async () => {} },
    },
  );

  assert.equal(candidate?.fullTextURL, "https://publisher.example/paper.pdf");
});
