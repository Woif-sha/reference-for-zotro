import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readdir, rename } from "node:fs/promises";
import test from "node:test";
import { startZoteroLocalPaperNameSync } from "../../src/platform/zotero-local-paper-name-sync";
import {
  assertNoWindowsReparsePoints,
  assertUnchangedNormalizedPath,
} from "../../src/platform/zotero-windows-file-safety";
import {
  geckoWindowsFile,
  installNativeWindowsAttributes,
  nativeWindowsAttributes,
} from "./windows-file-fixture";

const windowsOnly = { skip: process.platform !== "win32" };

test("UNC attribute contract checks descendants and stops at the share namespace root", () => {
  const share = "\\\\server\\share";
  const directory = `${share}\\papers`;
  const pdf = `${directory}\\old.pdf`;
  const harness = installWindowsFiles(directory, "unused", {
    [pdf]: 0x20,
    [directory]: 0x10,
  });

  assertNoWindowsReparsePoints(geckoWindowsFile(pdf) as nsIFile, "reparse");
  assert.deepEqual(harness.nativeCalls, [pdf, directory]);
  for (const root of [share, `${share}\\`]) {
    assertNoWindowsReparsePoints(geckoWindowsFile(root) as nsIFile, "reparse");
  }
  assert.deepEqual(harness.nativeCalls, [pdf, directory]);
});

test("UNC attribute contract preserves reparse and query failures inside the share", () => {
  const directory = "\\\\server\\share\\papers";
  const pdf = `${directory}\\old.pdf`;
  for (const [attributes, expected] of [
    [0x400, /reparse/u],
    [0xffffffff, /Cannot inspect Windows path attributes/u],
  ] as const) {
    const harness = installWindowsFiles(directory, "unused", {
      [pdf]: 0x20,
      [directory]: attributes,
    });

    assert.throws(
      () =>
        assertNoWindowsReparsePoints(
          geckoWindowsFile(pdf) as nsIFile,
          "reparse",
        ),
      expected,
    );
    assert.deepEqual(harness.nativeCalls, [pdf, directory]);
  }
});

test("Gecko drive-root attribute contract uses an absolute root rather than the drive current directory", () => {
  const pdf = "E:\\papers\\old.pdf";
  const harness = installWindowsFiles("E:\\papers", "unused", {
    [pdf]: 0x20,
    "E:\\papers": 0x10,
    "E:\\": 0x10,
  });

  assertNoWindowsReparsePoints(geckoWindowsFile(pdf) as nsIFile, "reparse");

  assert.deepEqual(harness.nativeCalls, [pdf, "E:\\papers", "E:\\"]);
});

test("Gecko drive-root normalization accepts a selected absolute root without accepting drive-relative paths", () => {
  assert.doesNotThrow(() =>
    assertUnchangedNormalizedPath(
      geckoWindowsFile("E:\\") as nsIFile,
      "E:\\",
      "Local paper root changed",
    ),
  );
  assert.throws(
    () =>
      assertUnchangedNormalizedPath(
        geckoWindowsFile("E:\\papers") as nsIFile,
        "E:papers",
        "Local paper root changed",
      ),
    /Local paper root changed/u,
  );
});

test(
  "Windows scan rejects a real junction before enumerating its external PDFs",
  windowsOnly,
  async () => {
    await withPaperDirectories(async ({ root, outside, storage }) => {
      const junction = path.join(root, "external");
      const externalPdf = path.join(outside, "old.pdf");
      writeFileSync(externalPdf, readFileSync(storage));
      symlinkSync(outside, junction, "junction");
      const native = nativeWindowsAttributes([root, junction, externalPdf]);
      assert.equal(native[junction] & 0x400, 0x400);
      const harness = installWindowsFiles(root, storage, native);

      const result = await harness.synchronize();

      assert.ok(result instanceof Error);
      assert.match(result.message, /symbolic link or junction/u);
      assert.deepEqual(harness.enumerated, [root]);
      assert.equal(existsSync(externalPdf), true);
      assert.equal(existsSync(path.join(outside, "Canonical.pdf")), false);
    });
  },
);

test(
  "Windows scan rejects a selected root beneath a real junction",
  windowsOnly,
  async () => {
    await withPaperDirectories(async ({ root, outside, storage }) => {
      const nested = path.join(outside, "papers");
      mkdirSync(nested);
      const externalPdf = path.join(nested, "old.pdf");
      writeFileSync(externalPdf, readFileSync(storage));
      const junction = path.join(root, "external");
      symlinkSync(outside, junction, "junction");
      const selectedRoot = path.join(junction, "papers");
      const native = nativeWindowsAttributes([selectedRoot]);
      const harness = installWindowsFiles(selectedRoot, storage, native);

      const result = await harness.synchronize();

      assert.ok(result instanceof Error);
      assert.match(result.message, /symbolic link or junction/u);
      assert.deepEqual(harness.enumerated, []);
      assert.equal(existsSync(externalPdf), true);
    });
  },
);

