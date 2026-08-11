import type {
  PythonProcessRequest,
  PythonProcessResult,
  PythonScanSciRuntime,
} from "../scansci/python-scan-sci-port";
import { createPythonScanSciPort } from "../scansci/python-scan-sci-port";
import type {
  ScanSciArchitecture,
  ScanSciPort,
} from "../scansci/scan-sci-port";

const MAX_STDOUT_CHARACTERS = 1024 * 1024;
const MAX_STDERR_CHARACTERS = 32 * 1024;
const MODULE_ASSETS = [
  "__init__.py",
  "bridge.py",
  "sidecar.py",
  "strict_http.py",
  "source-rules-v3.json",
  "requirements.lock",
  "institution-requirements.lock",
  "browser-runtime-policy-v3.json",
  "VENDORED-SOURCE.json",
  "MODIFICATIONS.md",
  "THIRD-PARTY-LICENSES/SCANSci-APACHE-2.0.txt",
  "vendored/__init__.py",
  "vendored/sources.py",
] as const;

type SubprocessPipe = {
  readString(): Promise<string>;
  write?(value: string): Promise<void>;
  close(): Promise<void>;
};

type SubprocessHandle = {
  stdin: SubprocessPipe;
  stdout: SubprocessPipe;
  stderr: SubprocessPipe;
  wait(): Promise<{ exitCode: number }>;
  kill(): Promise<void> | void;
};

type SubprocessModule = {
  pathSearch(command: string): Promise<string>;
  call(options: {
    command: string;
    arguments: readonly string[];
    environment: Readonly<Record<string, string | null>>;
    environmentAppend: true;
    stdout: "pipe";
    stderr: "pipe";
    workdir?: string;
  }): Promise<SubprocessHandle>;
};

export type ZoteroScanSciRuntimeOptions = Readonly<{
  packagedRootURI: string;
  moduleRoot: string;
}>;

export type ZoteroScanSciPortOptions = Readonly<{
  packagedRootURI: string;
  privateRuntimeRoot: string;
}>;

export function createZoteroScanSciPort(
  options: ZoteroScanSciPortOptions,
): ScanSciPort {
  const moduleRoot = joinWindows(options.privateRuntimeRoot, "module-3.0.0");
  const pythonRuntimeRoot = joinWindows(options.privateRuntimeRoot, "python");
  return createPythonScanSciPort(
    createZoteroScanSciRuntime({
      packagedRootURI: options.packagedRootURI,
      moduleRoot,
    }),
    {
      moduleRoot,
      privateRuntimeRoot: pythonRuntimeRoot,
      hostArchitecture: zoteroArchitecture(),
    },
  );
}

export function createZoteroScanSciRuntime(
  options: ZoteroScanSciRuntimeOptions,
): PythonScanSciRuntime {
  let materialization: Promise<void> | undefined;
  return {
    runProcess: runZoteroSubprocess,
    ensureModuleAssets() {
      materialization ??= materializeModuleAssets(options).catch((error) => {
        materialization = undefined;
        throw error;
      });
      return materialization;
    },
    files: {
      pathExists(path) {
        return IOUtils.exists(path);
      },
      async canonicalizeExisting(path) {
        const file = Zotero.File.pathToFile(path);
        if (!file.exists()) throw new Error(`Path does not exist: ${path}`);
        file.normalize();
        return file.path;
      },
      async createDirectory(path) {
        await IOUtils.makeDirectory(path, {
          createAncestors: true,
          ignoreExisting: true,
        });
      },
      async createDirectoryExclusive(path) {
        await IOUtils.makeDirectory(path, {
          createAncestors: false,
          ignoreExisting: false,
        });
      },
      readText(path) {
        return IOUtils.readUTF8(path);
      },
      async copyExclusiveContained(
        sourcePath,
        destinationRoot,
        destinationPath,
      ) {
        const root = Zotero.File.pathToFile(destinationRoot);
        const parent = Zotero.File.pathToFile(parentPath(destinationPath));
        root.normalize();
        parent.normalize();
        if (!root.contains(parent) && !root.equals(parent)) {
          throw new Error(
            "Final target parent escaped the download destination",
          );
        }
        if (root.isSymlink() || parent.isSymlink()) {
          throw new Error(
            "Final target cannot traverse a symbolic link or junction",
          );
        }
        await IOUtils.copy(sourcePath, destinationPath, { noOverwrite: true });
      },
      async removeDirectory(path) {
        const directory = Zotero.File.pathToFile(path);
        if (!directory.exists()) return;
        if (directory.isSymlink()) {
          throw new Error(
            "Owned ScanSci directory became a symbolic link or junction",
          );
        }
        directory.normalize();
        if (directory.path.toLowerCase() !== path.toLowerCase()) {
          throw new Error("Owned ScanSci directory changed before removal");
        }
        await IOUtils.remove(directory.path, {
          ignoreAbsent: true,
          recursive: true,
        });
      },
    },
    nextRequestID: () => crypto.randomUUID(),
  };
}

