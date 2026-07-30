import assert from "node:assert/strict";
import test from "node:test";
import {
  LiteratureCacheRepository,
  type CacheStorage,
} from "../../src/cache/cache-repository";

class MemoryStorage implements CacheStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  async read(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async write(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error("disk full");
    this.values.set(key, value);
  }
}

test("versioned cache returns only the exact MinerU and provider identity", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository<{ title: string }>(storage);
  const identity = {
    libraryID: 3,
    attachmentID: 44,
    attachmentKey: "ABCDEFGH",
    sourceFingerprint: "sha256-a",
    providerSchemaVersion: 2,
    provider: "crossref",
    providerQueryVersion: 1,
    normalizedRequestKey: "doi:10.1000/example",
  };

  await cache.write(identity, { title: "Paper" });

  assert.deepEqual(await cache.read(identity), { title: "Paper" });
  assert.equal(
    await cache.read({ ...identity, sourceFingerprint: "sha256-b" }),
    undefined,
  );
});

test("persistent write failure is exposed instead of becoming memory success", async () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  const cache = new LiteratureCacheRepository(storage);

  await assert.rejects(
    cache.write(
      {
        libraryID: 3,
        attachmentID: 44,
        attachmentKey: "ABCDEFGH",
        sourceFingerprint: "sha256-a",
        providerSchemaVersion: 2,
        provider: "crossref",
        providerQueryVersion: 1,
        normalizedRequestKey: "doi:10.1000/example",
      },
      { title: "Paper" },
    ),
    /disk full/,
  );
});
