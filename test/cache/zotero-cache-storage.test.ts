import assert from "node:assert/strict";
import test from "node:test";

import {
  createZoteroCacheStorage,
  createZoteroRecommendationCacheStorage,
} from "../../src/platform/zotero-runtime";

test("an aborted staged write cannot overwrite the next generation cache", async () => {
  const files = new Map<string, Uint8Array>();
  const recommendationPath =
    "C:\\Zotero\\reference-for-zotero-cache\\v2\\papers\\1-ABCD1234\\recommendation.json";
  files.set(recommendationPath, new TextEncoder().encode("recommendation"));
  const touchedPaths: string[] = [];
  const firstStageStarted = deferred<void>();
  const releaseFirstStage = deferred<void>();
  let stagedWrites = 0;
  const previousZotero = globalThis.Zotero;
  const previousIOUtils = globalThis.IOUtils;
  Object.assign(globalThis, {
    Zotero: { DataDirectory: { dir: "C:\\Zotero" } },
    IOUtils: {
      exists: async (path: string) => files.has(path),
      read: async (path: string) => {
        const value = files.get(path);
        if (!value) throw new Error(`missing ${path}`);
        return value;
      },
      async write(path: string, data: Uint8Array) {
        touchedPaths.push(path);
        if (path.includes(".pending-") && ++stagedWrites === 1) {
          firstStageStarted.resolve();
          await releaseFirstStage.promise;
        }
        files.set(path, data);
      },
      async makeDirectory(path: string) {
        touchedPaths.push(path);
      },
      async move(sourcePath: string, destinationPath: string) {
        touchedPaths.push(sourcePath, destinationPath);
        const value = files.get(sourcePath);
        if (!value) throw new Error(`missing ${sourcePath}`);
        files.set(destinationPath, value);
        files.delete(sourcePath);
      },
      async remove(path: string) {
        touchedPaths.push(path);
        files.delete(path);
      },
    },
  });

  try {
    const storage = createZoteroCacheStorage();
    const obsolete = new AbortController();
    const firstWrite = storage.write(
      "1-ABCD1234",
      cacheFiles("obsolete"),
      obsolete.signal,
    );
    await firstStageStarted.promise;
    obsolete.abort();
    const secondWrite = storage.write("1-ABCD1234", cacheFiles("current"));
    let readSettled = false;
    const readDuringWrite = storage
      .read("1-ABCD1234", "references.json")
      .then((value) => {
        readSettled = true;
        return value;
      });
    await Promise.resolve();
    assert.equal(readSettled, false);
    releaseFirstStage.resolve();

    await assert.rejects(firstWrite, { name: "AbortError" });
    await secondWrite;

    assert.equal(await readDuringWrite, "current");
    assert.equal(
      new TextDecoder().decode(files.get(recommendationPath)),
      "recommendation",
    );
    assert.equal(
      [...files.keys()].some((path) => path.includes(".pending-")),
      false,
    );
    assert.equal(
      touchedPaths.every(
        (path) =>
          path ===
            "C:\\Zotero\\reference-for-zotero-cache\\v2\\papers\\1-ABCD1234" ||
          path.startsWith(
            "C:\\Zotero\\reference-for-zotero-cache\\v2\\papers\\1-ABCD1234\\",
          ),
      ),
      true,
    );
  } finally {
    Object.assign(globalThis, {
      Zotero: previousZotero,
      IOUtils: previousIOUtils,
    });
  }
});

test("an aborted recommendation stage preserves the previous complete file", async () => {
  const finalPath =
    "C:\\Zotero\\reference-for-zotero-cache\\v2\\papers\\1-ABCD1234\\recommendation.json";
  const files = new Map<string, Uint8Array>([
    [finalPath, new TextEncoder().encode("previous")],
  ]);
  const stageStarted = deferred<void>();
  const releaseStage = deferred<void>();
  const previousZotero = globalThis.Zotero;
  const previousIOUtils = globalThis.IOUtils;
  Object.assign(globalThis, {
    Zotero: { DataDirectory: { dir: "C:\\Zotero" } },
    IOUtils: {
      exists: async (path: string) => files.has(path),
      read: async (path: string) => files.get(path)!,
      async write(path: string, data: Uint8Array) {
        if (path.includes(".pending-")) {
          stageStarted.resolve();
          await releaseStage.promise;
        }
        files.set(path, data);
      },
      async makeDirectory() {},
      async move(sourcePath: string, destinationPath: string) {
        files.set(destinationPath, files.get(sourcePath)!);
        files.delete(sourcePath);
      },
      async remove(path: string) {
        files.delete(path);
      },
    },
  });

  try {
    const storage = createZoteroRecommendationCacheStorage();
    const controller = new AbortController();
    const write = storage.write("1-ABCD1234", "replacement", controller.signal);
    await stageStarted.promise;
    controller.abort();
    releaseStage.resolve();

    await assert.rejects(write, { name: "AbortError" });
    assert.equal(new TextDecoder().decode(files.get(finalPath)), "previous");
    assert.equal(
      [...files.keys()].some((path) => path.includes(".pending-")),
      false,
    );
  } finally {
    Object.assign(globalThis, {
      Zotero: previousZotero,
      IOUtils: previousIOUtils,
    });
  }
});

function cacheFiles(value: string) {
  return {
    "manifest.json": value,
    "references.json": value,
    "citations.json": value,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
