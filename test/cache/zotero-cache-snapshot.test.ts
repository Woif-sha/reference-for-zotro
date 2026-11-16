import assert from "node:assert/strict";
import test from "node:test";

import { LiteratureCacheRepository } from "../../src/cache/cache-repository";
import { createZoteroCacheStorage } from "../../src/platform/zotero-runtime";

test("a cache reader observes one complete revision while another Reader writes", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-11-15T00:00:00Z"),
  });
  const files = new Map<string, Uint8Array>();
  const manifestRead = deferred();
  const releaseManifest = deferred();
  let pauseManifest = false;
  const previousZotero = globalThis.Zotero;
  const previousIOUtils = globalThis.IOUtils;
  Object.assign(globalThis, {
    Zotero: { DataDirectory: { dir: "C:\\Zotero" } },
    IOUtils: {
      exists: async (path: string) => files.has(path),
      async read(path: string) {
        const value = files.get(path);
        if (!value) throw new Error(`Missing file: ${path}`);
        if (pauseManifest && path.endsWith("manifest.json")) {
          pauseManifest = false;
          manifestRead.resolve();
          await releaseManifest.promise;
        }
        return value;
      },
      async write(path: string, value: Uint8Array) {
        files.set(path, value);
      },
      async copy(source: string, destination: string) {
        files.set(destination, files.get(source)!.slice());
      },
      async move(source: string, destination: string) {
        files.set(destination, files.get(source)!);
        files.delete(source);
      },
      async remove(path: string) {
        files.delete(path);
      },
      async makeDirectory() {},
    },
  });
  t.after(() => {
    Object.assign(globalThis, {
      Zotero: previousZotero,
      IOUtils: previousIOUtils,
    });
  });
  const repository = new LiteratureCacheRepository(createZoteroCacheStorage());
  const identity = {
    libraryID: 1,
    attachmentID: 42,
    attachmentKey: "ABCD1234",
    sourceFingerprint: "current-source",
    providerSchemaVersion: 4,
    provider: "related-literature-gateway",
    providerQueryVersion: 21,
    normalizedRequestKey: "reader-related-papers",
  };
  const snapshot = (title: string) => ({
    references: [
      {
        id: "reference:0",
        ordinal: 0,
        title,
        status: "resolved" as const,
        primaryResultURL: "https://example.test/paper",
      },
    ],
    citingPapers: [],
    citingPapersLoaded: 0,
  });
  await repository.write(identity, snapshot("before"));
  pauseManifest = true;
  const reading = repository.read(identity);
  await manifestRead.promise;
  t.mock.timers.setTime(Date.parse("2026-11-15T00:00:01Z"));
  const writing = repository.write(identity, snapshot("after"));
  // Allow the other Reader to submit work while this read holds its manifest.
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseManifest.resolve();
  try {
    const restored = await reading;
    assert.equal(restored?.references[0]?.title, "before");
    await writing;
    assert.equal(
      (await repository.read(identity))?.references[0]?.title,
      "after",
    );
  } finally {
    releaseManifest.resolve();
    await Promise.allSettled([reading, writing]);
  }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
