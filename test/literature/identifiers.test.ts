import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDeterministicLandingPage,
  extractStableIdentifiers,
} from "../../src/literature/identifiers";

test("DOI evidence produces a canonical confirmed landing page", () => {
  const identifiers = extractStableIdentifiers(
    "[7] Example. doi:10.1145/1234567.8901234.",
  );

  assert.equal(identifiers.doi, "10.1145/1234567.8901234");
  assert.deepEqual(resolveDeterministicLandingPage(identifiers), {
    status: "confirmed",
    matchedBy: "doi",
    url: "https://doi.org/10.1145/1234567.8901234",
  });
});

test("arXiv evidence is normalized without treating the version as a new paper", () => {
  const identifiers = extractStableIdentifiers(
    "Available at https://arxiv.org/abs/1706.03762v7",
  );

  assert.equal(identifiers.arxiv, "1706.03762");
  assert.deepEqual(resolveDeterministicLandingPage(identifiers), {
    status: "confirmed",
    matchedBy: "arxiv",
    url: "https://arxiv.org/abs/1706.03762",
  });
});

test("invalid identifier-like text remains non-navigable", () => {
  const identifiers = extractStableIdentifiers("doi: not-a-doi");

  assert.deepEqual(identifiers, {});
  assert.deepEqual(resolveDeterministicLandingPage(identifiers), {
    status: "unresolved",
    reason: "no-stable-identifier",
  });
});
