import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalPaperNameSynchronizer,
  type LocalPaperFilePort,
  type LocalPdf,
} from "../../src/application/local-paper-name-sync";

const PAPER_ROOT = "E:\\paper";
const STORAGE_PATH = "E:\\ZoteroData\\storage\\ABCD2345\\Smith - Paper.pdf";

test("renames the unique local PDF matching the read-only Zotero copy", async () => {
  const files = fakeFiles({
    [STORAGE_PATH]: { size: 100, hash: "paper-hash" },
    "E:\\paper\\download.pdf": { size: 100, hash: "paper-hash" },
    "E:\\paper\\other.pdf": { size: 80, hash: "other-hash" },
  });
  const synchronizer = new LocalPaperNameSynchronizer(PAPER_ROOT, files.port);

  const result = await synchronizer.sync(STORAGE_PATH);

  assert.deepEqual(result, {
    status: "renamed",
    sourcePath: "E:\\paper\\download.pdf",
    destinationPath: "E:\\paper\\Smith - Paper.pdf",
  });
  assert.deepEqual(files.moves, [
    ["E:\\paper\\download.pdf", "E:\\paper\\Smith - Paper.pdf"],
  ]);
  assert.equal(files.entries.has(STORAGE_PATH), true);
});

test("is idempotent when the local PDF already has Zotero's filename", async () => {
  const localPath = "E:\\paper\\Smith - Paper.pdf";
  const files = fakeFiles({
    [STORAGE_PATH]: { size: 100, hash: "paper-hash" },
    [localPath]: { size: 100, hash: "paper-hash" },
  });

  const result = await new LocalPaperNameSynchronizer(
    PAPER_ROOT,
    files.port,
  ).sync(STORAGE_PATH);

  assert.deepEqual(result, { status: "unchanged", path: localPath });
  assert.deepEqual(files.moves, []);
});

test("does not rename when multiple local PDFs have the same identity", async () => {
  const files = fakeFiles({
    [STORAGE_PATH]: { size: 100, hash: "paper-hash" },
    "E:\\paper\\one.pdf": { size: 100, hash: "paper-hash" },
    "E:\\paper\\archive\\two.pdf": { size: 100, hash: "paper-hash" },
  });

  const result = await new LocalPaperNameSynchronizer(
    PAPER_ROOT,
    files.port,
  ).sync(STORAGE_PATH);

  assert.deepEqual(result, {
    status: "ambiguous",
    storagePath: STORAGE_PATH,
    matchingPaths: ["E:\\paper\\one.pdf", "E:\\paper\\archive\\two.pdf"],
  });
  assert.deepEqual(files.moves, []);
});

test("does not overwrite an existing local filename", async () => {
  const files = fakeFiles({
    [STORAGE_PATH]: { size: 100, hash: "paper-hash" },
    "E:\\paper\\download.pdf": { size: 100, hash: "paper-hash" },
    "E:\\paper\\Smith - Paper.pdf": { size: 80, hash: "other-hash" },
  });

  const result = await new LocalPaperNameSynchronizer(
    PAPER_ROOT,
    files.port,
  ).sync(STORAGE_PATH);

  assert.deepEqual(result, {
    status: "conflict",
    sourcePath: "E:\\paper\\download.pdf",
    destinationPath: "E:\\paper\\Smith - Paper.pdf",
  });
  assert.deepEqual(files.moves, []);
});

test("ignores same-size PDFs whose SHA-256 does not match", async () => {
  const files = fakeFiles({
    [STORAGE_PATH]: { size: 100, hash: "paper-hash" },
    "E:\\paper\\other.pdf": { size: 100, hash: "other-hash" },
  });

  const result = await new LocalPaperNameSynchronizer(
    PAPER_ROOT,
    files.port,
  ).sync(STORAGE_PATH);

  assert.deepEqual(result, { status: "not-found", storagePath: STORAGE_PATH });
  assert.deepEqual(files.moves, []);
});

function fakeFiles(
  initial: Readonly<Record<string, Readonly<{ size: number; hash: string }>>>,
): {
  port: LocalPaperFilePort;
  entries: Map<string, Readonly<{ size: number; hash: string }>>;
  moves: Array<readonly [string, string]>;
} {
  const entries = new Map(Object.entries(initial));
  const moves: Array<readonly [string, string]> = [];
  const port: LocalPaperFilePort = {
    async listPdfs(root) {
      return [...entries]
        .filter(([path]) =>
          path.toLowerCase().startsWith(`${root.toLowerCase()}\\`),
        )
        .map(([path, entry]): LocalPdf => ({ path, size: entry.size }));
    },
    async inspect(path) {
      const entry = entries.get(path);
      return entry ? { path, size: entry.size } : undefined;
    },
    async sha256(path) {
      const entry = entries.get(path);
      if (!entry) throw new Error(`Missing fake file: ${path}`);
      return entry.hash;
    },
    async exists(path) {
      return entries.has(path);
    },
    async moveWithoutOverwrite(source, destination) {
      const entry = entries.get(source);
      if (!entry) throw new Error(`Missing fake source: ${source}`);
      if (entries.has(destination)) {
        throw new Error(`Fake destination exists: ${destination}`);
      }
      entries.delete(source);
      entries.set(destination, entry);
      moves.push([source, destination]);
    },
  };
  return { port, entries, moves };
}
