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
