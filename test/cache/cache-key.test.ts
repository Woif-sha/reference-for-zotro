import assert from "node:assert/strict";
import test from "node:test";
import { createLiteratureCacheKey } from "../../src/cache/cache-key";

test("cache identity includes library, attachment, MinerU fingerprint and schema", () => {
  assert.equal(
    createLiteratureCacheKey({
      libraryID: 3,
      attachmentID: 44,
      attachmentKey: "ABCDEFGH",
      sourceFingerprint: "sha256",
      providerSchemaVersion: 2,
    }),
    "v2:3:44:ABCDEFGH:sha256",
  );
});
