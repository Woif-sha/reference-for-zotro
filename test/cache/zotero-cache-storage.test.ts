import assert from "node:assert/strict";
import test from "node:test";

import { createZoteroCacheStorage } from "../../src/platform/zotero-runtime";

test("an aborted staged write cannot overwrite the next generation cache", async () => {
  const files = new Map<string, Uint8Array>();
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
    const firstWrite = storage.write("same-key", "obsolete", obsolete.signal);
    await firstStageStarted.promise;
    obsolete.abort();
    const secondWrite = storage.write("same-key", "current");
    releaseFirstStage.resolve();

    await assert.rejects(firstWrite, { name: "AbortError" });
    await secondWrite;

    assert.equal(await storage.read("same-key"), "current");
    assert.equal(
      [...files.keys()].some((path) => path.includes(".pending-")),
      false,
    );
    assert.equal(
      touchedPaths.every(
        (path) =>
          path === "C:\\Zotero\\reference-for-zotero-cache\\v1" ||
          path.startsWith("C:\\Zotero\\reference-for-zotero-cache\\v1\\"),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
