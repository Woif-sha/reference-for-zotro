import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDeterministicLandingPage,
  extractStableIdentifiers,
  findMalformedStableIdentifier,
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
  const text = "doi: not-a-doi";
  const identifiers = extractStableIdentifiers(text);

  assert.deepEqual(identifiers, {});
  assert.equal(findMalformedStableIdentifier(text, identifiers), "doi");
  assert.deepEqual(resolveDeterministicLandingPage(identifiers), {
    status: "unresolved",
    reason: "no-stable-identifier",
  });
});

test("trusted scholarly URLs discard request-specific query and fragment data", () => {
  const identifiers = extractStableIdentifiers(
    "https://dl.acm.org/doi/abs/10.1145/example?download=true#section",
  );

  assert.equal(
    identifiers.trustedSourceUrl,
    "https://dl.acm.org/doi/abs/10.1145/example",
  );
});
