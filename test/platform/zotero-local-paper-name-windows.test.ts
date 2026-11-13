import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
import { assertNoWindowsReparsePoints } from "../../src/platform/zotero-windows-file-safety";

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

// Read the actual Win32 contract rather than teaching an isSymlink stub to
// recognize junctions: Gecko's Windows nsIFile reports false for those paths.
function nativeWindowsAttributes(
  paths: readonly string[],
): Record<string, number> {
  const ancestors = new Set<string>();
  for (const requested of paths) {
    let current = requested;
    while (!ancestors.has(current)) {
      ancestors.add(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class RfzAttributes {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint GetFileAttributesW(string path);
}
'@
$result = @{}
foreach ($path in (ConvertFrom-Json $env:RFZ_ATTRIBUTE_PATHS)) {
  $result[$path] = [RfzAttributes]::GetFileAttributesW($path)
}
ConvertTo-Json -Compress $result
`,
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          RFZ_ATTRIBUTE_PATHS: JSON.stringify([...ancestors]),
        },
      },
    ),
  ) as Record<string, number>;
}

function installWindowsFiles(
  root: string,
  storage: string,
  attributes: Record<string, number>,
  afterHash?: (path: string) => void,
) {
  const enumerated: string[] = [];
  const nativeCalls: string[] = [];
  let notify!: (event: string, type: string, ids: readonly number[]) => void;
  let report!: (result: Error | string) => void;
  const completion = new Promise<Error | string>((resolve) => {
    report = resolve;
  });
  Object.assign(globalThis, {
    PathUtils: { parent: (value: string) => path.dirname(value) },
    ChromeUtils: {
      importESModule(uri: string) {
        assert.equal(uri, "resource://gre/modules/ctypes.sys.mjs");
        return {
          ctypes: {
            winapi_abi: "winapi_abi",
            uint32_t: "uint32_t",
            char16_t: { ptr: "char16_t.ptr" },
            winLastError: 0,
            open(name: string) {
              assert.equal(name.toLowerCase(), "kernel32.dll");
              return {
                declare(...declaration: unknown[]) {
                  assert.deepEqual(declaration, [
                    "GetFileAttributesW",
                    "winapi_abi",
                    "uint32_t",
                    "char16_t.ptr",
                  ]);
                  return (value: string) => {
                    nativeCalls.push(value);
                    assert.ok(
                      Object.hasOwn(attributes, value),
                      `Unmeasured native path: ${value}`,
                    );
                    return attributes[value];
                  };
                },
                close() {},
              };
            },
          },
        };
      },
    },
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

function geckoWindowsFile(value: string): object {
  // Gecko InitWithPath removes a trailing backslash, including at drive roots.
  const filePath = value.replace(/\\$/u, "");
  return {
    path: filePath,
    get parent() {
      if (/^[A-Za-z]:$/u.test(filePath)) return null;
      const parent = path.win32.dirname(filePath);
      return parent === filePath ? null : geckoWindowsFile(parent);
    },
    exists: () => existsSync(value),
    isDirectory: () => statSync(value).isDirectory(),
    isFile: () => statSync(value).isFile(),
    isSymlink: () => false,
    normalize() {},
    contains: (other: { path: string }) =>
      other.path.toLowerCase().startsWith(`${value.toLowerCase()}\\`),
    equals: (other: { path: string }) =>
      value.toLowerCase() === other.path.toLowerCase(),
  };
}
