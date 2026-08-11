import assert from "node:assert/strict";
import test from "node:test";
import { createZoteroScanSciRuntime } from "../../src/platform/zotero-scansci-runtime";

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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
