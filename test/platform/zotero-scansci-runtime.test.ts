import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createZoteroScanSciRuntime } from "../../src/platform/zotero-scansci-runtime";
import {
  geckoWindowsFile,
  installNativeWindowsAttributes,
  nativeWindowsAttributes,
} from "./windows-file-fixture";

test("Zotero subprocess streams complete JSONL lines and applies bounded environment removal", async () => {
  const stdin = new FakePipe([]);
  const stdout = new FakePipe(['{"first":1}\n{"sec', 'ond":2}\r\n']);
  const stderr = new FakePipe(["diagnostic"]);
  const calls: unknown[] = [];
  const handle = processHandle(
    stdin,
    stdout,
    stderr,
    Promise.resolve({ exitCode: 0 }),
  );
  installSubprocess(handle, calls);
  const lines: string[] = [];
  const runtime = createZoteroScanSciRuntime({
    packagedRootURI: "resource://reference-for-zotero/",
    moduleRoot: "C:\\profile\\module",
  });

  const result = await runtime.runProcess({
    command: "python",
    arguments: ["sidecar.py"],
    stdin: '{"request":1}\n',
    timeoutMilliseconds: 1_000,
    removeEnvironment: ["HTTP_PROXY", "TOKEN"],
    workingDirectory: "E:\\paper\\ScanSciCache\\request",
    onStdoutLine: (line) => {
      lines.push(line);
    },
  });

  assert.deepEqual(lines, ['{"first":1}', '{"second":2}']);
  assert.equal(stdin.written, '{"request":1}\n');
  assert.equal(stdin.closed, true);
  assert.deepEqual(result, {
    exitCode: 0,
    stdout: '{"first":1}\n{"second":2}\r\n',
    stderr: "diagnostic",
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  });
  assert.deepEqual(calls, [
    {
      command: "C:\\Python\\python.exe",
      arguments: ["sidecar.py"],
      environment: { HTTP_PROXY: null, TOKEN: null },
      environmentAppend: true,
      stdout: "pipe",
      stderr: "pipe",
      workdir: "E:\\paper\\ScanSciCache\\request",
    },
  ]);
});

