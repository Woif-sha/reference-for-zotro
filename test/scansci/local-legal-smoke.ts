import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  constants as fileConstants,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPythonScanSciPort,
  type PythonProcessRequest,
  type PythonScanSciRuntime,
} from "../../src/scansci/python-scan-sci-port";

const [destination, arxivID, ...extraArguments] = process.argv.slice(2);
if (!destination || !arxivID || extraArguments.length > 0) {
  throw new Error(
    "Usage: npm run test:scansci-smoke -- <absolute-destination> <arxiv-id>",
  );
}
await mkdir(destination, { recursive: true });

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(
  currentDirectory,
  "../../addon/python/reference_for_zotero_scansci",
);
const runtime: PythonScanSciRuntime = {
  async ensureModuleAssets() {},
  runProcess,
  files: {
    async pathExists(value) {
      try {
        await access(value);
        return true;
      } catch {
        return false;
      }
    },
    canonicalizeExisting: (value) => realpath(value),
    async createDirectory(value) {
      await mkdir(value, { recursive: true });
    },
    async createDirectoryExclusive(value) {
      await mkdir(value, { recursive: false });
    },
    readText: (value) => readFile(value, "utf8"),
    async commitExclusiveContained(
      _sourceRoot,
      source,
      destinationRoot,
      target,
    ) {
      const canonicalRoot = await realpath(destinationRoot);
      const canonicalParent = await realpath(path.dirname(target));
      const relative = path.relative(canonicalRoot, canonicalParent);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Final target escaped the smoke destination");
      }
      await copyFile(source, target, fileConstants.COPYFILE_EXCL);
    },
    async removeDirectory(value) {
      await rm(value, { recursive: true, force: true });
    },
  },
  nextRequestID: randomUUID,
};
const port = createPythonScanSciPort(runtime, {
  moduleRoot,
  hostArchitecture: hostArchitecture(),
});
const capability = await port.probe();
const target = path.join(destination, `RFZ legal smoke ${arxivID}.pdf`);
const [download] = await port.downloadPapers({
  items: [
    {
      itemID: "legal-smoke",
      paper: {
        title: `RFZ legal smoke ${arxivID}`,
        arxivID,
        primaryResultURL: `https://arxiv.org/abs/${arxivID}`,
      },
      canonicalFinalTarget: target,
    },
  ],
  downloadDestination: destination,
});
if (!download) throw new Error("ScanSci returned no smoke-test result");
const result = download.result;
if (result.status !== "downloaded") throw new Error(result.error);
process.stdout.write(`${JSON.stringify({ capability, result })}\n`);

function runProcess(request: PythonProcessRequest) {
  return new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
  }>((resolve, reject) => {
    const environment = { ...process.env };
    for (const name of request.removeEnvironment) delete environment[name];
    const child = spawn(request.command, request.arguments, {
      env: environment,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: request.workingDirectory,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(0, 1024 * 1024);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(0, 16 * 1024);
    });
    child.once("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, request.timeoutMilliseconds);
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? -1, stdout, stderr, timedOut });
    });
    child.stdin.end(request.stdin);
  });
}

function hostArchitecture(): "x64" | "arm64" | "x86" {
  if (process.arch === "x64") return "x64";
  if (process.arch === "arm64") return "arm64";
  if (process.arch === "ia32") return "x86";
  throw new Error(`Unsupported host architecture: ${process.arch}`);
}
