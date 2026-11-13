import assert from "node:assert/strict";
import test from "node:test";

import { loadMineruReferences } from "../../src/mineru/mineru-adapter";
import {
  createZoteroCacheStorage,
  createZoteroMinerUPorts,
} from "../../src/platform/zotero-runtime";

const DATA_DIRECTORY = "C:\\Zotero";
const PAPER_DIRECTORY = `${DATA_DIRECTORY}\\reference-for-zotero-cache\\v2\\papers\\1-ABCD1234`;
const CACHE_FILENAMES = [
  "references.json",
  "citations.json",
  "abstract.json",
  "manifest.json",
] as const;

test("cancellation during literature commit restores the entire previous revision", async (t) => {
  const files = cacheFiles("previous");
  const original = new Map(files);
  const controller = new AbortController();
  const io = installRuntime(t, files);
  const move = io.move;
  io.move = async (source, destination) => {
    await move(source, destination);
    if (source.includes(".pending-")) controller.abort();
  };

  await assert.rejects(
    createZoteroCacheStorage().write(
      "1-ABCD1234",
      replacementCache(),
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.deepEqual(files, original);
});

test("a failed literature commit restores replaced files and leaves recommendation intact", async (t) => {
  const files = cacheFiles("previous");
  files.set(
    `${PAPER_DIRECTORY}\\recommendation.json`,
    encode("recommendation"),
  );
  const original = new Map(files);
  const io = installRuntime(t, files);
  const move = io.move;
  io.move = async (source, destination) => {
    if (
      source.includes(".pending-") &&
      destination.endsWith("citations.json")
    ) {
      throw new Error("citation replacement failed");
    }
    await move(source, destination);
  };

  await assert.rejects(
    createZoteroCacheStorage().write("1-ABCD1234", replacementCache()),
    /citation replacement failed/u,
  );
  assert.deepEqual(files, original);
});

test("a cancelled first literature commit leaves no partial cache", async (t) => {
  const files = new Map<string, Uint8Array>();
  const controller = new AbortController();
  const io = installRuntime(t, files);
  const move = io.move;
  io.move = async (source, destination) => {
    await move(source, destination);
    if (source.includes(".pending-")) controller.abort();
  };
  await assert.rejects(
    createZoteroCacheStorage().write(
      "1-ABCD1234",
      replacementCache(),
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(files.size, 0);
});

test("a file transaction preserves an existing recovery backup on a name collision", async (t) => {
  t.mock.method(globalThis.crypto, "randomUUID", () => "reused-id");
  const files = cacheFiles("previous");
  const backup = `${PAPER_DIRECTORY}\\references.json.previous-reused-id`;
  files.set(backup, encode("recovery backup"));
  const original = new Map(files);
  installRuntime(t, files);

  await assert.rejects(
    createZoteroCacheStorage().write("1-ABCD1234", replacementCache()),
    /already exists/u,
  );
  assert.deepEqual(files, original);
});

test("cleanup failure retains commit and rollback errors and their recovery backup", async (t) => {
  const files = cacheFiles("previous");
  const io = installRuntime(t, files);
  const copy = io.copy;
  const move = io.move;
  const remove = io.remove;
  io.copy = async (source, destination, options) => {
    if (source.includes(".previous-")) throw new Error("rollback failed");
    await copy(source, destination, options);
  };
  io.move = async (source, destination) => {
    if (destination.endsWith("citations.json"))
      throw new Error("commit failed");
    await move(source, destination);
  };
  io.remove = async (path) => {
    if (path.includes("citations.json.pending-")) {
      throw new Error("cleanup failed");
    }
    await remove(path);
  };
  await assert.rejects(
    createZoteroCacheStorage().write("1-ABCD1234", replacementCache()),
    (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      const detail = JSON.stringify(error, (_key, value) =>
        value instanceof Error
          ? {
              message: value.message,
              cause: value.cause,
              errors:
                value instanceof AggregateError ? value.errors : undefined,
            }
          : value,
      );
      assert.match(detail, /commit failed/u);
      assert.match(detail, /rollback failed/u);
      assert.match(detail, /cleanup failed/u);
      return true;
    },
  );
  assert.ok(
    [...files].some(
      ([path, data]) =>
        path.includes("references.json.previous-") &&
        new TextDecoder().decode(data) === "previous",
    ),
  );
});

test("a MinerU normalization write failure preserves a readable original file set", async (t) => {
  const directory = `${DATA_DIRECTORY}\\llm-for-zotero-mineru\\42`;
  const markdown = "## References\n1. First    paper\n2. Second paper";
  const values = {
    "_llm_source.json": JSON.stringify({
      kind: "llm-for-zotero/mineru-cache-source",
      version: 2,
      attachmentId: 42,
      attachmentKey: "ATTACH01",
      parentItemKey: "PARENT01",
      origin: "parsed",
      recordedAt: "2026-07-30T00:00:00.000Z",
    }),
    "full.md": markdown,
    "manifest.json": JSON.stringify({
      totalChars: markdown.length,
      sections: [{ charStart: 0, charEnd: markdown.length }],
    }),
    "content_list.json": JSON.stringify([
      { type: "ref_text", text: "1. First    paper" },
      { type: "ref_text", text: "2. Second paper" },
    ]),
  };
  const files = new Map(
    Object.entries(values).map(([name, text]) => [
      `${directory}\\${name}`,
      encode(text),
    ]),
  );
  const original = new Map(files);
  const io = installRuntime(t, files);
  const write = io.write;
  let failManifest = true;
  io.write = async (path, value) => {
    if (failManifest && path.includes("manifest.json")) {
      failManifest = false;
      throw new Error("manifest write failed");
    }
    await write(path, value);
  };
  const ports = createZoteroMinerUPorts();

  await assert.rejects(loadMineruReferences(42, ports), {
    code: "md-cache-invalid",
  });
  assert.deepEqual(files, original);
  const result = await loadMineruReferences(42, ports);
  assert.deepEqual(
    result.entries.map(({ lookupText }) => lookupText),
    ["First paper", "Second paper"],
  );
});

function installRuntime(t: test.TestContext, files: Map<string, Uint8Array>) {
  const io = {
    exists: async (path: string) => files.has(path),
    read: async (path: string) => {
      const data = files.get(path);
      if (!data) throw new Error(`Missing file: ${path}`);
      return data;
    },
    async write(path: string, value: Uint8Array) {
      files.set(path, value);
    },
    async copy(
      source: string,
      destination: string,
      options?: { noOverwrite?: boolean },
    ) {
      if (options?.noOverwrite && files.has(destination)) {
        throw new Error(`File already exists: ${destination}`);
      }
      files.set(destination, (await io.read(source)).slice());
    },
    async move(source: string, destination: string) {
      files.set(destination, await io.read(source));
      files.delete(source);
    },
    async remove(path: string) {
      files.delete(path);
    },
    async makeDirectory() {},
  };
  const previousZotero = globalThis.Zotero;
  const previousIOUtils = globalThis.IOUtils;
  Object.assign(globalThis, {
    IOUtils: io,
    Zotero: {
      DataDirectory: { dir: DATA_DIRECTORY },
      Items: {
        get(id: number) {
          return {
            id,
            key: id === 42 ? "ATTACH01" : "PARENT01",
            libraryID: 1,
            parentItemID: id === 42 ? 24 : null,
            isAttachment: () => id === 42,
          };
        },
      },
    },
  });
  t.after(() => {
    Object.assign(globalThis, {
      Zotero: previousZotero,
      IOUtils: previousIOUtils,
    });
  });
  return io;
}

function encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function cacheFiles(value: string) {
  return new Map(
    CACHE_FILENAMES.map((name) => [
      `${PAPER_DIRECTORY}\\${name}`,
      encode(value),
    ]),
  );
}

function replacementCache() {
  return Object.fromEntries(
    CACHE_FILENAMES.map((name) => [name, "replacement"]),
  ) as Record<(typeof CACHE_FILENAMES)[number], string>;
}
