import assert from "node:assert/strict";
import test from "node:test";
import {
  LiteratureCacheRepository,
  type CacheStorage,
  type LiteratureCacheFileName,
  type LiteratureCacheFiles,
} from "../../src/cache/cache-repository";
import { lookupOpenAlexAbstract } from "../../src/literature/providers/openalex";
import type { ProviderPorts } from "../../src/literature/providers/types";

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
      abstract: "Do not persist this Crossref abstract",
      abstractSource: "crossref",
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
    retrievedAt: snapshotRetrievedAt(storage),
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
    retrievedAt: snapshotRetrievedAt(storage),
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

test("a configured OpenAlex API Key never enters abstract.json or other cache files", async () => {
  const apiKey = "test-openalex-cache-secret";
  let authorization: string | null = null;
  const ports: ProviderPorts = {
    fetch: async (_input, init) => {
      authorization = new Headers(init?.headers).get("Authorization");
      return Response.json({
        id: "https://openalex.org/W123",
        doi: "https://doi.org/10.1000/paper",
        abstract_inverted_index: { Cached: [0], abstract: [1] },
      });
    },
    clock: { now: () => new Date("2026-08-17T12:00:00.000Z") },
    scheduler: { sleep: async () => {} },
  };
  const loaded = await lookupOpenAlexAbstract(
    "10.1000/paper",
    ports,
    undefined,
    apiKey,
  );
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);

  await cache.write(identity, {
    references: [
      {
        id: "reference:0",
        ordinal: 0,
        title: "Paper",
        status: "resolved",
        primaryResultURL: "https://doi.org/10.1000/paper",
        doi: "10.1000/paper",
        abstract: loaded.text,
        abstractSource: loaded.source,
        abstractSourceRecordID: loaded.sourceRecordID,
        abstractRetrievedAt: "2026-08-17T12:00:00.000Z",
      },
    ],
    citingPapers: [],
    citingPapersLoaded: 0,
  });

  assert.equal(authorization, `Bearer ${apiKey}`);
  assert.match(
    storage.values.get("3-ABCDEFGH/abstract.json") ?? "",
    /"source": "openalex"/u,
  );
  assert.doesNotMatch(
    [...storage.values.values()].join("\n"),
    new RegExp(apiKey, "u"),
  );
});

test("paper cache restores Semantic Scholar Abstracts by DOI", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);
  const semanticScholarResults = {
    references: [
      {
        id: "reference:0",
        ordinal: 0,
        title: "Paper",
        status: "resolved" as const,
        primaryResultURL: "https://doi.org/10.1000/paper",
        doi: "10.1000/paper",
        abstract: "Locally cached Semantic Scholar Abstract",
        abstractSource: "semantic-scholar",
        abstractSourceRecordID: "semantic-scholar-paper-id",
        abstractRetrievedAt: "2026-08-17T12:00:00.000Z",
      },
    ],
    citingPapers: [],
    citingPapersLoaded: 0,
  };

  await cache.write(identity, semanticScholarResults);

  const abstracts = storage.values.get("3-ABCDEFGH/abstract.json") ?? "";
  assert.match(abstracts, /"source": "semantic-scholar"/u);
  assert.deepEqual(await cache.read(identity), {
    ...semanticScholarResults,
    retrievedAt: snapshotRetrievedAt(storage),
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

test("resolved snapshots expire after the landing-page TTL", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);
  await cache.write(identity, results);
  ageCache(storage, 24 * 60 * 60 * 1000 + 1000);

  assert.equal(await cache.read(identity), undefined);
});

test("writing Abstract updates preserves the restored snapshot retrieval time", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);
  await cache.write(identity, results);
  ageCache(storage, 23 * 60 * 60 * 1000);
  const retrievedAt = snapshotRetrievedAt(storage);
  const restored = await cache.read(identity);
  assert.ok(restored);

  await cache.write(identity, {
    ...restored,
    references: restored.references.map((paper) => ({
      ...paper,
      doi: "10.1000/paper",
      abstract: "Fetched Abstract",
      abstractSource: "openalex",
      abstractSourceRecordID: "https://openalex.org/W123",
      abstractRetrievedAt: new Date().toISOString(),
    })),
  });

  assert.equal(restored.retrievedAt, retrievedAt);
  assert.equal(snapshotRetrievedAt(storage), retrievedAt);
  const manifest = JSON.parse(
    storage.values.get("3-ABCDEFGH/manifest.json") ?? "{}",
  );
  assert.notEqual(manifest.updatedAt, retrievedAt);
});