test(
  "Windows rename rechecks a directory replaced with a junction after scanning",
  windowsOnly,
  async () => {
    await withPaperDirectories(async ({ root, outside, storage }) => {
      const nested = path.join(root, "papers");
      mkdirSync(nested);
      const source = path.join(nested, "old.pdf");
      const externalPdf = path.join(outside, "old.pdf");
      writeFileSync(source, readFileSync(storage));
      writeFileSync(externalPdf, readFileSync(storage));
      const native = nativeWindowsAttributes([source, nested]);
      const harness = installWindowsFiles(
        root,
        storage,
        native,
        (hashedPath) => {
          if (hashedPath !== source) return;
          renameSync(nested, path.join(root, "original-papers"));
          symlinkSync(outside, nested, "junction");
          Object.assign(native, nativeWindowsAttributes([source, nested]));
        },
      );

      const result = await harness.synchronize();

      assert.ok(result instanceof Error);
      assert.match(result.message, /symbolic link or junction/u);
      assert.equal(existsSync(externalPdf), true);
      assert.equal(existsSync(path.join(outside, "Canonical.pdf")), false);
    });
  },
);

test(
  "Windows synchronization renames a regular nested PDF using native attributes",
  windowsOnly,
  async () => {
    await withPaperDirectories(async ({ root, storage }) => {
      const nested = path.join(root, "papers");
      mkdirSync(nested);
      const source = path.join(nested, "old.pdf");
      writeFileSync(source, readFileSync(storage));
      const harness = installWindowsFiles(
        root,
        storage,
        nativeWindowsAttributes([source]),
      );

      const result = await harness.synchronize();

      assert.equal(typeof result, "string");
      assert.equal(existsSync(source), false);
      assert.deepEqual(
        readFileSync(path.join(nested, "Canonical.pdf")),
        readFileSync(storage),
      );
      assert.ok(harness.nativeCalls.includes(source));
    });
  },
);

async function withPaperDirectories(
  run: (directories: {
    root: string;
    outside: string;
    storage: string;
  }) => Promise<void>,
): Promise<void> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "rfz-native-path-"));
  const root = path.join(temporaryRoot, "papers");
  const outside = path.join(temporaryRoot, "outside");
  const storage = path.join(temporaryRoot, "storage", "Canonical.pdf");
  mkdirSync(root);
  mkdirSync(outside);
  mkdirSync(path.dirname(storage));
  writeFileSync(storage, "%PDF-1.7\nidentical local attachment");
  try {
    await run({ root, outside, storage });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function installWindowsFiles(
  root: string,
  storage: string,
  attributes: Record<string, number>,
  afterHash?: (path: string) => void,
) {
  const enumerated: string[] = [];
  const nativeCalls = installNativeWindowsAttributes(attributes);
  let notify!: (event: string, type: string, ids: readonly number[]) => void;
  let report!: (result: Error | string) => void;
  const completion = new Promise<Error | string>((resolve) => {
    report = resolve;
  });
  Object.assign(globalThis, {
    PathUtils: { parent: (value: string) => path.dirname(value) },
    Zotero: {
      File: { pathToFile: geckoWindowsFile },
      Items: {
        get: () => ({
          parentID: 1,
          isRegularItem: () => false,
          isAttachment: () => true,
          isPDFAttachment: () => true,
          isStoredFileAttachment: () => true,
          getFilePathAsync: async () => storage,
        }),
      },
      Notifier: {
        registerObserver(observer: { notify: typeof notify }) {
          notify = observer.notify;
          return "observer";
        },
        unregisterObserver() {},
      },
      logError: (error: Error) => report(error),
      debug: (message: string) => report(message),
    },
    IOUtils: {
      exists: async (value: string) => existsSync(value),
      async stat(value: string) {
        const info = statSync(value);
        return {
          type: info.isDirectory() ? "directory" : "regular",
          size: info.size,
        };
      },
      async getChildren(directory: string) {
        enumerated.push(directory);
        return (await readdir(directory)).map((name) =>
          path.join(directory, name),
        );
      },
      async computeHexDigest(value: string) {
        const hash = createHash("sha256")
          .update(readFileSync(value))
          .digest("hex");
        afterHash?.(value);
        return hash;
      },
      move: rename,
    },
  });
  return {
    enumerated,
    nativeCalls,
    async synchronize() {
      const handle = startZoteroLocalPaperNameSync(root);
      try {
        notify("modify", "item", [2]);
        return await completion;
      } finally {
        handle.shutdown();
      }
    },
  };
}
