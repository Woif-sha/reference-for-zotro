import assert from "node:assert/strict";
import test from "node:test";
import { parseReferenceQuery } from "../../src/literature/reference-query";

test("quoted bibliography metadata becomes a conservative gateway query", () => {
  assert.deepEqual(
    parseReferenceQuery(
      "Smith, J. and Doe, A. “A Reliable Paper Title.” Journal of Tests, 2024. doi:10.1000/example",
    ),
    {
      identifiers: { doi: "10.1000/example" },
      title: "A Reliable Paper Title.",
      authors: ["Smith", "Doe"],
      year: 2024,
      venue: "Journal of Tests",
      channel: "journal",
    },
  );
});

test("unknown unquoted formats retain bibliographic text without inventing authors", () => {
  const result = parseReferenceQuery(
    "An unfamiliar bibliography layout without stable identifiers",
  );

  assert.equal(
    result.title,
    "An unfamiliar bibliography layout without stable identifiers",
  );
  assert.deepEqual(result.identifiers, {});
  assert.deepEqual(result.authors, []);
  assert.equal(result.channel, "unknown");
});

test("common unquoted author-title-venue entries use all three matching signals", () => {
  const result = parseReferenceQuery(
    "Vaswani, A., et al. Attention Is All You Need. Advances in Neural Information Processing Systems, 2017.",
  );

  assert.equal(result.title, "Attention Is All You Need");
  assert.deepEqual(result.authors, ["Vaswani"]);
  assert.equal(result.year, 2017);
  assert.equal(
    result.venue,
    "Advances in Neural Information Processing Systems",
  );
});
