import assert from "node:assert/strict";
import test from "node:test";
import { createLiteratureCacheKey } from "../../src/cache/cache-key";

test("cache identity includes paper, provider, query and schema dimensions", () => {
  assert.equal(
    createLiteratureCacheKey({
      libraryID: 3,
      attachmentID: 44,
      attachmentKey: "ABCDEFGH",
      sourceFingerprint: "sha256",
      providerSchemaVersion: 2,
      provider: "crossref",
      providerQueryVersion: 3,
      normalizedRequestKey: "doi:10.1000/example",
    }),
    "v2:3:44:ABCDEFGH:sha256:crossref:qv3:doi:10.1000/example",
  );
});