test("Abstract updates cannot mix paper files from an earlier revision", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);
  await cache.write(identity, results);
  ageCache(storage, 23 * 60 * 60 * 1000);
  const key = "3-ABCDEFGH/references.json";
  const previousReferences = storage.values.get(key)!;
  const restored = await cache.read(identity);
  assert.ok(restored);

  await cache.write(identity, {
    ...restored,
    references: restored.references.map((paper) => ({
      ...paper,
      title: "Updated title",
    })),
  });
  storage.values.set(key, previousReferences);

  await assert.rejects(cache.read(identity), /different revisions/u);
});

test("source snapshot expiry is independent from a recent file revision", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);
  const retrievedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  await cache.write(identity, results);
  const key = "3-ABCDEFGH/manifest.json";
  const manifest = JSON.parse(storage.values.get(key) ?? "{}");
  storage.values.set(key, JSON.stringify({ ...manifest, retrievedAt }));

  assert.equal(await cache.read(identity), undefined);
});

test("existing schema 2 manifests use their revision time as source snapshot time", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);
  await cache.write(identity, results);
  const key = "3-ABCDEFGH/manifest.json";
  const manifest = JSON.parse(storage.values.get(key) ?? "{}");
  delete manifest.retrievedAt;
  storage.values.set(key, JSON.stringify(manifest));
  ageCache(storage, 23 * 60 * 60 * 1000);

  assert.equal(
    (await cache.read(identity))?.retrievedAt,
    snapshotRetrievedAt(storage),
  );
  ageCache(storage, 25 * 60 * 60 * 1000);
  assert.equal(await cache.read(identity), undefined);
});

test("an invalid source snapshot time cannot be persisted", async () => {
  const storage = new MemoryStorage();
  const cache = new LiteratureCacheRepository(storage);

  await assert.rejects(
    cache.write(identity, { ...results, retrievedAt: "not-a-date" }),
    /manifest.*invalid/u,
  );
  assert.equal(storage.values.size, 0);
});

test("negative search and empty Citations snapshots expire after one hour", async () => {
  for (const snapshot of [
    {
      ...results,
      references: [
        {
          id: "reference:0",
          ordinal: 0,
          title: "Paper",
          status: "unresolved" as const,
        },
      ],
    },
    { ...results, citingPapersLoaded: 10 },
  ]) {
    const storage = new MemoryStorage();
    const cache = new LiteratureCacheRepository(storage);
    await cache.write(identity, snapshot);
    ageCache(storage, 60 * 60 * 1000 + 1000);

    assert.equal(await cache.read(identity), undefined);
  }
});

test("old caches containing transient failures are not restored", async () => {
  for (const status of ["failed", "unreachable"] as const) {
    const storage = new MemoryStorage();
    const cache = new LiteratureCacheRepository(storage);
    await cache.write(identity, results);
    const key = "3-ABCDEFGH/references.json";
    const file = JSON.parse(storage.values.get(key) ?? "{}");
    file.papers[0].status = status;
    delete file.papers[0].landingURL;
    file.papers[0].statusText = "rate-limited";
    storage.values.set(key, JSON.stringify(file));

    assert.equal(await cache.read(identity), undefined);
  }
});

function ageCache(storage: MemoryStorage, elapsedMs: number): void {
  const updatedAt = new Date(Date.now() - elapsedMs).toISOString();
  for (const [key, raw] of storage.values) {
    const file = { ...JSON.parse(raw), updatedAt };
    if (key.endsWith("manifest.json") && "retrievedAt" in file) {
      file.retrievedAt = updatedAt;
    }
    storage.values.set(key, JSON.stringify(file));
  }
}

function snapshotRetrievedAt(storage: MemoryStorage): string {
  const manifest = JSON.parse(
    storage.values.get("3-ABCDEFGH/manifest.json") ?? "{}",
  );
  return (manifest.retrievedAt ?? manifest.updatedAt) as string;
}

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