async function materializeModuleAssets(
  options: ZoteroScanSciRuntimeOptions,
): Promise<void> {
  await IOUtils.makeDirectory(options.moduleRoot, {
    createAncestors: true,
    ignoreExisting: true,
  });
  for (const relativePath of MODULE_ASSETS) {
    const response = await fetch(
      `${options.packagedRootURI}python/reference_for_zotero_scansci/${relativePath}`,
    );
    if (!response.ok) {
      throw new Error(`Packaged ScanSci asset is unavailable: ${relativePath}`);
    }
    const expected = await response.text();
    const target = joinWindows(options.moduleRoot, relativePath);
    const parent = parentPath(target);
    await IOUtils.makeDirectory(parent, {
      createAncestors: true,
      ignoreExisting: true,
    });
    if (await IOUtils.exists(target)) {
      if ((await IOUtils.readUTF8(target)) !== expected) {
        throw new Error(`Materialized ScanSci asset differs: ${relativePath}`);
      }
      continue;
    }
    const staging = `${target}.installing-${crypto.randomUUID()}`;
    try {
      await IOUtils.writeUTF8(staging, expected);
      await IOUtils.move(staging, target, { noOverwrite: true });
    } catch (error) {
      await IOUtils.remove(staging, { ignoreAbsent: true });
      throw error;
    }
  }
}

async function runZoteroSubprocess(
  request: PythonProcessRequest,
): Promise<PythonProcessResult> {
  if (request.signal?.aborted) throw abortError();
  const { Subprocess } = ChromeUtils.importESModule(
    "resource://gre/modules/Subprocess.sys.mjs",
  ) as { Subprocess: SubprocessModule };
  const command = isAbsoluteCommand(request.command)
    ? request.command
    : await Subprocess.pathSearch(request.command);
  const environment = Object.fromEntries(
    request.removeEnvironment.map((name) => [name, null]),
  );
  const process = await Subprocess.call({
    command,
    arguments: request.arguments,
    environment,
    environmentAppend: true,
    stdout: "pipe",
    stderr: "pipe",
    ...(request.workingDirectory ? { workdir: request.workingDirectory } : {}),
  });
  const stdout = readBounded(
    process.stdout,
    MAX_STDOUT_CHARACTERS,
    request.onStdoutLine,
  );
  const stderr = readBounded(process.stderr, MAX_STDERR_CHARACTERS);
  const wait = process.wait();
  const timeout = createTimeout(request.timeoutMilliseconds);
  const abort = createAbortWait(request.signal);
  let killed = false;
  const killOnce = async (): Promise<void> => {
    if (killed) return;
    killed = true;
    await process.kill();
  };
  try {
    if (!process.stdin.write)
      throw new Error("Subprocess stdin is unavailable");
    await process.stdin.write(request.stdin);
    await process.stdin.close();
    const outcome = await Promise.race([
      wait.then((result) => ({ kind: "exit" as const, result })),
      timeout.promise.then(() => ({ kind: "timeout" as const })),
      abort.promise.then(() => ({ kind: "abort" as const })),
    ]);
    if (outcome.kind === "abort") {
      await killOnce();
      await wait.catch(() => undefined);
      throw abortError();
    }
    if (outcome.kind === "timeout") {
      await killOnce();
      await wait;
      const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr]);
      return {
        exitCode: -1,
        stdout: stdoutResult.text,
        stderr: stderrResult.text,
        timedOut: true,
        stdoutTruncated: stdoutResult.truncated,
        stderrTruncated: stderrResult.truncated,
      };
    }
    const [stdoutResult, stderrResult] = await Promise.all([stdout, stderr]);
    return {
      exitCode: outcome.result.exitCode,
      stdout: stdoutResult.text,
      stderr: stderrResult.text,
      timedOut: false,
      stdoutTruncated: stdoutResult.truncated,
      stderrTruncated: stderrResult.truncated,
    };
  } catch (error) {
    await killOnce();
    await wait.catch(() => undefined);
    throw error;
  } finally {
    timeout.cancel();
    abort.cancel();
  }
}