test("Zotero subprocess kills the sidecar when its abort signal fires", async () => {
  const completion = deferred<{ exitCode: number }>();
  let killed = 0;
  const handle = processHandle(
    new FakePipe([]),
    new FakePipe([]),
    new FakePipe([]),
    completion.promise,
    () => {
      killed += 1;
      completion.resolve({ exitCode: -1 });
    },
  );
  installSubprocess(handle, []);
  const runtime = createZoteroScanSciRuntime({
    packagedRootURI: "resource://reference-for-zotero/",
    moduleRoot: "C:\\profile\\module",
  });
  const controller = new AbortController();
  const running = runtime.runProcess({
    command: "C:\\Python\\python.exe",
    arguments: ["sidecar.py"],
    stdin: "{}\n",
    timeoutMilliseconds: 10_000,
    removeEnvironment: [],
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(running, { name: "AbortError" });
  assert.equal(killed, 1);
});

test("Zotero subprocess drains stdout and stderr after aborting the process", async () => {
  const completion = deferred<{ exitCode: number }>();
  const stdout = new DelayedClosePipe();
  const stderr = new DelayedClosePipe();
  const handle = processHandle(
    new FakePipe([]),
    stdout,
    stderr,
    completion.promise,
    () => {
      completion.resolve({ exitCode: -1 });
      stdout.releaseAfter(10);
      stderr.releaseAfter(10);
    },
  );
  installSubprocess(handle, []);
  const runtime = createZoteroScanSciRuntime({
    packagedRootURI: "resource://reference-for-zotero/",
    moduleRoot: "C:\\profile\\module",
  });
  const controller = new AbortController();
  const running = runtime.runProcess({
    command: "C:\\Python\\python.exe",
    arguments: ["sidecar.py"],
    stdin: "{}\n",
    timeoutMilliseconds: 10_000,
    removeEnvironment: [],
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(running, { name: "AbortError" });
  assert.equal(stdout.drained, true);
  assert.equal(stderr.drained, true);
});

test("Zotero subprocess reports timeout and explicit output truncation", async () => {
  const completion = deferred<{ exitCode: number }>();
  let killed = 0;
  const handle = processHandle(
    new FakePipe([]),
    new FakePipe(["x".repeat(1024 * 1024 + 1)]),
    new FakePipe(["y".repeat(32 * 1024 + 1)]),
    completion.promise,
    () => {
      killed += 1;
      completion.resolve({ exitCode: -1 });
    },
  );
  installSubprocess(handle, []);
  const runtime = createZoteroScanSciRuntime({
    packagedRootURI: "resource://reference-for-zotero/",
    moduleRoot: "C:\\profile\\module",
  });

  const result = await runtime.runProcess({
    command: "C:\\Python\\python.exe",
    arguments: ["sidecar.py"],
    stdin: "{}\n",
    timeoutMilliseconds: 1,
    removeEnvironment: [],
  });

  assert.equal(killed, 1);
  assert.equal(result.timedOut, true);
  assert.equal(result.stdout.length, 1024 * 1024);
  assert.equal(result.stderr.length, 32 * 1024);
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
});

for (const stage of ["write", "close"] as const) {
  for (const interruption of ["timeout", "abort"] as const) {
    test(`Zotero subprocess handles ${interruption} while stdin ${stage} is blocked`, async () => {
      const completion = deferred<{ exitCode: number }>();
      const blocked = deferred<void>();
      const started = deferred<void>();
      const stdin = new FakePipe([]);
      stdin[stage] = async () => {
        started.resolve();
        await blocked.promise;
      };
      let killed = 0;
      const handle = processHandle(
        stdin,
        new FakePipe([]),
        new FakePipe([]),
        completion.promise,
        () => {
          killed += 1;
          completion.resolve({ exitCode: -1 });
        },
      );
      installSubprocess(handle, []);
      const runtime = createZoteroScanSciRuntime({
        packagedRootURI: "resource://reference-for-zotero/",
        moduleRoot: "C:\\profile\\module",
      });
      const controller = new AbortController();
      const running = runtime.runProcess({
        command: "C:\\Python\\python.exe",
        arguments: ["sidecar.py"],
        stdin: "{}\n",
        timeoutMilliseconds: interruption === "timeout" ? 1 : 10_000,
        removeEnvironment: [],
        signal: controller.signal,
      });
      const observed = running.then(
        (result) => ({ kind: "result" as const, result }),
        (error: unknown) => ({ kind: "error" as const, error }),
      );
      await started.promise;
      if (interruption === "abort") controller.abort();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race([
          observed,
          new Promise<{ kind: "stalled" }>((resolve) => {
            timer = setTimeout(() => resolve({ kind: "stalled" }), 100);
          }),
        ]);
        assert.notEqual(outcome.kind, "stalled");
        assert.equal(killed, 1);
        if (interruption === "timeout") {
          assert.equal(outcome.kind, "result");
          if (outcome.kind === "result") {
            assert.equal(outcome.result.timedOut, true);
          }
        } else {
          assert.equal(outcome.kind, "error");
          if (outcome.kind === "error") {
            assert.equal((outcome.error as Error).name, "AbortError");
          }
        }
      } finally {
        clearTimeout(timer);
        blocked.reject(new Error("stdin closed after process interruption"));
        completion.resolve({ exitCode: -1 });
        await observed;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    });
  }
}

test("Zotero final commit moves one regular non-link file exclusively into the destination root", async () => {
  const moved: unknown[] = [];
  installFileSystem(
    {
      "E:\\paper": fakeFile("E:\\paper", "directory"),
      "E:\\paper\\ScanSciCache\\request": fakeFile(
        "E:\\paper\\ScanSciCache\\request",
        "directory",
      ),
      "E:\\paper\\ScanSciCache\\request\\paper.pdf": fakeFile(
        "E:\\paper\\ScanSciCache\\request\\paper.pdf",
        "file",
      ),
    },
    moved,
  );
  const runtime = createZoteroScanSciRuntime({
    packagedRootURI: "resource://reference-for-zotero/",
    moduleRoot: "C:\\profile\\module",
  });

  await runtime.files.commitExclusiveContained(
    "E:\\paper\\ScanSciCache\\request",
    "E:\\paper\\ScanSciCache\\request\\paper.pdf",
    "E:\\paper",
    "E:\\paper\\Canonical paper.pdf",
  );

  assert.deepEqual(moved, [
    [
      "E:\\paper\\ScanSciCache\\request\\paper.pdf",
      "E:\\paper\\Canonical paper.pdf",
      { noOverwrite: true },
    ],
  ]);
});

test("Zotero final commit rejects directories, links, and reparse traversal", async () => {
  const sourceRoot = "E:\\paper\\ScanSciCache\\request";
  const sourcePath = `${sourceRoot}\\paper.pdf`;
  const destination = "E:\\paper";
  const target = `${destination}\\Canonical paper.pdf`;

  for (const [source, expected] of [
    [fakeFile(sourcePath, "file", { exists: false }), /does not exist/u],
    [fakeFile(sourcePath, "directory"), /not a regular file/u],
    [
      fakeFile(sourcePath, "file", { symlink: true }),
      /symbolic link or junction/u,
    ],
    [
      fakeFile(sourcePath, "file", {
        canonicalPath: "E:\\elsewhere\\paper.pdf",
      }),
      /cannot traverse a symbolic link or junction/u,
    ],
  ] as const) {
    installFileSystem(
      {
        [destination]: fakeFile(destination, "directory"),
        [sourceRoot]: fakeFile(sourceRoot, "directory"),
        [sourcePath]: source,
      },
      [],
    );
    const runtime = createZoteroScanSciRuntime({
      packagedRootURI: "resource://reference-for-zotero/",
      moduleRoot: "C:\\profile\\module",
    });
    await assert.rejects(
      runtime.files.commitExclusiveContained(
        sourceRoot,
        sourcePath,
        destination,
        target,
      ),
      expected,
    );
  }
});

test(
  "Windows final commit rejects a selected destination junction and a junction ancestor",
  { skip: process.platform !== "win32" },
  async (t) => {
    for (const beneathJunction of [false, true]) {
      await t.test(
        beneathJunction ? "junction ancestor" : "destination junction",
        async () => {
          await withWindowsCommitFiles(
            async ({ root, sourceRoot, source, outside }) => {
              const junction = path.join(root, "selected");
              symlinkSync(outside, junction, "junction");
              const selected = beneathJunction
                ? path.join(junction, "papers")
                : junction;
              if (beneathJunction) mkdirSync(path.join(outside, "papers"));
              const target = path.join(selected, "Canonical.pdf");
              const native = nativeWindowsAttributes([source, selected]);
              assert.equal(native[junction] & 0x400, 0x400);
              const harness = installNativeCommitFiles(native);

              await assert.rejects(
                harness.runtime.files.commitExclusiveContained(
                  sourceRoot,
                  source,
                  selected,
                  target,
                ),
                /cannot traverse a symbolic link or junction/u,
              );

              assert.deepEqual(harness.moves, []);
              assert.equal(existsSync(source), true);
              assert.equal(existsSync(target), false);
            },
          );
        },
      );
    }
  },
);

test(
  "Windows final commit moves a regular file after checking native ancestor attributes",
  { skip: process.platform !== "win32" },
  async () => {
    await withWindowsCommitFiles(async ({ sourceRoot, source, outside }) => {
      const target = path.join(outside, "Canonical.pdf");
      const native = nativeWindowsAttributes([source, outside]);
      const harness = installNativeCommitFiles(native);

      await harness.runtime.files.commitExclusiveContained(
        sourceRoot,
        source,
        outside,
        target,
      );

      assert.deepEqual(harness.moves, [
        [source, target, { noOverwrite: true }],
      ]);
      assert.equal(existsSync(source), false);
      assert.equal(readFileSync(target, "utf8"), "%PDF-1.7\nrequest output");
      assert.ok(harness.nativeCalls.includes(source));
      assert.ok(harness.nativeCalls.includes(outside));
      assert.ok(harness.nativeCalls.includes(path.parse(outside).root));
    });
  },
);

async function withWindowsCommitFiles(
  run: (files: {
    root: string;
    sourceRoot: string;
    source: string;
    outside: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "rfz-scansci-commit-"));
  const sourceRoot = path.join(root, "request");
  const source = path.join(sourceRoot, "paper.pdf");
  const outside = path.join(root, "outside");
  mkdirSync(sourceRoot);
  mkdirSync(outside);
  writeFileSync(source, "%PDF-1.7\nrequest output");
  try {
    await run({ root, sourceRoot, source, outside });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function installNativeCommitFiles(attributes: Record<string, number>) {
  const nativeCalls = installNativeWindowsAttributes(attributes);
  const moves: unknown[] = [];
  Object.assign(globalThis, {
    Zotero: { File: { pathToFile: geckoWindowsFile } },
    IOUtils: {
      async move(source: string, target: string, options: unknown) {
        moves.push([source, target, options]);
        await rename(source, target);
      },
    },
  });
  return {
    nativeCalls,
    moves,
    runtime: createZoteroScanSciRuntime({
      packagedRootURI: "resource://reference-for-zotero/",
      moduleRoot: "C:\\profile\\module",
    }),
  };
}

class FakePipe {
  written = "";
  closed = false;

  constructor(private readonly chunks: string[]) {}

  async readString(): Promise<string> {
    return this.chunks.shift() ?? "";
  }

  async write(value: string): Promise<void> {
    this.written += value;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class DelayedClosePipe extends FakePipe {
  drained = false;
  private readonly release = deferred<void>();

  constructor() {
    super([]);
  }

  override async readString(): Promise<string> {
    await this.release.promise;
    this.drained = true;
    return "";
  }

  releaseAfter(milliseconds: number): void {
    setTimeout(() => this.release.resolve(), milliseconds);
  }
}

function processHandle(
  stdin: FakePipe,
  stdout: FakePipe,
  stderr: FakePipe,
  completion: Promise<{ exitCode: number }>,
  kill: () => void = () => undefined,
) {
  return {
    stdin,
    stdout,
    stderr,
    wait: () => completion,
    kill,
  };
}

function installSubprocess(handle: unknown, calls: unknown[]): void {
  Object.assign(globalThis, {
    ChromeUtils: {
      importESModule() {
        return {
          Subprocess: {
            async pathSearch() {
              return "C:\\Python\\python.exe";
            },
            async call(options: unknown) {
              calls.push(options);
              return handle;
            },
          },
        };
      },
    },
  });
}

type FakeFile = {
  path: string;
  exists(): boolean;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymlink(): boolean;
  normalize(): void;
  contains(other: FakeFile): boolean;
  equals(other: FakeFile): boolean;
};

function fakeFile(
  path: string,
  kind: "directory" | "file",
  options: Readonly<{
    exists?: boolean;
    symlink?: boolean;
    canonicalPath?: string;
  }> = {},
): FakeFile {
  return {
    path,
    exists: () => options.exists !== false,
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
    isSymlink: () => options.symlink === true,
    normalize() {
      this.path = options.canonicalPath ?? this.path;
    },
    contains(other: FakeFile) {
      return other.path
        .toLowerCase()
        .startsWith(`${this.path.toLowerCase()}\\`);
    },
    equals(other: FakeFile) {
      return this.path.toLowerCase() === other.path.toLowerCase();
    },
  };
}

function installFileSystem(
  files: Readonly<Record<string, FakeFile>>,
  moved: unknown[],
): void {
  installNativeWindowsAttributes(
    Object.fromEntries(Object.values(files).map((file) => [file.path, 0])),
  );
  Object.assign(globalThis, {
    Zotero: {
      File: {
        pathToFile(path: string) {
          const file = files[path];
          if (!file) throw new Error(`Unexpected test path: ${path}`);
          return { ...file };
        },
      },
    },
    IOUtils: {
      async move(source: string, target: string, options: unknown) {
        moved.push([source, target, options]);
      },
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}
