import assert from "node:assert/strict";
import test from "node:test";
import {
  LiteratureCacheRepository,
  type CacheStorage,
  type LiteratureCacheFileName,
  type LiteratureCacheFiles,
} from "../../src/cache/cache-repository";

class MemoryStorage implements CacheStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  async read(
    directory: string,
    file: LiteratureCacheFileName,
  ): Promise<string | undefined> {
    return this.values.get(`${directory}/${file}`);
  }

  async write(
    directory: string,
    files: LiteratureCacheFiles,
    signal?: AbortSignal,
  ): Promise<void> {
    void signal;
    if (this.failWrites) throw new Error("disk full");
    for (const [file, value] of Object.entries(files)) {
      this.values.set(`${directory}/${file}`, value);
    }
  }
}

const identity = {
  libraryID: 3,
  attachmentID: 44,
  attachmentKey: "ABCDEFGH",
  sourceFingerprint: "sha256-a",
  providerSchemaVersion: 2,
  provider: "crossref",
  providerQueryVersion: 1,
  normalizedRequestKey: "reader-related-papers",
};

const results = {
  references: [
    {
      id: "reference:0",
      ordinal: 0,
      title: "Paper",
      status: "resolved" as const,
      primaryResultURL: "https://example.test/paper",
      abstract: "Do not persist this abstract",
      abstractSource: "semantic-scholar",
    },
  ],
  citingPapers: [],
  citingPapersLoaded: 0,
};

test("paper cache uses readable permanent files and restores landing URLs", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);

  await cache.write(identity, results);

  assert.deepEqual([...storage.values.keys()].sort(), [
    "3-ABCDEFGH/abstract.json",
    "3-ABCDEFGH/citations.json",
    "3-ABCDEFGH/manifest.json",
    "3-ABCDEFGH/references.json",
  ]);
  const manifest = storage.values.get("3-ABCDEFGH/manifest.json") ?? "";
  const references = storage.values.get("3-ABCDEFGH/references.json") ?? "";
  assert.match(manifest, /"schemaVersion": 2/u);
  assert.doesNotMatch(manifest, /expiresAt/u);
  assert.match(references, /"landingURL": "https:\/\/example\.test\/paper"/u);
  assert.doesNotMatch(references, /abstract|primaryResultURL/u);
  assert.deepEqual(await cache.read(identity), {
    references: [
      {
        id: "reference:0",
        ordinal: 0,
        title: "Paper",
        status: "resolved",
        primaryResultURL: "https://example.test/paper",
      },
    ],
    citingPapers: [],
    citingPapersLoaded: 0,
  });
});

test("paper cache restores OpenAlex Abstracts by DOI", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);
  const openAlexResults = {
    references: [
      {
        id: "reference:0",
        ordinal: 0,
        title: "Paper",
        status: "resolved" as const,
        primaryResultURL: "https://doi.org/10.1000/paper",
        doi: "https://doi.org/10.1000/PAPER",
        abstract: "Locally cached Abstract",
        abstractSource: "openalex",
        abstractSourceRecordID: "https://openalex.org/W123",
        abstractRetrievedAt: "2026-08-17T12:00:00.000Z",
      },
    ],
    citingPapers: [
      {
        id: "citation:0",
        ordinal: 0,
        title: "Same paper",
        status: "resolved" as const,
        primaryResultURL: "https://doi.org/10.1000/paper",
        doi: "10.1000/paper",
      },
    ],
    citingPapersLoaded: 10,
  };

  await cache.write(identity, openAlexResults);

  const abstracts = storage.values.get("3-ABCDEFGH/abstract.json") ?? "";
  assert.match(abstracts, /"doi": "10\.1000\/paper"/u);
  assert.match(abstracts, /"source": "openalex"/u);
  assert.deepEqual(await cache.read(identity), {
    references: [
      {
        ...openAlexResults.references[0],
        doi: "https://doi.org/10.1000/PAPER",
      },
    ],
    citingPapers: [
      {
        ...openAlexResults.citingPapers[0],
        abstract: "Locally cached Abstract",
        abstractSource: "openalex",
        abstractSourceRecordID: "https://openalex.org/W123",
        abstractRetrievedAt: "2026-08-17T12:00:00.000Z",
      },
    ],
    citingPapersLoaded: 10,
  });
});

test("an existing paper cache without abstract.json remains readable", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);
  await cache.write(identity, results);
  storage.values.delete("3-ABCDEFGH/abstract.json");

  const restored = await cache.read(identity);

  assert.equal(restored?.references[0]?.abstract, undefined);
});

test("paper cache misses when the source or provider identity changes", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);
  await cache.write(identity, results);

  assert.equal(
    await cache.read({ ...identity, sourceFingerprint: "sha256-b" }),
    undefined,
  );
  assert.equal(
    await cache.read({ ...identity, providerQueryVersion: 2 }),
    undefined,
  );
});

test("persistent write failure is exposed instead of becoming memory success", async () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  const cache = new LiteratureCacheRepository(storage);

  await assert.rejects(cache.write(identity, results), /disk full/);
});

test("cache writes carry the active generation abort signal to persistent storage", async () => {
  const storage = new MemoryStorage();
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  storage.write = async (_directory, _files, signal) => {
    receivedSignal = signal;
  };
  const cache = new LiteratureCacheRepository(storage);

  await cache.write(identity, results, controller.signal);

  assert.equal(receivedSignal, controller.signal);
});