async function readBounded(
  pipe: SubprocessPipe,
  maximumCharacters: number,
  onLine?: (line: string) => void | Promise<void>,
): Promise<Readonly<{ text: string; truncated: boolean }>> {
  let result = "";
  let lineBuffer = "";
  let truncated = false;
  let callbackError: unknown;
  let callbacksDisabled = false;
  let chunk: string;
  while ((chunk = await pipe.readString())) {
    const remaining = maximumCharacters - result.length;
    if (chunk.length > remaining) {
      truncated = true;
      callbacksDisabled = true;
      lineBuffer = "";
    }
    if (remaining > 0) result += chunk.slice(0, remaining);
    if (!onLine || callbackError || callbacksDisabled) continue;
    lineBuffer += chunk;
    const lines = lineBuffer.split(/\r?\n/u);
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      try {
        await onLine(line);
      } catch (error) {
        callbackError = error;
        break;
      }
    }
  }
  if (onLine && !callbackError && lineBuffer) {
    try {
      await onLine(lineBuffer);
    } catch (error) {
      callbackError = error;
    }
  }
  if (callbackError) throw callbackError;
  return { text: result, truncated };
}

function createTimeout(milliseconds: number): {
  promise: Promise<void>;
  cancel(): void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    promise: new Promise((resolve) => {
      timer = setTimeout(resolve, milliseconds);
    }),
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

function createAbortWait(signal?: AbortSignal): {
  promise: Promise<void>;
  cancel(): void;
} {
  let listener: (() => void) | undefined;
  return {
    promise: new Promise((resolve) => {
      if (!signal) return;
      if (signal.aborted) {
        resolve();
        return;
      }
      listener = resolve;
      signal.addEventListener("abort", listener, { once: true });
    }),
    cancel() {
      if (listener) signal?.removeEventListener("abort", listener);
    },
  };
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}

function isAbsoluteCommand(command: string): boolean {
  return /^[A-Za-z]:[\\/]/u.test(command) || command.startsWith("/");
}

function parentPath(path: string): string {
  const normalized = path.replace(/\//gu, "\\").replace(/\\+$/u, "");
  const separator = normalized.lastIndexOf("\\");
  if (separator < 0) throw new Error("Final target has no parent directory");
  return normalized.slice(0, separator);
}

function joinWindows(left: string, right: string): string {
  return `${left.replace(/[\\/]+$/u, "")}\\${right.replace(/\//gu, "\\").replace(/^[\\/]+/u, "")}`;
}

function zoteroArchitecture(): ScanSciArchitecture {
  const abi = Services.appinfo.XPCOMABI.toLowerCase();
  if (abi.includes("x86_64") || abi.includes("amd64")) return "x64";
  if (abi.includes("aarch64") || abi.includes("arm64")) return "arm64";
  if (abi.includes("x86")) return "x86";
  throw new Error(
    `Unsupported Zotero architecture: ${Services.appinfo.XPCOMABI}`,
  );
}
